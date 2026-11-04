import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  BOOKING_STATUSES,
  CALENDAR_KINDS,
  EVENT_KINDS,
  EVENT_STATUSES,
  ROLES,
  SOLVER_STATUSES,
  TERM_DATE_KINDS,
} from "@sched/shared";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);
export const eventKindEnum = pgEnum("event_kind", EVENT_KINDS);
export const eventStatusEnum = pgEnum("event_status", EVENT_STATUSES);
export const calendarKindEnum = pgEnum("calendar_kind", CALENDAR_KINDS);
export const memberRoleEnum = pgEnum("member_role", ["owner", "editor", "viewer"]);
export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUSES);
export const termDateKindEnum = pgEnum("term_date_kind", TERM_DATE_KINDS);
export const availabilityEnum = pgEnum("availability_pref", ["unavailable", "undesired", "preferred"]);
export const solverStatusEnum = pgEnum("solver_status", SOLVER_STATUSES);
export const sectionStatusEnum = pgEnum("section_status", ["unscheduled", "scheduled", "published"]);

/* ---------------- People & organisation ---------------- */

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Campus login id (eppn local part / uid). */
    netid: text("netid").notNull().unique(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    title: text("title"),
    affiliations: text("affiliations").array().notNull().default(sql`'{}'::text[]`),
    roles: roleEnum("roles").array().notNull().default(sql`'{viewer}'::role[]`),
    /** When true, roles were set by an admin and are not overwritten by IdP attributes at login. */
    rolesLocked: boolean("roles_locked").notNull().default(false),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastLoginAt: tstz("last_login_at"),
  },
  (t) => [index("users_display_name_idx").on(t.displayName)],
);

/* ---------------- Spaces ---------------- */

export const buildings = pgTable("buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    name: text("name"),
    capacity: integer("capacity").notNull(),
    features: text("features").array().notNull().default(sql`'{}'::text[]`),
    /** classroom | lecture_hall | lab | seminar | conference */
    kind: text("kind").notNull().default("classroom"),
    bookable: boolean("bookable").notNull().default(true),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    /** Rooms the timetabling solver may assign classes to. */
    schedulable: boolean("schedulable").notNull().default(true),
  },
  (t) => [uniqueIndex("rooms_building_number_uq").on(t.buildingId, t.number)],
);

/* ---------------- Academic calendar ---------------- */

export const terms = pgTable("terms", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  classesEndOn: date("classes_end_on").notNull(),
  finalsStartOn: date("finals_start_on").notNull(),
  finalsEndOn: date("finals_end_on").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
});

export const termDates = pgTable("term_dates", {
  id: uuid("id").primaryKey().defaultRandom(),
  termId: uuid("term_id")
    .notNull()
    .references(() => terms.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  label: text("label").notNull(),
  kind: termDateKindEnum("kind").notNull(),
});

/* ---------------- Calendars & events ---------------- */

export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("azurite"),
  kind: calendarKindEnum("kind").notNull(),
  /** Public calendars are readable by every signed-in user. */
  isPublic: boolean("is_public").notNull().default(true),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
  /** Bumped on every write; part of the Redis cache key for expanded occurrences. */
  version: integer("version").notNull().default(0),
  createdAt: createdAt(),
});

export const calendarMembers = pgTable(
  "calendar_members",
  {
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("viewer"),
  },
  (t) => [primaryKey({ columns: [t.calendarId, t.userId] })],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    kind: eventKindEnum("kind").notNull().default("meeting"),
    status: eventStatusEnum("status").notNull().default("confirmed"),
    /** First occurrence start/end. */
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    timezone: text("timezone").notNull().default("America/Phoenix"),
    /** RFC 5545 RRULE body, without the "RRULE:" prefix. */
    rrule: text("rrule"),
    exdates: tstz("exdates").array().notNull().default(sql`'{}'::timestamptz[]`),
    /** End of the last occurrence (null = repeats forever). Used to prune range queries. */
    recurUntil: tstz("recur_until"),
    /** For single-occurrence overrides: the series this row replaces an occurrence of. */
    recurrenceId: uuid("recurrence_id"),
    originalStart: tstz("original_start"),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    locationText: text("location_text"),
    organizerId: uuid("organizer_id").references(() => users.id, { onDelete: "set null" }),
    sectionId: uuid("section_id"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("events_calendar_start_idx").on(t.calendarId, t.startsAt),
    index("events_room_start_idx").on(t.roomId, t.startsAt),
    index("events_organizer_idx").on(t.organizerId),
    index("events_recurrence_idx").on(t.recurrenceId),
    index("events_section_idx").on(t.sectionId),
  ],
);

