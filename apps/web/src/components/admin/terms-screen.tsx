"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DAY_CODES, TERM_DATE_KINDS, type DayCode, type PatternDTO, type TermDateKind, type TermDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { qk, usePatterns, useTerms } from "@/lib/queries";
import { inCampus, parseYmd } from "@/lib/time";
import { cn } from "@/lib/utils";
import { EmptyState, errorText, Field, fieldErrors, useDefaultTerm } from "./common";

const KIND: Record<TermDateKind, { label: string; dot: string }> = {
  holiday: { label: "Holiday, no classes", dot: "bg-[var(--cal-chili)]" },
  break: { label: "Break, no classes", dot: "bg-[var(--cal-chili)]" },
  deadline: { label: "Deadline", dot: "bg-[var(--cal-azurite)]" },
  finals: { label: "Finals", dot: "bg-[var(--cal-mesa)]" },
  milestone: { label: "Milestone", dot: "bg-muted-foreground" },
};
const DAY_SHORT: Record<DayCode, string> = { MO: "M", TU: "T", WE: "W", TH: "R", FR: "F", SA: "S", SU: "U" };
const DAY_NAME: Record<DayCode, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

const day = (s: string, pattern = "MMM d, yyyy") => format(parseYmd(s), pattern, { in: inCampus });
const dayRange = (a: string, b: string | null) =>
  !b || b === a ? day(a, "EEE, MMM d") : `${day(a, "EEE, MMM d")} to ${day(b, "EEE, MMM d")}`;

function useInvalidateTerms() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.terms });
    qc.invalidateQueries({ queryKey: ["patterns"] });
  };
}

