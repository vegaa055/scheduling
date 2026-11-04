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

export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  admin: { label: "Admin", description: "Everything, including people, rooms and terms" },
  scheduler: { label: "Scheduler", description: "Builds and publishes term timetables" },
  staff: { label: "Staff", description: "Edits department, college and room calendars; reviews room requests" },
  faculty: { label: "Faculty", description: "Teaches; sets teaching availability" },
  viewer: { label: "Viewer", description: "Reads public calendars" },
};

export const ROOM_KINDS = ["classroom", "lecture_hall", "lab", "seminar", "conference", "event_space"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  classroom: "Classroom",
  lecture_hall: "Lecture hall",
  lab: "Lab",
  seminar: "Seminar room",
  conference: "Conference room",
  event_space: "Event space",
};

export const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type DayCode = (typeof DAY_CODES)[number];

export const AVAILABILITY_PREFS = ["unavailable", "undesired", "preferred"] as const;
export type AvailabilityPref = (typeof AVAILABILITY_PREFS)[number];

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

/* ---------------- Admin ---------------- */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-13");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const netidSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, "NetIDs use letters, numbers, dots, dashes and underscores");

export const userCreateSchema = z.object({
  netid: netidSchema,
  displayName: z.string().trim().min(1, "Add a name").max(120),
  email: z.union([z.email("Enter a valid email address"), z.literal("")]).default(""),
  title: optionalText(120),
  departmentId: z.uuid().nullish(),
  roles: z.array(z.enum(ROLES)).min(1, "Pick at least one role").default(["faculty"]),
});
export type UserCreateInput = z.input<typeof userCreateSchema>;

export const userPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  email: z.union([z.email("Enter a valid email address"), z.literal("")]).optional(),
  /** Omit to leave as is; null or "" clears it. */
  title: z.string().trim().max(120).nullable().optional(),
  departmentId: z.uuid().nullish(),
  roles: z.array(z.enum(ROLES)).min(1, "Pick at least one role").optional(),
  /** Keep the admin-set roles when the person signs in, instead of mapping them from campus attributes. */
  rolesLocked: z.boolean().optional(),
});
export type UserPatchInput = z.input<typeof userPatchSchema>;

export const departmentInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Use 2 to 10 letters or numbers, like CHEM"),
  name: z.string().trim().min(1, "Add a name").max(120),
});

export const buildingInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, "Use 2 to 8 letters or numbers, like CHM"),
  name: z.string().trim().min(1, "Add a name").max(120),
});

export const featureSlug = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/[\s-]+/g, "_"))
  .pipe(z.string().regex(/^[a-z0-9_]{2,40}$/, "Features use letters, numbers and underscores"));

export const roomInputSchema = z.object({
  buildingId: z.uuid(),
  number: z.string().trim().min(1, "Add a room number").max(20),
  name: optionalText(120),
  capacity: z.number().int().min(1, "Capacity must be at least 1").max(5000),
  kind: z.enum(ROOM_KINDS),
  features: z.array(featureSlug).max(30).default([]),
  bookable: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  schedulable: z.boolean().default(true),
});
export type RoomInput = z.input<typeof roomInputSchema>;

export const termInputSchema = z
  .object({
    code: z.string().trim().min(1, "Add a term code").max(12),
    name: z.string().trim().min(1, "Add a name").max(60),
    startsOn: ymd,
    classesEndOn: ymd,
    finalsStartOn: ymd,
    finalsEndOn: ymd,
    endsOn: ymd,
    isCurrent: z.boolean().default(false),
    /** On create: copy the meeting patterns of this term. */
    copyPatternsFrom: z.uuid().nullish(),
  })
  .superRefine((t, ctx) => {
    const order: [keyof typeof t, string][] = [
      ["startsOn", "Classes start"],
      ["classesEndOn", "Classes end"],
      ["finalsStartOn", "Finals start"],
      ["finalsEndOn", "Finals end"],
      ["endsOn", "Term ends"],
    ];
    for (let i = 1; i < order.length; i++) {
      const [prevKey, prevLabel] = order[i - 1]!;
      const [key, label] = order[i]!;
      if ((t[key] as string) < (t[prevKey] as string)) {
        ctx.addIssue({ code: "custom", path: [key], message: `${label} can't be before ${prevLabel.toLowerCase()}` });
      }
    }
  });
export type TermInput = z.input<typeof termInputSchema>;

export const termDateInputSchema = z
  .object({
    startsOn: ymd,
    endsOn: ymd.nullish(),
    label: z.string().trim().min(1, "Add a label").max(120),
    kind: z.enum(TERM_DATE_KINDS),
  })
  .refine((d) => !d.endsOn || d.endsOn >= d.startsOn, { message: "The last day can't be before the first", path: ["endsOn"] });
export type TermDateInput = z.input<typeof termDateInputSchema>;

export const patternInputSchema = z
  .object({
    family: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,16}$/, "Use 2 to 16 letters or numbers, like MWF50"),
    days: z.array(z.enum(DAY_CODES)).min(1, "Pick at least one day"),
    startTime: hhmm,
    endTime: hhmm,
  })
  .refine((p) => p.endTime > p.startTime, { message: "End time must be after the start time", path: ["endTime"] });
export type PatternInput = z.input<typeof patternInputSchema>;

export const availabilityBlockSchema = z
  .object({
    day: z.enum(DAY_CODES),
    startTime: hhmm,
    endTime: hhmm,
    preference: z.enum(AVAILABILITY_PREFS),
  })
  .refine((b) => b.endTime > b.startTime, { message: "End time must be after the start time", path: ["endTime"] });

export const sectionImportSchema = z.object({
  csv: z.string().min(1, "The file is empty").max(5_000_000, "The file is larger than 5 MB"),
  /** false = check the file and report what would change; true = make the changes. */
  apply: z.boolean().default(false),
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
  buildingId: string;
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
  /** The timetabling solver may place classes here. */
  schedulable: boolean;
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

export interface AdminUserDTO {
  id: string;
  netid: string;
  email: string;
  displayName: string;
  title: string | null;
  roles: Role[];
  rolesLocked: boolean;
  affiliations: string[];
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface DepartmentDTO {
  id: string;
  code: string;
  name: string;
  people: number;
  courses: number;
}

export interface BuildingDTO {
  id: string;
  code: string;
  name: string;
  rooms: number;
}

export interface PatternDTO {
  id: string;
  termId: string;
  family: string;
  days: DayCode[];
  startTime: string;
  endTime: string;
  label: string;
  /** Sections of the term placed in this pattern. */
  sectionCount: number;
}

export interface AvailabilityBlockDTO {
  day: DayCode;
  startTime: string;
  endTime: string;
  preference: AvailabilityPref;
}

export interface ImportIssue {
  /** 1-based line number in the file (the header is line 1). */
  line: number;
  message: string;
}

export interface SectionImportResultDTO {
  applied: boolean;
  rows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  courses: { created: number; updated: number };
  sections: { created: number; updated: number; unchanged: number };
  /** NetIDs of instructors who will be (or were) added as new people. */
  newPeople: string[];
  /** Sections already in the term that the file doesn't mention; they're left as they are. */
  notInFile: number;
  /** Changed sections that are already on the class calendars and need publishing again. */
  republishNeeded: number;
}

export interface ApiError {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
  conflicts?: ConflictDTO[];
}
