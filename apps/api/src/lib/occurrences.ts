import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { OccurrenceDTO } from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { cached, getVersion } from "./cache.ts";
import { expand } from "./recurrence.ts";

const { events, rooms, buildings, users } = schema;
export type EventRow = typeof events.$inferSelect;

/** SQL predicate: the event (single or series) may have an occurrence overlapping [from, to). */
export function overlapsRange(from: Date, to: Date): SQL {
  return and(
    lt(events.startsAt, to),
    or(
      and(isNull(events.rrule), gt(events.endsAt, from)),
      and(isNotNull(events.rrule), or(isNull(events.recurUntil), gt(events.recurUntil, from))),
    ),
  )!;
}

export const roomLabelSql = sql<string | null>`case when ${rooms.id} is null then null else ${buildings.code} || ' ' || ${rooms.number} end`;

const organizer = alias(users, "organizer");

export async function loadEventRows(where: SQL) {
  return db
    .select({
      event: events,
      roomLabel: roomLabelSql,
      organizerName: organizer.displayName,
    })
    .from(events)
    .leftJoin(rooms, eq(rooms.id, events.roomId))
    .leftJoin(buildings, eq(buildings.id, rooms.buildingId))
    .leftJoin(organizer, eq(organizer.id, events.organizerId))
    .where(where);
}

type Loaded = Awaited<ReturnType<typeof loadEventRows>>[number];

export function toOccurrences(rows: Loaded[], from: Date, to: Date): OccurrenceDTO[] {
  const out: OccurrenceDTO[] = [];
  for (const { event: e, roomLabel, organizerName } of rows) {
    for (const span of expand(e, from, to)) {
      out.push({
        key: `${e.id}:${span.start.toISOString()}`,
        eventId: e.id,
        calendarId: e.calendarId,
        title: e.title,
        kind: e.kind,
        status: e.status,
        start: span.start.toISOString(),
        end: span.end.toISOString(),
        originalStart: span.start.toISOString(),
        allDay: e.allDay,
        recurring: !!e.rrule || !!e.recurrenceId,
        roomId: e.roomId,
        roomLabel,
        locationText: e.locationText,
        organizerName,
      });
    }
  }
  return out;
}

/** Occurrences for the given calendars in [from, to), cached per calendar version. */
export async function occurrencesForCalendars(calendarIds: string[], from: Date, to: Date) {
  const chunks = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const version = await getVersion(`cal:${calendarId}`).catch(() => -1);
      const key = `occ:${calendarId}:v${version}:${from.toISOString()}:${to.toISOString()}`;
      const load = async () => {
        const rows = await loadEventRows(
          and(eq(events.calendarId, calendarId), ne(events.status, "cancelled"), overlapsRange(from, to))!,
        );
        return toOccurrences(rows, from, to);
      };
      return version < 0 ? load() : cached(key, 300, load);
    }),
  );
  return chunks.flat().sort((a, b) => a.start.localeCompare(b.start));
}

/** Every occurrence held in any of the given rooms during [from, to). */
export async function occurrencesForRooms(roomIds: string[], from: Date, to: Date) {
  if (roomIds.length === 0) return [];
  const rows = await loadEventRows(
    and(inArray(events.roomId, roomIds), ne(events.status, "cancelled"), overlapsRange(from, to))!,
  );
  return toOccurrences(rows, from, to);
}
