"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { ROOM_KIND_LABELS, ROOM_KINDS, type BuildingDTO, type RoomDTO, type RoomKind } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { qk, useBuildings, useRooms } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { EmptyState, errorText, featureLabel, Field, fieldErrors } from "./common";

const kindLabel = (k: string) => ROOM_KIND_LABELS[k as RoomKind] ?? featureLabel(k);

function useInvalidateRooms() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.rooms });
    qc.invalidateQueries({ queryKey: qk.buildings });
    qc.invalidateQueries({ queryKey: ["rooms-board"] });
    qc.invalidateQueries({ queryKey: qk.me });
  };
}

export function RoomsScreen() {
  const { data: rooms = [], isLoading } = useRooms();
  const { data: buildings = [] } = useBuildings();
  const [q, setQ] = useState("");
  const [building, setBuilding] = useState("all");
  const [roomSheet, setRoomSheet] = useState<{ room: RoomDTO | null } | null>(null);
  const [buildingDialog, setBuildingDialog] = useState<{ building: BuildingDTO | null } | null>(null);
  const knownFeatures = useMemo(() => [...new Set(rooms.flatMap((r) => r.features))].sort(), [rooms]);

  const needle = q.trim().toLowerCase();
  const shown = rooms.filter(
    (r) =>
      (building === "all" || r.buildingId === building) &&
      (!needle || `${r.label} ${r.name ?? ""} ${r.buildingName} ${r.features.join(" ")}`.toLowerCase().includes(needle)),
  );
  const groups = buildings
    .map((b) => ({ b, rooms: shown.filter((r) => r.buildingId === b.id) }))
    .filter((g) => g.rooms.length > 0 || (building === g.b.id && !needle));

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rooms or features"
          aria-label="Search rooms"
          className="h-9 w-full sm:w-64"
        />
        <Select value={building} onValueChange={setBuilding}>
          <SelectTrigger className="w-[200px]" aria-label="Building">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every building</SelectItem>
            {buildings.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.code}, {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setBuildingDialog({ building: null })}>
            <Building2 /> Add building
          </Button>
          <Button onClick={() => setRoomSheet({ room: null })} disabled={buildings.length === 0}>
            <Plus /> Add room
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        {isLoading ? (
          <Skeleton className="m-4 h-72" />
        ) : groups.length === 0 ? (
          <div className="p-4">
            <EmptyState>{rooms.length ? "No rooms match." : "Add a building, then its rooms."}</EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="hidden lg:table-cell">Features</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead className="hidden md:table-cell">Classes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(({ b, rooms: list }) => (
                <Fragment key={b.id}>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={6} className="py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-numeral text-base font-semibold">{b.code}</span>
                        <span className="text-sm text-muted-foreground">{b.name}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto"
                          onClick={() => setBuildingDialog({ building: b })}
                          aria-label={`Edit building ${b.code}`}
                        >
                          <Pencil />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {list.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setRoomSheet({ room: r })}>
                      <TableCell>
                        <button
                          className="text-left font-medium hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRoomSheet({ room: r });
                          }}
                        >
                          {r.label}
                        </button>
                        {r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{kindLabel(r.kind)}</TableCell>
                      <TableCell className="text-right tabular">{r.capacity}</TableCell>
                      <TableCell className="hidden max-w-72 lg:table-cell">
                        <span className="text-xs text-muted-foreground">{r.features.map(featureLabel).join(", ") || "None"}</span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "text-sm",
                            !r.bookable && "text-muted-foreground",
                            r.bookable && r.requiresApproval && "text-[var(--cal-mesa-ink)]",
                          )}
                        >
                          {!r.bookable ? "Not bookable" : r.requiresApproval ? "Needs approval" : "Open"}
                        </span>
                      </TableCell>
                      <TableCell className={cn("hidden md:table-cell", !r.schedulable && "text-muted-foreground")}>
                        {r.schedulable ? "Yes" : "No"}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Sheet open={!!roomSheet} onOpenChange={(v) => !v && setRoomSheet(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {roomSheet && (
            <RoomForm
              key={roomSheet.room?.id ?? "new"}
              room={roomSheet.room}
              buildings={buildings}
              knownFeatures={knownFeatures}
              defaultBuilding={building === "all" ? buildings[0]?.id : building}
              onDone={() => setRoomSheet(null)}
            />
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={!!buildingDialog} onOpenChange={(v) => !v && setBuildingDialog(null)}>
        <DialogContent className="sm:max-w-md">
          {buildingDialog && (
            <BuildingForm key={buildingDialog.building?.id ?? "new"} building={buildingDialog.building} onDone={() => setBuildingDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoomForm({
  room,
  buildings,
  knownFeatures,
  defaultBuilding,
  onDone,
}: {
  room: RoomDTO | null;
  buildings: BuildingDTO[];
  knownFeatures: string[];
  defaultBuilding?: string;
  onDone: () => void;
}) {
  const invalidate = useInvalidateRooms();
  const [form, setForm] = useState({
    buildingId: room?.buildingId ?? defaultBuilding ?? "",
    number: room?.number ?? "",
    name: room?.name ?? "",
    kind: (room?.kind ?? "classroom") as RoomKind,
    capacity: room ? String(room.capacity) : "",
    features: room?.features ?? [],
    bookable: room?.bookable ?? true,
    requiresApproval: room?.requiresApproval ?? false,
    schedulable: room?.schedulable ?? true,
  });
  const [newFeature, setNewFeature] = useState("");
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleFeature = (f: string) =>
    set("features", form.features.includes(f) ? form.features.filter((x) => x !== f) : [...form.features, f]);
  const addFeature = () => {
    const slug = newFeature.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (slug && !form.features.includes(slug)) set("features", [...form.features, slug]);
    setNewFeature("");
  };
  const allFeatures = [...new Set([...knownFeatures, ...form.features])].sort();
  const buildingCode = buildings.find((b) => b.id === form.buildingId)?.code;

  const save = useMutation({
    mutationFn: () =>
      api<RoomDTO>(room ? `/admin/rooms/${room.id}` : "/admin/rooms", {
        method: room ? "PUT" : "POST",
        json: { ...form, capacity: Number(form.capacity), name: form.name.trim() || null },
      }),
    onSuccess: (r) => {
      invalidate();
      toast.success(room ? `Saved ${r.label}` : `Added ${r.label}`);
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/rooms/${room!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success(`Deleted ${room!.label}`);
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
        <SheetTitle className="text-lg">{room ? room.label : "Add a room"}</SheetTitle>
        <SheetDescription>
          {room ? (room.name ?? `${room.buildingName}`) : "The room gets its own calendar for bookings and classes."}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 p-4">
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Building" error={errors.buildingId}>
            {(p) => (
              <Select value={form.buildingId} onValueChange={(v) => set("buildingId", v)}>
                <SelectTrigger {...p} className="w-full">
                  <SelectValue placeholder="Pick a building" />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code}, {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Number" error={errors.number}>
            {(p) => <Input {...p} value={form.number} onChange={(e) => set("number", e.target.value)} required />}
          </Field>
        </div>
        <Field label="Name" hint={`Optional, like "Kemper Lecture Hall". Listed as ${buildingCode ?? "the building"} ${form.number || "number"}.`}>
          {(p) => <Input {...p} value={form.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Type">
            {(p) => (
              <Select value={form.kind} onValueChange={(v) => set("kind", v as RoomKind)}>
                <SelectTrigger {...p} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROOM_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {ROOM_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Seats" error={errors.capacity}>
            {(p) => (
              <Input {...p} type="number" min={1} max={5000} inputMode="numeric" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} required />
            )}
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Features</legend>
          <p className="-mt-1 text-xs text-muted-foreground">Sections that need a feature are only placed in rooms that have it.</p>
          <div className="flex flex-wrap gap-1.5">
            {allFeatures.map((f) => {
              const on = form.features.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleFeature(f)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    on ? "border-[var(--ring)] bg-[color-mix(in_oklab,var(--ring)_12%,var(--card))] font-medium" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {featureLabel(f)}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFeature();
                }
              }}
              placeholder="Add another feature"
              aria-label="New feature"
              className="h-8"
            />
            <Button type="button" variant="outline" size="sm" onClick={addFeature} disabled={!newFeature.trim()}>
              Add
            </Button>
          </div>
          {errors.features && <p className="text-xs text-destructive">{errors.features}</p>}
        </fieldset>

        <div className="grid gap-3 rounded-md border p-3">
          <SwitchRow id="bookable" label="People can book it" hint="It shows on the Rooms board for requests." checked={form.bookable} onChange={(v) => set("bookable", v)} />
          <SwitchRow
            id="approval"
            label="Bookings need approval"
            hint="Requests wait for staff to approve them."
            checked={form.bookable && form.requiresApproval}
            disabled={!form.bookable}
            onChange={(v) => set("requiresApproval", v)}
          />
          <SwitchRow
            id="schedulable"
            label="Classes can be scheduled here"
            hint="The Schedule builder may place sections in it."
            checked={form.schedulable}
            onChange={(v) => set("schedulable", v)}
          />
        </div>
        {save.error && !Object.keys(errors).length && <p className="text-sm text-destructive">{errorText(save.error)}</p>}
      </div>
      <SheetFooter className="mt-auto flex-row items-center border-t">
        {room && (
          <Popover onOpenChange={(v) => !v && remove.reset()}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive">
                <Trash2 /> Delete
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <p className="text-sm font-medium">Delete {room.label}?</p>
              {remove.isError ? (
                <p className="mt-1 text-sm text-destructive" role="alert">
                  {errorText(remove.error)}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Only rooms with no events, sections or requests can be deleted. Otherwise, turn off booking and class scheduling.
                  </p>
                  <Button variant="destructive" className="mt-3 w-full" onClick={() => remove.mutate()} disabled={remove.isPending}>
                    {remove.isPending ? "Deleting…" : "Delete room"}
                  </Button>
                </>
              )}
            </PopoverContent>
          </Popover>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !form.buildingId}>
            {save.isPending ? "Saving…" : room ? "Save" : "Add room"}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-60")}>
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function BuildingForm({ building, onDone }: { building: BuildingDTO | null; onDone: () => void }) {
  const invalidate = useInvalidateRooms();
  const [code, setCode] = useState(building?.code ?? "");
  const [name, setName] = useState(building?.name ?? "");
  const save = useMutation({
    mutationFn: () =>
      api<BuildingDTO>(building ? `/admin/buildings/${building.id}` : "/admin/buildings", {
        method: building ? "PATCH" : "POST",
        json: { code, name },
      }),
    onSuccess: (b) => {
      invalidate();
      toast.success(building ? `Saved ${b.code}` : `Added ${b.code}, ${b.name}`);
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
        <DialogTitle>{building ? `Edit ${building.code}` : "Add a building"}</DialogTitle>
        <DialogDescription>
          {building ? `${building.rooms} room${building.rooms === 1 ? "" : "s"}. Room labels and calendars follow the code.` : "Then add its rooms."}
        </DialogDescription>
      </DialogHeader>
      <Field label="Code" hint="Short code used in room labels, like CHM." error={errors.code}>
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
          {save.isPending ? "Saving…" : building ? "Save" : "Add building"}
        </Button>
      </DialogFooter>
    </form>
  );
}
