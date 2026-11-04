import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { bookingInputSchema, type BookingDTO } from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { requireUser } from "../auth/session.ts";
import { hasRole, requireRole, type SessionUser } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { bump } from "../lib/cache.ts";
import { findConflicts } from "../lib/conflicts.ts";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.ts";
import { roomLabelSql } from "../lib/occurrences.ts";
import { publish } from "../lib/pubsub.ts";

const { bookingRequests, rooms, buildings, users, calendars, events } = schema;
const requester = alias(users, "requester");
const reviewer = alias(users, "reviewer");

async function loadBookings(where?: SQL): Promise<BookingDTO[]> {
  const rows = await db
    .select({
      b: bookingRequests,
      roomLabel: roomLabelSql,
      requesterName: requester.displayName,
      reviewerName: reviewer.displayName,
    })
    .from(bookingRequests)
    .innerJoin(rooms, eq(rooms.id, bookingRequests.roomId))
    .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
    .innerJoin(requester, eq(requester.id, bookingRequests.requesterId))
    .leftJoin(reviewer, eq(reviewer.id, bookingRequests.reviewerId))
    .where(where)
    .orderBy(desc(bookingRequests.createdAt))
    .limit(200);
  return rows.map(({ b, roomLabel, requesterName, reviewerName }) => ({
    id: b.id,
    roomId: b.roomId,
    roomLabel: roomLabel ?? "",
    requester: { id: b.requesterId, displayName: requesterName },
    title: b.title,
    purpose: b.purpose,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    attendeeCount: b.attendeeCount,
    status: b.status,
    reviewer: b.reviewerId ? { id: b.reviewerId, displayName: reviewerName ?? "" } : null,
    reviewNote: b.reviewNote,
    createdAt: b.createdAt.toISOString(),
  }));
}

const canReview = (u: SessionUser) => hasRole(u, "admin", "staff", "scheduler");

/** Creates the room-calendar event for an approved booking. */
async function confirmBooking(b: typeof bookingRequests.$inferSelect, reviewerId: string | null) {
  const [roomCal] = await db.select().from(calendars).where(eq(calendars.roomId, b.roomId)).limit(1);
  if (!roomCal) throw new HttpError(500, "no_room_calendar", "Room has no calendar");
  const [ev] = await db
    .insert(events)
    .values({
      calendarId: roomCal.id,
      title: b.title,
      description: b.purpose,
      kind: "booking",
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      roomId: b.roomId,
      organizerId: b.requesterId,
    })
    .returning();
  await db
    .update(bookingRequests)
    .set({ status: "approved", reviewerId, reviewedAt: new Date(), eventId: ev!.id })
    .where(eq(bookingRequests.id, b.id));
  await bump(`cal:${roomCal.id}`, "rooms");
  await publish({ type: "calendar.changed", calendarIds: [roomCal.id] });
}

