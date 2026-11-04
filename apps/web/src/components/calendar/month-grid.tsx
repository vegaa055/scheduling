"use client";

import { addDays, format } from "date-fns";
import type { CalendarDTO, OccurrenceDTO } from "@sched/shared";
import { swatch } from "@/lib/colors";
import { atMinute, campus, inCampus, sameCampusDay, shortTime, ymd } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Closure } from "./time-grid";

const MAX_PER_DAY = 3;

export function MonthGrid({
  days,
  month,
  occurrences,
  calendars,
  closures,
  now,
  onSelect,
  onCreate,
  onOpenDay,
}: {
  days: Date[];
  month: number;
  occurrences: OccurrenceDTO[];
  calendars: Map<string, CalendarDTO>;
  closures: Map<string, Closure>;
  now: Date;
  onSelect: (o: OccurrenceDTO) => void;
  onCreate: (start: Date, end: Date, allDay: boolean) => void;
  onOpenDay: (d: Date) => void;
}) {
  const byDay = new Map<string, OccurrenceDTO[]>();
  for (const o of occurrences) {
    const s = new Date(o.start);
    const e = new Date(o.end);
    for (const d of days) {
      const ds = atMinute(d, 0);
      const de = addDays(ds, 1, { in: inCampus });
      if (s < de && e > ds) {
        const k = ymd(d);
        byDay.set(k, [...(byDay.get(k) ?? []), o]);
      }
    }
  }
  const weeks = days.length / 7;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b bg-card">
        {days.slice(0, 7).map((d) => (
          <div key={d.getTime()} className="px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
            {format(d, "EEE", { in: inCampus })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const k = ymd(d);
          const list = (byDay.get(k) ?? []).sort(
            (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
          );
          const closure = closures.get(k);
          const inMonth = campus(d).getMonth() === month;
          const isToday = sameCampusDay(d, now);
          return (
            <div
              key={k}
              onClick={(e) => e.target === e.currentTarget && onCreate(atMinute(d, 9 * 60), atMinute(d, 10 * 60), false)}
              className={cn(
                "flex min-h-0 flex-col gap-0.5 overflow-hidden border-r border-b border-grid p-1 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-[var(--grid-off-hours)]",
                closure && "hatch",
              )}
            >
              <div className="pointer-events-none flex items-baseline gap-1.5 px-1">
                <button
                  onClick={() => onOpenDay(d)}
                  className={cn(
                    "pointer-events-auto font-numeral text-lg leading-none font-semibold tabular hover:text-[var(--ring)]",
                    !inMonth && "text-muted-foreground/70",
                    isToday && "rounded-[4px] bg-primary px-1 py-0.5 text-primary-foreground hover:text-primary-foreground",
                  )}
                  aria-label={format(d, "EEEE, MMMM d", { in: inCampus })}
                >
                  {format(d, "d", { in: inCampus })}
                </button>
                {closure && <span className="truncate text-[10.5px] text-[var(--cal-chili-ink)]">{closure.label}</span>}
              </div>
              {list.slice(0, MAX_PER_DAY).map((o) => {
                const cal = calendars.get(o.calendarId);
                return (
                  <button
                    key={o.key}
                    onClick={() => onSelect(o)}
                    className="flex min-w-0 items-center gap-1.5 rounded-[4px] px-1 py-px text-left text-[11.5px] hover:bg-muted"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={swatch(cal?.color ?? "azurite")} />
                    {!o.allDay && <span className="shrink-0 text-muted-foreground tabular">{shortTime(new Date(o.start))}</span>}
                    <span className="truncate font-medium">{o.title}</span>
                  </button>
                );
              })}
              {list.length > MAX_PER_DAY && (
                <button
                  onClick={() => onOpenDay(d)}
                  className="px-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {list.length - MAX_PER_DAY} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
