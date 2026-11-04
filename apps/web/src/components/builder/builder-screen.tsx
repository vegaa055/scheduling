"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronRight, Lock, LockOpen, Play, Send, Square, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SectionDTO, SolverRunDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { layoutColumn } from "@/components/calendar/layout";
import { useMounted } from "@/hooks/use-mounted";
import { api, ApiError } from "@/lib/api";
import { useMe, usePatterns, useSections, useSolverRun, useSolverRuns, useTerms, useRooms, type PatternDTO } from "@/lib/queries";
import { parseYmd } from "@/lib/time";
import { cn } from "@/lib/utils";

const SUBJECT_COLOR: Record<string, string> = { CHEM: "oasis", MATH: "leaf", PHYS: "sky", MCB: "river", CSC: "bloom" };
const DAYS = [
  { code: "MO", label: "Monday" },
  { code: "TU", label: "Tuesday" },
  { code: "WE", label: "Wednesday" },
  { code: "TH", label: "Thursday" },
  { code: "FR", label: "Friday" },
];
const GRID_START = 8 * 60;
const GRID_END = 18 * 60 + 30;
const PX = 0.9;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

function parseScore(score: string | null) {
  if (!score) return null;
  const m = score.match(/(-?\d+)hard\/(-?\d+)medium\/(-?\d+)soft/);
  if (!m) return null;
  return { hard: Number(m[1]), medium: Number(m[2]), soft: Number(m[3]) };
}

function scoreWords(score: string | null) {
  const s = parseScore(score);
  if (!s) return null;
  return {
    hard: s.hard === 0 ? "No conflicts" : `${Math.abs(s.hard)} conflict${s.hard === -1 ? "" : "s"}`,
    medium: s.medium === 0 ? "Every section placed" : `${Math.abs(s.medium)} section${s.medium === -1 ? "" : "s"} not placed`,
    soft: `Preference score ${s.soft > 0 ? "+" : ""}${s.soft}`,
    ok: s.hard === 0 && s.medium === 0,
  };
}

export function BuilderScreen() {
  const mounted = useMounted();
  if (!mounted) return <Skeleton className="m-6 h-[70vh]" />;
  return <BuilderInner />;
}

