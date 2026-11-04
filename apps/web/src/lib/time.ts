import { TZDate, tz } from "@date-fns/tz";
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { brand } from "./brand";

/**
 * Everything on screen is shown in campus time, whatever the viewer's laptop is set to.
 * TZDate behaves like a Date whose getters read in the campus zone.
 */
export const CAMPUS_TZ = brand.timezone;
export const inCampus = tz(CAMPUS_TZ);

export const campus = (d: Date | string | number) => new TZDate(new Date(d).getTime(), CAMPUS_TZ);
export const campusNow = () => campus(Date.now());

export type View = "day" | "week" | "month" | "agenda";

export const WEEK_STARTS_ON = 0 as const; // Sunday, like the registrar's calendar

export function viewRange(view: View, anchor: Date): { from: TZDate; to: TZDate } {
  const a = campus(anchor);
  switch (view) {
    case "day":
      return { from: startOfDay(a, { in: inCampus }), to: addDays(startOfDay(a, { in: inCampus }), 1, { in: inCampus }) };
    case "week": {
      const from = startOfWeek(a, { weekStartsOn: WEEK_STARTS_ON, in: inCampus });
      return { from, to: addDays(from, 7, { in: inCampus }) };
    }
    case "month": {
      const from = startOfWeek(startOfMonth(a, { in: inCampus }), { weekStartsOn: WEEK_STARTS_ON, in: inCampus });
      const to = addDays(endOfWeek(endOfMonth(a, { in: inCampus }), { weekStartsOn: WEEK_STARTS_ON, in: inCampus }), 1, {
        in: inCampus,
      });
      return { from: startOfDay(from, { in: inCampus }), to: startOfDay(to, { in: inCampus }) };
    }
    case "agenda": {
      const from = startOfDay(a, { in: inCampus });
      return { from, to: addDays(from, 21, { in: inCampus }) };
    }
  }
}

export function stepAnchor(view: View, anchor: Date, dir: 1 | -1): TZDate {
  const a = campus(anchor);
  if (view === "day") return addDays(a, dir, { in: inCampus });
  if (view === "week") return addDays(a, 7 * dir, { in: inCampus });
  if (view === "agenda") return addDays(a, 21 * dir, { in: inCampus });
  const m = new TZDate(a.getFullYear(), a.getMonth() + dir, 1, CAMPUS_TZ);
  return m;
}

export const daysIn = (from: Date, to: Date) => {
  const out: TZDate[] = [];
  const n = differenceInCalendarDays(to, from, { in: inCampus });
  for (let i = 0; i < n; i++) out.push(addDays(campus(from), i, { in: inCampus }));
  return out;
};

export const minutesSinceMidnight = (d: Date) => {
  const c = campus(d);
  return c.getHours() * 60 + c.getMinutes();
};

/** Campus-local date at a given minute of the day. */
export const atMinute = (day: Date, minutes: number) => addMinutes(startOfDay(campus(day), { in: inCampus }), minutes);

export const sameCampusDay = (a: Date, b: Date) => format(campus(a), "yyyy-MM-dd") === format(campus(b), "yyyy-MM-dd");

export const ymd = (d: Date) => format(campus(d), "yyyy-MM-dd");

/** "9am", "9:30am", "12pm" */
export function shortTime(d: Date) {
  const c = campus(d);
  return format(c, c.getMinutes() === 0 ? "haaa" : "h:mmaaa");
}

export function timeRange(start: Date, end: Date) {
  const s = campus(start);
  const e = campus(end);
  const sameMeridiem = format(s, "a") === format(e, "a");
  const left = format(s, s.getMinutes() === 0 ? "h" : "h:mm") + (sameMeridiem ? "" : format(s, "aaa"));
  return `${left}–${shortTime(e)}`;
}

/** ISO string with the campus offset, e.g. 2026-11-04T09:00:00-07:00 */
export const isoCampus = (d: Date) => format(campus(d), "yyyy-MM-dd'T'HH:mm:ssXXX");

/** Parse "yyyy-MM-dd" as a campus-local midnight. */
export function parseYmd(s: string): TZDate {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new TZDate(y, m - 1, d, CAMPUS_TZ);
}
