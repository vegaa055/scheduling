"use client";

import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import type { TermDTO } from "@sched/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { campus, inCampus, parseYmd, WEEK_STARTS_ON } from "@/lib/time";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<string, string> = {
  holiday: "bg-[var(--cal-chili)]",
  break: "bg-[var(--cal-chili)]",
  deadline: "bg-[var(--cal-azurite)]",
  milestone: "bg-muted-foreground",
  finals: "bg-[var(--cal-mesa)]",
};

/**
 * Where we are in the semester: one segment per week of instruction, then finals. Tick marks
 * show holidays, breaks and deadlines; clicking a week jumps the calendar there.
 */
export function TermRibbon({
  terms,
  anchor,
  today,
  onJump,
}: {
  terms: TermDTO[];
  anchor: Date;
  today: Date;
  onJump: (d: Date) => void;
}) {
  const a = campus(anchor);
  const term =
    terms.find((t) => parseYmd(t.startsOn) <= a && a < addDays(parseYmd(t.endsOn), 1)) ??
    terms.find((t) => t.isCurrent) ??
    terms[0];
  if (!term) return null;

  const start = startOfWeek(parseYmd(term.startsOn), { weekStartsOn: WEEK_STARTS_ON, in: inCampus });
  const classesEnd = parseYmd(term.classesEndOn);
  const finalsStart = parseYmd(term.finalsStartOn);
  const finalsEnd = parseYmd(term.finalsEndOn);
  const weeks = Math.ceil((differenceInCalendarDays(classesEnd, start, { in: inCampus }) + 1) / 7);
  // Week segments fill 91% of the track, finals the last 9%.
  const finalsDays = differenceInCalendarDays(finalsEnd, finalsStart, { in: inCampus }) + 1;
  const markerLeft = (d: Date) => {
    const off = differenceInCalendarDays(d, start, { in: inCampus });
    if (off < weeks * 7) return Math.max(0, (off / (weeks * 7)) * 91);
    const f = differenceInCalendarDays(d, finalsStart, { in: inCampus }) / finalsDays;
    return 91 + Math.min(1, Math.max(0, f)) * 9;
  };

  const weekOf = (d: Date) => Math.floor(differenceInCalendarDays(d, start, { in: inCampus }) / 7) + 1;
  const anchorWeek = weekOf(a);
  const todayWeek = weekOf(campus(today));
  const inFinals = a >= finalsStart && a <= addDays(finalsEnd, 1);

  const upcoming = term.dates
    .filter((d) => parseYmd(d.startsOn) >= campus(today) && d.kind !== "milestone")
    .sort((x, y) => x.startsOn.localeCompare(y.startsOn))[0];
  const daysUntil = upcoming ? differenceInCalendarDays(parseYmd(upcoming.startsOn), campus(today), { in: inCampus }) : null;

  const weekStatus =
    a < parseYmd(term.startsOn)
      ? "Before classes start"
      : inFinals
        ? "Finals week"
        : anchorWeek > weeks
          ? "After classes end"
          : null;

  return (
    <div className="flex items-center gap-5 border-b bg-card px-5 py-2.5">
      <div className="flex shrink-0 items-baseline gap-2.5">
        <span className="text-sm font-semibold">{term.name}</span>
        <span className="font-numeral text-lg leading-none font-semibold text-muted-foreground">
          {weekStatus ?? (
            <>
              Week <span className="text-foreground">{anchorWeek}</span> of {weeks}
            </>
          )}
        </span>
      </div>

      <div className="relative hidden min-w-0 flex-1 sm:block" role="group" aria-label={`${term.name} weeks`}>
        <div className="flex h-2 gap-[3px]">
          {Array.from({ length: weeks }).map((_, i) => {
            const n = i + 1;
            const wStart = addDays(start, i * 7, { in: inCampus });
            const label = `Week ${n}, ${format(wStart, "MMM d", { in: inCampus })}`;
            return (
              <Tooltip key={n}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={label}
                    aria-current={n === anchorWeek ? "true" : undefined}
                    onClick={() => onJump(wStart)}
                    className={cn(
                      "h-full flex-1 rounded-[2px] transition-[background-color,box-shadow]",
                      n < todayWeek ? "bg-[color-mix(in_oklab,var(--brand-midnight)_55%,var(--card))] dark:bg-[#5b7bb0]" : "bg-grid-strong",
                      n === todayWeek && "bg-primary",
                      n === anchorWeek && "ring-2 ring-ring ring-offset-2 ring-offset-card",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Final exams"
                onClick={() => onJump(finalsStart)}
                className={cn(
                  "hatch h-full w-[9%] rounded-[2px] border border-[var(--cal-mesa)]",
                  inFinals && "ring-2 ring-ring ring-offset-2 ring-offset-card",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              Final exams, {format(finalsStart, "MMM d", { in: inCampus })}–{format(finalsEnd, "MMM d", { in: inCampus })}
            </TooltipContent>
          </Tooltip>
        </div>
        {/* Key dates */}
        <div className="pointer-events-none absolute inset-x-0 -top-[7px] h-0">
          {term.dates
            .filter((d) => d.kind !== "finals" && d.kind !== "milestone")
            .map((d) => (
              <Tooltip key={d.id}>
                <TooltipTrigger asChild>
                  <span
                    className={cn("pointer-events-auto absolute size-[7px] -translate-x-1/2 rounded-full ring-2 ring-card", KIND_STYLE[d.kind])}
                    style={{ left: `${markerLeft(parseYmd(d.startsOn))}%` }}
                    aria-label={`${d.label}, ${format(parseYmd(d.startsOn), "MMM d", { in: inCampus })}`}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {d.label}
                  <span className="ml-1.5 opacity-70">
                    {format(parseYmd(d.startsOn), "EEE MMM d", { in: inCampus })}
                    {d.endsOn ? `–${format(parseYmd(d.endsOn), "MMM d", { in: inCampus })}` : ""}
                  </span>
                </TooltipContent>
              </Tooltip>
            ))}
        </div>
      </div>

      {upcoming && daysUntil !== null && (
        <p className="hidden shrink-0 text-xs text-muted-foreground lg:block">
          <span className="font-medium text-foreground">{upcoming.label}</span>{" "}
          {daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`}
        </p>
      )}
    </div>
  );
}
