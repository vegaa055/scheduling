"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Eraser } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AvailabilityBlockDTO, AvailabilityPref, DayCode, TermDTO } from "@sched/shared";
import { useDefaultTerm } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMounted } from "@/hooks/use-mounted";
import { api, ApiError } from "@/lib/api";
import { qk, useAvailability, useAvailabilitySummary, useMe, useTerms } from "@/lib/queries";
import { cn } from "@/lib/utils";

const DAYS: { code: DayCode; label: string; short: string }[] = [
  { code: "MO", label: "Monday", short: "Mon" },
  { code: "TU", label: "Tuesday", short: "Tue" },
  { code: "WE", label: "Wednesday", short: "Wed" },
  { code: "TH", label: "Thursday", short: "Thu" },
  { code: "FR", label: "Friday", short: "Fri" },
];
const START = 7 * 60;
const END = 21 * 60;
const SLOT = 30;
const SLOTS = (END - START) / SLOT;
const ROW_PX = 20;

type Brush = AvailabilityPref | "clear";
type Cells = Record<string, AvailabilityPref>;

const PREFS: Record<AvailabilityPref, { label: string; hint: string; swatch: string; plural: string }> = {
  unavailable: {
    label: "Can't teach",
    plural: "Can't teach",
    hint: "The builder never schedules your classes then.",
    swatch:
      "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--cal-chili) 62%, var(--card)) 0 4px, color-mix(in oklab, var(--cal-chili) 38%, var(--card)) 4px 8px)",
  },
  undesired: {
    label: "Rather not",
    plural: "Rather not",
    hint: "Used only when nothing else works.",
    swatch:
      "repeating-linear-gradient(0deg, color-mix(in oklab, var(--cal-mesa) 42%, var(--card)) 0 3px, color-mix(in oklab, var(--cal-mesa) 24%, var(--card)) 3px 5px)",
  },
  preferred: {
    label: "Prefer",
    plural: "Prefer",
    hint: "The builder tries these times first.",
    swatch: "linear-gradient(color-mix(in oklab, var(--cal-leaf) 48%, var(--card)), color-mix(in oklab, var(--cal-leaf) 48%, var(--card)))",
  },
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmt = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = ((h + 11) % 12) + 1;
  const suffix = h >= 12 ? "pm" : "am";
  return m ? `${hh}:${String(m).padStart(2, "0")}${suffix}` : `${hh}${suffix}`;
};
const key = (day: DayCode, slot: number) => `${day}:${slot}`;

/** Splits saved blocks into grid cells, keeping anything outside the grid (weekends, very early or late) as is. */
function fromBlocks(blocks: AvailabilityBlockDTO[]) {
  const cells: Cells = {};
  const outside: AvailabilityBlockDTO[] = [];
  for (const b of blocks) {
    const s = toMin(b.startTime);
    const e = toMin(b.endTime);
    if (!DAYS.some((d) => d.code === b.day)) {
      outside.push(b);
      continue;
    }
    if (s < START) outside.push({ ...b, endTime: toHHMM(Math.min(e, START)) });
    if (e > END) outside.push({ ...b, startTime: toHHMM(Math.max(s, END)) });
    for (let i = 0; i < SLOTS; i++) {
      const cs = START + i * SLOT;
      if (cs < e && cs + SLOT > s) cells[key(b.day, i)] = b.preference;
    }
  }
  return { cells, outside };
}

/** Merges runs of same-preference cells back into blocks. */
function toBlocks(cells: Cells): AvailabilityBlockDTO[] {
  const out: AvailabilityBlockDTO[] = [];
  for (const d of DAYS) {
    let run: { pref: AvailabilityPref; from: number } | null = null;
    for (let i = 0; i <= SLOTS; i++) {
      const p = i < SLOTS ? cells[key(d.code, i)] : undefined;
      if (run && p !== run.pref) {
        out.push({ day: d.code, startTime: toHHMM(START + run.from * SLOT), endTime: toHHMM(START + i * SLOT), preference: run.pref });
        run = null;
      }
      if (p && !run) run = { pref: p, from: i };
    }
  }
  return out;
}

export function AvailabilityScreen() {
  const mounted = useMounted();
  const { data: me } = useMe();
  if (!mounted || !me) return <Skeleton className="m-6 h-[70vh]" />;
  const roles = me.user.roles;
  if (!roles.some((r) => r === "faculty" || r === "admin" || r === "scheduler")) {
    return <p className="p-10 text-sm text-muted-foreground">Teaching availability is for instructors and schedulers.</p>;
  }
  return <AvailabilityInner />;
}

