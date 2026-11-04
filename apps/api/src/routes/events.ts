import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  eventInputSchema,
  eventPatchSchema,
  type ConflictDTO,
  type EventDetailDTO,
} from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { requireUser } from "../auth/session.ts";
import { accessMap, calendarAccess, canEdit, hasRole, requireCalendarEdit, type SessionUser } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { bump } from "../lib/cache.ts";
import { findConflicts } from "../lib/conflicts.ts";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.ts";
import { loadEventRows, occurrencesForCalendars } from "../lib/occurrences.ts";
import { publish } from "../lib/pubsub.ts";
import { computeRecurUntil, validateRRule } from "../lib/recurrence.ts";

const { events, eventAttendees, rooms, users } = schema;

const MAX_RANGE_DAYS = 120;

async function changed(...calendarIds: string[]) {
  const ids = [...new Set(calendarIds)];
  await bump(...ids.map((id) => `cal:${id}`), "rooms");
  await publish({ type: "calendar.changed", calendarIds: ids });
}

async function assertRoomUsable(user: SessionUser, roomId: string | null | undefined) {
  if (!roomId) return;
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  if (!room) throw badRequest("That room doesn't exist");
  if (room.requiresApproval && !hasRole(user, "admin", "staff", "scheduler")) {
    throw new HttpError(
      403,
      "approval_required",
      "This room needs approval. Send a booking request from the Rooms page instead.",
    );
  }
}

function conflictError(conflicts: ConflictDTO[]) {
  return new HttpError(409, "conflict", "This time is already taken", { conflicts });
}

async function eventDetail(user: SessionUser, id: string): Promise<EventDetailDTO> {
  const [row] = await loadEventRows(eq(events.id, id));
  if (!row) throw notFound("Event");
  const access = await calendarAccess(user, row.event.calendarId);
  if (!access) throw notFound("Event");
  const attendees = await db
    .select({ id: users.id, displayName: users.displayName, response: eventAttendees.response })
    .from(eventAttendees)
    .innerJoin(users, eq(users.id, eventAttendees.userId))
    .where(eq(eventAttendees.eventId, id));
  const e = row.event;
  const organizer = e.organizerId ? { id: e.organizerId, displayName: row.organizerName ?? "" } : null;
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    description: e.description,
    kind: e.kind,
    status: e.status,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
    timezone: e.timezone,
    rrule: e.rrule,
    roomId: e.roomId,
    roomLabel: row.roomLabel,
    locationText: e.locationText,
    organizer,
    attendees,
    sectionId: e.sectionId,
    canEdit: canEdit(access) || e.organizerId === user.id,
  };
}

async function requireEventEdit(user: SessionUser, id: string) {
  const [e] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!e) throw notFound("Event");
  const access = await calendarAccess(user, e.calendarId);
  if (!access) throw notFound("Event");
  if (!canEdit(access) && e.organizerId !== user.id) throw forbidden("You can't change this event");
  return e;
}

