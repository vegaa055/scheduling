"use client";

import { format } from "date-fns";
import { CalendarPlus, MapPin } from "lucide-react";
import type { CalendarDTO, OccurrenceDTO } from "@sched/shared";
import { EVENT_KIND_LABELS } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { swatch } from "@/lib/colors";
import { atMinute, campus, inCampus, sameCampusDay, timeRange, ymd } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Closure } from "./time-grid";

export function AgendaList({
  days,
  occurrences,
  calendars,
  closures,
  now,
  onSelect,
  onNew,
}: {
  days: Date[];
  occurrences: OccurrenceDTO[];
  calendars: Map<string, CalendarDTO>;
  closures: Map<string, Closure>;
  now: Date;
  onSelect: (o: OccurrenceDTO) => void;
  onNew: () => void;
}) {
  const groups = days
    .map((d) => {
      const ds = atMinute(d, 0);
      const de = new Date(ds.getTime() + 86_400_000);
      return {
        d,
        closure: closures.get(ymd(d)),
        items: occurrences
          .filter((o) => (o.allDay ? new Date(o.start) < de && new Date(o.end) > ds : ymd(new Date(o.start)) === ymd(d)))
          .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start)),
      };
    })
    .filter((g) => g.items.length || g.closure);

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing is scheduled on the calendars you have turned on for these three weeks.
        </p>
        <Button variant="outline" onClick={onNew}>
          <CalendarPlus /> New event
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <ol className="mx-auto max-w-4xl px-4 py-4 sm:px-8">
        {groups.map(({ d, items, closure }) => {
          const today = sameCampusDay(d, now);
          return (
            <li key={ymd(d)} className="grid grid-cols-[72px_1fr] gap-4 border-b border-grid py-3 last:border-0 sm:grid-cols-[84px_1fr]">
              <div className="pt-0.5">
                <div className={cn("font-numeral text-3xl leading-none font-semibold tabular", today && "text-primary")}>
                  {format(d, "d", { in: inCampus })}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{format(d, "EEE, MMM", { in: inCampus })}</div>
              </div>
              <ul className="flex min-w-0 flex-col gap-1">
                {closure && (
                  <li className="hatch rounded-md px-3 py-1.5 text-sm font-medium text-[var(--cal-chili-ink)]">{closure.label}</li>
                )}
                {items.map((o) => {
                  const cal = calendars.get(o.calendarId);
                  return (
                    <li key={o.key}>
                      <button
                        onClick={() => onSelect(o)}
                        className="grid w-full grid-cols-[96px_10px_1fr] items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted sm:grid-cols-[112px_10px_1fr] sm:px-3"
                      >
                        <span className="text-sm text-muted-foreground tabular">
                          {o.allDay ? "All day" : timeRange(campus(o.start), campus(o.end))}
                        </span>
                        <span className="size-2.5 translate-y-[1px] rounded-full" style={swatch(cal?.color ?? "azurite")} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{o.title}</span>
                          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            <span>{EVENT_KIND_LABELS[o.kind]}</span>
                            {(o.roomLabel || o.locationText) && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="size-3" />
                                {o.roomLabel ?? o.locationText}
                              </span>
                            )}
                            {cal && <span className="truncate">{cal.name}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