function BuilderInner() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: terms = [] } = useTerms();
  const [termId, setTermId] = useState<string>();
  const [seconds, setSeconds] = useState("30");
  const [show, setShow] = useState<"proposed" | "current">("proposed");
  const [filter, setFilter] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);

  // Default to the next term that isn't under way yet; that's the one being built.
  useEffect(() => {
    if (termId || terms.length === 0) return;
    const upcoming = terms.find((t) => parseYmd(t.startsOn) > new Date());
    setTermId((upcoming ?? terms.find((t) => t.isCurrent) ?? terms[0])!.id);
  }, [terms, termId]);

  const term = terms.find((t) => t.id === termId);
  const { data: sections = [], isLoading: sectionsLoading } = useSections(termId);
  const { data: patterns = [] } = usePatterns(termId);
  const { data: rooms = [] } = useRooms();
  const { data: runs = [] } = useSolverRuns(termId);
  const latest = runs[0];
  const { data: run } = useSolverRun(latest?.id ?? null);
  const health = useQuery({ queryKey: ["solver-health"], queryFn: () => api<{ ok: boolean }>("/solver/health"), refetchInterval: 30_000 });

  const active = latest && (latest.status === "queued" || latest.status === "solving");
  // Poll while solving as a fallback for the live stream.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["solver-run", latest!.id] });
      qc.invalidateQueries({ queryKey: ["solver-runs", termId] });
    }, 1500);
    return () => clearInterval(t);
  }, [active, latest, qc, termId]);

  const patternById = useMemo(() => new Map(patterns.map((p) => [p.id, p])), [patterns]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const proposed = run && run.assignments?.length && run.status !== "applied" ? run.assignments : null;
  const placements = useMemo(() => {
    const useProposed = show === "proposed" && proposed;
    const byId = new Map(proposed?.map((a) => [a.sectionId, a]) ?? []);
    return sections.map((s) => {
      const a = useProposed ? byId.get(s.id) : null;
      const patternId = s.locked || !a ? s.meetingPatternId : a.meetingPatternId;
      const roomId = s.locked || !a ? s.roomId : a.roomId;
      return { s, pattern: patternId ? patternById.get(patternId) : undefined, roomLabel: roomId ? roomById.get(roomId)?.label : undefined };
    });
  }, [sections, proposed, show, patternById, roomById]);

  const start = useMutation({
    mutationFn: () => api<SolverRunDTO>("/solver/runs", { method: "POST", json: { termId, secondsLimit: Number(seconds) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solver-runs", termId] });
      setShow("proposed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't start the solver"),
  });
  const stop = useMutation({
    mutationFn: () => api(`/solver/runs/${latest!.id}/stop`, { method: "POST" }),
    onSuccess: () => toast("Stopping; keeping the best timetable found so far"),
  });
  const apply = useMutation({
    mutationFn: () => api<{ changed: number }>(`/solver/runs/${latest!.id}/apply`, { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sections", termId] });
      qc.invalidateQueries({ queryKey: ["solver-runs", termId] });
      qc.invalidateQueries({ queryKey: ["solver-run", latest!.id] });
      setShow("current");
      toast.success(`Applied to ${r.changed} section${r.changed === 1 ? "" : "s"}`);
    },
  });
  const publish = useMutation({
    mutationFn: () => api<{ published: number }>(`/terms/${termId}/publish`, { method: "POST" }),
    onSuccess: (r) => {
      setConfirmPublish(false);
      qc.invalidateQueries({ queryKey: ["sections", termId] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Published ${r.published} sections to the class calendars`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't publish"),
  });

  if (me && !me.user.roles.some((r) => r === "admin" || r === "scheduler")) {
    return <p className="p-10 text-sm text-muted-foreground">The schedule builder is for college schedulers.</p>;
  }

  const stats = {
    total: sections.length,
    placed: sections.filter((s) => s.meetingPatternId && s.roomId).length,
    locked: sections.filter((s) => s.locked).length,
    published: sections.filter((s) => s.status === "published").length,
  };
  const words = scoreWords(run?.score ?? null);
  const canApply = run && (run.status === "completed" || run.status === "cancelled");
  const canPublish = stats.placed > 0 && !active;
  const unplaced = placements.filter((p) => !p.pattern);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b bg-card px-5 py-3">
        <h1 className="font-numeral text-[28px] leading-none font-semibold">Schedule builder</h1>
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger size="sm" className="w-[170px]" aria-label="Term">
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
        <dl className="flex gap-5 text-sm">
          {[
            ["Sections", stats.total],
            ["Placed", stats.placed],
            ["Locked", stats.locked],
            ["Published", stats.published],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <dd className="font-numeral text-xl leading-none font-semibold tabular">{v}</dd>
              <dt className="text-muted-foreground">{k}</dt>
            </div>
          ))}
        </dl>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 text-xs", health.data?.ok ? "text-muted-foreground" : "text-destructive")}>
          <span className={cn("size-2 rounded-full", health.data?.ok ? "bg-[var(--cal-leaf)]" : "bg-destructive")} />
          {health.data?.ok ? "Solver ready" : health.isLoading ? "Checking solver" : "Solver offline: start services/solver"}
        </span>
      </header>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Run controls + timetable preview */}
        <section className="min-w-0 rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            {active ? (
              <Button variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
                <Square /> Stop
              </Button>
            ) : (
              <Button onClick={() => start.mutate()} disabled={!termId || start.isPending || !health.data?.ok}>
                <Wand2 /> Build timetable
              </Button>
            )}
            <Select value={seconds} onValueChange={setSeconds} disabled={!!active}>
              <SelectTrigger size="sm" className="w-[140px]" aria-label="Time budget">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ["15", "Quick, 15 sec"],
                  ["30", "30 seconds"],
                  ["60", "1 minute"],
                  ["120", "2 minutes"],
                  ["300", "5 minutes"],
                ].map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="min-w-0 flex-1 text-sm" aria-live="polite">
              {active ? (
                <span className="inline-flex items-center gap-2">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--ring)] opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-[var(--ring)]" />
                  </span>
                  {latest.status === "queued" ? "Waiting for the solver…" : words ? `Searching. ${words.hard}, ${words.medium.toLowerCase()}.` : "Building a first timetable…"}
                </span>
              ) : run?.status === "failed" ? (
                <span className="text-destructive">The solver stopped with an error: {run.error}</span>
              ) : words ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  {words.ok ? <CheckCircle2 className="size-4 text-[var(--cal-leaf)]" /> : <AlertTriangle className="size-4 text-[var(--cal-mesa)]" />}
                  <span className="font-medium">{words.hard}</span>
                  <span>{words.medium}</span>
                  <span className="text-muted-foreground">{words.soft}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Locked sections stay where they are; the solver places the rest.</span>
              )}
            </div>
            {canApply && run.status !== "applied" && (
              <Button variant="outline" onClick={() => apply.mutate()} disabled={apply.isPending}>
                <Play /> Apply to sections
              </Button>
            )}
            <Popover open={confirmPublish} onOpenChange={setConfirmPublish}>
              <PopoverTrigger asChild>
                <Button variant="outline" disabled={!canPublish || publish.isPending}>
                  <Send /> Publish
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <p className="text-sm font-medium">Publish {stats.placed} placed sections?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Each becomes a weekly class on its department&apos;s class calendar for {term?.name}, skipping holidays and breaks.
                  Classes already published are updated in place.
                </p>
                <Button className="mt-3 w-full" onClick={() => publish.mutate()} disabled={publish.isPending}>
                  {publish.isPending ? "Publishing…" : "Publish to calendars"}
                </Button>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={proposed ? show : "current"}
              onValueChange={(v) => v && setShow(v as "proposed" | "current")}
              aria-label="Which timetable to show"
            >
              <ToggleGroupItem value="proposed" disabled={!proposed} className="px-3">
                Solver&apos;s proposal
              </ToggleGroupItem>
              <ToggleGroupItem value="current" className="px-3">
                Saved placements
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="hidden flex-wrap gap-3 text-xs text-muted-foreground sm:flex">
              {Object.entries(SUBJECT_COLOR).map(([subj, c]) => (
                <span key={subj} className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ backgroundColor: `var(--cal-${c})` }} />
                  {subj}
                </span>
              ))}
            </div>
          </div>
          <WeekPreview placements={placements} loading={sectionsLoading} />
          {unplaced.length > 0 && (
            <p className="border-t px-4 py-2.5 text-sm text-muted-foreground">
              Not placed: {unplaced.map((p) => `${p.s.subject} ${p.s.number}-${p.s.sectionNumber}`).join(", ")}
            </p>
          )}
        </section>

        {/* Review */}
        <aside className="flex flex-col gap-5">
          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">What the solver weighed</h2>
            {!run ? (
              <p className="p-4 text-sm text-muted-foreground">Build a timetable to see conflicts and preferences here.</p>
            ) : !run.constraints?.length ? (
              <p className="p-4 text-sm text-muted-foreground">{active ? "Details appear when the run finishes." : "Nothing to report."}</p>
            ) : (
              <ul className="divide-y">
                {run.constraints.map((c) => {
                  const s = parseScore(c.score);
                  const level = s && s.hard ? "hard" : s && s.medium ? "medium" : "soft";
                  const reward = s && s.soft > 0;
                  return (
                    <li key={c.name}>
                      <Collapsible>
                        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/60">
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{c.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {level === "hard" ? "Must fix" : level === "medium" ? "Should fix" : reward ? "Bonus" : "Preference"}, {c.matchCount}{" "}
                              {c.matchCount === 1 ? "case" : "cases"}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-numeral text-base font-semibold tabular",
                              level === "hard" && "text-destructive",
                              level === "medium" && "text-[var(--cal-mesa-ink)]",
                              reward && "text-[var(--cal-leaf-ink)]",
                            )}
                          >
                            {s ? (level === "hard" ? s.hard : level === "medium" ? s.medium : (s.soft > 0 ? "+" : "") + s.soft) : ""}
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ul className="space-y-1 px-4 pb-3 pl-10 text-[13px] text-muted-foreground">
                            {c.justifications.map((j, i) => (
                              <li key={i}>{j}</li>
                            ))}
                            {c.matchCount > c.justifications.length && <li>and {c.matchCount - c.justifications.length} more</li>}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Recent runs</h2>
            {runs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No runs yet for {term?.name ?? "this term"}.</p>
            ) : (
              <ul className="divide-y text-sm">
                {runs.slice(0, 6).map((r) => {
                  const w = scoreWords(r.score);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <span className="min-w-0">
                        <span className="block truncate">{w ? `${w.hard}, ${w.medium.toLowerCase()}` : r.status}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}, {r.secondsLimit}s budget
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">{r.status}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* Sections */}
      <section className="mx-5 mb-8 rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Sections</h2>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by course or instructor" className="h-8 w-64" />
        </div>
        <SectionsTable
          sections={sections.filter((s) =>
            `${s.subject} ${s.number} ${s.courseTitle} ${s.instructorName}`.toLowerCase().includes(filter.toLowerCase()),
          )}
          termId={termId}
        />
      </section>
    </div>
  );
}

function WeekPreview({
  placements,
  loading,
}: {
  placements: { s: SectionDTO; pattern?: PatternDTO; roomLabel?: string }[];
  loading: boolean;
}) {
  const height = (GRID_END - GRID_START) * PX;
  const columns = DAYS.map((d) =>
    layoutColumn(
      placements
        .filter((p) => p.pattern?.days.includes(d.code))
        .map((p) => ({ s: toMin(p.pattern!.startTime), e: toMin(p.pattern!.endTime), p })),
    ),
  );
  if (loading) return <Skeleton className="m-4 h-[540px]" />;
  return (
    <div className="overflow-x-auto px-4 pt-2 pb-4">
      <div className="grid min-w-[720px] grid-cols-[44px_repeat(5,minmax(0,1fr))]">
        <div />
        {DAYS.map((d) => (
          <div key={d.code} className="pb-1.5 text-xs font-semibold text-muted-foreground">
            {d.label}
          </div>
        ))}
        <div className="relative" style={{ height }}>
          {Array.from({ length: 11 }).map((_, i) => {
            const h = 8 + i;
            return (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] text-muted-foreground tabular" style={{ top: (h * 60 - GRID_START) * PX }}>
                {h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}
              </span>
            );
          })}
        </div>
        {columns.map((col, ci) => (
          <div key={ci} className="relative border-l border-grid" style={{ height }}>
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-grid" style={{ top: ((8 + i) * 60 - GRID_START) * PX }} />
            ))}
            {col.map(({ item, col: c, cols, span }) => {
              const { s, roomLabel } = item.p;
              const color = SUBJECT_COLOR[s.subject] ?? "azurite";
              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <div
                      className="absolute overflow-hidden rounded-[4px] border-l-[3px] px-1 py-0.5 text-[10.5px] leading-[13px]"
                      style={{
                        top: (item.s - GRID_START) * PX + 1,
                        height: (item.e - item.s) * PX - 2,
                        left: `calc(${(c / cols) * 100}% + 1px)`,
                        width: `calc(${(span / cols) * 100}% - 3px)`,
                        borderColor: `var(--cal-${color})`,
                        backgroundColor: `color-mix(in oklab, var(--cal-${color}) var(--tint), var(--card))`,
                        color: `var(--cal-${color}-ink)`,
                      }}
                    >
                      <div className="truncate font-semibold">
                        {s.locked && <Lock className="mr-0.5 inline size-2.5" />}
                        {s.subject} {s.number}
                      </div>
                      <div className="truncate opacity-80">{roomLabel}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="font-medium">
                      {s.subject} {s.number}-{s.sectionNumber} {s.courseTitle}
                    </div>
                    <div className="opacity-80">
                      {item.p.pattern?.label}, {roomLabel}. {s.instructorName}, cap {s.enrollmentCap}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionsTable({ sections, termId }: { sections: SectionDTO[]; termId?: string }) {
  const qc = useQueryClient();
  const lock = useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) => api(`/sections/${id}`, { method: "PATCH", json: { locked } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sections", termId] }),
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Course</TableHead>
          <TableHead>Instructor</TableHead>
          <TableHead className="text-right">Cap</TableHead>
          <TableHead>Allowed</TableHead>
          <TableHead>Meets</TableHead>
          <TableHead>Room</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-12 text-right">
            <span className="sr-only">Lock</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <div className="font-medium">
                {s.subject} {s.number}-{s.sectionNumber}
              </div>
              <div className="text-xs text-muted-foreground">{s.courseTitle}</div>
            </TableCell>
            <TableCell>{s.instructorName}</TableCell>
            <TableCell className="text-right tabular">{s.enrollmentCap}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{s.allowedPatterns.join(", ")}</TableCell>
            <TableCell className="tabular">{s.meetingPatternLabel ?? <span className="text-muted-foreground">Not placed</span>}</TableCell>
            <TableCell>{s.roomLabel ?? <span className="text-muted-foreground">–</span>}</TableCell>
            <TableCell>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">{s.status}</span>
            </TableCell>
            <TableCell className="text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!s.meetingPatternId || !s.roomId || lock.isPending}
                    onClick={() => lock.mutate({ id: s.id, locked: !s.locked })}
                    aria-label={s.locked ? "Unlock section" : "Lock section"}
                    aria-pressed={s.locked}
                  >
                    {s.locked ? <Lock className="text-[var(--brand-red)]" /> : <LockOpen className="text-muted-foreground" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{s.locked ? "Locked: the solver won't move it" : s.meetingPatternId ? "Lock in place" : "Place it first"}</TooltipContent>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
