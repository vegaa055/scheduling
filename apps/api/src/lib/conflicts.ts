import { and, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { ConflictDTO } from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { loadEventRows, overlapsRange } from "./occurrences.ts";
import { computeRecurUntil, expand, type SeriesLike, type Span } from "./recurrence.ts";

const { events, eventAttendees, users } = schema;

export interface Candidate extends SeriesLike {
  /** When editing, the event being edited (and its overrides) is ignored. */
  id?: string;
  roomId: string | null;
  roomLabel?: string | null;
  /** Organizer and attendees whose time this event takes up. */
  personIds: string[];
  allDay?: boolean;
}

const HORIZON_DAYS = 200;
const MAX_CONFLICTS = 25;

/**
 * Finds double-bookings of the candidate's room or people. Recurring candidates are checked
 * occurrence by occurrence up to ~a semester and a half ahead.
 */
export async function findConflicts(c: Candidate): Promise<ConflictDTO[]> {
  if (c.allDay) return [];
  if (!c.roomId && c.personIds.length === 0) return [];

  const windowStart = c.startsAt;
  const until = c.rrule ? computeRecurUntil(c) : c.endsAt;
  const horizon = new Date(windowStart.getTime() + HORIZON_DAYS * 86_400_000);
  const windowEnd = until && until < horizon ? until : c.rrule ? horizon : c.endsAt;

  const mine = expand(c, windowStart, windowEnd, 400);
  if (mine.length === 0) return [];

  // Events that involve the same room or any of the same people.
  const involvement: SQL[] = [];
  if (c.roomId) involvement.push(eq(events.roomId, c.roomId));
  if (c.personIds.length) {
    involvement.push(inArray(events.organizerId, c.personIds));
    const attending = db
      .select({ id: eventAttendees.eventId })
      .from(eventAttendees)
      .where(inArray(eventAttendees.userId, c.personIds));
    involvement.push(inArray(events.id, attending));
  }

  const filters: SQL[] = [
    or(...involvement)!,
    ne(events.status, "cancelled"),
    eq(events.allDay, false),
    ne(events.kind, "deadline"),
    overlapsRange(windowStart, windowEnd),
  ];
  if (c.id) {
    filters.push(ne(events.id, c.id));
    // overrides of the series being edited are part of the same thing
    filters.push(or(isNull(events.recurrenceId), ne(events.recurrenceId, c.id))!);
  }
  const others = await loadEventRows(and(...filters)!);
  if (others.length === 0) return [];

  // Who is attending each of the other events (only people we care about).
  const attendeeRows = c.personIds.length
    ? await db
        .select({ eventId: eventAttendees.eventId, userId: eventAttendees.userId })
        .from(eventAttendees)
        .where(
          and(
            inArray(
              eventAttendees.eventId,
              others.map((o) => o.event.id),
            ),
            inArray(eventAttendees.userId, c.personIds),
          ),
        )
    : [];
  const peopleById = new Map<string, string>();
  if (c.personIds.length) {
    const ppl = await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, c.personIds));
    for (const p of ppl) peopleById.set(p.id, p.name);
  }

  const conflicts: ConflictDTO[] = [];
  for (const { event: o, roomLabel } of others) {
    const theirs = expand(o, windowStart, windowEnd, 400);
    const hit = firstOverlap(mine, theirs);
    if (!hit) continue;

    if (c.roomId && o.roomId === c.roomId) {
      conflicts.push({
        reason: "room",
        subject: roomLabel ?? c.roomLabel ?? "Room",
        eventId: o.id,
        title: o.title,
        start: hit.start.toISOString(),
        end: hit.end.toISOString(),
      });
    }
    const sharedPeople = new Set<string>();
    if (o.organizerId && c.personIds.includes(o.organizerId)) sharedPeople.add(o.organizerId);
    for (const a of attendeeRows) if (a.eventId === o.id) sharedPeople.add(a.userId);
    for (const pid of sharedPeople) {
      conflicts.push({
        reason: "person",
        subject: peopleById.get(pid) ?? "Someone",
        eventId: o.id,
        title: o.title,
        start: hit.start.toISOString(),
        end: hit.end.toISOString(),
      });
    }
    if (conflicts.length >= MAX_CONFLICTS) break;
  }
  return conflicts.sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_CONFLICTS);
}

/** First overlapping occurrence between two start-sorted lists (two-pointer sweep). */
function firstOverlap(a: Span[], b: Span[]): Span | null {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    if (x.start < y.end && y.start < x.end) return y;
    if (x.end <= y.start) i++;
    else j++;
  }
  return null;
}
