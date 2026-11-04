import { TZDate } from "@date-fns/tz";
import rrulePkg from "rrule";

const { RRule } = rrulePkg;

/**
 * Recurrence expansion.
 *
 * RRULEs describe wall-clock times ("every Monday at 9:00"), but we store instants. To stay
 * correct across DST in any zone, we expand in "floating" time: a Date whose UTC fields hold the
 * wall-clock reading in the event's zone. Each floating occurrence is then converted back to a
 * real instant in that zone. (Arizona has no DST, but departments elsewhere might.)
 */

export function toFloating(instant: Date, tz: string): Date {
  const z = new TZDate(instant.getTime(), tz);
  return new Date(
    Date.UTC(z.getFullYear(), z.getMonth(), z.getDate(), z.getHours(), z.getMinutes(), z.getSeconds()),
  );
}

export function fromFloating(f: Date, tz: string): Date {
  const z = new TZDate(
    f.getUTCFullYear(),
    f.getUTCMonth(),
    f.getUTCDate(),
    f.getUTCHours(),
    f.getUTCMinutes(),
    f.getUTCSeconds(),
    tz,
  );
  return new Date(z.getTime());
}

export interface SeriesLike {
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  rrule: string | null;
  exdates: Date[];
}

export interface Span {
  start: Date;
  end: Date;
}

function buildRule(series: SeriesLike) {
  const options = RRule.parseString(series.rrule!);
  options.dtstart = toFloating(series.startsAt, series.timezone);
  return new RRule(options);
}

/** All occurrences of `series` that overlap [from, to). */
export function expand(series: SeriesLike, from: Date, to: Date, limit = 2000): Span[] {
  const duration = series.endsAt.getTime() - series.startsAt.getTime();
  if (!series.rrule) {
    return series.startsAt < to && series.endsAt > from ? [{ start: series.startsAt, end: series.endsAt }] : [];
  }
  const rule = buildRule(series);
  const windowStart = toFloating(new Date(from.getTime() - duration), series.timezone);
  const windowEnd = toFloating(to, series.timezone);
  const excluded = new Set(series.exdates.map((d) => d.getTime()));
  const out: Span[] = [];
  const dates = rule.between(windowStart, windowEnd, true, (_d, i) => i < limit);
  for (const f of dates) {
    const start = fromFloating(f, series.timezone);
    if (excluded.has(start.getTime())) continue;
    const end = new Date(start.getTime() + duration);
    if (start < to && end > from) out.push({ start, end });
  }
  return out;
}

/** End of the final occurrence, or null when the series never ends. */
export function computeRecurUntil(series: SeriesLike): Date | null {
  if (!series.rrule) return null;
  const rule = buildRule(series);
  if (!rule.origOptions.until && !rule.origOptions.count) return null;
  const all = rule.all((_d, i) => i < 5000);
  const last = all.at(-1);
  if (!last) return series.endsAt;
  const duration = series.endsAt.getTime() - series.startsAt.getTime();
  return new Date(fromFloating(last, series.timezone).getTime() + duration);
}

/** Validates an RRULE body; returns an error message or null. */
export function validateRRule(rrule: string): string | null {
  try {
    const options = RRule.parseString(rrule);
    if (options.freq === undefined) return "Repeat rule needs a frequency";
    return null;
  } catch {
    return "Repeat rule could not be read";
  }
}

export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
