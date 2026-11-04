"use client";

import { TZDate } from "@date-fns/tz";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BookingDTO, ConflictDTO, RoomDTO } from "@sched/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { atMinute, CAMPUS_TZ, campus, inCampus, isoCampus, minutesSinceMidnight, timeRange } from "@/lib/time";

export interface BookingDraft {
  roomId: string;
  start: Date;
  end: Date;
}

const TIMES = Array.from({ length: (17 * 60) / 15 + 1 }, (_, i) => 6 * 60 + i * 15);
const label = (m: number) => format(atMinute(new Date(2026, 0, 5), m), m % 60 ? "h:mm aaa" : "h aaa", { in: inCampus });

export function BookingDialog({
  draft,
  rooms,
  canReview,
  onClose,
}: {
  draft: BookingDraft | null;
  rooms: RoomDTO[];
  canReview: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [roomId, setRoomId] = useState("");
  const [day, setDay] = useState<Date>(new Date());
  const [startMin, setStartMin] = useState(9 * 60);
  const [endMin, setEndMin] = useState(10 * 60);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [count, setCount] = useState(10);
  const [conflicts, setConflicts] = useState<ConflictDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setRoomId(draft.roomId);
    setDay(campus(draft.start));
    setStartMin(minutesSinceMidnight(draft.start));
    setEndMin(minutesSinceMidnight(draft.end));
    setTitle("");
    setPurpose("");
    setCount(10);
    setConflicts([]);
    setError(null);
  }, [draft]);

  const room = rooms.find((r) => r.id === roomId);
  const needsApproval = !!room?.requiresApproval && !canReview;

  const submit = useMutation({
    mutationFn: () =>
      api<BookingDTO>("/bookings", {
        method: "POST",
        json: {
          roomId,
          title: title.trim(),
          purpose: purpose || null,
          startsAt: isoCampus(atMinute(day, startMin)),
          endsAt: isoCampus(atMinute(day, endMin)),
          attendeeCount: count,
        },
      }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["rooms-board"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(b.status === "approved" ? `${b.roomLabel} booked` : "Request sent for approval", {
        description: b.status === "approved" ? undefined : "You'll see the decision on the Requests page.",
      });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "conflict") {
        setConflicts(e.conflicts);
        setError(null);
      } else setError(e instanceof Error ? e.message : "Couldn't send the request");
    },
  });

  const start = atMinute(day, startMin);
  const end = atMinute(day, endMin);

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{needsApproval ? "Request a room" : "Book a room"}</DialogTitle>
          <DialogDescription>
            {room ? `${room.label}${room.name ? `, ${room.name}` : ""}. Seats ${room.capacity}.` : "Choose a room"}
            {needsApproval && " This room needs approval from the Dean's Office."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("Add a title");
            if (endMin <= startMin) return setError("End time must be after the start time");
            submit.mutate();
          }}
        >
          <Input autoFocus placeholder="What's it for?" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Room</Label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a room" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {rooms
                  .filter((r) => r.bookable)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                      {r.name ? `, ${r.name}` : ""}
                      <span className="text-muted-foreground tabular">{r.capacity} seats</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start font-normal">
                    <CalendarIcon className="text-muted-foreground" />
                    {format(day, "EEE, MMM d", { in: inCampus })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={new Date(campus(day).getFullYear(), campus(day).getMonth(), campus(day).getDate())}
                    onSelect={(d) => d && setDay(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), CAMPUS_TZ))}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <TimeField label="From" value={startMin} onChange={(m) => {
              setEndMin(m + Math.max(endMin - startMin, 30));
              setStartMin(m);
            }} />
            <TimeField label="To" value={endMin} onChange={setEndMin} min={startMin + 15} />
            <div className="grid w-24 gap-1.5">
              <Label className="text-xs text-muted-foreground">People</Label>
              <Input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <Textarea rows={3} placeholder="Purpose, setup needs, catering" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Purpose" />
          {room && count > room.capacity && (
            <p className="text-sm text-destructive">This room seats {room.capacity}. Pick a larger room or lower the headcount.</p>
          )}
          {conflicts.length > 0 && (
            <Alert className="border-[var(--cal-mesa)]/50">
              <AlertTriangle className="text-[var(--cal-mesa)]" />
              <AlertTitle>The room is taken then</AlertTitle>
              <AlertDescription>
                {conflicts.map((c, i) => (
                  <div key={i} className="text-[13px]">
                    {c.title}, {timeRange(new Date(c.start), new Date(c.end))}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submit.isPending || !roomId}>
              {submit.isPending ? "Sending…" : needsApproval ? "Send request" : "Book room"}
            </Button>
          </DialogFooter>
          <p className="-mt-2 text-right text-xs text-muted-foreground tabular">
            {format(start, "EEEE, MMMM d", { in: inCampus })}, {timeRange(start, end)}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeField({ label: l, value, onChange, min }: { label: string; value: number; onChange: (m: number) => void; min?: number }) {
  return (
    <div className="grid w-[120px] gap-1.5">
      <Label className="text-xs text-muted-foreground">{l}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full tabular">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {TIMES.filter((t) => min === undefined || t >= min).map((t) => (
            <SelectItem key={t} value={String(t)} className="tabular">
              {label(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