export async function bookingRoutes(app: FastifyInstance) {
  /** `scope=mine` (default) or `scope=review` for approvers. */
  app.get("/bookings", async (req) => {
    const user = requireUser(req);
    const { scope, status } = z
      .object({ scope: z.enum(["mine", "review"]).default("mine"), status: z.string().optional() })
      .parse(req.query);
    const filters: SQL[] = [];
    if (scope === "review") requireRole(user, "admin", "staff", "scheduler");
    else filters.push(eq(bookingRequests.requesterId, user.id));
    if (status) filters.push(eq(bookingRequests.status, status as BookingDTO["status"]));
    const list = await loadBookings(filters.length ? and(...filters) : undefined);
    if (scope === "review") {
      // Annotate pending requests with anything they would collide with.
      await Promise.all(
        list
          .filter((b) => b.status === "pending")
          .map(async (b) => {
            b.conflicts = await findConflicts({
              startsAt: new Date(b.startsAt),
              endsAt: new Date(b.endsAt),
              timezone: "America/Phoenix",
              rrule: null,
              exdates: [],
              roomId: b.roomId,
              personIds: [],
            });
          }),
      );
    }
    return list;
  });

  app.get("/bookings/pending-count", async (req) => {
    const user = requireUser(req);
    if (!canReview(user)) return { count: 0 };
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingRequests)
      .where(eq(bookingRequests.status, "pending"));
    return { count: row?.count ?? 0 };
  });

  app.post("/bookings", async (req, reply) => {
    const user = requireUser(req);
    if (!hasRole(user, "admin", "staff", "scheduler", "faculty")) throw forbidden("Your account can't book rooms");
    const input = bookingInputSchema.parse(req.body);
    const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
    if (!room || !room.bookable) throw badRequest("That room can't be booked");
    if (input.attendeeCount > room.capacity) {
      throw badRequest(`This room seats ${room.capacity}. Pick a larger room or lower the headcount.`);
    }
    const conflicts = await findConflicts({
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      timezone: "America/Phoenix",
      rrule: null,
      exdates: [],
      roomId: input.roomId,
      personIds: [],
    });
    if (conflicts.length) throw new HttpError(409, "conflict", "The room is already booked then", { conflicts });

    const [b] = await db
      .insert(bookingRequests)
      .values({
        roomId: input.roomId,
        requesterId: user.id,
        title: input.title,
        purpose: input.purpose ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        attendeeCount: input.attendeeCount,
      })
      .returning();
    // Rooms that don't need approval (or staff booking them) are confirmed straight away.
    if (!room.requiresApproval || canReview(user)) await confirmBooking(b!, canReview(user) ? user.id : null);
    await audit(user.id, "create", "booking", b!.id, { roomId: input.roomId });
    await publish({ type: "booking.changed", bookingId: b!.id });
    reply.code(201);
    const [dto] = await loadBookings(eq(bookingRequests.id, b!.id));
    return dto;
  });

  app.post("/bookings/:id/:decision", async (req) => {
    const user = requireUser(req);
    const { id, decision } = z
      .object({ id: z.uuid(), decision: z.enum(["approve", "deny", "cancel"]) })
      .parse(req.params);
    const { note } = z.object({ note: z.string().max(1000).optional() }).parse(req.body ?? {});
    const [b] = await db.select().from(bookingRequests).where(eq(bookingRequests.id, id)).limit(1);
    if (!b) throw notFound("Booking request");

    if (decision === "cancel") {
      if (b.requesterId !== user.id && !canReview(user)) throw forbidden();
      await db.update(bookingRequests).set({ status: "cancelled" }).where(eq(bookingRequests.id, id));
      if (b.eventId) {
        const [ev] = await db.delete(events).where(eq(events.id, b.eventId)).returning();
        if (ev) {
          await bump(`cal:${ev.calendarId}`, "rooms");
          await publish({ type: "calendar.changed", calendarIds: [ev.calendarId] });
        }
      }
    } else {
      if (!canReview(user)) throw forbidden("Only room coordinators can review requests");
      if (b.status !== "pending") throw badRequest("This request has already been reviewed");
      if (decision === "approve") {
        const conflicts = await findConflicts({
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          timezone: "America/Phoenix",
          rrule: null,
          exdates: [],
          roomId: b.roomId,
          personIds: [],
        });
        if (conflicts.length) throw new HttpError(409, "conflict", "The room was booked by something else", { conflicts });
        await confirmBooking(b, user.id);
        if (note) await db.update(bookingRequests).set({ reviewNote: note }).where(eq(bookingRequests.id, id));
      } else {
        await db
          .update(bookingRequests)
          .set({ status: "denied", reviewerId: user.id, reviewedAt: new Date(), reviewNote: note ?? null })
          .where(eq(bookingRequests.id, id));
      }
    }
    await audit(user.id, decision, "booking", id, { note });
    await publish({ type: "booking.changed", bookingId: id });
    const [dto] = await loadBookings(eq(bookingRequests.id, id));
    return dto;
  });

}
