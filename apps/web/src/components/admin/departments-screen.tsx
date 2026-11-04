"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { DepartmentDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { qk, useDepartments } from "@/lib/queries";
import { errorText, Field, fieldErrors } from "./common";

export function DepartmentsScreen() {
  const { data: departments = [], isLoading } = useDepartments();
  const [open, setOpen] = useState<{ dept: DepartmentDTO | null } | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each department has its own calendar, plus a class calendar where its published sections appear. Course imports
          match departments by code.
        </p>
        <Button onClick={() => setOpen({ dept: null })}>
          <Plus /> Add department
        </Button>
      </div>
      <div className="mt-4 rounded-lg border bg-card">
        {isLoading ? (
          <Skeleton className="m-4 h-48" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">Courses</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Edit</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-numeral text-base font-semibold">{d.code}</TableCell>
                  <TableCell>{d.name}</TableCell>
                  <TableCell className="text-right tabular">{d.people}</TableCell>
                  <TableCell className="text-right tabular">{d.courses}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => setOpen({ dept: d })} aria-label={`Edit ${d.name}`}>
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          {open && <DepartmentForm key={open.dept?.id ?? "new"} dept={open.dept} onDone={() => setOpen(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DepartmentForm({ dept, onDone }: { dept: DepartmentDTO | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(dept?.code ?? "");
  const [name, setName] = useState(dept?.name ?? "");
  const save = useMutation({
    mutationFn: () =>
      api<DepartmentDTO>(dept ? `/admin/departments/${dept.id}` : "/admin/departments", {
        method: dept ? "PATCH" : "POST",
        json: { code, name },
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: qk.departments });
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success(dept ? `Saved ${d.name}` : `Added ${d.name}`);
      onDone();
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
        <DialogTitle>{dept ? `Edit ${dept.name}` : "Add a department"}</DialogTitle>
        <DialogDescription>
          {dept ? "Its calendars are renamed to match." : "Its department calendar and class calendar are created with it."}
        </DialogDescription>
      </DialogHeader>
      <Field label="Code" hint="The subject or org code used in course files, like CHEM." error={errors.code}>
        {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-32 uppercase" required />}
      </Field>
      <Field label="Name" error={errors.name}>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required />}
      </Field>
      {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive">{errorText(save.error)}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : dept ? "Save" : "Add department"}
        </Button>
      </DialogFooter>
    </form>
  );
}
