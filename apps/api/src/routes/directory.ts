import type { FastifyInstance } from "fastify";
import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { CALENDAR_COLORS, type RoomBusyDTO, type RoomDTO, type TermDTO } from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { requireUser } from "../auth/session.ts";
import { accessMap, hasRole, requireRole, toCalendarDTO, visibleCalendars } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { cached, getVersion } from "../lib/cache.ts";
import { findConflicts } from "../lib/conflicts.ts";
import { badRequest } from "../lib/errors.ts";
import { occurrencesForRooms } from "../lib/occurrences.ts";
import { fromFloating } from "../lib/recurrence.ts";

const { users, departments, calendars, rooms, buildings, terms, termDates } = schema;

export async function roomList(): Promise<RoomDTO[]> {
  const rows = await db
    .select({ room: rooms, building: buildings })
    .from(rooms)
    .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
    .orderBy(asc(buildings.code), asc(rooms.number));
  return rows.map(({ room, building }) => ({
    id: room.id,
    buildingId: building.id,
    buildingCode: building.code,
    buildingName: building.name,
    number: room.number,
    name: room.name,
    label: `${building.code} ${room.number}`,
    capacity: room.capacity,
    features: room.features,
    kind: room.kind,
    bookable: room.bookable,
    requiresApproval: room.requiresApproval,
    schedulable: room.schedulable,
  }));
}

export async function termList(): Promise<TermDTO[]> {
  const ts = await db.select().from(terms).orderBy(asc(terms.startsOn));
  const ds = await db.select().from(termDates).orderBy(asc(termDates.startsOn));
  return ts.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    classesEndOn: t.classesEndOn,
    finalsStartOn: t.finalsStartOn,
    finalsEndOn: t.finalsEndOn,
    isCurrent: t.isCurrent,
    dates: ds
      .filter((d) => d.termId === t.id)
      .map((d) => ({ id: d.id, startsOn: d.startsOn, endsOn: d.endsOn, label: d.label, kind: d.kind })),
  }));
}

/** Start and end instants of a local calendar day in the campus time zone. */
export function dayBounds(day: string, tz = "America/Phoenix") {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const start = fromFloating(new Date(Date.UTC(y, m - 1, d)), tz);
  const end = fromFloating(new Date(Date.UTC(y, m - 1, d + 1)), tz);
  return { start, end };
}

