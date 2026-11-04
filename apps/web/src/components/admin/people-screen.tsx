"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Lock, UserPlus } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { ROLE_LABELS, ROLES, type AdminUserDTO, type Role } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { qk, useAdminUsers, useDepartments, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { EmptyState, errorText, Field, fieldErrors } from "./common";

export function RoleChip({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] font-medium",
        role === "admin"
          ? "bg-[color-mix(in_oklab,var(--primary)_12%,var(--card))] text-primary"
          : role === "scheduler"
            ? "bg-[color-mix(in_oklab,var(--cal-azurite)_14%,var(--card))] text-[var(--cal-azurite-ink)]"
            : "bg-muted text-muted-foreground",
      )}
    >
      {ROLE_LABELS[role].label}
    </span>
  );
}

export function PeopleScreen() {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const [role, setRole] = useState<Role | "all">("all");
  const { data: people = [], isLoading } = useAdminUsers(query, role);
  const [open, setOpen] = useState<{ person: AdminUserDTO | null } | null>(null);

  return (
    <>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Roles normally come from campus sign-in groups. Roles you change here stay as you set them until you hand them back to
        campus sign-in.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, NetID or email"
          aria-label="Search people"
          className="h-9 w-full sm:w-72"
        />
        <Select value={role} onValueChange={(v) => setRole(v as Role | "all")}>
          <SelectTrigger className="w-[150px]" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every role</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground tabular" aria-live="polite">
          {isLoading ? "" : `${people.length} ${people.length === 1 ? "person" : "people"}`}
        </span>
        <Button className="ml-auto" onClick={() => setOpen({ person: null })}>
          <UserPlus /> Add person
        </Button>
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        {isLoading ? (
          <Skeleton className="m-4 h-60" />
        ) : people.length === 0 ? (
          <div className="p-4">
            <EmptyState>No one matches. Try part of a name or NetID, or add the person.</EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="hidden lg:table-cell">Roles come from</TableHead>
                <TableHead className="hidden sm:table-cell">Last signed in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setOpen({ person: p })}>
                  <TableCell>
                    <button
                      className="text-left font-medium hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen({ person: p });
                      }}
                    >
                      {p.displayName}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {p.netid}
                      {p.title ? `, ${p.title}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.departmentName ?? <span className="text-muted-foreground">None</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.roles.map((r) => (
                        <RoleChip key={r} role={r} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {p.rolesLocked ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="size-3.5" /> Set here
                      </span>
                    ) : (
                      "Campus sign-in"
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {p.lastLoginAt ? formatDistanceToNow(new Date(p.lastLoginAt), { addSuffix: true }) : "Never"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {open && <PersonForm key={open.person?.id ?? "new"} person={open.person} onDone={() => setOpen(null)} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function PersonForm({ person, onDone }: { person: AdminUserDTO | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: departments = [] } = useDepartments();
  const isSelf = person?.id === me?.user.id;
  const [form, setForm] = useState({
    netid: person?.netid ?? "",
    displayName: person?.displayName ?? "",
    email: person?.email ?? "",
    title: person?.title ?? "",
    departmentId: person?.departmentId ?? "none",
    roles: person?.roles ?? (["faculty"] as Role[]),
    rolesLocked: person?.rolesLocked ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleRole = (r: Role, on: boolean) =>
    setForm((f) => ({ ...f, roles: on ? ROLES.filter((x) => x === r || f.roles.includes(x)) : f.roles.filter((x) => x !== r), rolesLocked: true }));

  const save = useMutation({
    mutationFn: () => {
      const common = {
        displayName: form.displayName,
        email: form.email.trim(),
        title: form.title.trim() || null,
        departmentId: form.departmentId === "none" ? null : form.departmentId,
      };
      if (!person) return api<AdminUserDTO>("/admin/users", { method: "POST", json: { ...common, netid: form.netid, roles: form.roles } });
      const rolesChanged = form.roles.join() !== person.roles.join();
      return api<AdminUserDTO>(`/admin/users/${person.id}`, {
        method: "PATCH",
        json: { ...common, ...(rolesChanged ? { roles: form.roles } : {}), rolesLocked: form.rolesLocked },
      });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: qk.departments });
      if (isSelf) qc.invalidateQueries({ queryKey: qk.me });
      toast.success(person ? `Saved ${p.displayName}` : `Added ${p.displayName}`);
      onDone();
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <form
      className="flex min-h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SheetHeader className="border-b">
        <SheetTitle className="text-lg">{person ? person.displayName : "Add a person"}</SheetTitle>
        <SheetDescription>
          {person
            ? `NetID ${person.netid}${person.affiliations.length ? `. Campus affiliations: ${person.affiliations.join(", ")}.` : "."}`
            : "Add someone before their first sign-in, for example a new instructor to assign to sections. Their details update from campus sign-in when they first sign in."}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-4 p-4">
        {!person && (
          <Field label="NetID" error={errors.netid}>
            {(p) => <Input {...p} value={form.netid} onChange={(e) => set("netid", e.target.value)} autoComplete="off" required />}
          </Field>
        )}
        <Field label="Name" error={errors.displayName}>
          {(p) => <Input {...p} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} required />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <Input {...p} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}
        </Field>
        <Field label="Title" hint="Shown next to their name, like Associate Professor." error={errors.title}>
          {(p) => <Input {...p} value={form.title} onChange={(e) => set("title", e.target.value)} />}
        </Field>
        <Field label="Department">
          {(p) => (
            <Select value={form.departmentId} onValueChange={(v) => set("departmentId", v)}>
              <SelectTrigger {...p} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No department</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        <fieldset className="grid gap-2.5">
          <legend className="mb-1 text-sm font-medium">Roles</legend>
          {ROLES.map((r) => {
            const lockedOut = isSelf && r === "admin";
            const id = `role-${r}`;
            return (
              <div key={r} className="flex items-start gap-2.5">
                <Checkbox
                  id={id}
                  checked={form.roles.includes(r)}
                  disabled={lockedOut}
                  onCheckedChange={(v) => toggleRole(r, v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor={id} className="grid gap-0.5 font-normal">
                  <span className="font-medium">{ROLE_LABELS[r].label}</span>
                  <span className="text-xs text-muted-foreground">
                    {lockedOut ? "You can't remove your own admin role." : ROLE_LABELS[r].description}
                  </span>
                </Label>
              </div>
            );
          })}
          {errors.roles && <p className="text-xs text-destructive">{errors.roles}</p>}
        </fieldset>

        {person && (
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="roles-locked" className="grid gap-0.5 font-normal">
              <span className="font-medium">Keep these roles at sign-in</span>
              <span className="text-xs text-muted-foreground">
                {form.rolesLocked
                  ? "Campus sign-in won't change them."
                  : "They're set from campus groups the next time this person signs in."}
              </span>
            </Label>
            <Switch id="roles-locked" checked={form.rolesLocked} onCheckedChange={(v) => set("rolesLocked", v)} />
          </div>
        )}

        {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive">{errorText(save.error)}</p>}
      </div>

      <SheetFooter className="mt-auto flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : person ? "Save" : "Add person"}
        </Button>
      </SheetFooter>
    </form>
  );
}
