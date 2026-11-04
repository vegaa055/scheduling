CREATE TYPE "public"."availability_pref" AS ENUM('unavailable', 'undesired', 'preferred');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'approved', 'denied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."calendar_kind" AS ENUM('personal', 'department', 'room', 'course', 'college');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('class', 'office_hours', 'meeting', 'exam', 'booking', 'deadline', 'event', 'hold');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'scheduler', 'staff', 'faculty', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."section_status" AS ENUM('unscheduled', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."solver_status" AS ENUM('queued', 'solving', 'completed', 'failed', 'cancelled', 'applied');--> statement-breakpoint
CREATE TYPE "public"."term_date_kind" AS ENUM('holiday', 'deadline', 'finals', 'break', 'milestone');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"title" text NOT NULL,
	"purpose" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"attendee_count" integer DEFAULT 1 NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "buildings_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "calendar_members" (
	"calendar_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	CONSTRAINT "calendar_members_calendar_id_user_id_pk" PRIMARY KEY("calendar_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'azurite' NOT NULL,
	"kind" "calendar_kind" NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"owner_id" uuid,
	"department_id" uuid,
	"room_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"credits" smallint DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "event_attendees" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"response" text DEFAULT 'needs_action' NOT NULL,
	CONSTRAINT "event_attendees_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" "event_kind" DEFAULT 'meeting' NOT NULL,
	"status" "event_status" DEFAULT 'confirmed' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'America/Phoenix' NOT NULL,
	"rrule" text,
	"exdates" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"recur_until" timestamp with time zone,
	"recurrence_id" uuid,
	"original_start" timestamp with time zone,
	"room_id" uuid,
	"location_text" text,
	"organizer_id" uuid,
	"section_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"day" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"preference" "availability_pref" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"family" text NOT NULL,
	"days" text[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text,
	"capacity" integer NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" text DEFAULT 'classroom' NOT NULL,
	"bookable" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"schedulable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"section_number" text NOT NULL,
	"instructor_id" uuid,
	"enrollment_cap" integer NOT NULL,
	"allowed_patterns" text[] NOT NULL,
	"required_features" text[] DEFAULT '{}'::text[] NOT NULL,
	"cohorts" text[] DEFAULT '{}'::text[] NOT NULL,
	"meeting_pattern_id" uuid,
	"room_id" uuid,
	"locked" boolean DEFAULT false NOT NULL,
	"status" "section_status" DEFAULT 'unscheduled' NOT NULL,
	"published_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "solver_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"status" "solver_status" DEFAULT 'queued' NOT NULL,
	"seconds_limit" integer DEFAULT 30 NOT NULL,
	"score" text,
	"hard_score" integer,
	"soft_score" integer,
	"started_by" uuid,
	"summary" jsonb,
	"solution" jsonb,
	"analysis" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "term_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"label" text NOT NULL,
	"kind" "term_date_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"classes_end_on" date NOT NULL,
	"finals_start_on" date NOT NULL,
	"finals_end_on" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "terms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"netid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"affiliations" text[] DEFAULT '{}'::text[] NOT NULL,
	"roles" "role"[] DEFAULT '{viewer}'::role[] NOT NULL,
	"roles_locked" boolean DEFAULT false NOT NULL,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_netid_unique" UNIQUE("netid")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_availability" ADD CONSTRAINT "instructor_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_availability" ADD CONSTRAINT "instructor_availability_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_patterns" ADD CONSTRAINT "meeting_patterns_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_meeting_pattern_id_meeting_patterns_id_fk" FOREIGN KEY ("meeting_pattern_id") REFERENCES "public"."meeting_patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solver_runs" ADD CONSTRAINT "solver_runs_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solver_runs" ADD CONSTRAINT "solver_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_dates" ADD CONSTRAINT "term_dates_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "booking_requests_status_idx" ON "booking_requests" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_subject_number_uq" ON "courses" USING btree ("subject","number");--> statement-breakpoint
CREATE INDEX "event_attendees_user_idx" ON "event_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_calendar_start_idx" ON "events" USING btree ("calendar_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_room_start_idx" ON "events" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "events_recurrence_idx" ON "events" USING btree ("recurrence_id");--> statement-breakpoint
CREATE INDEX "events_section_idx" ON "events" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "instructor_availability_user_term_idx" ON "instructor_availability" USING btree ("user_id","term_id");--> statement-breakpoint
CREATE INDEX "meeting_patterns_term_idx" ON "meeting_patterns" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_building_number_uq" ON "rooms" USING btree ("building_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_course_term_number_uq" ON "sections" USING btree ("course_id","term_id","section_number");--> statement-breakpoint
CREATE INDEX "sections_term_idx" ON "sections" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "users_display_name_idx" ON "users" USING btree ("display_name");