export async function directoryRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/me", async (req) => {
    const user = requireUser(req);
    const [dept] = user.departmentId
      ? await db.select().from(departments).where(eq(departments.id, user.departmentId))
      : [];
    return {
      user: { ...user, departmentName: dept?.name ?? null },
      calendars: await visibleCalendars(user),
    };
  });

  /* ---------------- Calendars ---------------- */

  app.post("/calendars", async (req, reply) => {
    const user = requireUser(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(1000).optional(),
        color: z.enum(CALENDAR_COLORS).default("oasis"),
        isPublic: z.boolean().default(false),
      })
      .parse(req.body);
    const [cal] = await db
      .insert(calendars)
      .values({ ...body, kind: "personal", ownerId: user.id })
      .returning();
    await audit(user.id, "create", "calendar", cal!.id, body);
    reply.code(201);
    return toCalendarDTO(cal!, "owner");
  });

  app.patch("/calendars/:id", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({ name: z.string().trim().min(1).max(120).optional(), color: z.enum(CALENDAR_COLORS).optional() })
      .parse(req.body);
    const access = (await accessMap(user)).get(id);
    if (access !== "owner") requireRole(user, "admin");
    const [cal] = await db.update(calendars).set(body).where(eq(calendars.id, id)).returning();
    return toCalendarDTO(cal!, access ?? "owner");
  });

  /* ---------------- People ---------------- */

  app.get("/people", async (req) => {
    const user = requireUser(req);
    if (!hasRole(user, "admin", "scheduler", "staff", "faculty")) return [];
    const { q } = z.object({ q: z.string().max(80).default("") }).parse(req.query);
    const term = `%${q.trim()}%`;
    return db
      .select({
        id: users.id,
        netid: users.netid,
        displayName: users.displayName,
        title: users.title,
        departmentName: departments.name,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(q ? or(ilike(users.displayName, term), ilike(users.netid, term), ilike(users.email, term)) : undefined)
      .orderBy(asc(users.displayName))
      .limit(20);
  });

  app.get("/departments", async (req) => {
    requireUser(req);
    return db.select().from(departments).orderBy(asc(departments.name));
  });

  /* ---------------- Terms ---------------- */

  app.get("/terms", async (req) => {
    requireUser(req);
    return cached(`terms:v${await getVersion("terms").catch(() => 0)}`, 3600, termList);
  });

  /* ---------------- Rooms ---------------- */

  app.get("/rooms", async (req) => {
    requireUser(req);
    return cached(`rooms:list:v${await getVersion("rooms-list").catch(() => 0)}`, 3600, roomList);
  });

  /** Busy blocks for every room on a given day — the Rooms board. */
  app.get("/rooms/board", async (req) => {
    const user = requireUser(req);
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    const { start, end } = dayBounds(date);
    const version = await getVersion("rooms").catch(() => 0);
    const allRooms = await roomList();
    const occ = await cached(`rooms:board:v${version}:${date}`, 300, () =>
      occurrencesForRooms(
        allRooms.map((r) => r.id),
        start,
        end,
      ),
    );
    // Hide titles of events on calendars the viewer can't see.
    const visible = await accessMap(user);
    const byRoom = new Map<string, RoomBusyDTO["busy"]>();
    for (const o of occ) {
      if (!o.roomId) continue;
      const list = byRoom.get(o.roomId) ?? [];
      list.push({
        start: o.start,
        end: o.end,
        title: visible.has(o.calendarId) ? o.title : "Reserved",
        kind: o.kind,
        eventId: visible.has(o.calendarId) ? o.eventId : "",
      });
      byRoom.set(o.roomId, list);
    }
    return allRooms.map<RoomBusyDTO>((r) => ({
      roomId: r.id,
      busy: (byRoom.get(r.id) ?? []).sort((a, b) => a.start.localeCompare(b.start)),
    }));
  });

  /** Rooms free for an entire interval, optionally filtered by size and features. */
  app.get("/rooms/free", async (req) => {
    requireUser(req);
    const q = z
      .object({
        start: z.iso.datetime({ offset: true }),
        end: z.iso.datetime({ offset: true }),
        capacity: z.coerce.number().int().min(0).default(0),
        features: z.string().optional(),
        rrule: z.string().optional(),
      })
      .parse(req.query);
    const startsAt = new Date(q.start);
    const endsAt = new Date(q.end);
    if (endsAt <= startsAt) throw badRequest("`end` must be after `start`");
    const wanted = q.features ? q.features.split(",").filter(Boolean) : [];
    const candidates = (await roomList()).filter(
      (r) => r.bookable && r.capacity >= q.capacity && wanted.every((f) => r.features.includes(f)),
    );
    const busy = new Set(
      (
        await occurrencesForRooms(
          candidates.map((r) => r.id),
          startsAt,
          endsAt,
        )
      ).map((o) => o.roomId),
    );
    let free = candidates.filter((r) => !busy.has(r.id));
    if (q.rrule) {
      // For repeating events check every occurrence (slower; only for the shortlisted rooms).
      const checks = await Promise.all(
        free.map(async (r) => ({
          r,
          conflicts: await findConflicts({
            startsAt,
            endsAt,
            timezone: "America/Phoenix",
            rrule: q.rrule!,
            exdates: [],
            roomId: r.id,
            personIds: [],
          }),
        })),
      );
      free = checks.filter((c) => c.conflicts.length === 0).map((c) => c.r);
    }
    return free;
  });

  /* ---------------- Audit (admin) ---------------- */

  app.get("/audit", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin");
    return db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        entity: schema.auditLog.entity,
        entityId: schema.auditLog.entityId,
        at: schema.auditLog.at,
        actor: users.displayName,
      })
      .from(schema.auditLog)
      .leftJoin(users, eq(users.id, schema.auditLog.actorId))
      .orderBy(sql`${schema.auditLog.id} desc`)
      .limit(100);
  });
}
