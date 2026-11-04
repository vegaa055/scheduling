"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Check, CircleHelp, Clock, DoorOpen, MapPin, Pencil, Repeat, Trash2, UserRound, Users, X } from "lucide-react";
import { toast } from "sonner";
import { EVENT_KIND_LABELS, type CalendarDTO, type OccurrenceDTO } from "@sched/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { swatch } from "@/lib/colors";
import { useEventDetail, useInvalidateCalendar, useMe } from "@/lib/queries";
import { describeRRule } from "@/lib/rrule";
import { campus, inCampus, timeRange } from "@/lib/time";

const RESPONSE_ICON = { accepted: Check, declined: X, tentative: CircleHelp, needs_action: Clock } as const;
const RESPONSE_LABEL = { accepted: "Going", declined: "Not going", tentative: "Maybe", needs_action: "No reply yet" } as const;

export function EventSheet({
  occurrence,
  calendars,
  onClose,
  onEdit,
}: {
  occurrence: OccurrenceDTO | null;
  calendars: Map<string, CalendarDTO>;
  onClose: () => void;
  onEdit: (o: OccurrenceDTO) => void;
}) {
  const { data: me } = useMe();
  const { data: ev, isLoading } = useEventDetail(occurrence?.eventId ?? null);
  const invalidate = useInvalidateCalendar();
  const cal = occurrence ? calendars.get(occurrence.calendarId) : undefined;

  const remove = useMutation({
    mutationFn: (scope: "series" | "occurrence") =>
      api(
        `/events/${occurrence!.eventId}?scope=${scope}${scope === "occurrence" ? `&occurrenceStart=${encodeURIComponent(occurrence!.originalStart)}` : ""}`,
        { method: "DELETE" },
      ),
    onSuccess: (_d, scope) => {
      invalidate();
      toast.success(scope === "occurrence" ? "Event deleted from this day" : "Event deleted");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete the event"),
  });

  const respond = useMutation({
    mutationFn: (response: "accepted" | "declined" | "tentative") =>
      api(`/events/${occurrence!.eventId}/respond`, { method: "POST", json: { response } }),
    onSuccess: () => {
      invalidate();
      toast.success("Reply sent");
    },
  });

  const myAttendance = ev?.attendees.find((a) => a.id === me?.user.id);
  const start = occurrence ? campus(occurrence.start) : null;
  const end = occurrence ? campus(occurrence.end) : null;

  return (
    <Sheet open={!!occurrence} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-[420px]">
        {occurrence && start && end && (
          <>
            <SheetHeader className="gap-2 border-b pr-12 pb-5">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="size-2.5 rounded-full" style={swatch(cal?.color ?? "azurite")} />
                {cal?.name}
                <span aria-hidden>·</span>
                {EVENT_KIND_LABELS[occurrence.kind]}
                {occurrence.status === "tentative" && <span className="rounded bg-muted px-1.5">Tentative</span>}
              </div>
              <SheetTitle className="text-xl leading-snug">{occurrence.title}</SheetTitle>
              <SheetDescription className="sr-only">Event details</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
              <Row icon={CalendarClock}>
                <div className="font-medium">{format(start, "EEEE, MMMM d, yyyy", { in: inCampus })}</div>
                <div className="text-muted-foreground tabular">{occurrence.allDay ? "All day" : `${timeRange(start, end)} MST`}</div>
              </Row>
              {ev?.rrule && <Row icon={Repeat}>{describeRRule(ev.rrule)}</Row>}
              {(occurrence.roomLabel || occurrence.locationText) && (
                <Row icon={occurrence.roomLabel ? DoorOpen : MapPin}>{ev?.roomLabel ?? occurrence.roomLabel ?? occurrence.locationText}</Row>
              )}
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                ev && (
                  <>
                    {ev.organizer && (
                      <Row icon={UserRound}>
                        <span className="text-muted-foreground">Organized by </span>
                        {ev.organizer.displayName}
                      </Row>
                    )}
                    {ev.attendees.length > 0 && (
                      <Row icon={Users}>
                        <div className="mb-1.5 text-muted-foreground">
                          {ev.attendees.length} {ev.attendees.length === 1 ? "person" : "people"}
                        </div>
                        <ul className="space-y-1">
                          {ev.attendees.map((a) => {
                            const r = (a.response in RESPONSE_ICON ? a.response : "needs_action") as keyof typeof RESPONSE_ICON;
                            const Icon = RESPONSE_ICON[r];
                            return (
                              <li key={a.id} className="flex items-center justify-between gap-2">
                                <span>{a.displayName}</span>
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <Icon className="size-3.5" /> {RESPONSE_LABEL[r]}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </Row>
                    )}
                    {ev.description && <p className="text-sm leading-relaxed whitespace-pre-wrap">{ev.description}</p>}
                  </>
                )
              )}

              {myAttendance && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-2 text-sm font-medium">Going?</p>
                    <div className="flex gap-2">
                      {(["accepted", "tentative", "declined"] as const).map((r) => (
                        <Button
                          key={r}
                          size="sm"
                          variant={myAttendance.response === r ? "default" : "outline"}
                          onClick={() => respond.mutate(r)}
                          disabled={respond.isPending}
                        >
                          {r === "accepted" ? "Yes" : r === "tentative" ? "Maybe" : "No"}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {ev?.canEdit && (
              <div className="flex gap-2 border-t p-4">
                <Button onClick={() => onEdit(occurrence)} className="flex-1">
                  <Pencil /> Edit
                </Button>
                {occurrence.recurring && ev.rrule ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" disabled={remove.isPending}>
                        <Trash2 /> Delete
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => remove.mutate("occurrence")}>
                        Only {format(start, "EEE, MMM d", { in: inCampus })}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => remove.mutate("series")}>
                        Every event in the series
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button variant="outline" onClick={() => remove.mutate("series")} disabled={remove.isPending}>
                    <Trash2 /> Delete
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
