"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, Download, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { SectionImportResultDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { qk, useTerms } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { errorText, useDefaultTerm } from "./common";

const TEMPLATE = [
  "subject,number,title,department,credits,section,instructor_netid,instructor_name,cap,patterns,features,cohorts",
  "CHEM,151,General Chemistry I,CHEM,4,001,dchen,David Chen,200,MWF50 TR75,lecture_capture,first-year-science",
  "CHEM,151L,General Chemistry I Lab,CHEM,1,001,hsantos,Helena Santos,24,LAB170,wet_lab,",
  "MATH,122A,Functions for Calculus,MATH,3,001,,,45,MWF50 TR75,projector,first-year-science",
].join("\r\n");

const COLUMNS: [string, string, string][] = [
  ["subject", "Yes", "Subject code, like CHEM."],
  ["number", "Yes", "Catalog number, like 151 or 151L."],
  ["section", "Yes", "Section number, like 001."],
  ["cap", "Yes", "Enrollment cap."],
  ["patterns", "Yes", "Meeting pattern families the section may meet in, separated by spaces, like MWF50 TR75."],
  ["title", "New courses", "Course title. If it differs for an existing course, the title is updated."],
  ["department", "New courses", "Department code, like CHEM."],
  ["credits", "No", "Whole number; new courses default to 3."],
  ["instructor_netid", "No", "Leave blank when the instructor isn't known yet. A blank cell removes the current instructor."],
  ["instructor_name", "No", "With instructor_email, adds instructors who aren't here yet. They join the course's department."],
  ["features", "No", "Room features the section needs, like wet_lab. Separate several with spaces."],
  ["cohorts", "No", "Groups of students who take these sections together, so the builder keeps them from overlapping."],
];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportScreen() {
  const qc = useQueryClient();
  const { data: terms = [], isLoading } = useTerms();
  const [termId, setTermId] = useDefaultTerm(terms);
  const term = terms.find((t) => t.id === termId);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const check = useMutation({
    mutationFn: (v: { termId: string; csv: string }) =>
      api<SectionImportResultDTO>(`/admin/terms/${v.termId}/import`, { method: "POST", json: { csv: v.csv, apply: false } }),
  });
  const apply = useMutation({
    mutationFn: () => api<SectionImportResultDTO>(`/admin/terms/${termId}/import`, { method: "POST", json: { csv: file!.text, apply: true } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.sections(termId!) });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: qk.departments });
      qc.invalidateQueries({ queryKey: qk.availabilitySummary(termId!) });
      if (!r.applied) toast.error("The file changed since it was checked. Fix the problems listed and try again.");
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const load = async (f: File | undefined) => {
    if (!f || !termId) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      toast.error(`${f.name} isn't a CSV file. In your spreadsheet app, save or export it as CSV.`);
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    apply.reset();
    check.mutate({ termId, csv: text });
  };
  const changeTerm = (id: string) => {
    setTermId(id);
    apply.reset();
    if (file) check.mutate({ termId: id, csv: file.text });
  };
  const reset = () => {
    setFile(null);
    check.reset();
    apply.reset();
    if (input.current) input.current.value = "";
  };

  const result = apply.data?.applied ? apply.data : (apply.data ?? check.data);
  const changes = result ? result.sections.created + result.sections.updated + result.courses.created + result.courses.updated : 0;

  if (isLoading) return <Skeleton className="h-80" />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium" id="import-term">
            Import into
          </span>
          <Select value={termId} onValueChange={changeTerm}>
            <SelectTrigger className="w-[180px]" aria-labelledby="import-term">
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
        </div>

        {!file ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void load(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-card px-6 py-14 text-center transition-colors",
              dragging && "border-[var(--ring)] bg-[color-mix(in_oklab,var(--ring)_6%,var(--card))]",
            )}
          >
            <FileUp className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <div>
              <p className="font-medium">Drop a CSV of courses and sections here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing changes until you&apos;ve seen what the file would do and chosen to import it.
              </p>
            </div>
            <Button onClick={() => input.current?.click()} disabled={!termId}>
              <Upload /> Choose a file
            </Button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void load(e.target.files?.[0])}
            />
          </div>
        ) : (
          <section className="rounded-lg border bg-card" aria-live="polite">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{file.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {check.isPending ? "Checking…" : result ? `${result.rows} row${result.rows === 1 ? "" : "s"} checked against ${term?.name}` : ""}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={reset}>
                Choose another file
              </Button>
            </header>

            {check.isPending ? (
              <Skeleton className="m-4 h-32" />
            ) : check.isError ? (
              <p className="p-4 text-sm text-destructive">{errorText(check.error)}</p>
            ) : result ? (
              <ImportResult result={result} termName={term?.name ?? "this term"} />
            ) : null}

            {result && (
              <footer className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
                {result.applied ? (
                  <>
                    <span className="mr-auto inline-flex items-center gap-2 text-sm font-medium text-[var(--cal-leaf-ink)]">
                      <CheckCircle2 className="size-4" /> Imported into {term?.name}
                    </span>
                    <Button variant="outline" onClick={reset}>
                      Import another file
                    </Button>
                    <Button asChild>
                      <Link href="/builder">Open the Schedule builder</Link>
                    </Button>
                  </>
                ) : result.errors.length ? (
                  <span className="text-sm text-muted-foreground">Fix the problems in your spreadsheet, save it as CSV and choose it again.</span>
                ) : changes === 0 ? (
                  <span className="text-sm text-muted-foreground">Everything in this file already matches {term?.name}.</span>
                ) : (
                  <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
                    {apply.isPending ? "Importing…" : `Import into ${term?.name}`}
                  </Button>
                )}
              </footer>
            )}
          </section>
        )}
      </div>

      <aside className="grid content-start gap-4 text-sm">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Start from a file</h2>
          <p className="mt-1 text-muted-foreground">
            Export sections from the registrar&apos;s system or a spreadsheet. Common registrar column names, like catalog_nbr
            and enrl_cap, work as they are.
          </p>
          <div className="mt-3 grid gap-2">
            <Button variant="outline" className="justify-start" onClick={() => download("sections-template.csv", TEMPLATE)}>
              <Download /> Download a template
            </Button>
            {termId && (
              <Button variant="outline" className="justify-start" asChild>
                <a href={`/api/admin/terms/${termId}/sections.csv`} download>
                  <Download /> Download {term?.name} sections
                </a>
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Editing the downloaded sections and importing them again updates them in place.
          </p>
        </section>
        <Collapsible className="rounded-lg border bg-card">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 p-4 text-left font-semibold">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            What goes in the file
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="grid gap-3 px-4 pb-4">
              {COLUMNS.map(([name, needed, what]) => (
                <div key={name}>
                  <dt className="flex items-baseline justify-between gap-2">
                    <code className="font-mono text-[13px] font-medium">{name}</code>
                    <span className="text-xs text-muted-foreground">{needed === "Yes" ? "Required" : needed === "No" ? "Optional" : "Required for new courses"}</span>
                  </dt>
                  <dd className="text-muted-foreground">{what}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              Columns you leave out aren&apos;t changed. Sections already in the term that aren&apos;t in the file stay as they are.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </aside>
    </div>
  );
}

function ImportResult({ result, termName }: { result: SectionImportResultDTO; termName: string }) {
  const done = result.applied;
  const stats: [string, number][] = [
    [done ? "Sections added" : "New sections", result.sections.created],
    [done ? "Sections changed" : "Changed sections", result.sections.updated],
    ["Unchanged", result.sections.unchanged],
    [done ? "Courses added" : "New courses", result.courses.created],
    [done ? "People added" : "New people", result.newPeople.length],
  ];
  return (
    <div className="grid gap-4 p-4">
      <dl className="flex flex-wrap gap-x-7 gap-y-3">
        {stats.map(([label, n]) => (
          <div key={label} className={cn(n === 0 && "opacity-55")}>
            <dd className="font-numeral text-[28px] leading-none font-semibold tabular">{n}</dd>
            <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>

      {result.errors.length > 0 && (
        <div className="rounded-md border border-[color-mix(in_oklab,var(--destructive)_35%,var(--border))]">
          <h3 className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            {result.errors.length >= 200 ? "200 or more problems" : `${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}`} to fix
            before importing
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Line</TableHead>
                <TableHead>Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.errors.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="align-top tabular">{e.line}</TableCell>
                  <TableCell className="whitespace-normal">{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(result.warnings.length > 0 || result.newPeople.length > 0 || result.notInFile > 0 || result.republishNeeded > 0) && (
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          {result.newPeople.length > 0 && (
            <li>
              {done ? "Added" : "Adds"} {result.newPeople.length === 1 ? "a new instructor" : `${result.newPeople.length} new instructors`}:{" "}
              {result.newPeople.join(", ")}. Their details fill in when they first sign in.
            </li>
          )}
          {result.notInFile > 0 && (
            <li>
              {result.notInFile} section{result.notInFile === 1 ? "" : "s"} in {termName} {result.notInFile === 1 ? "isn't" : "aren't"} in this file
              and {result.notInFile === 1 ? "stays" : "stay"} as {result.notInFile === 1 ? "it is" : "they are"}.
            </li>
          )}
          {result.republishNeeded > 0 && (
            <li className="text-[var(--cal-mesa-ink)]">
              {result.republishNeeded} changed section{result.republishNeeded === 1 ? " is" : "s are"} already on the class calendars. Publish
              again from the Schedule builder to update {result.republishNeeded === 1 ? "it" : "them"}.
            </li>
          )}
          {result.warnings.map((w, i) => (
            <li key={i}>
              <span className="tabular">Line {w.line}:</span> {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