export async function eventRoutes(app: FastifyInstance) {
  /** Occurrences in a date range across the requested (visible) calendars. */
  app.get("/events", async (req) => {
    const user = requireUser(req);
    const q = z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
        calendars: z.string().optional(),
      })
      .parse(req.query);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to <= from) throw badRequest("`to` must be after `from`");
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw badRequest(`Ranges are limited to ${MAX_RANGE_DAYS} days`);
    }
    const visible = await accessMap(user);
    const requested = q.calendars ? q.calendars.split(",").filter(Boolean) : [...visible.keys()];
    const ids = requested.filter((id) => visible.has(id));
    return occurrencesForCalendars(ids, from, to);
  });

  app.get("/events/:id", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return eventDetail(user, id);
  });

  /** Dry-run conflict check used by the editor while the user types. */
  app.post("/events/check", async (req) => {
    const user = requireUser(req);
    const body = z
      .object({
        id: z.uuid().optional(),
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
        timezone: z.string().default("America/Phoenix"),
        rrule: z.string().nullable().optional(),
        roomId: z.uuid().nullable().optional(),
        attendeeIds: z.array(z.uuid()).default([]),
        allDay: z.boolean().default(false),
      })
      .parse(req.body);
    if (body.rrule && validateRRule(body.rrule)) return { conflicts: [] };
    let organizerId = user.id;
    if (body.id) {
      const [e] = await db.select({ organizerId: events.organizerId }).from(events).where(eq(events.id, body.id));
      organizerId = e?.organizerId ?? user.id;
    }
    const conflicts = await findConflicts({
      id: body.id,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      timezone: body.timezone,
      rrule: body.rrule ?? null,
      exdates: [],
      roomId: body.roomId ?? null,
      personIds: [...new Set([organizerId, ...body.attendeeIds])],
      allDay: body.allDay,
    });
    return { conflicts };
  });

  app.post("/events", async (req, reply) => {
    const user = requireUser(req);
    const input = eventInputSchema.parse(req.body);
    await requireCalendarEdit(user, input.calendarId);
    await assertRoomUsable(user, input.roomId);
    if (input.rrule) {
      const err = validateRRule(input.rrule);
      if (err) throw badRequest(err);
    }
    const series = {
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      timezone: input.timezone,
      rrule: input.rrule ?? null,
      exdates: [] as Date[],
    };
    if (!input.force) {
      const conflicts = await findConflicts({
        ...series,
        roomId: input.roomId ?? null,
        personIds: [...new Set([user.id, ...input.attendeeIds])],
        allDay: input.allDay,
      });
      if (conflicts.length) throw conflictError(conflicts);
    }
    const [created] = await db
      .insert(events)
      .values({
        calendarId: input.calendarId,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind,
        status: input.status,
        ...series,
        allDay: input.allDay,
        recurUntil: computeRecurUntil(series),
        roomId: input.roomId ?? null,
        locationText: input.locationText ?? null,
        organizerId: user.id,
      })
      .returning();
    if (input.attendeeIds.length) {
      await db
        .insert(eventAttendees)
        .values(input.attendeeIds.map((userId) => ({ eventId: created!.id, userId })))
        .onConflictDoNothing();
    }
    await audit(user.id, "create", "event", created!.id, { title: created!.title, forced: input.force });
    await changed(created!.calendarId);
    reply.code(201);
    return eventDetail(user, created!.id);
  });

  app.patch("/events/:id", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const patch = eventPatchSchema.parse(req.body);
    const existing = await requireEventEdit(user, id);
    if (patch.calendarId && patch.calendarId !== existing.calendarId) {
      await requireCalendarEdit(user, patch.calendarId);
    }
    if (patch.roomId !== undefined && patch.roomId !== existing.roomId) await assertRoomUsable(user, patch.roomId);
    if (patch.rrule) {
      const err = validateRRule(patch.rrule);
      if (err) throw badRequest(err);
    }

    const attendeeIds =
      patch.attendeeIds ??
      (await db.select({ userId: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, id))).map(
        (a) => a.userId,
      );

    // --- One occurrence of a series: exclude it from the series and store a standalone override.
    if (patch.scope === "occurrence" && existing.rrule) {
      if (!patch.occurrenceStart) throw badRequest("occurrenceStart is required to change one occurrence");
      const originalStart = new Date(patch.occurrenceStart);
      const duration = existing.endsAt.getTime() - existing.startsAt.getTime();
      const startsAt = patch.startsAt ? new Date(patch.startsAt) : originalStart;
      const endsAt = patch.endsAt ? new Date(patch.endsAt) : new Date(startsAt.getTime() + duration);
      const roomId = patch.roomId !== undefined ? patch.roomId : existing.roomId;
      if (!patch.force) {
        const conflicts = await findConflicts({
          id,
          startsAt,
          endsAt,
          timezone: existing.timezone,
          rrule: null,
          exdates: [],
          roomId,
          personIds: [...new Set([existing.organizerId ?? user.id, ...attendeeIds])],
          allDay: patch.allDay ?? existing.allDay,
        });
        if (conflicts.length) throw conflictError(conflicts);
      }
      const override = await db.transaction(async (tx) => {
        await tx
          .update(events)
          .set({ exdates: sql`array_append(${events.exdates}, ${originalStart.toISOString()}::timestamptz)`, updatedAt: new Date() })
          .where(eq(events.id, id));
        const [o] = await tx
          .insert(events)
          .values({
            calendarId: patch.calendarId ?? existing.calendarId,
            title: patch.title ?? existing.title,
            description: patch.description !== undefined ? patch.description : existing.description,
            kind: patch.kind ?? existing.kind,
            status: patch.status ?? existing.status,
            startsAt,
            endsAt,
            allDay: patch.allDay ?? existing.allDay,
            timezone: existing.timezone,
            rrule: null,
            recurrenceId: id,
            originalStart,
            roomId,
            locationText: patch.locationText !== undefined ? patch.locationText : existing.locationText,
            organizerId: existing.organizerId,
            sectionId: existing.sectionId,
          })
          .returning();
        if (attendeeIds.length) {
          await tx.insert(eventAttendees).values(attendeeIds.map((userId) => ({ eventId: o!.id, userId })));
        }
        return o!;
      });
      await audit(user.id, "update_occurrence", "event", id, { overrideId: override.id, originalStart });
      await changed(existing.calendarId, override.calendarId);
      return eventDetail(user, override.id);
    }

    // --- Whole event / series.
    const next = {
      startsAt: patch.startsAt ? new Date(patch.startsAt) : existing.startsAt,
      endsAt: patch.endsAt ? new Date(patch.endsAt) : existing.endsAt,
      timezone: existing.timezone,
      rrule: patch.rrule !== undefined ? patch.rrule : existing.rrule,
      exdates: existing.exdates,
    };
    if (next.endsAt <= next.startsAt) throw badRequest("End time must be after the start time");
    const roomId = patch.roomId !== undefined ? patch.roomId : existing.roomId;
    if (!patch.force) {
      const conflicts = await findConflicts({
        id,
        ...next,
        roomId,
        personIds: [...new Set([existing.organizerId ?? user.id, ...attendeeIds])],
        allDay: patch.allDay ?? existing.allDay,
      });
      if (conflicts.length) throw conflictError(conflicts);
    }
    await db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({
          title: patch.title,
          description: patch.description,
          kind: patch.kind,
          status: patch.status,
          calendarId: patch.calendarId,
          allDay: patch.allDay,
          locationText: patch.locationText,
          roomId,
          ...next,
          recurUntil: computeRecurUntil(next),
          updatedAt: new Date(),
        })
        .where(eq(events.id, id));
      if (patch.attendeeIds) {
        await tx.delete(eventAttendees).where(eq(eventAttendees.eventId, id));
        if (patch.attendeeIds.length) {
          await tx.insert(eventAttendees).values(patch.attendeeIds.map((userId) => ({ eventId: id, userId })));
        }
      }
    });
    await audit(user.id, "update", "event", id, patch);
    await changed(existing.calendarId, patch.calendarId ?? existing.calendarId);
    return eventDetail(user, id);
  });

  app.delete("/events/:id", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z
      .object({
        scope: z.enum(["series", "occurrence"]).default("series"),
        occurrenceStart: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(req.query);
    const existing = await requireEventEdit(user, id);
    if (q.scope === "occurrence" && existing.rrule) {
      if (!q.occurrenceStart) throw badRequest("occurrenceStart is required to delete one occurrence");
      await db
        .update(events)
        .set({ exdates: sql`array_append(${events.exdates}, ${q.occurrenceStart}::timestamptz)`, updatedAt: new Date() })
        .where(eq(events.id, id));
      await audit(user.id, "delete_occurrence", "event", id, { occurrenceStart: q.occurrenceStart });
    } else {
      // Deleting a series removes its single-occurrence overrides too.
      const overrides = await db.select({ id: events.id }).from(events).where(eq(events.recurrenceId, id));
      await db.delete(events).where(inArray(events.id, [id, ...overrides.map((o) => o.id)]));
      await audit(user.id, "delete", "event", id, { title: existing.title });
    }
    await changed(existing.calendarId);
    return { ok: true };
  });

  /** RSVP for attendees. */
  app.post("/events/:id/respond", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { response } = z.object({ response: z.enum(["accepted", "declined", "tentative"]) }).parse(req.body);
    const res = await db
      .update(eventAttendees)
      .set({ response })
      .where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, user.id)))
      .returning();
    if (res.length === 0) throw notFound("Invitation");
    return { ok: true };
  });
}
