"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, Check, DoorOpen, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BookingDTO, BookingStatus } from "@sched/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { useBookings, useMe } from "@/lib/queries";
import { campus, inCampus, timeRange } from "@/lib/time";
import { cn } from "@/lib/utils";

const STATUS: Record<BookingStatus, { label: string; className: string }> = {
  pending: { label: "Waiting for review", className: "bg-[color-mix(in_oklab,var(--cal-mesa)_16%,var(--card))] text-[var(--cal-mesa-ink)]" },
  approved: { label: "Approved", className: "bg-[color-mix(in_oklab,var(--cal-leaf)_16%,var(--card))] text-[var(--cal-leaf-ink)]" },
  denied: { label: "Declined", className: "bg-[color-mix(in_oklab,var(--cal-chili)_12%,var(--card))] text-[var(--cal-chili-ink)]" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export function RequestsScreen() {
  const { data: me } = useMe();
  const canReview = !!me?.user.roles.some((r) => r === "admin" || r === "staff" || r === "scheduler");
  const mine = useBookings("mine", !!me);
  const review = useBookings("review", canReview);
  const pending = (review.data ?? []).filter((b) => b.status === "pending");

  // The default tab depends on the person's roles, so wait for them.
  if (!me) return <Skeleton className="m-8 h-64" />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
        <h1 className="font-numeral text-[32px] leading-none font-semibold">Room requests</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rooms marked as needing approval go through the Dean&apos;s Office. Book from the Rooms page.
        </p>
        <Tabs defaultValue={canReview ? "review" : "mine"} className="mt-6">
          <TabsList>
            {canReview && (
              <TabsTrigger value="review">
                To review
                {pending.length > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground tabular">{pending.length}</span>}
              </TabsTrigger>
            )}
            <TabsTrigger value="mine">My requests</TabsTrigger>
          </TabsList>
          {canReview && (
            <TabsContent value="review" className="mt-4">
              <BookingList query={review} reviewer emptyText="Nothing waiting. New requests show up here as soon as they're sent." />
            </TabsContent>
          )}
          <TabsContent value="mine" className="mt-4">
            <BookingList query={mine} emptyText="You haven't requested any rooms. Open Rooms and click a free slot to book one." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function BookingList({
  query,
  reviewer = false,
  emptyText,
}: {
  query: ReturnType<typeof useBookings>;
  reviewer?: boolean;
  emptyText: string;
}) {
  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  const list = [...(query.data ?? [])].sort(
    (a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt),
  );
  if (list.length === 0) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {list.map((b) => (
        <BookingRow key={b.id} b={b} reviewer={reviewer} />
      ))}
    </ul>
  );
}

function BookingRow({ b, reviewer }: { b: BookingDTO; reviewer: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: (decision: "approve" | "deny" | "cancel") =>
      api<BookingDTO>(`/bookings/${b.id}/${decision}`, { method: "POST", json: { note: note || undefined } }),
    onSuccess: (_r, d) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["rooms-board"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(d === "approve" ? "Request approved" : d === "deny" ? "Request declined" : "Request cancelled");
    },
    onError: (e) =>
      toast.error(e instanceof ApiError && e.code === "conflict" ? "The room was booked by something else in the meantime" : e instanceof Error ? e.message : "Something went wrong"),
  });
  const start = campus(b.startsAt);
  const status = STATUS[b.status];
  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[88px_1fr_auto] sm:gap-5">
      <div className="flex items-baseline gap-2 sm:block">
        <div className="font-numeral text-3xl leading-none font-semibold tabular">{format(start, "d", { in: inCampus })}</div>
        <div className="text-xs text-muted-foreground sm:mt-1">{format(start, "EEE, MMM", { in: inCampus })}</div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{b.title}</h3>
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", status.className)}>{status.label}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular">{timeRange(new Date(b.startsAt), new Date(b.endsAt))}</span>
          <span className="inline-flex items-center gap-1">
            <DoorOpen className="size-3.5" /> {b.roomLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> {b.attendeeCount}
          </span>
          {reviewer && <span>{b.requester.displayName}</span>}
        </div>
        {b.purpose && <p className="mt-2 text-sm">{b.purpose}</p>}
        {b.reviewNote && (
          <p className="mt-2 border-l-2 pl-3 text-sm text-muted-foreground">
            {b.reviewer?.displayName}: {b.reviewNote}
          </p>
        )}
        {b.conflicts && b.conflicts.length > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--cal-mesa-ink)]">
            <AlertTriangle className="size-4" /> Overlaps {b.conflicts[0]!.title}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Sent {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}</p>
      </div>
      <div className="flex items-start gap-2">
        {reviewer && b.status === "pending" && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={act.isPending}>
                  <X /> Decline
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-2 text-sm font-medium">Tell {b.requester.displayName.split(" ")[0]} why</p>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Suggest another room or time" />
                <Button size="sm" variant="destructive" className="mt-2 w-full" onClick={() => act.mutate("deny")}>
                  Decline request
                </Button>
              </PopoverContent>
            </Popover>
            <Button size="sm" onClick={() => act.mutate("approve")} disabled={act.isPending || !!b.conflicts?.length}>
              <Check /> Approve
            </Button>
          </>
        )}
        {!reviewer && (b.status === "pending" || (b.status === "approved" && new Date(b.startsAt) > new Date())) && (
          <Button variant="ghost" size="sm" onClick={() => act.mutate("cancel")} disabled={act.isPending}>
            Cancel request
          </Button>
        )}
      </div>
    </li>
  );
}