function AvailabilityInner() {
  const { data: me } = useMe();
  const { data: terms = [] } = useTerms();
  const [termId, setTermId] = useDefaultTerm(terms);
  const term = terms.find((t) => t.id === termId);
  const user = me!.user;
  const isScheduler = user.roles.some((r) => r === "admin" || r === "scheduler");
  const isFaculty = user.roles.includes("faculty");
  const { data: summary = [] } = useAvailabilitySummary(termId, isScheduler);
  const [picked, setPicked] = useState<string>();
  const [dirty, setDirty] = useState(false);

  const people = useMemo(() => {
    const list = [...summary];
    if (isFaculty && !list.some((p) => p.id === user.id)) list.unshift({ id: user.id, displayName: user.displayName, netid: user.netid, blocks: -1 });
    return list;
  }, [summary, isFaculty, user]);
  const userId = picked ?? (isFaculty || !isScheduler ? user.id : people[0]?.id);
  const self = userId === user.id;
  const person = people.find((p) => p.id === userId);
  const { data: blocks, isLoading } = useAvailability(termId, userId, self);
  const setCount = summary.filter((p) => p.blocks > 0).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b bg-card px-5 py-3">
        <h1 className="font-numeral text-[28px] leading-none font-semibold">Teaching availability</h1>
        <Select value={termId} onValueChange={setTermId} disabled={dirty}>
          <SelectTrigger size="sm" className="w-[160px]" aria-label="Term">
            <SelectValue placeholder="Term" />
          </SelectTrigger>
          <SelectContent>
            {terms.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isScheduler && people.length > 0 && (
          <Select value={userId} onValueChange={setPicked} disabled={dirty}>
            <SelectTrigger size="sm" className="w-[240px]" aria-label="Instructor">
              <SelectValue placeholder="Instructor" />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span>{p.id === user.id ? `${p.displayName} (you)` : p.displayName}</span>
                  {p.blocks >= 0 && <span className="ml-auto pl-3 text-xs text-muted-foreground">{p.blocks > 0 ? "Set" : "Not set"}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isScheduler && summary.length > 0 && (
          <span className="text-sm text-muted-foreground">
            <span className="font-numeral text-base font-semibold text-foreground tabular">{setCount}</span> of {summary.length} instructors
            teaching in {term?.name} have set theirs
          </span>
        )}
        {dirty && <span className="ml-auto text-xs text-muted-foreground">Save or discard to switch term or person</span>}
      </header>

      {!termId || !userId ? (
        <p className="p-8 text-sm text-muted-foreground">{termId ? "No instructors are assigned to sections in this term yet." : ""}</p>
      ) : isLoading || !blocks ? (
        <Skeleton className="m-5 h-[600px]" />
      ) : (
        <Editor
          key={`${termId}:${userId}`}
          termId={termId}
          term={term!}
          terms={terms}
          userId={userId}
          self={self}
          name={self ? null : (person?.displayName ?? "this instructor")}
          initial={blocks}
          onDirty={setDirty}
        />
      )}
    </div>
  );
}

function Editor({
  termId,
  term,
  terms,
  userId,
  self,
  name,
  initial,
  onDirty,
}: {
  termId: string;
  term: TermDTO;
  terms: TermDTO[];
  userId: string;
  self: boolean;
  name: string | null;
  initial: AvailabilityBlockDTO[];
  onDirty: (d: boolean) => void;
}) {
  const qc = useQueryClient();
  const start = useMemo(() => fromBlocks(initial), [initial]);
  const [cells, setCells] = useState<Cells>(start.cells);
  const [brush, setBrush] = useState<Brush>("unavailable");
  const [focus, setFocus] = useState({ d: 0, s: 4 });
  const stroke = useRef<Brush | null>(null);
  /** While dragging: where it started and the cells as they were, so the drag paints a rectangle. */
  const drag = useRef<{ anchor: { d: number; s: number }; before: Cells; value: Brush } | null>(null);
  const others = terms.filter((t) => t.id !== termId);
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");

  const savedJson = useMemo(() => JSON.stringify(toBlocks(start.cells)), [start]);
  const blocks = useMemo(() => toBlocks(cells), [cells]);
  const dirty = JSON.stringify(blocks) !== savedJson;
  // The header locks the term and person pickers while there are unsaved changes.
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const paint = (d: number, s: number, value: Brush) =>
    setCells((c) => {
      const k = key(DAYS[d]!.code, s);
      if ((c[k] ?? "clear") === value) return c;
      const n = { ...c };
      if (value === "clear") delete n[k];
      else n[k] = value;
      return n;
    });
  /** Painting over a cell that already has the brush's value erases instead. */
  const strokeFor = (d: number, s: number): Brush => (brush !== "clear" && cells[key(DAYS[d]!.code, s)] === brush ? "clear" : brush);

  const paintRect = (to: { d: number; s: number }) => {
    const g = drag.current;
    if (!g) return;
    const [d0, d1] = [Math.min(g.anchor.d, to.d), Math.max(g.anchor.d, to.d)];
    const [s0, s1] = [Math.min(g.anchor.s, to.s), Math.max(g.anchor.s, to.s)];
    const next = { ...g.before };
    for (let d = d0; d <= d1; d++) {
      for (let s = s0; s <= s1; s++) {
        const k = key(DAYS[d]!.code, s);
        if (g.value === "clear") delete next[k];
        else next[k] = g.value;
      }
    }
    setCells(next);
  };

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
    return el ? { d: Number(el.dataset.d), s: Number(el.dataset.s) } : null;
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/terms/${termId}/availability`, {
        method: "PUT",
        json: { ...(self ? {} : { userId }), blocks: [...blocks, ...start.outside] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.availability(termId, userId) });
      qc.invalidateQueries({ queryKey: qk.availabilitySummary(termId) });
      toast.success(self ? `Saved your availability for ${term.name}` : `Saved ${name}'s availability for ${term.name}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't save. Try again."),
  });
  const copy = useMutation({
    mutationFn: () => api<AvailabilityBlockDTO[]>(`/terms/${copyFrom}/availability${self ? "" : `?userId=${userId}`}`),
    onSuccess: (b) => {
      const from = terms.find((t) => t.id === copyFrom)?.name;
      if (b.length === 0) return toast(`Nothing was set for ${from}`);
      setCells(() => fromBlocks(b).cells);
      toast(`Copied from ${from}. Save to keep it.`);
    },
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!el) return;
    const at = { d: Number(el.dataset.d), s: Number(el.dataset.s) };
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (e.key in moves) {
      e.preventDefault();
      const [dd, ds] = moves[e.key]!;
      const next = { d: Math.min(DAYS.length - 1, Math.max(0, at.d + dd)), s: Math.min(SLOTS - 1, Math.max(0, at.s + ds)) };
      // Shift+arrow paints the current brush as it moves (Space toggles a single time).
      if (e.shiftKey) {
        stroke.current ??= brush;
        paint(at.d, at.s, stroke.current);
        paint(next.d, next.s, stroke.current);
      }
      setFocus(next);
      document.getElementById(`cell-${next.d}-${next.s}`)?.focus();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      paint(at.d, at.s, strokeFor(at.d, at.s));
    }
  };

  const byDay = DAYS.map((d) => ({ d, blocks: blocks.filter((b) => b.day === d.code) }));

  return (
    <div className="grid gap-6 p-3 sm:p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={brush}
            onValueChange={(v) => v && setBrush(v as Brush)}
            aria-label="What to mark"
            className="flex-wrap"
          >
            {(Object.keys(PREFS) as AvailabilityPref[]).map((p) => (
              <ToggleGroupItem key={p} value={p} className="gap-2 px-3">
                <span className="size-3 rounded-[3px] border border-black/10" style={{ background: PREFS[p].swatch }} aria-hidden />
                {PREFS[p].label}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="clear" className="gap-2 px-3">
              <Eraser className="size-3.5" /> Erase
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="basis-full text-xs text-muted-foreground">
            {brush === "clear" ? "Drag over times to clear them." : `${PREFS[brush].hint} Drag over times, across several days if you like.`}
          </p>
        </div>

        <div className="px-2 pt-3 pb-4 sm:px-4">
          <div>
            <div className="grid grid-cols-[44px_repeat(5,minmax(0,1fr))] sm:grid-cols-[52px_repeat(5,minmax(0,1fr))] pb-1.5">
              <div />
              {DAYS.map((d) => (
                <div key={d.code} className="text-xs font-semibold text-muted-foreground">
                  <span className="hidden sm:inline">{d.label}</span>
                  <span className="sm:hidden">{d.short}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[44px_minmax(0,1fr)] sm:grid-cols-[52px_minmax(0,1fr)]">
              <div className="relative" style={{ height: SLOTS * ROW_PX }} aria-hidden>
                {Array.from({ length: (END - START) / 60 + 1 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute right-1.5 -translate-y-1/2 sm:right-2 text-[10.5px] text-muted-foreground tabular"
                    style={{ top: i * 2 * ROW_PX }}
                  >
                    {fmt(START + i * 60)}
                  </span>
                ))}
              </div>
              <div
                role="grid"
                aria-label={`Availability for ${term.name}. Arrow keys move, Space marks the time, Shift with arrows marks as you move.`}
                aria-rowcount={SLOTS}
                aria-colcount={DAYS.length}
                className="grid touch-none grid-cols-5 border-r border-b border-grid select-none"
                style={{ gridTemplateRows: `repeat(${SLOTS}, ${ROW_PX}px)` }}
                onPointerDown={(e) => {
                  const c = cellAt(e.clientX, e.clientY);
                  if (!c || e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { anchor: c, before: cells, value: strokeFor(c.d, c.s) };
                  setFocus(c);
                  paintRect(c);
                }}
                onPointerMove={(e) => {
                  if (!drag.current || e.buttons === 0) return;
                  const c = cellAt(e.clientX, e.clientY);
                  if (c) paintRect(c);
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => {
                  if (drag.current) setCells(drag.current.before);
                  drag.current = null;
                }}
                onKeyDown={onKeyDown}
                onKeyUp={(e) => e.key === "Shift" && (stroke.current = null)}
              >
                {Array.from({ length: SLOTS }).map((_, s) => (
                  <div key={s} role="row" className="contents">
                    {DAYS.map((d, di) => {
                      const p = cells[key(d.code, s)];
                      const from = START + s * SLOT;
                      const focused = focus.d === di && focus.s === s;
                      return (
                        <div
                          key={d.code}
                          id={`cell-${di}-${s}`}
                          role="gridcell"
                          data-cell
                          data-d={di}
                          data-s={s}
                          tabIndex={focused ? 0 : -1}
                          aria-label={`${d.label} ${fmt(from)} to ${fmt(from + SLOT)}, ${p ? PREFS[p].label.toLowerCase() : "no preference"}`}
                          onFocus={() => setFocus({ d: di, s })}
                          className={cn(
                            "border-l border-grid outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                            s % 2 === 0 ? "border-t" : "border-t border-t-[color-mix(in_oklab,var(--grid-line)_55%,transparent)]",
                            !p && "hover:bg-muted/60",
                          )}
                          style={
                            p
                              ? {
                                  // One grid-sized pattern sliced per cell, so stripes run on across a block.
                                  backgroundImage: PREFS[p].swatch,
                                  backgroundSize: `100% ${SLOTS * ROW_PX}px`,
                                  backgroundPosition: `0 ${-s * ROW_PX}px`,
                                  borderTopColor: s > 0 && cells[key(d.code, s - 1)] === p ? "transparent" : undefined,
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="grid content-start gap-4">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">{self ? `Your ${term.name} availability` : `${name}, ${term.name}`}</h2>
          {blocks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing marked. Without any marks, the Schedule builder treats every time as fine.
            </p>
          ) : (
            <dl className="mt-3 grid gap-2.5 text-sm">
              {byDay
                .filter((x) => x.blocks.length)
                .map(({ d, blocks: list }) => (
                  <div key={d.code} className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
                    <dt className="font-medium">{d.label}</dt>
                    <dd className="grid gap-0.5">
                      {list.map((b, i) => (
                        <span key={i} className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: PREFS[b.preference].swatch }} aria-hidden />
                          <span className="tabular">
                            {fmt(toMin(b.startTime))} to {fmt(toMin(b.endTime))}
                          </span>
                          <span className="text-muted-foreground">{PREFS[b.preference].label.toLowerCase()}</span>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          {start.outside.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Also keeps {start.outside.length} time{start.outside.length === 1 ? "" : "s"} outside this grid (weekends, before 7am or after 9pm).
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save availability"}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setCells(() => start.cells)}>
                Discard changes
              </Button>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4 text-sm">
          <h2 className="font-semibold">How the Schedule builder uses this</h2>
          <ul className="mt-2 grid gap-2">
            {(Object.keys(PREFS) as AvailabilityPref[]).map((p) => (
              <li key={p} className="flex gap-2.5">
                <span className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-black/10" style={{ background: PREFS[p].swatch }} aria-hidden />
                <span>
                  <span className="font-medium">{PREFS[p].plural}.</span> <span className="text-muted-foreground">{PREFS[p].hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-4">
          {others.length > 0 && (
            <>
              <Select value={copyFrom} onValueChange={setCopyFrom}>
                <SelectTrigger size="sm" className="w-[150px]" aria-label="Term to copy from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {others.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => copy.mutate()} disabled={!copyFrom || copy.isPending}>
                <Copy /> Copy from that term
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setCells(() => ({}))} disabled={blocks.length === 0}>
            Clear all
          </Button>
        </section>
      </aside>
    </div>
  );
}
