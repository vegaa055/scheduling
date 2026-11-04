import { format } from "date-fns";
import { inCampus, parseYmd } from "./time";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY";
export const WEEKDAYS = [
  { code: "SU", short: "S", label: "Sun" },
  { code: "MO", short: "M", label: "Mon" },
  { code: "TU", short: "T", label: "Tue" },
  { code: "WE", short: "W", label: "Wed" },
  { code: "TH", short: "R", label: "Thu" },
  { code: "FR", short: "F", label: "Fri" },
  { code: "SA", short: "S", label: "Sat" },
] as const;

export interface RepeatRule {
  freq: Freq;
  interval: number;
  byday: string[];
  /** yyyy-MM-dd, inclusive */
  until: string | null;
  count: number | null;
}

export function parseRRule(rrule: string | null | undefined): RepeatRule | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
  const until = parts.UNTIL ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` : null;
  return {
    freq: (parts.FREQ as Freq) ?? "WEEKLY",
    interval: parts.INTERVAL ? Number(parts.INTERVAL) : 1,
    byday: parts.BYDAY ? parts.BYDAY.split(",").map((d) => d.replace(/^-?\d+/, "")) : [],
    until,
    count: parts.COUNT ? Number(parts.COUNT) : null,
  };
}

export function buildRRule(r: RepeatRule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byday.length) parts.push(`BYDAY=${r.byday.join(",")}`);
  if (r.until) parts.push(`UNTIL=${r.until.replaceAll("-", "")}T235959Z`);
  else if (r.count) parts.push(`COUNT=${r.count}`);
  return parts.join(";");
}

export function describeRRule(rrule: string | null | undefined): string | null {
  const r = parseRRule(rrule);
  if (!r) return null;
  const every =
    r.freq === "DAILY"
      ? r.interval > 1 ? `Every ${r.interval} days` : "Daily"
      : r.freq === "MONTHLY"
        ? r.interval > 1 ? `Every ${r.interval} months` : "Monthly"
        : r.interval > 1 ? `Every ${r.interval} weeks` : "Weekly";
  const order = WEEKDAYS.map((d) => d.code as string);
  const days =
    r.freq === "WEEKLY" && r.byday.length
      ? ` on ${[...r.byday].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((c) => WEEKDAYS.find((w) => w.code === c)?.label ?? c).join(", ")}`
      : "";
  const end = r.until ? `, until ${format(parseYmd(r.until), "MMM d, yyyy", { in: inCampus })}` : r.count ? `, ${r.count} times` : "";
  return `${every}${days}${end}`;
}