export const eventAttendees = pgTable(
  "event_attendees",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    response: text("response").notNull().default("needs_action"),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index("event_attendees_user_idx").on(t.userId)],
);

/* ---------------- Room booking workflow ---------------- */

export const bookingRequests = pgTable(
  "booking_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    purpose: text("purpose"),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    attendeeCount: integer("attendee_count").notNull().default(1),
    status: bookingStatusEnum("status").notNull().default("pending"),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    reviewedAt: tstz("reviewed_at"),
  },
  (t) => [index("booking_requests_status_idx").on(t.status, t.startsAt)],
);

/* ---------------- Course timetabling ---------------- */

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    number: text("number").notNull(),
    title: text("title").notNull(),
    credits: smallint("credits").notNull().default(3),
  },
  (t) => [uniqueIndex("courses_subject_number_uq").on(t.subject, t.number)],
);

/** A standard meeting pattern offered in a term, e.g. MWF 9:00–9:50. */
export const meetingPatterns = pgTable(
  "meeting_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    /** Pattern family the solver matches against sections, e.g. MWF50, TR75, LAB170. */
    family: text("family").notNull(),
    /** Days as iCal BYDAY codes, e.g. {MO,WE,FR}. */
    days: text("days").array().notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [index("meeting_patterns_term_idx").on(t.termId)],
);

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    sectionNumber: text("section_number").notNull(),
    instructorId: uuid("instructor_id").references(() => users.id, { onDelete: "set null" }),
    enrollmentCap: integer("enrollment_cap").notNull(),
    allowedPatterns: text("allowed_patterns").array().notNull(),
    requiredFeatures: text("required_features").array().notNull().default(sql`'{}'::text[]`),
    /** Curriculum groups whose students take these together; sections sharing a cohort must not overlap. */
    cohorts: text("cohorts").array().notNull().default(sql`'{}'::text[]`),
    meetingPatternId: uuid("meeting_pattern_id").references(() => meetingPatterns.id, { onDelete: "set null" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    /** Locked sections are pinned: the solver keeps their current assignment. */
    locked: boolean("locked").notNull().default(false),
    status: sectionStatusEnum("status").notNull().default("unscheduled"),
    publishedEventId: uuid("published_event_id"),
  },
  (t) => [
    uniqueIndex("sections_course_term_number_uq").on(t.courseId, t.termId, t.sectionNumber),
    index("sections_term_idx").on(t.termId),
  ],
);

export const instructorAvailability = pgTable(
  "instructor_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    /** iCal day code: MO..SU */
    day: text("day").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    preference: availabilityEnum("preference").notNull(),
  },
  (t) => [index("instructor_availability_user_term_idx").on(t.userId, t.termId)],
);

export const solverRuns = pgTable("solver_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  termId: uuid("term_id")
    .notNull()
    .references(() => terms.id, { onDelete: "cascade" }),
  status: solverStatusEnum("status").notNull().default("queued"),
  secondsLimit: integer("seconds_limit").notNull().default(30),
  score: text("score"),
  hardScore: integer("hard_score"),
  softScore: integer("soft_score"),
  startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
  summary: jsonb("summary"),
  solution: jsonb("solution"),
  analysis: jsonb("analysis"),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: tstz("finished_at"),
});

/* ---------------- Audit ---------------- */

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);
