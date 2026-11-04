"use client";

import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { OccurrenceDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMounted } from "@/hooks/use-mounted";
import { api, ApiError } from "@/lib/api";
import { useInvalidateCalendar, useMe, useOccurrences, useTerms } from "@/lib/queries";
import { atMinute, campus, campusNow, daysIn, inCampus, isoCampus, parseYmd, stepAnchor, viewRange, ymd, type View } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AgendaList } from "./agenda-list";
import { CalendarSidebar, groupCalendars } from "./calendar-sidebar";
import { EventEditor, type EditorTarget } from "./event-editor";
import { EventSheet } from "./event-sheet";
import { MonthGrid } from "./month-grid";
import { TermRibbon } from "./term-ribbon";
import { TimeGrid, type Closure } from "./time-grid";

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "day", label: "Day", key: "D" },
  { id: "week", label: "Week", key: "W" },
  { id: "month", label: "Month", key: "M" },
  { id: "agenda", label: "Agenda", key: "A" },
];

function readStore<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function CalendarScreen() {
  const mounted = useMounted();
  if (!mounted) return <CalendarSkeleton />;
  return <CalendarScreenInner />;
}

function CalendarScreenInner() {
  const { data: me } = useMe();
  const { data: terms = [] } = useTerms();
  const [view, setViewState] = useState<View>(() =>
    readStore<View>("sched.view", window.innerWidth < 768 ? "day" : "week"),
  );
  const [anchor, setAnchor] = useState<Date>(() => campusNow());
  const [now, setNow] = useState<Date>(() => new Date());
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<OccurrenceDTO | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const invalidate = useInvalidateCalendar();

  const setView = (v: View) => {
    setViewState(v);
    writeStore("sched.view", v);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const calendars = useMemo(() => me?.calendars ?? [], [me]);
  const calMap = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const groups = useMemo(() => (me ? groupCalendars(calendars, me.user.id) : []), [calendars, me]);

  // Which calendars are switched on: remembered per person, with sensible defaults.
  useEffect(() => {
    if (!me || enabled) return;
    const stored = readStore<string[] | null>(`sched.enabled.${me.user.id}`, null);
    if (stored) {
      setEnabled(new Set(stored.filter((id) => calMap.has(id))));
      return;
    }
    const dept = me.user.departmentId;
    const defaults = calendars.filter(
      (c) =>
        (c.kind === "personal" && (c.ownerId === me.user.id || c.access === "editor")) ||
        c.kind === "college" ||
        (c.kind === "department" && c.departmentId === dept) ||
        (c.kind === "course" && c.departmentId === dept),
    );
    setEnabled(new Set(defaults.map((c) => c.id)));
  }, [me, calendars, calMap, enabled]);

  const toggle = useCallback(
    (ids: string[], on: boolean) => {
      setEnabled((prev) => {
        const next = new Set(prev ?? []);
        for (const id of ids) (on ? next.add(id) : next.delete(id));
        if (me) writeStore(`sched.enabled.${me.user.id}`, [...next]);
        return next;
      });
    },
    [me],
  );

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const days = useMemo(() => daysIn(range.from, range.to), [range]);
  const { data: occurrences = [], isFetching } = useOccurrences(range.from, range.to, enabled ? [...enabled].sort() : null);

  // Holidays and breaks from the academic calendar.
  const closures = useMemo(() => {
    const map = new Map<string, Closure>();
    for (const t of terms) {
      for (const d of t.dates) {
        if (d.kind !== "holiday" && d.kind !== "break") continue;
        const last = parseYmd(d.endsOn ?? d.startsOn);
        for (let day = parseYmd(d.startsOn); day <= last; day = addDays(day, 1, { in: inCampus })) {
          map.set(ymd(day), { label: d.label, kind: d.kind });
        }
      }
    }
    return map;
  }, [terms]);

  const editableIds = useMemo(
    () => new Set(calendars.filter((c) => c.access === "owner" || c.access === "editor").map((c) => c.id)),
    [calendars],
  );
  const canStaffRooms = !!me?.user.roles.some((r) => r === "admin" || r === "staff" || r === "scheduler");

  const newEvent = useCallback(() => {
    // Next half hour if the calendar is showing today, otherwise 9am.
    const n = campusNow();
    const minute = ymd(anchor) === ymd(n) ? Math.min(Math.ceil((n.getHours() * 60 + n.getMinutes()) / 30) * 30, 22 * 60) : 9 * 60;
    const s = atMinute(anchor, minute);
    setEditor({ mode: "create", start: s, end: new Date(s.getTime() + 3600_000), allDay: false });
  }, [anchor]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || editor || selected) return;
      if (el.closest("input, textarea, select, [contenteditable], [role=dialog], [role=listbox], [role=menu]")) return;
      const k = e.key.toLowerCase();
      if (k === "t") setAnchor(campusNow());
      else if (k === "arrowleft" || k === "j") setAnchor((a) => stepAnchor(view, a, -1));
      else if (k === "arrowright" || k === "k") setAnchor((a) => stepAnchor(view, a, 1));
      else if (k === "n") {
        e.preventDefault();
        newEvent();
      } else {
        const v = VIEWS.find((x) => x.key.toLowerCase() === k);
        if (v) setView(v.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, editor, selected, newEvent]);

  const moveEvent = async (o: OccurrenceDTO, start: Date, end: Date, force = false) => {
    if (start.getTime() === new Date(o.start).getTime() && end.getTime() === new Date(o.end).getTime()) return;
    try {
      await api(`/events/${o.eventId}`, {
        method: "PATCH",
        json: {
          startsAt: isoCampus(start),
          endsAt: isoCampus(end),
          scope: o.recurring ? "occurrence" : "series",
          occurrenceStart: o.recurring ? o.originalStart : undefined,
          force,
        },
      });
      invalidate();
      toast.success(o.recurring ? `Moved ${format(campus(start), "EEE MMM d", { in: inCampus })} only` : "Event moved");
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") {
        const c = e.conflicts[0];
        toast.warning("That time is taken", {
          description: c ? `${c.subject} ${c.reason === "room" ? "is booked for" : "is busy with"} ${c.title}.` : undefined,
          action: { label: "Move anyway", onClick: () => moveEvent(o, start, end, true) },
        });
      } else {
        toast.error(e instanceof Error ? e.message : "Couldn't move the event");
      }
    }
  };

  const title = (() => {
    const a = campus(anchor);
    if (view === "day") return { main: format(a, "EEEE", { in: inCampus }), sub: format(a, "MMMM d, yyyy", { in: inCampus }) };
    if (view === "month") return { main: format(a, "MMMM", { in: inCampus }), sub: format(a, "yyyy", { in: inCampus }) };
    const f = days[0]!;
    const l = days[days.length - 1]!;
    const sameMonth = campus(f).getMonth() === campus(l).getMonth();
    return {
      main: format(f, "MMMM", { in: inCampus }) + (sameMonth ? "" : `–${format(l, "MMMM", { in: inCampus })}`),
      sub: `${format(f, "MMM d", { in: inCampus })}–${format(l, sameMonth ? "d" : "MMM d", { in: inCampus })}, ${format(l, "yyyy", { in: inCampus })}`,
    };
  })();

  const isTodayInView = days.some((d) => ymd(d) === ymd(now));

  return (
    <div className="flex min-h-0 flex-1">
      <CalendarSidebar
        anchor={anchor}
        onPickDate={setAnchor}
        groups={groups}
        enabled={enabled ?? new Set()}
        onToggle={toggle}
        onNew={newEvent}
        canCreate={editableIds.size > 0}
      />
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Calendar">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setAnchor(campusNow())} disabled={isTodayInView && view !== "month"}>
              Today
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setAnchor((a) => stepAnchor(view, a, -1))} aria-label="Previous">
                  <ChevronLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous (←)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setAnchor((a) => stepAnchor(view, a, 1))} aria-label="Next">
                  <ChevronRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next (→)</TooltipContent>
            </Tooltip>
          </div>
          <h1 className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-numeral text-[28px] leading-none font-semibold tracking-tight">{title.main}</span>
            <span className="truncate text-sm text-muted-foreground tabular">{title.sub}</span>
          </h1>
          <span className={cn("size-1.5 rounded-full bg-[var(--ring)] transition-opacity", isFetching ? "opacity-100" : "opacity-0")} aria-hidden />
          <div className="ml-auto flex items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => v && setView(v as View)}
              aria-label="Calendar view"
            >
              {VIEWS.map((v) => (
                <Tooltip key={v.id}>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value={v.id} className="px-3 data-[state=on]:bg-[var(--brand-blue)] data-[state=on]:text-white dark:data-[state=on]:bg-[var(--cal-azurite)]">
                      {v.label}
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>Press {v.key}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
            <Button size="sm" onClick={newEvent} className="lg:hidden" aria-label="New event" disabled={editableIds.size === 0}>
              <Plus />
            </Button>
          </div>
        </header>

        <TermRibbon terms={terms} anchor={anchor} today={now} onJump={(d) => setAnchor(d)} />

        {!enabled ? (
          <CalendarSkeleton inline />
        ) : view === "month" ? (
          <MonthGrid
            days={days}
            month={campus(anchor).getMonth()}
            occurrences={occurrences}
            calendars={calMap}
            closures={closures}
            now={now}
            onSelect={setSelected}
            onCreate={(start, end, allDay) => editableIds.size && setEditor({ mode: "create", start, end, allDay })}
            onOpenDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
        ) : view === "agenda" ? (
          <AgendaList days={days} occurrences={occurrences} calendars={calMap} closures={closures} now={now} onSelect={setSelected} onNew={newEvent} />
        ) : (
          <TimeGrid
            days={days}
            occurrences={occurrences}
            calendars={calMap}
            closures={closures}
            now={now}
            canEdit={(id) => editableIds.has(id)}
            onSelect={setSelected}
            onCreate={(start, end, allDay) => editableIds.size && setEditor({ mode: "create", start, end, allDay })}
            onMove={moveEvent}
            onOpenDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
        )}
      </section>

      <EventSheet
        occurrence={selected}
        calendars={calMap}
        onClose={() => setSelected(null)}
        onEdit={(o) => {
          setSelected(null);
          setEditor({ mode: "edit", eventId: o.eventId, occurrenceStart: o.originalStart });
        }}
      />
      <EventEditor target={editor} onClose={() => setEditor(null)} calendars={calendars} canStaffRooms={canStaffRooms} terms={terms} />
    </div>
  );
}

function CalendarSkeleton({ inline = false }: { inline?: boolean }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 p-5", !inline && "pl-[288px]")}>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="min-h-0 w-full flex-1" />
    </div>
  );
}
