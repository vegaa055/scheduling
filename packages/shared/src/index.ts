import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const ROLES = ["admin", "scheduler", "staff", "faculty", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const EVENT_KINDS = [
  "class",
  "office_hours",
  "meeting",
  "exam",
  "booking",
  "deadline",
  "event",
  "hold",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  class: "Class",
  office_hours: "Office hours",
  meeting: "Meeting",
  exam: "Exam",
  booking: "Room booking",
  deadline: "Deadline",
  event: "Event",
  hold: "Hold",
};

export const EVENT_STATUSES = ["confirmed", "tentative", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const CALENDAR_KINDS = ["personal", "department", "room", "course", "college"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_COLORS = [
  "azurite",
  "oasis",
  "river",
  "leaf",
  "mesa",
  "chili",
  "bloom",
  "sky",
  "midnight",
  "sage",
] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export const BOOKING_STATUSES = ["pending", "approved", "denied", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const TERM_DATE_KINDS = ["holiday", "deadline", "finals", "break", "milestone"] as const;
export type TermDateKind = (typeof TERM_DATE_KINDS)[number];

export const SOLVER_STATUSES = [
  "queued",
  "solving",
  "completed",
  "failed",
  "cancelled",
  "applied",
] as const;
export type SolverStatus = (typeof SOLVER_STATUSES)[number];

export const DEFAULT_TIMEZONE = "America/Phoenix";

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

const isoDateTime = z.iso.datetime({ offset: true });

export const eventInputSchema = z
  .object({
    calendarId: z.uuid(),
    title: z.string().trim().min(1, "Add a title").max(200),
    description: z.string().max(5000).optional().nullable(),
    kind: z.enum(EVENT_KINDS).default("meeting"),
    status: z.enum(EVENT_STATUSES).default("confirmed"),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    allDay: z.boolean().default(false),
    timezone: z.string().default(DEFAULT_TIMEZONE),
    rrule: z
      .string()
      .regex(/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+\-]+)*$/, "Invalid repeat rule")
      .optional()
      .nullable(),
    roomId: z.uuid().optional().nullable(),
    locationText: z.string().max(200).optional().nullable(),
    attendeeIds: z.array(z.uuid()).max(500).default([]),
    /** Save even if conflicts are found. */
    force: z.boolean().default(false),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "End time must be after the start time",
    path: ["endsAt"],
  });
export type EventInput = z.input<typeof eventInputSchema>;

export const eventPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  kind: z.enum(EVENT_KINDS).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  calendarId: z.uuid().optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  allDay: z.boolean().optional(),
  rrule: z.string().optional().nullable(),
  roomId: z.uuid().optional().nullable(),
  locationText: z.string().max(200).optional().nullable(),
  attendeeIds: z.array(z.uuid()).max(500).optional(),
  /** For recurring events: change only one occurrence, or the whole series. */
  scope: z.enum(["series", "occurrence"]).default("series"),
  /** Required when scope = occurrence: the original start of the occurrence being changed. */
  occurrenceStart: isoDateTime.optional(),
  force: z.boolean().default(false),
});
export type EventPatch = z.input<typeof eventPatchSchema>;

export const bookingInputSchema = z
  .object({
    roomId: z.uuid(),
    title: z.string().trim().min(1, "Add a title").max(200),
    purpose: z.string().max(2000).optional().nullable(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    attendeeCount: z.number().int().min(1).max(2000).default(1),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "End time must be after the start time",
    path: ["endsAt"],
  });
export type BookingInput = z.input<typeof bookingInputSchema>;

export const solverRunInputSchema = z.object({
  termId: z.uuid(),
  /** Wall-clock budget for the solver in seconds. */
  secondsLimit: z.number().int().min(5).max(900).default(30),
});

/* ------------------------------------------------------------------ */
/* Response DTOs                                                       */
/* ------------------------------------------------------------------ */

export interface UserDTO {
  id: string;
  netid: string;
  email: string;
  displayName: string;
  title: string | null;
  roles: Role[];
  departmentId: string | null;
  departmentName?: string | null;
}

export interface CalendarDTO {
  id: string;
  name: string;
  description: string | null;
  color: CalendarColor;
  kind: CalendarKind;
  isPublic: boolean;
  departmentId: string | null;
  roomId: string | null;
  ownerId: string | null;
  /** What the current user can do on this calendar. */
  access: "owner" | "editor" | "viewer";
}

/** One rendered occurrence of an event. Non-recurring events have exactly one. */
export interface OccurrenceDTO {
  /** Stable key: `${eventId}:${originalStart}` */
  key: string;
  eventId: string;
  calendarId: string;
  title: string;
  kind: EventKind;
  status: EventStatus;
  start: string;
  end: string;
  /** For recurring series, the occurrence's original start (used to edit one instance). */
  originalStart: string;
  allDay: boolean;
  recurring: boolean;
  roomId: string | null;
  roomLabel: string | null;
  locationText: string | null;
  organizerName: string | null;
}

export interface EventDetailDTO {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  kind: EventKind;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  roomId: string | null;
  roomLabel: string | null;
  locationText: string | null;
  organizer: { id: string; displayName: string } | null;
  attendees: { id: string; displayName: string; response: string }[];
  sectionId: string | null;
  canEdit: boolean;
}

export interface ConflictDTO {
  reason: "room" | "person";
  /** Who or what is double-booked. */
  subject: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
}

export interface RoomDTO {
  id: string;
  buildingCode: string;
  buildingName: string;
  number: string;
  name: string | null;
  label: string;
  capacity: number;
  features: string[];
  kind: string;
  bookable: boolean;
  requiresApproval: boolean;
}

export interface RoomBusyDTO {
  roomId: string;
  busy: { start: string; end: string; title: string; kind: EventKind; eventId: string }[];
}

export interface TermDTO {
  id: string;
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  classesEndOn: string;
  finalsStartOn: string;
  finalsEndOn: string;
  isCurrent: boolean;
  dates: { id: string; startsOn: string; endsOn: string | null; label: string; kind: TermDateKind }[];
}

export interface BookingDTO {
  id: string;
  roomId: string;
  roomLabel: string;
  requester: { id: string; displayName: string };
  title: string;
  purpose: string | null;
  startsAt: string;
  endsAt: string;
  attendeeCount: number;
  status: BookingStatus;
  reviewer: { id: string; displayName: string } | null;
  reviewNote: string | null;
  createdAt: string;
  conflicts?: ConflictDTO[];
}

export interface SectionDTO {
  id: string;
  courseId: string;
  subject: string;
  number: string;
  courseTitle: string;
  sectionNumber: string;
  instructorId: string | null;
  instructorName: string | null;
  enrollmentCap: number;
  allowedPatterns: string[];
  requiredFeatures: string[];
  cohorts: string[];
  meetingPatternId: string | null;
  meetingPatternLabel: string | null;
  roomId: string | null;
  roomLabel: string | null;
  locked: boolean;
  status: "unscheduled" | "scheduled" | "published";
}

export interface SolverRunDTO {
  id: string;
  termId: string;
  status: SolverStatus;
  score: string | null;
  hardScore: number | null;
  softScore: number | null;
  secondsLimit: number;
  startedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  summary: {
    sections: number;
    assigned: number;
    unassigned: number;
    hardViolations: number;
  } | null;
  constraints?: { name: string; score: string; matchCount: number; justifications: string[] }[];
  assignments?: { sectionId: string; meetingPatternId: string | null; roomId: string | null }[];
}

export interface ApiError {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
  conflicts?: ConflictDTO[];
}