export function TermsScreen() {
  const { data: terms = [], isLoading } = useTerms();
  const [termId, setTermId] = useDefaultTerm(terms);
  const [adding, setAdding] = useState(false);
  const term = terms.find((t) => t.id === termId);
  const sorted = [...terms].sort((a, b) => b.startsOn.localeCompare(a.startsOn));

  if (isLoading) return <Skeleton className="h-96" />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside>
        <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
          <Plus /> Add term
        </Button>
        <ul className="mt-3 grid gap-1" aria-label="Terms">
          {sorted.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTermId(t.id)}
                aria-current={t.id === termId ? "true" : undefined}
                className={cn(
                  "w-full rounded-md border-l-[3px] px-3 py-2 text-left transition-colors",
                  t.id === termId ? "border-primary bg-card shadow-xs" : "border-transparent hover:bg-muted",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  {t.isCurrent && <span className="text-[11px] font-medium text-primary">Current</span>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {day(t.startsOn, "MMM d")} to {day(t.endsOn, "MMM d, yyyy")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {term ? (
        <div className="grid min-w-0 grid-cols-1 gap-6">
          <TermDatesCard key={`dates-${term.id}`} term={term} />
          <ClosuresCard key={`closures-${term.id}`} term={term} />
          <PatternsCard key={`patterns-${term.id}`} term={term} terms={terms} />
        </div>
      ) : (
        <EmptyState>Add your first term to get started.</EmptyState>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          {adding && (
            <NewTermForm
              terms={sorted}
              onDone={(id) => {
                setAdding(false);
                if (id) setTermId(id);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ title, description, action, children }: { title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

type TermForm = Omit<TermDTO, "id" | "dates">;
const termForm = (t?: TermDTO): TermForm => ({
  code: t?.code ?? "",
  name: t?.name ?? "",
  startsOn: t?.startsOn ?? "",
  classesEndOn: t?.classesEndOn ?? "",
  finalsStartOn: t?.finalsStartOn ?? "",
  finalsEndOn: t?.finalsEndOn ?? "",
  endsOn: t?.endsOn ?? "",
  isCurrent: t?.isCurrent ?? false,
});

function TermFields({ form, set, errors }: { form: TermForm; set: (patch: Partial<TermForm>) => void; errors: Record<string, string> }) {
  const date = (key: keyof TermForm, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={errors[key]}>
      {(p) => <Input {...p} type="date" value={form[key] as string} onChange={(e) => set({ [key]: e.target.value })} required />}
    </Field>
  );
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Fall 2027" required />}
        </Field>
        <Field label="Term code" error={errors.code}>
          {(p) => <Input {...p} value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="2274" required />}
        </Field>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {date("startsOn", "Classes start")}
        {date("classesEndOn", "Classes end")}
        {date("finalsStartOn", "Finals start")}
        {date("finalsEndOn", "Finals end")}
        {date("endsOn", "Term ends", "Grades due, usually.")}
      </div>
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <Label htmlFor="is-current" className="grid gap-0.5 font-normal">
          <span className="font-medium">Current term</span>
          <span className="text-xs text-muted-foreground">The calendar&apos;s term ribbon follows this term. Only one term is current.</span>
        </Label>
        <Switch id="is-current" checked={form.isCurrent} onCheckedChange={(v) => set({ isCurrent: v })} />
      </div>
    </div>
  );
}

function TermDatesCard({ term }: { term: TermDTO }) {
  const invalidate = useInvalidateTerms();
  const [form, setForm] = useState(() => termForm(term));
  const dirty = JSON.stringify(form) !== JSON.stringify(termForm(term));
  const save = useMutation({
    mutationFn: () => api<TermDTO>(`/admin/terms/${term.id}`, { method: "PUT", json: form }),
    onSuccess: () => {
      invalidate();
      toast.success(`Saved ${form.name}`);
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <Card title="Term dates" description="Publishing a timetable runs classes from the first to the last day of classes.">
      <form
        className="grid gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TermFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} errors={errors} />
        {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive">{errorText(save.error)}</p>}
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setForm(termForm(term))}>
              Discard changes
            </Button>
          )}
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save dates"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function NewTermForm({ terms, onDone }: { terms: TermDTO[]; onDone: (id?: string) => void }) {
  const invalidate = useInvalidateTerms();
  const [form, setForm] = useState(() => termForm());
  const [copyFrom, setCopyFrom] = useState(terms[0]?.id ?? "none");
  const save = useMutation({
    mutationFn: () =>
      api<TermDTO>("/admin/terms", { method: "POST", json: { ...form, copyPatternsFrom: copyFrom === "none" ? null : copyFrom } }),
    onSuccess: (t) => {
      invalidate();
      toast.success(`Added ${t.name}`);
      onDone(t.id);
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Add a term</DialogTitle>
        <DialogDescription>Add holidays and deadlines after it&apos;s created.</DialogDescription>
      </DialogHeader>
      <TermFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} errors={errors} />
      <Field label="Meeting patterns" hint="The time blocks classes can meet in. You can change them later.">
        {(p) => (
          <Select value={copyFrom} onValueChange={setCopyFrom}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  Copy from {t.name}
                </SelectItem>
              ))}
              <SelectItem value="none">Start with none</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive">{errorText(save.error)}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Adding…" : "Add term"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ---------------- Holidays, breaks and deadlines ---------------- */

type DateForm = { startsOn: string; endsOn: string; label: string; kind: TermDateKind };

function ClosuresCard({ term }: { term: TermDTO }) {
  const [editing, setEditing] = useState<string | null>(null);
  const dates = [...term.dates].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return (
    <Card
      title="Holidays and deadlines"
      description="Classes skip holidays and breaks when the timetable is published. If the term is already published, publish it again from the Schedule builder after changing them."
    >
      {dates.length === 0 && <p className="px-4 pt-4 text-sm text-muted-foreground">No dates yet.</p>}
      <ul className="divide-y">
        {dates.map((d) =>
          editing === d.id ? (
            <li key={d.id} className="px-4 py-3">
              <DateRowForm
                termId={term.id}
                id={d.id}
                initial={{ startsOn: d.startsOn, endsOn: d.endsOn ?? "", label: d.label, kind: d.kind }}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <DateRow key={d.id} d={d} onEdit={() => setEditing(d.id)} />
          ),
        )}
      </ul>
      <div className="border-t bg-muted/30 px-4 py-3">
        <DateRowForm termId={term.id} initial={{ startsOn: "", endsOn: "", label: "", kind: "holiday" }} />
      </div>
    </Card>
  );
}

function DateRow({ d, onEdit }: { d: TermDTO["dates"][number]; onEdit: () => void }) {
  const invalidate = useInvalidateTerms();
  const remove = useMutation({
    mutationFn: () => api(`/admin/term-dates/${d.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast(`Removed ${d.label}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className={cn("size-2 shrink-0 rounded-full", KIND[d.kind].dot)} aria-hidden />
      <span className="w-52 shrink-0 text-sm tabular">{dayRange(d.startsOn, d.endsOn)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{d.label}</span>
        <span className="text-xs text-muted-foreground">{KIND[d.kind].label}</span>
      </span>
      <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${d.label}`}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate()} disabled={remove.isPending} aria-label={`Remove ${d.label}`}>
        <Trash2 />
      </Button>
    </li>
  );
}

function DateRowForm({ termId, id, initial, onDone }: { termId: string; id?: string; initial: DateForm; onDone?: () => void }) {
  const invalidate = useInvalidateTerms();
  const [form, setForm] = useState(initial);
  const set = (p: Partial<DateForm>) => setForm((f) => ({ ...f, ...p }));
  const save = useMutation({
    mutationFn: () =>
      api(id ? `/admin/term-dates/${id}` : `/admin/terms/${termId}/dates`, {
        method: id ? "PUT" : "POST",
        json: { ...form, endsOn: form.endsOn || null },
      }),
    onSuccess: () => {
      invalidate();
      toast.success(id ? `Saved ${form.label}` : `Added ${form.label}`);
      if (!id) setForm({ startsOn: "", endsOn: "", label: "", kind: form.kind });
      onDone?.();
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <Field label="First day" error={errors.startsOn} className="w-[150px]">
        {(p) => <Input {...p} type="date" value={form.startsOn} onChange={(e) => set({ startsOn: e.target.value })} required />}
      </Field>
      <Field label="Last day" error={errors.endsOn} className="w-[150px]">
        {(p) => <Input {...p} type="date" value={form.endsOn} min={form.startsOn || undefined} onChange={(e) => set({ endsOn: e.target.value })} />}
      </Field>
      <Field label="Label" error={errors.label} className="min-w-[180px] flex-1">
        {(p) => <Input {...p} value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Spring recess" required />}
      </Field>
      <Field label="Kind" className="w-[180px]">
        {(p) => (
          <Select value={form.kind} onValueChange={(v) => set({ kind: v as TermDateKind })}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERM_DATE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <div className="flex gap-1.5">
        {id ? (
          <>
            <Button type="submit" size="icon" disabled={save.isPending} aria-label="Save date">
              <Check />
            </Button>
            <Button type="button" size="icon" variant="ghost" onClick={onDone} aria-label="Cancel editing">
              <X />
            </Button>
          </>
        ) : (
          <Button type="submit" variant="outline" disabled={save.isPending}>
            <Plus /> Add
          </Button>
        )}
      </div>
      {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive basis-full">{errorText(save.error)}</p>}
    </form>
  );
}

/* ---------------- Meeting patterns ---------------- */

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

function PatternsCard({ term, terms }: { term: TermDTO; terms: TermDTO[] }) {
  const qc = useQueryClient();
  const { data: patterns = [], isLoading } = usePatterns(term.id);
  const others = terms.filter((t) => t.id !== term.id);
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");
  const families = useMemo(() => {
    const map = new Map<string, PatternDTO[]>();
    for (const p of patterns) map.set(p.family, [...(map.get(p.family) ?? []), p]);
    const dayIndex = (p: PatternDTO) => DAY_CODES.indexOf(p.days[0]!);
    return [...map.entries()].map(
      ([f, list]) => [f, list.sort((a, b) => a.startTime.localeCompare(b.startTime) || dayIndex(a) - dayIndex(b))] as const,
    );
  }, [patterns]);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.patterns(term.id) });

  const remove = useMutation({
    mutationFn: (p: PatternDTO) => api(`/admin/patterns/${p.id}`, { method: "DELETE" }),
    onSuccess: (_r, p) => {
      invalidate();
      toast(`Removed ${p.family} ${p.label}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const copy = useMutation({
    mutationFn: () => api<{ copied: number }>(`/admin/terms/${term.id}/patterns/copy`, { method: "POST", json: { fromTermId: copyFrom } }),
    onSuccess: (r) => {
      invalidate();
      const from = terms.find((t) => t.id === copyFrom)?.name;
      toast.success(r.copied ? `Copied ${r.copied} patterns from ${from}` : `${term.name} already has every pattern in ${from}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Card
      title="Meeting patterns"
      description="The time blocks sections can meet in. Each section lists the pattern families it may use, and the Schedule builder picks one. Patterns that sections are placed in can't be removed."
      action={
        others.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger size="sm" className="w-[150px]" aria-label="Term to copy patterns from">
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
              <Copy /> Copy patterns
            </Button>
          </div>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="m-4 h-40" />
      ) : families.length === 0 ? (
        <p className="px-4 pt-4 text-sm text-muted-foreground">No patterns yet. Add one below or copy them from another term.</p>
      ) : (
        <div className="divide-y">
          {families.map(([family, list]) => {
            const lengths = [...new Set(list.map((p) => minutes(p.endTime) - minutes(p.startTime)))];
            return (
              <div key={family} className="grid gap-2 px-4 py-3 sm:grid-cols-[130px_minmax(0,1fr)]">
                <div>
                  <div className="font-numeral text-lg leading-tight font-semibold">{family}</div>
                  <div className="text-xs text-muted-foreground">
                    {lengths.map((m) => `${m} min`).join(", ")}, {list.length} time{list.length === 1 ? "" : "s"}
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {list.map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs tabular",
                        p.sectionCount > 0 && "pr-2",
                      )}
                    >
                      {p.label}
                      {p.sectionCount > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1 rounded bg-muted px-1 text-[10.5px] text-muted-foreground">{p.sectionCount}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {p.sectionCount} section{p.sectionCount === 1 ? "" : "s"} placed here
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => remove.mutate(p)}
                          disabled={remove.isPending}
                          aria-label={`Remove ${family} ${p.label}`}
                        >
                          <X />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <div className="border-t bg-muted/30 px-4 py-3">
        <PatternForm termId={term.id} families={families.map(([f]) => f)} onAdded={invalidate} />
      </div>
    </Card>
  );
}

function PatternForm({ termId, families, onAdded }: { termId: string; families: string[]; onAdded: () => void }) {
  const [family, setFamily] = useState("");
  const [days, setDays] = useState<DayCode[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [endEdited, setEndEdited] = useState(false);
  // Until the end time is typed, suggest it from the family's length: MWF50 means 50 minutes.
  const suggest = (f: string, s: string) => {
    if (endEdited) return;
    const m = f.match(/(\d{2,3})$/);
    const total = m && s ? minutes(s) + Number(m[1]) : NaN;
    setEnd(total < 24 * 60 ? `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}` : "");
  };
  const save = useMutation({
    mutationFn: () => api(`/admin/terms/${termId}/patterns`, { method: "POST", json: { family, days, startTime: start, endTime: end } }),
    onSuccess: () => {
      onAdded();
      toast.success(`Added ${family.toUpperCase()} at ${start}`);
      setStart("");
      setEnd("");
      setEndEdited(false);
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <Field label="Family" error={errors.family} className="w-[120px]">
        {(p) => (
          <>
            <Input
              {...p}
              list="pattern-families"
              value={family}
              onChange={(e) => {
                setFamily(e.target.value.toUpperCase());
                suggest(e.target.value, start);
              }}
              placeholder="MWF50"
              required
            />
            <datalist id="pattern-families">
              {families.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Days</legend>
        <ToggleGroup type="multiple" variant="outline" size="sm" value={days} onValueChange={(v) => setDays(v as DayCode[])}>
          {DAY_CODES.map((d) => (
            <ToggleGroupItem key={d} value={d} aria-label={DAY_NAME[d]} className="w-8">
              {DAY_SHORT[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {errors.days && <p className="text-xs text-destructive">{errors.days}</p>}
      </fieldset>
      <Field label="Starts" error={errors.startTime} className="w-[120px]">
        {(p) => (
          <Input
            {...p}
            type="time"
            step={300}
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              suggest(family, e.target.value);
            }}
            required
          />
        )}
      </Field>
      <Field label="Ends" error={errors.endTime} className="w-[120px]">
        {(p) => (
          <Input
            {...p}
            type="time"
            step={300}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setEndEdited(true);
            }}
            required
          />
        )}
      </Field>
      <Button type="submit" variant="outline" disabled={save.isPending}>
        <Plus /> Add
      </Button>
      {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive basis-full">{errorText(save.error)}</p>}
    </form>
  );
}
