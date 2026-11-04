"use client";

import { TZDate } from "@date-fns/tz";
import { ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { CalendarDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { CAMPUS_TZ, campus } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface CalendarGroup {
  id: string;
  label: string;
  calendars: CalendarDTO[];
  defaultOpen: boolean;
  searchable?: boolean;
}

export function groupCalendars(calendars: CalendarDTO[], userId: string): CalendarGroup[] {
  // Mine = my own, plus personal calendars I was explicitly given edit rights to (e.g. an assistant
  // managing the Dean's calendar). Admins can edit everything, so access alone doesn't decide it.
  const mine = calendars.filter((c) => c.kind === "personal" && (c.ownerId === userId || c.access === "editor"));
  const people = calendars.filter((c) => c.kind === "personal" && !mine.includes(c));
  return [
    { id: "mine", label: "My calendars", calendars: mine, defaultOpen: true },
    { id: "college", label: "College & departments", calendars: calendars.filter((c) => c.kind === "college" || c.kind === "department"), defaultOpen: true },
    { id: "classes", label: "Classes", calendars: calendars.filter((c) => c.kind === "course"), defaultOpen: true },
    { id: "people", label: "People", calendars: people, defaultOpen: false, searchable: true },
    { id: "rooms", label: "Rooms", calendars: calendars.filter((c) => c.kind === "room"), defaultOpen: false, searchable: true },
  ].filter((g) => g.calendars.length > 0);
}

const toPicker = (d: Date) => {
  const c = campus(d);
  return new Date(c.getFullYear(), c.getMonth(), c.getDate());
};

export function CalendarSidebar({
  anchor,
  onPickDate,
  groups,
  enabled,
  onToggle,
  onNew,
  canCreate,
}: {
  anchor: Date;
  onPickDate: (d: Date) => void;
  groups: CalendarGroup[];
  enabled: Set<string>;
  onToggle: (ids: string[], on: boolean) => void;
  onNew: () => void;
  canCreate: boolean;
}) {
  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r bg-card lg:flex">
      <div className="p-3">
        <Button onClick={onNew} disabled={!canCreate} className="w-full justify-start" size="lg">
          <Plus /> New event
          <kbd className="ml-auto rounded border border-white/30 px-1.5 text-[11px] font-normal opacity-80">N</kbd>
        </Button>
      </div>
      <div className="px-2">
        <Calendar
          mode="single"
          selected={toPicker(anchor)}
          month={toPicker(anchor)}
          onMonthChange={(m) => onPickDate(new TZDate(m.getFullYear(), m.getMonth(), 1, CAMPUS_TZ))}
          onSelect={(d) => d && onPickDate(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), CAMPUS_TZ))}
          className="w-full bg-transparent p-1 [--cell-size:--spacing(8)]"
          classNames={{ root: "w-full" }}
        />
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t px-2 py-3 scrollbar-thin">
        {groups.map((g) => (
          <Group key={g.id} group={g} enabled={enabled} onToggle={onToggle} />
        ))}
      </div>
    </aside>
  );
}

function Group({ group, enabled, onToggle }: { group: CalendarGroup; enabled: Set<string>; onToggle: (ids: string[], on: boolean) => void }) {
  const [open, setOpen] = useState(group.defaultOpen);
  const [q, setQ] = useState("");
  const visible = useMemo(
    () => (q ? group.calendars.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : group.calendars),
    [group.calendars, q],
  );
  const onCount = group.calendars.filter((c) => enabled.has(c.id)).length;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2">
      <div className="flex items-center gap-1 pr-1">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          {group.label}
          {!open && onCount > 0 && <span className="ml-1 font-normal tabular">{onCount} on</span>}
        </CollapsibleTrigger>
        {open && group.calendars.length > 3 && (
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onToggle(visible.map((c) => c.id), onCount === 0)}
          >
            {onCount === 0 ? "Show all" : "Hide all"}
          </button>
        )}
      </div>
      <CollapsibleContent>
        {group.searchable && group.calendars.length > 6 && (
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find in ${group.label.toLowerCase()}`} className="my-1 h-8 text-xs" />
        )}
        <ul className="mt-0.5">
          {visible.map((c) => {
            const on = enabled.has(c.id);
            return (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) => onToggle([c.id], !!v)}
                    className="border-[var(--c)] data-[state=checked]:border-[var(--c)] data-[state=checked]:bg-[var(--c)]"
                    style={{ "--c": `var(--cal-${c.color})` } as React.CSSProperties}
                  />
                  <span className="truncate">{c.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
