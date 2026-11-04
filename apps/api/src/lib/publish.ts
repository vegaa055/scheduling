import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { bump } from "./cache.ts";
import { notFound } from "./errors.ts";
import { publish } from "./pubsub.ts";
import { computeRecurUntil, fromFloating } from "./recurrence.ts";

const { sections, courses, meetingPatterns, terms, termDates, calendars, events } = schema;
const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const TZ = "America/Phoenix";

const floatingAt = (d: Date, h: number, m: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m));
const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const hm = (t: string) => t.split(":").map(Number) as [number, number];

/**
 * Publishes every scheduled section of a term as a weekly recurring class event on its
 * department's course calendar. Holidays and breaks become EXDATEs. Re-publishing updates
 * the existing events in place. Returns the number of sections published.
 */
export async function publishTerm(termId: string): Promise<number> {
  const [term] = await db.select().from(terms).where(eq(terms.id, termId));
  if (!term) throw notFound("Term");
  const closures = (await db.select().from(termDates).where(eq(termDates.termId, termId))).filter(
    (d) => d.kind === "holiday" || d.kind === "break",
  );
  const rows = await db
    .select({ s: sections, c: courses, p: meetingPatterns })
    .from(sections)
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .innerJoin(meetingPatterns, eq(meetingPatterns.id, sections.meetingPatternId))
    .where(and(eq(sections.termId, termId), inArray(sections.status, ["scheduled", "published"])));
  const courseCals = await db.select().from(calendars).where(eq(calendars.kind, "course"));
  const calByDept = new Map(courseCals.map((c) => [c.departmentId, c.id]));
  const touched = new Set<string>();
  let published = 0;

  for (const { s, c, p } of rows) {
    const calendarId = calByDept.get(c.departmentId);
    if (!calendarId || !s.roomId) continue;
    const [sh, sm] = hm(p.startTime);
    const [eh, em] = hm(p.endTime);
    const dayNums = p.days.map((d) => DAY_INDEX[d]!);

    let first = parseDay(term.startsOn);
    while (!dayNums.includes(first.getUTCDay())) first = new Date(first.getTime() + 86_400_000);
    const startsAt = fromFloating(floatingAt(first, sh, sm), TZ);
    const endsAt = fromFloating(floatingAt(first, eh, em), TZ);
    const rrule = `FREQ=WEEKLY;BYDAY=${p.days.join(",")};UNTIL=${term.classesEndOn.replaceAll("-", "")}T235959Z`;

    const exdates: Date[] = [];
    for (const cl of closures) {
      const last = parseDay(cl.endsOn ?? cl.startsOn).getTime();
      for (let t = parseDay(cl.startsOn).getTime(); t <= last; t += 86_400_000) {
        const day = new Date(t);
        if (dayNums.includes(day.getUTCDay())) exdates.push(fromFloating(floatingAt(day, sh, sm), TZ));
      }
    }
    const series = { startsAt, endsAt, timezone: TZ, rrule, exdates };
    const values = {
      calendarId,
      title: `${c.subject} ${c.number}-${s.sectionNumber} ${c.title}`,
      kind: "class" as const,
      ...series,
      recurUntil: computeRecurUntil(series),
      roomId: s.roomId,
      organizerId: s.instructorId,
      sectionId: s.id,
    };
    let eventId = s.publishedEventId;
    if (eventId) {
      const res = await db
        .update(events)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(events.id, eventId))
        .returning({ id: events.id });
      if (res.length === 0) eventId = null;
    }
    if (!eventId) {
      const [ev] = await db.insert(events).values(values).returning({ id: events.id });
      eventId = ev!.id;
    }
    await db.update(sections).set({ status: "published", publishedEventId: eventId }).where(eq(sections.id, s.id));
    touched.add(calendarId);
    published++;
  }
  await bump(...[...touched].map((cid) => `cal:${cid}`), "rooms").catch(() => {});
  await publish({ type: "calendar.changed", calendarIds: [...touched] }).catch(() => {});
  await publish({ type: "sections.changed", termId }).catch(() => {});
  return published;
}
