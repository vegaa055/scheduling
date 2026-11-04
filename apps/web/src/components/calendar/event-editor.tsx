"use client";

import { TZDate } from "@date-fns/tz";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { AlertTriangle, CalendarIcon, Check, ChevronsUpDown, DoorOpen, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  EVENT_KIND_LABELS,
  type CalendarDTO,
  type ConflictDTO,
  type EventDetailDTO,
  type EventKind,
  type RoomDTO,
  type TermDTO,
} from "@sched/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError } from "@/lib/api";
import { swatch } from "@/lib/colors";
import { useConflictCheck, useEventDetail, useInvalidateCalendar, usePeople, useRooms, type Person } from "@/lib/queries";
import { buildRRule, parseRRule, WEEKDAYS, type Freq } from "@/lib/rrule";
import { atMinute, CAMPUS_TZ, campus, inCampus, isoCampus, minutesSinceMidnight, parseYmd, timeRange, ymd } from "@/lib/time";
import { cn } from "@/lib/utils";

export type EditorTarget =
  | { mode: "create"; start: Date; end: Date; allDay: boolean; calendarId?: string; roomId?: string }
  | { mode: "edit"; eventId: string; occurrenceStart: string };

const KINDS: EventKind[] = ["meeting", "class", "office_hours", "exam", "event", "deadline", "hold"];
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const minuteLabel = (m: number) => format(atMinute(new Date(2026, 0, 5), m), m % 60 === 0 ? "h aaa" : "h:mm aaa", { in: inCampus });
const TIMES = Array.from({ length: (24 * 60) / 15 }, (_, i) => i * 15);
const duration = (min: number) => (min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60} hr` : `${(min / 60).toFixed(1)} hr`);

/** DayPicker works in the browser's zone; convert campus days to and from it. */
const toPicker = (d: Date) => {
  const c = campus(d);
  return new Date(c.getFullYear(), c.getMonth(), c.getDate());
};
const fromPicker = (d: Date) => new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), CAMPUS_TZ);

interface FormState {
  title: string;
  calendarId: string;
  kind: EventKind;
  day: Date;
  startMin: number;
  endMin: number;
  allDay: boolean;
  repeat: "none" | Freq;
  byday: string[];
  repeatEnd: "term" | "date" | "count" | "never";
  until: string;
  count: number;
  roomId: string | null;
  locationText: string;
  attendees: Person[];
  description: string;
  tentative: boolean;
}

function initialForm(target: EditorTarget, detail: EventDetailDTO | undefined, defaultCal: string, termEnd: string): FormState | null {
  if (target.mode === "create") {
    const s = campus(target.start);
    return {
      title: "",
      calendarId: target.calendarId ?? defaultCal,
      kind: "meeting",
      day: s,
      startMin: target.allDay ? 9 * 60 : minutesSinceMidnight(target.start),
      endMin: target.allDay ? 10 * 60 : Math.min(minutesSinceMidnight(target.end) || 24 * 60, 24 * 60),
      allDay: target.allDay,
      repeat: "none",
      byday: [DAY_CODES[s.getDay()]!],
      repeatEnd: "term",
      until: termEnd,
      count: 10,
      roomId: target.roomId ?? null,
      locationText: "",
      attendees: [],
      description: "",
      tentative: false,
    };
  }
  if (!detail) return null;
  const occStart = new Date(target.occurrenceStart);
  const dur = new Date(detail.endsAt).getTime() - new Date(detail.startsAt).getTime();
  const r = parseRRule(detail.rrule);
  return {
    title: detail.title,
    calendarId: detail.calendarId,
    kind: detail.kind,
    day: campus(occStart),
    startMin: minutesSinceMidnight(occStart),
    endMin: Math.min(minutesSinceMidnight(occStart) + dur / 60_000, 24 * 60),
    allDay: detail.allDay,
    repeat: r ? r.freq : "none",
    byday: r?.byday.length ? r.byday : [DAY_CODES[campus(occStart).getDay()]!],
    repeatEnd: r?.until ? (r.until === termEnd ? "term" : "date") : r?.count ? "count" : r ? "never" : "term",
    until: r?.until ?? termEnd,
    count: r?.count ?? 10,
    roomId: detail.roomId,
    locationText: detail.locationText ?? "",
    attendees: detail.attendees.map((a) => ({ id: a.id, displayName: a.displayName, netid: "", title: null, departmentName: null })),
    description: detail.description ?? "",
    tentative: detail.status === "tentative",
  };
}

export function EventEditor({
  target,
  onClose,
  calendars,
  canStaffRooms,
  terms,
}: {
  target: EditorTarget | null;
  onClose: () => void;
  calendars: CalendarDTO[];
  canStaffRooms: boolean;
  terms: TermDTO[];
}) {
  const open = !!target;
  const editId = target?.mode === "edit" ? target.eventId : null;
  const { data: detail, isLoading } = useEventDetail(editId);
  const editable = calendars.filter((c) => c.access === "owner" || c.access === "editor");
  const personal = editable.find((c) => c.kind === "personal") ?? editable[0];
  const anchorDay = target ? (target.mode === "create" ? target.start : new Date(target.occurrenceStart)) : new Date();
  const term = terms.find((t) => parseYmd(t.startsOn) <= campus(anchorDay) && campus(anchorDay) <= parseYmd(t.endsOn)) ?? terms.find((t) => t.isCurrent);
  const termEnd = term?.classesEndOn ?? ymd(addDays(campus(anchorDay), 90, { in: inCampus }));

  const [form, setForm] = useState<FormState | null>(null);
  const [conflicts, setConflicts] = useState<ConflictDTO[]>([]);
  const [askScope, setAskScope] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveConflicts, setSaveConflicts] = useState(false);

  // (Re)initialise when the target or loaded detail changes.
  useEffect(() => {
    if (!target) {
      setForm(null);
      return;
    }
    setForm(initialForm(target, detail, personal?.id ?? "", termEnd));
    setConflicts([]);
    setAskScope(false);
    setError(null);
    setSaveConflicts(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, detail]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const rrule = useMemo(() => {
    if (!form || form.repeat === "none") return null;
    return buildRRule({
      freq: form.repeat,
      interval: 1,
      byday: form.repeat === "WEEKLY" ? form.byday : [],
      until: form.repeatEnd === "term" ? termEnd : form.repeatEnd === "date" ? form.until : null,
      count: form.repeatEnd === "count" ? form.count : null,
    });
  }, [form, termEnd]);

  const times = useMemo(() => {
    if (!form) return null;
    if (form.allDay) {
      const s = atMinute(form.day, 0);
      return { startsAt: s, endsAt: addDays(s, 1, { in: inCampus }) };
    }
    return { startsAt: atMinute(form.day, form.startMin), endsAt: atMinute(form.day, form.endMin) };
  }, [form]);

  // Live conflict check, debounced.
  const check = useConflictCheck();
  const attendeeIds = form?.attendees.map((a) => a.id) ?? [];
  const checkKey = form && times ? JSON.stringify([times.startsAt, times.endsAt, rrule, form.roomId, attendeeIds, form.allDay]) : "";
  useEffect(() => {
    if (!form || !times || times.endsAt <= times.startsAt) return;
    const t = setTimeout(() => {
      check.mutate(
        {
          id: editId ?? undefined,
          startsAt: isoCampus(times.startsAt),
          endsAt: isoCampus(times.endsAt),
          rrule,
          roomId: form.roomId,
          attendeeIds,
          allDay: form.allDay,
        },
        { onSuccess: (r) => setConflicts(r.conflicts) },
      );
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const invalidate = useInvalidateCalendar();
  const save = useMutation({
    mutationFn: async ({ scope, force }: { scope: "series" | "occurrence"; force: boolean }) => {
      if (!form || !times) return;
      const body = {
        title: form.title.trim(),
        description: form.description || null,
        kind: form.kind,
        status: form.tentative ? "tentative" : "confirmed",
        calendarId: form.calendarId,
        allDay: form.allDay,
        roomId: form.roomId,
        locationText: form.roomId ? null : form.locationText || null,
        attendeeIds,
        force,
      } as const;
      if (!editId) {
        return api<EventDetailDTO>("/events", {
          method: "POST",
          json: { ...body, startsAt: isoCampus(times.startsAt), endsAt: isoCampus(times.endsAt), rrule },
        });
      }
      let { startsAt, endsAt } = times;
      if (scope === "series" && detail?.rrule) {
        // Keep the series' first date; apply the new time of day.
        const first = campus(detail.startsAt);
        startsAt = form.allDay ? atMinute(first, 0) : atMinute(first, form.startMin);
        endsAt = form.allDay ? addDays(atMinute(first, 0), 1, { in: inCampus }) : atMinute(first, form.endMin);
      }
      return api<EventDetailDTO>(`/events/${editId}`, {
        method: "PATCH",
        json: {
          ...body,
          startsAt: isoCampus(startsAt),
          endsAt: isoCampus(endsAt),
          rrule: scope === "occurrence" ? undefined : rrule,
          scope,
          occurrenceStart: target?.mode === "edit" ? target.occurrenceStart : undefined,
        },
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success(editId ? "Changes saved" : "Event created");
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "conflict") {
        setConflicts(e.conflicts);
        setSaveConflicts(true);
        setError(null);
        return;
      }
      setError(e instanceof Error ? e.message : "Couldn't save the event");
    },
  });

  const submit = (force = false) => {
    if (!form) return;
    if (!form.title.trim()) return setError("Add a title");
    if (!form.allDay && form.endMin <= form.startMin) return setError("End time must be after the start time");
    setError(null);
    if (editId && detail?.rrule && !askScope && !force) return setAskScope(true);
    save.mutate({ scope: "series", force });
  };

  const selectedCal = calendars.find((c) => c.id === form?.calendarId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle>{editId ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>
            {times && form
              ? `${format(times.startsAt, "EEEE, MMMM d", { in: inCampus })}${form.allDay ? ", all day" : `, ${timeRange(times.startsAt, times.endsAt)}`}`
              : "Loading"}
          </DialogDescription>
        </DialogHeader>

        {!form || (editId && isLoading) ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <form
            className="grid gap-5 px-6 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit(saveConflicts);
            }}
          >
            <Input
              autoFocus
              aria-label="Title"
              placeholder="Add a title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className="h-11 text-base font-medium"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Calendar">
                <Select value={form.calendarId} onValueChange={(v) => set("calendarId", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {editable.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="size-2.5 rounded-full" style={swatch(c.color)} />
                        {c.kind === "personal" && c.ownerId ? `${c.name} (personal)` : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Type">
                <Select value={form.kind} onValueChange={(v) => set("kind", v as EventKind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {EVENT_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* When */}
            <div className="grid gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Date" className="min-w-[180px] flex-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start font-normal">
                        <CalendarIcon className="text-muted-foreground" />
                        {format(form.day, "EEE, MMM d, yyyy", { in: inCampus })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={toPicker(form.day)}
                        defaultMonth={toPicker(form.day)}
                        onSelect={(d) => d && set("day", fromPicker(d))}
                      />
                    </PopoverContent>
                  </Popover>
                </Field>
                {!form.allDay && (
                  <>
                    <Field label="Starts" className="w-[130px]">
                      <TimeSelect
                        value={form.startMin}
                        onChange={(m) => {
                          const len = form.endMin - form.startMin;
                          setForm({ ...form, startMin: m, endMin: Math.min(m + Math.max(len, 15), 24 * 60) });
                        }}
                      />
                    </Field>
                    <Field label="Ends" className="w-[150px]">
                      <TimeSelect value={form.endMin} onChange={(m) => set("endMin", m)} after={form.startMin} />
                    </Field>
                  </>
                )}
                <label className="flex h-9 items-center gap-2 text-sm">
                  <Switch checked={form.allDay} onCheckedChange={(v) => set("allDay", v)} />
                  All day
                </label>
              </div>

              <div className="grid gap-3 rounded-md border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Label className="w-16 text-muted-foreground">Repeat</Label>
                  <Select value={form.repeat} onValueChange={(v) => set("repeat", v as FormState["repeat"])}>
                    <SelectTrigger className="w-[180px] bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Doesn&apos;t repeat</SelectItem>
                      <SelectItem value="DAILY">Every day</SelectItem>
                      <SelectItem value="WEEKLY">Every week</SelectItem>
                      <SelectItem value="MONTHLY">Every month</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.repeat === "WEEKLY" && (
                    <ToggleGroup
                      type="multiple"
                      variant="outline"
                      size="sm"
                      value={form.byday}
                      onValueChange={(v) => v.length && set("byday", v)}
                      aria-label="Days of the week"
                    >
                      {WEEKDAYS.map((w) => (
                        <ToggleGroupItem key={w.code} value={w.code} aria-label={w.label} className="w-8 bg-card data-[state=on]:bg-[var(--brand-blue)] data-[state=on]:text-white">
                          {w.short}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  )}
                </div>
                {form.repeat !== "none" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Label className="w-16 text-muted-foreground">Ends</Label>
                    <Select value={form.repeatEnd} onValueChange={(v) => set("repeatEnd", v as FormState["repeatEnd"])}>
                      <SelectTrigger className="w-[220px] bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="term">
                          Last day of classes{term ? `, ${format(parseYmd(term.classesEndOn), "MMM d", { in: inCampus })}` : ""}
                        </SelectItem>
                        <SelectItem value="date">On a date</SelectItem>
                        <SelectItem value="count">After a number of times</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.repeatEnd === "date" && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="bg-card font-normal">
                            {format(parseYmd(form.until), "MMM d, yyyy", { in: inCampus })}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={toPicker(parseYmd(form.until))}
                            defaultMonth={toPicker(parseYmd(form.until))}
                            onSelect={(d) => d && set("until", ymd(fromPicker(d)))}
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                    {form.repeatEnd === "count" && (
                      <Input
                        type="number"
                        min={2}
                        max={200}
                        value={form.count}
                        onChange={(e) => set("count", Math.max(2, Number(e.target.value) || 2))}
                        className="w-20 bg-card"
                        aria-label="Number of times"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Where */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Room">
                <RoomPicker
                  value={form.roomId}
                  onChange={(id) => set("roomId", id)}
                  startsAt={times?.startsAt}
                  endsAt={times?.endsAt}
                  rrule={rrule}
                  canStaffRooms={canStaffRooms}
                />
              </Field>
              <Field label="Other location">
                <Input
                  placeholder={form.roomId ? "Using the room above" : "Office, Zoom link, off campus"}
                  value={form.locationText}
                  disabled={!!form.roomId}
                  onChange={(e) => set("locationText", e.target.value)}
                />
              </Field>
            </div>

            <Field label="People">
              <AttendeePicker value={form.attendees} onChange={(v) => set("attendees", v)} />
            </Field>

            <Field label="Notes">
              <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Agenda, links, what to bring" />
            </Field>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={form.tentative} onCheckedChange={(v) => set("tentative", v)} />
              Tentative: show as pencilled in
            </label>

            {conflicts.length > 0 && (
              <Alert className="border-[var(--cal-mesa)]/50 bg-[color-mix(in_oklab,var(--cal-mesa)_8%,var(--card))]">
                <AlertTriangle className="text-[var(--cal-mesa)]" />
                <AlertTitle>
                  {conflicts.length === 1 ? "1 conflict" : `${conflicts.length} conflicts`}
                  {rrule ? " across the series" : ""}
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 space-y-1">
                    {conflicts.slice(0, 5).map((c, i) => (
                      <li key={i} className="text-[13px]">
                        <span className="font-medium text-foreground">{c.subject}</span>{" "}
                        {c.reason === "room" ? "is booked for" : "is busy with"} {c.title},{" "}
                        <span className="tabular">
                          {format(campus(c.start), "EEE MMM d", { in: inCampus })}, {timeRange(new Date(c.start), new Date(c.end))}
                        </span>
                      </li>
                    ))}
                    {conflicts.length > 5 && <li className="text-[13px]">and {conflicts.length - 5} more</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {askScope ? (
              <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
                <p className="text-sm font-medium">This is a repeating event. What should change?</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => save.mutate({ scope: "occurrence", force: saveConflicts })} disabled={save.isPending}>
                    Only {format(campus(target?.mode === "edit" ? target.occurrenceStart : new Date()), "EEE, MMM d", { in: inCampus })}
                  </Button>
                  <Button type="button" onClick={() => save.mutate({ scope: "series", force: saveConflicts })} disabled={save.isPending}>
                    Every event in the series
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAskScope(false)}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <DialogFooter className="items-center gap-2 sm:justify-between">
                <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  {selectedCal && <span className="size-2.5 rounded-full" style={swatch(selectedCal.color)} />}
                  {selectedCal?.name}
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={save.isPending} variant={saveConflicts ? "destructive" : "default"}>
                    {save.isPending ? "Saving…" : saveConflicts ? "Save anyway" : editId ? "Save changes" : "Create event"}
                  </Button>
                </div>
              </DialogFooter>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function TimeSelect({ value, onChange, after }: { value: number; onChange: (m: number) => void; after?: number }) {
  const options = after !== undefined ? [...TIMES.filter((t) => t > after), 24 * 60] : TIMES;
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-full tabular">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((m) => (
          <SelectItem key={m} value={String(m)} className="tabular">
            {m === 24 * 60 ? "midnight" : minuteLabel(m)}
            {after !== undefined && <span className="text-muted-foreground">{duration(m - after)}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RoomPicker({
  value,
  onChange,
  startsAt,
  endsAt,
  rrule,
  canStaffRooms,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  startsAt?: Date;
  endsAt?: Date;
  rrule: string | null;
  canStaffRooms: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [onlyFree, setOnlyFree] = useState(true);
  const { data: rooms = [] } = useRooms();
  const valid = startsAt && endsAt && endsAt > startsAt;
  const free = useQuery({
    queryKey: ["rooms-free", startsAt?.toISOString(), endsAt?.toISOString(), rrule],
    queryFn: () =>
      api<RoomDTO[]>(
        `/rooms/free?start=${encodeURIComponent(isoCampus(startsAt!))}&end=${encodeURIComponent(isoCampus(endsAt!))}${rrule ? `&rrule=${encodeURIComponent(rrule)}` : ""}`,
      ),
    enabled: open && !!valid,
    staleTime: 15_000,
  });
  const freeIds = new Set((free.data ?? []).map((r) => r.id));
  const selected = rooms.find((r) => r.id === value);
  const list = rooms.filter((r) => r.bookable && (!onlyFree || !free.data || freeIds.has(r.id) || r.id === value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <DoorOpen className="text-muted-foreground" />
            <span className="truncate">{selected ? `${selected.label}${selected.name ? `, ${selected.name}` : ""}` : "No room"}</span>
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search rooms or buildings" />
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
            <span>{free.isFetching ? "Checking availability…" : free.data ? `${freeIds.size} free at this time` : ""}</span>
            <label className="flex items-center gap-1.5">
              <Switch checked={onlyFree} onCheckedChange={setOnlyFree} className="scale-75" />
              Free only
            </label>
          </div>
          <CommandList className="max-h-72">
            <CommandEmpty>No rooms match.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__none"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <X /> Remove room
                </CommandItem>
              )}
              {list.map((r) => {
                const busy = free.data && !freeIds.has(r.id);
                const locked = r.requiresApproval && !canStaffRooms;
                return (
                  <CommandItem
                    key={r.id}
                    value={`${r.label} ${r.name ?? ""} ${r.buildingName}`}
                    disabled={locked}
                    onSelect={() => {
                      onChange(r.id);
                      setOpen(false);
                    }}
                    className="items-start"
                  >
                    <Check className={cn("mt-0.5", value === r.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {r.label}
                          {r.name && <span className="font-normal text-muted-foreground">, {r.name}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular">{r.capacity} seats</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {locked ? "Needs approval: request it from Rooms" : busy ? "Busy at this time" : r.features.slice(0, 3).join(", ").replaceAll("_", " ")}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AttendeePicker({ value, onChange }: { value: Person[]; onChange: (v: Person[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: people = [], isFetching } = usePeople(q);
  const chosen = new Set(value.map((p) => p.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2.5 text-sm">
          {p.displayName}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x.id !== p.id))}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Remove ${p.displayName}`}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="rounded-full">
            <Users /> Add people
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Name or NetID" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>{isFetching ? "Searching…" : "No one matches."}</CommandEmpty>
              <CommandGroup>
                {people
                  .filter((p) => !chosen.has(p.id))
                  .map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => {
                        onChange([...value, p]);
                        setQ("");
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.title}
                          {p.departmentName ? `, ${p.departmentName}` : ""}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
