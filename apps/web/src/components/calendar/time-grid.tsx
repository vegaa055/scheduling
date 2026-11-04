"use client";

import { addDays, format } from "date-fns";
import { Repeat } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CalendarDTO, OccurrenceDTO } from "@sched/shared";
import { eventStyle, KIND_GLYPH } from "@/lib/colors";
import { atMinute, campus, inCampus, minutesSinceMidnight, sameCampusDay, timeRange, ymd } from "@/lib/time";
import { cn } from "@/lib/utils";
import { layoutColumn } from "./layout";

export const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const SNAP = 15;
const DAY_MIN = 24 * 60;
const WORKDAY = { start: 8 * 60, end: 18 * 60 };

export interface Closure {
  label: string;
  kind: string;
}

interface Props {
  days: Date[];
  occurrences: OccurrenceDTO[];
  calendars: Map<string, CalendarDTO>;
  closures: Map<string, Closure>;
  now: Date;
  canEdit: (calendarId: string) => boolean;
  onSelect: (o: OccurrenceDTO) => void;
  onCreate: (start: Date, end: Date, allDay: boolean) => void;
  onMove: (o: OccurrenceDTO, start: Date, end: Date) => void;
  onOpenDay: (d: Date) => void;
}

type Drag =
  | { type: "create"; day: number; from: number; to: number }
  | { type: "move"; occ: OccurrenceDTO; editable: boolean; grabOffset: number; dur: number; day: number; start: number; moved: boolean; x0: number; y0: number }
  | { type: "resize"; occ: OccurrenceDTO; day: number; start: number; end: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (m: number) => Math.round(m / SNAP) * SNAP;

const hourLabel = (h: number) => (h === 0 ? "" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`);

export function TimeGrid({ days, occurrences, calendars, closures, now, canEdit, onSelect, onCreate, onMove, onOpenDay }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  // Open on the teaching day: 7:30am, or earlier if something starts before then.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 7.5 * 60 * PX_PER_MIN;
    // only on mount / when the visible days change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, days[0]?.getTime()]);

  const { timed, allDay } = useMemo(() => {
    const timed: { s: number; e: number; occ: OccurrenceDTO }[][] = days.map(() => []);
    const allDay: OccurrenceDTO[][] = days.map(() => []);
    for (const o of occurrences) {
      const start = new Date(o.start);
      const end = new Date(o.end);
      days.forEach((d, i) => {
        const dayStart = atMinute(d, 0);
        const dayEnd = addDays(dayStart, 1, { in: inCampus });
        if (!(start < dayEnd && end > dayStart)) return;
        if (o.allDay) {
          allDay[i]!.push(o);
          return;
        }
        const s = start <= dayStart ? 0 : minutesSinceMidnight(start);
        const e = end >= dayEnd ? DAY_MIN : minutesSinceMidnight(end);
        timed[i]!.push({ s, e: Math.max(e, s + 15), occ: o });
      });
    }
    return { timed: timed.map((col) => layoutColumn(col)), allDay };
  }, [occurrences, days]);

  const pointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = colsRef.current!.getBoundingClientRect();
      const day = clamp(Math.floor(((clientX - rect.left) / rect.width) * days.length), 0, days.length - 1);
      const min = clamp((clientY - rect.top) / PX_PER_MIN, 0, DAY_MIN);
      return { day, min };
    },
    [days.length],
  );

  // Global pointer tracking while a drag is in progress.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = pointer(e.clientX, e.clientY);
      if (d.type === "create") setDrag({ ...d, day: d.day, to: clamp(snap(p.min), 0, DAY_MIN) });
      if (d.type === "resize") setDrag({ ...d, end: clamp(snap(p.min), d.start + SNAP, DAY_MIN) });
      if (d.type === "move") {
        const moved = d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 5;
        if (!d.editable) return moved !== d.moved ? setDrag({ ...d, moved }) : undefined;
        setDrag({ ...d, moved, day: p.day, start: clamp(snap(p.min - d.grabOffset), 0, DAY_MIN - d.dur) });
      }
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.type === "create") {
        const a = Math.min(d.from, d.to);
        let b = Math.max(d.from, d.to);
        if (b - a < SNAP) b = a + 60; // a click makes a one-hour event
        onCreate(atMinute(days[d.day]!, a), atMinute(days[d.day]!, Math.min(b, DAY_MIN)), false);
      } else if (d.type === "resize") {
        onMove(d.occ, new Date(d.occ.start), atMinute(days[d.day]!, d.end));
      } else if (d.type === "move") {
        if (!d.moved) return onSelect(d.occ);
        if (!d.editable) return;
        const start = atMinute(days[d.day]!, d.start);
        onMove(d.occ, start, new Date(start.getTime() + d.dur * 60_000));
      }
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.type]);

  const startCreate = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const p = pointer(e.clientX, e.clientY);
    const m = Math.floor(p.min / SNAP) * SNAP;
    setDrag({ type: "create", day: p.day, from: m, to: m });
  };

  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const nowMin = minutesSinceMidnight(now);
  const todayIdx = days.findIndex((d) => sameCampusDay(d, now));
  const hasAllDay = allDay.some((l) => l.length) || days.some((d) => closures.has(ymd(d)));

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="time-grid">
      {/* Day headers + all-day lane (sticky inside the scroller so columns line up exactly) */}
      <div className="sticky top-0 z-20 border-b bg-card">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="flex items-end justify-end pr-2 pb-1.5 text-[10px] text-muted-foreground">MST</div>
          {days.map((d, i) => {
            const isToday = i === todayIdx;
            const closure = closures.get(ymd(d));
            return (
              <button
                key={i}
                onClick={() => onOpenDay(d)}
                className="group flex items-end gap-2 border-l border-grid px-2.5 pt-2 pb-1.5 text-left first:border-l-0"
                aria-label={format(d, "EEEE, MMMM d", { in: inCampus })}
              >
                <span
                  className={cn(
                    "font-numeral text-[28px] leading-none font-semibold tabular",
                    isToday ? "rounded-[5px] bg-primary px-1.5 py-0.5 text-primary-foreground" : "group-hover:text-[var(--ring)]",
                  )}
                >
                  {format(d, "d", { in: inCampus })}
                </span>
                <span className="pb-0.5 leading-tight">
                  <span className={cn("block text-xs font-semibold", isToday ? "text-primary" : "text-muted-foreground")}>
                    {format(d, "EEE", { in: inCampus })}
                  </span>
                  {closure && <span className="block max-w-full truncate text-[10.5px] text-[var(--cal-chili-ink)]">{closure.label}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="grid border-t border-grid" style={{ gridTemplateColumns: cols }}>
            <div className="py-1 pr-2 text-right text-[10px] text-muted-foreground">all day</div>
            {days.map((d, i) => (
              <div
                key={i}
                className={cn("flex min-h-7 flex-col gap-0.5 border-l border-grid p-0.5 first:border-l-0", closures.has(ymd(d)) && "hatch")}
                onDoubleClick={() => onCreate(atMinute(d, 0), addDays(atMinute(d, 0), 1, { in: inCampus }), true)}
              >
                {allDay[i]!.map((o) => {
                  const cal = calendars.get(o.calendarId);
                  return (
                    <button
                      key={o.key}
                      onClick={() => onSelect(o)}
                      style={eventStyle(cal?.color ?? "azurite")}
                      className="truncate rounded-[4px] border-l-[3px] border-[var(--ev)] px-1.5 py-0.5 text-left text-[11px] font-semibold"
                    >
                      {o.kind === "deadline" ? "Due: " : ""}
                      {o.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: cols }}>
        {/* Hour gutter */}
        <div className="relative" style={{ height: DAY_MIN * PX_PER_MIN }}>
          {Array.from({ length: 24 }).map((_, h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] text-muted-foreground tabular" style={{ top: h * HOUR_PX }}>
              {hourLabel(h)}
            </span>
          ))}
          {todayIdx >= 0 && (
            <span
              className="absolute right-1 z-10 -translate-y-1/2 rounded bg-now px-1 text-[10px] font-semibold text-white tabular"
              style={{ top: nowMin * PX_PER_MIN }}
            >
              {format(campus(now), "h:mm", { in: inCampus })}
            </span>
          )}
        </div>

        {/* Day columns */}
        <div ref={colsRef} className="relative col-span-full col-start-2 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* hour lines */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="absolute inset-x-0 border-t border-grid" style={{ top: h * HOUR_PX }} />
            ))}
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={`h${h}`} className="absolute inset-x-0 border-t border-dashed border-grid/60" style={{ top: h * HOUR_PX + HOUR_PX / 2 }} />
            ))}
          </div>

          {days.map((d, i) => {
            const closure = closures.has(ymd(d));
            return (
              <div
                key={i}
                className={cn("relative border-l border-grid first:border-l-0", closure && "hatch")}
                style={{ height: DAY_MIN * PX_PER_MIN }}
                onPointerDown={startCreate}
                data-day={ymd(d)}
              >
                {/* off-hours shading */}
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-[var(--grid-off-hours)] opacity-70" style={{ height: WORKDAY.start * PX_PER_MIN }} />
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 bg-[var(--grid-off-hours)] opacity-70" style={{ top: WORKDAY.end * PX_PER_MIN }} />

                {timed[i]!.map(({ item, col, cols: n, span }) => {
                  const o = item.occ;
                  const cal = calendars.get(o.calendarId);
                  const editable = canEdit(o.calendarId);
                  const isDragging = drag && drag.type !== "create" && drag.occ.key === o.key && (drag.type === "resize" || (drag.editable && drag.moved));
                  const height = (item.e - item.s) * PX_PER_MIN;
                  const compact = height < 38;
                  return (
                    <div
                      key={o.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${o.title}, ${format(new Date(o.start), "EEE MMM d", { in: inCampus })}, ${timeRange(new Date(o.start), new Date(o.end))}${o.roomLabel ? `, ${o.roomLabel}` : ""}`}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(o))}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        const p = pointer(e.clientX, e.clientY);
                        setDrag({ type: "move", occ: o, editable, grabOffset: p.min - item.s, dur: item.e - item.s, day: i, start: item.s, moved: false, x0: e.clientX, y0: e.clientY });
                      }}
                      style={{
                        ...eventStyle(cal?.color ?? "azurite"),
                        top: item.s * PX_PER_MIN + 1,
                        height: Math.max(height - 2, 16),
                        left: `calc(${(col / n) * 100}% + 2px)`,
                        width: `calc(${(span / n) * 100}% - 5px)`,
                      }}
                      className={cn(
                        "group absolute z-[1] overflow-hidden rounded-[5px] border-l-[3px] border-[var(--ev)] px-1.5 text-left select-none",
                        "shadow-[0_0_0_1px_var(--card)] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        o.status === "tentative" && "hatch",
                        o.kind === "hold" && "border border-l-[3px] border-dashed border-[var(--ev)] !bg-card/70",
                        isDragging && "opacity-35",
                        compact ? "py-0" : "py-1",
                      )}
                    >
                      <div className={cn("flex min-w-0 gap-1", compact ? "items-center text-[11px] leading-[15px]" : "flex-col text-[11.5px] leading-[14px]")}>
                        <span className="flex min-w-0 items-start gap-1 font-semibold">
                          {KIND_GLYPH[o.kind] && (
                            <span className="shrink-0 rounded-[3px] bg-[var(--ev)] px-1 text-[9.5px] leading-[14px] font-bold text-white">{KIND_GLYPH[o.kind]}</span>
                          )}
                          <span className={cn("min-w-0", compact ? "truncate" : "line-clamp-2")}>{o.title}</span>
                        </span>
                        <span className={cn("truncate opacity-80 tabular", compact && "shrink-0")}>
                          {timeRange(new Date(o.start), new Date(o.end))}
                          {!compact && o.roomLabel ? `  ${o.roomLabel}` : ""}
                        </span>
                      </div>
                      {o.recurring && !compact && height > 54 && <Repeat aria-hidden className="absolute right-1 bottom-1 size-3 opacity-50" />}
                      {editable && !o.recurring && (
                        <span
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setDrag({ type: "resize", occ: o, day: i, start: item.s, end: item.e });
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Ghosts while dragging */}
                {drag?.type === "create" && drag.day === i && (
                  <Ghost from={Math.min(drag.from, drag.to)} to={Math.max(drag.to, drag.from) === Math.min(drag.from, drag.to) ? drag.from + SNAP : Math.max(drag.from, drag.to)} day={d} label="New event" />
                )}
                {drag?.type === "move" && drag.editable && drag.moved && drag.day === i && (
                  <Ghost from={drag.start} to={drag.start + drag.dur} day={d} label={drag.occ.title} color={calendars.get(drag.occ.calendarId)?.color} />
                )}
                {drag?.type === "resize" && drag.day === i && (
                  <Ghost from={drag.start} to={drag.end} day={d} label={drag.occ.title} color={calendars.get(drag.occ.calendarId)?.color} />
                )}

                {i === todayIdx && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-0 border-t-2 border-now" style={{ top: nowMin * PX_PER_MIN }}>
                    <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-now" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Ghost({ from, to, day, label, color }: { from: number; to: number; day: Date; label: string; color?: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-1 z-[5] rounded-[5px] border-2 border-[var(--ring)] bg-card/85 px-1.5 py-1 text-[11.5px] shadow-lg"
      style={{ top: from * PX_PER_MIN, height: Math.max((to - from) * PX_PER_MIN, 16), ...(color ? { borderColor: `var(--cal-${color})` } : {}) }}
    >
      <div className="truncate font-semibold">{label}</div>
      <div className="tabular opacity-80">{timeRange(atMinute(day, from), atMinute(day, to))}</div>
    </div>
  );
}
