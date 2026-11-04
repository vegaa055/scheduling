"use client";

import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, Monitor, Plus, ShieldCheck, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { EventKind, RoomDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMounted } from "@/hooks/use-mounted";
import { useMe, useRoomBoard, useRooms } from "@/lib/queries";
import { atMinute, CAMPUS_TZ, campus, campusNow, inCampus, minutesSinceMidnight, timeRange, ymd } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BookingDialog, type BookingDraft } from "./booking-dialog";

const START = 7 * 60;
const END = 22 * 60;
const SPAN = END - START;
const KIND_COLOR: Partial<Record<EventKind, string>> = {
  class: "azurite",
  exam: "chili",
  booking: "sage",
  event: "leaf",
  meeting: "oasis",
  office_hours: "mesa",
  hold: "midnight",
};

export function RoomBoard() {
  const mounted = useMounted();
  if (!mounted) return <Skeleton className="m-6 h-[70vh]" />;
  return <RoomBoardInner />;
}

function RoomBoardInner() {
  const { data: me } = useMe();
  const [day, setDay] = useState<Date>(() => campusNow());
  const [building, setBuilding] = useState("all");
  const [minCap, setMinCap] = useState("0");
  const [feature, setFeature] = useState("any");
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data: rooms = [], isLoading: roomsLoading } = useRooms();
  const { data: board = [], isFetching } = useRoomBoard(ymd(day));
  const busyById = useMemo(() => new Map(board.map((b) => [b.roomId, b.busy])), [board]);
  const canReview = !!me?.user.roles.some((r) => r === "admin" || r === "staff" || r === "scheduler");
  const canBook = !!me?.user.roles.some((r) => r !== "viewer");

  const buildings = [...new Map(rooms.map((r) => [r.buildingCode, r.buildingName])).entries()];
  const features = [...new Set(rooms.flatMap((r) => r.features))].sort();
  const filtered = rooms.filter(
    (r) =>
      (building === "all" || r.buildingCode === building) &&
      r.capacity >= Number(minCap) &&
      (feature === "any" || r.features.includes(feature)),
  );
  const grouped = buildings
    .map(([code, name]) => ({ code, name, rooms: filtered.filter((r) => r.buildingCode === code) }))
    .filter((g) => g.rooms.length);

  const isToday = ymd(day) === ymd(now);
  const nowMin = minutesSinceMidnight(now);
  const freeNow = isToday
    ? filtered.filter((r) => !(busyById.get(r.id) ?? []).some((b) => new Date(b.start) <= now && new Date(b.end) > now)).length
    : null;
  const pct = (m: number) => `${((m - START) / SPAN) * 100}%`;

  const openDraft = (room: RoomDTO, minute: number) => {
    const m = Math.max(START, Math.min(END - 60, Math.floor(minute / 30) * 30));
    setDraft({ roomId: room.id, start: atMinute(day, m), end: atMinute(day, m + 60) });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-5 py-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setDay(campusNow())} disabled={isToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Previous day" onClick={() => setDay((d) => addDays(campus(d), -1, { in: inCampus }))}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next day" onClick={() => setDay((d) => addDays(campus(d), 1, { in: inCampus }))}>
            <ChevronRight />
          </Button>
        </div>
        <h1 className="flex items-baseline gap-2.5">
          <span className="font-numeral text-[28px] leading-none font-semibold">Rooms</span>
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                {format(day, "EEEE, MMMM d", { in: inCampus })}
                <CalendarIcon className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={new Date(campus(day).getFullYear(), campus(day).getMonth(), campus(day).getDate())}
                onSelect={(d) => d && setDay(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), CAMPUS_TZ))}
              />
            </PopoverContent>
          </Popover>
        </h1>
        {freeNow !== null && (
          <p className="text-sm">
            <span className="font-numeral text-lg font-semibold tabular">{freeNow}</span>
            <span className="text-muted-foreground"> of {filtered.length} free right now</span>
          </p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={building} onValueChange={setBuilding}>
            <SelectTrigger size="sm" className="w-[190px]" aria-label="Building">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All buildings</SelectItem>
              {buildings.map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minCap} onValueChange={setMinCap}>
            <SelectTrigger size="sm" className="w-[120px]" aria-label="Minimum seats">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any size</SelectItem>
              {[20, 40, 100, 150].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}+ seats
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={feature} onValueChange={setFeature}>
            <SelectTrigger size="sm" className="w-[160px]" aria-label="Feature">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any equipment</SelectItem>
              {features.map((f) => (
                <SelectItem key={f} value={f} className="capitalize">
                  {f.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canBook && (
            <Button size="sm" onClick={() => filtered[0] && openDraft(filtered[0], isToday ? nowMin + 30 : 9 * 60)}>
              <Plus /> Book a room
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="min-w-[960px]">
          {/* Hour scale */}
          <div className="sticky top-0 z-10 grid grid-cols-[232px_1fr] border-b bg-card">
            <div className="px-4 py-2 text-xs text-muted-foreground">
              {isFetching ? "Updating…" : `${filtered.length} rooms`}
            </div>
            <div className="relative h-8">
              {Array.from({ length: SPAN / 60 + 1 }).map((_, i) => {
                const h = START / 60 + i;
                return (
                  <span key={h} className="absolute top-2 -translate-x-1/2 text-[10.5px] text-muted-foreground tabular" style={{ left: pct(h * 60) }}>
                    {h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}
                  </span>
                );
              })}
            </div>
          </div>

          {roomsLoading && <Skeleton className="m-4 h-96" />}
          {grouped.map((g) => (
            <section key={g.code} aria-label={g.name}>
              <h2 className="sticky left-0 bg-background px-4 pt-4 pb-1.5 text-xs font-semibold text-muted-foreground">
                {g.name}
              </h2>
              <ul>
                {g.rooms.map((r) => {
                  const busy = busyById.get(r.id) ?? [];
                  return (
                    <li key={r.id} className="grid grid-cols-[232px_1fr] border-t border-grid bg-card">
                      <div className="flex items-center justify-between gap-2 px-4 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-semibold">
                            {r.label}
                            {r.requiresApproval && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <ShieldCheck className="size-3.5 text-[var(--cal-mesa)]" aria-label="Needs approval" />
                                </TooltipTrigger>
                                <TooltipContent>Bookings need approval</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{r.name ?? r.kind.replaceAll("_", " ")}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                          {r.features.includes("video_conf") && <Video className="size-3.5" aria-label="Video conferencing" />}
                          {r.features.includes("computers") && <Monitor className="size-3.5" aria-label="Computers" />}
                          <span className="font-numeral text-base font-semibold text-foreground tabular">{r.capacity}</span>
                        </div>
                      </div>
                      <div
                        className={cn("relative h-12 border-l border-grid", canBook && r.bookable && "cursor-cell")}
                        onClick={(e) => {
                          if (!canBook || !r.bookable || e.target !== e.currentTarget) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          openDraft(r, START + ((e.clientX - rect.left) / rect.width) * SPAN);
                        }}
                      >
                        {Array.from({ length: SPAN / 60 }).map((_, i) => (
                          <span key={i} aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-grid" style={{ left: pct(START + i * 60) }} />
                        ))}
                        {busy.map((b, i) => {
                          const s = Math.max(START, minutesSinceMidnight(new Date(b.start)));
                          const e = Math.min(END, minutesSinceMidnight(new Date(b.end)) || 24 * 60);
                          if (e <= START || s >= END) return null;
                          const color = KIND_COLOR[b.kind] ?? "azurite";
                          return (
                            <Tooltip key={i}>
                              <TooltipTrigger asChild>
                                <div
                                  className="absolute inset-y-1.5 overflow-hidden rounded-[4px] border-l-[3px] px-1.5 text-[11px] leading-[36px] font-medium whitespace-nowrap"
                                  style={{
                                    left: pct(s),
                                    width: `calc(${((e - s) / SPAN) * 100}% - 2px)`,
                                    borderColor: `var(--cal-${color})`,
                                    backgroundColor: `color-mix(in oklab, var(--cal-${color}) var(--tint), var(--card))`,
                                    color: `var(--cal-${color}-ink)`,
                                  }}
                                >
                                  {b.title}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="font-medium">{b.title}</div>
                                <div className="opacity-80 tabular">{timeRange(new Date(b.start), new Date(b.end))}</div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                        {isToday && nowMin > START && nowMin < END && (
                          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0 border-l-2 border-now" style={{ left: pct(nowMin) }} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!roomsLoading && grouped.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">No rooms match these filters. Try a smaller size or any equipment.</p>
          )}
        </div>
      </div>
      <BookingDialog draft={draft} rooms={rooms} canReview={canReview} onClose={() => setDraft(null)} />
    </div>
  );
}
