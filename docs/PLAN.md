# Wildcat Scheduling — build plan

An internal scheduling calendar for college administration and faculty. Admin staff use it for
daily work (meetings, room bookings, deadlines, approvals); faculty use it for classes, office
hours, exams and their own availability. A constraint engine (Timefold) builds conflict-free
course timetables for a term.

## Goals

| Audience | What they need to do |
| --- | --- |
| Admin staff | See every room and department calendar at once, book rooms, approve requests, publish term dates |
| Faculty | See their teaching schedule, post office hours, request rooms, declare teaching availability |
| Schedulers | Load a term's sections, run the solver, review conflicts, lock what's final, publish to calendars |

## Architecture

```
            ┌──────────────── Browser ────────────────┐
            │ Next.js 16 (App Router) + shadcn/ui     │
            │ Tailwind v4 · TanStack Query            │
            └───────────────┬─────────────────────────┘
                            │ /api/* (same-origin rewrite)
            ┌───────────────▼─────────────────────────┐        ┌──────────────────────┐
 SAML 2.0 ◄─┤ API — Node.js, Fastify 5, TypeScript    ├──HTTP──► Solver — Java 21,    │
 (Shibboleth│ Drizzle ORM · zod · node-saml · BullMQ  │        │ Spring Boot 4,       │
 IdP / SSP) │ RRULE expansion · conflict detection    │        │ Timefold Solver 2.8  │
            └──────┬──────────────────────┬───────────┘        └──────────────────────┘
                   │                      │
            ┌──────▼──────┐        ┌──────▼──────────────────────────┐
            │ PostgreSQL  │        │ Redis: sessions, cache, BullMQ   │
            │ 17          │        │ queue, pub/sub for live updates  │
            └─────────────┘        └──────────────────────────────────┘
```

Repository layout (npm workspaces):

```
apps/web          Next.js front end
apps/api          Fastify API, DB schema, migrations, seed, workers
packages/shared   zod schemas and types shared by web + api
services/solver   Timefold timetabling service (Maven, Spring Boot)
infra/            docker-compose: Postgres, Redis, SimpleSAMLphp test IdP, solver
docs/             this plan, decisions
```

### Key decisions

- **Time zone.** All instants are stored as `timestamptz` (UTC). Recurring events are expanded in
  their wall-clock zone (default `America/Phoenix`, which has no DST) and converted per occurrence,
  so the engine stays correct if a calendar is ever set to a DST zone.
- **Recurrence.** RFC 5545 `RRULE` strings plus `EXDATE`s on the event row; single-occurrence edits
  become override rows linked by `recurrence_id` + `original_start`. Expansion happens in the API and is
  cached in Redis per calendar and range, invalidated by a version counter.
- **Calendar views.** shadcn's `Calendar` (react-day-picker) drives the month picker and date inputs.
  The day/week/month/agenda scheduling grids are custom shadcn-style components, because the
  shadcn calendar is a date picker, not a scheduler.
- **Auth.** The API is a SAML 2.0 Service Provider (`@node-saml/node-saml`). Production points at the
  campus Shibboleth IdP; local development uses a SimpleSAMLphp IdP in Docker. A `header` mode trusts
  `REMOTE_USER`/`eppn` from a Shibboleth SP (Apache/IIS) if IT prefers that pattern, and a `dev` mode
  offers a user picker on localhost only. Sessions live in Redis.
- **Roles.** `admin`, `scheduler`, `staff`, `faculty`, `viewer`. Mapped from `eduPersonAffiliation`
  and `isMemberOf` group attributes, overridable in the admin screen.
- **Conflicts.** Two layers. The API checks room and instructor overlaps synchronously on every write
  (fast, for single events). Timefold handles the whole-term optimisation problem asynchronously.
- **Solver jobs.** API enqueues a BullMQ job → worker builds the problem from Postgres → posts to the
  solver → polls → stores the best solution and score analysis → publishes progress over Redis pub/sub,
  which the browser receives via Server-Sent Events.

## Data model (summary)

`users`, `departments`, `terms`, `term_dates`, `buildings`, `rooms`, `calendars`, `calendar_members`,
`events` (+ `rrule`, `exdates`, overrides), `event_attendees`, `booking_requests`, `courses`,
`sections`, `meeting_patterns`, `instructor_availability`, `solver_runs`, `audit_log`.

## Phases

### Phase 0 — Foundations
- Monorepo, TypeScript config, lint/format, env handling
- docker-compose: Postgres, Redis, SimpleSAMLphp IdP, solver
- Design tokens (brand palette, type scale), app shell
- **Done when:** `npm run dev` starts web + api against Dockerised Postgres/Redis.

### Phase 1 — Data and API
- Drizzle schema + migrations, realistic seed (a college with departments, buildings, rooms,
  faculty, a Fall term with sections, term dates)
- REST endpoints: me, calendars, events (CRUD + recurrence expansion), rooms + availability,
  terms, booking requests, sections
- RBAC middleware, zod validation, audit log, conflict detection on write
- Redis cache for expanded ranges
- **Done when:** seeded data can be queried and edited through the API with conflicts reported.

### Phase 2 — Calendar experience
- App shell: navigation rail, mini month (shadcn Calendar), calendar layer toggles
- Term ribbon: semester progress, holidays, deadlines, finals
- Week / day / month / agenda views; current-time line; click-drag to create; drag to move/resize
- Event editor (dialog) with recurrence, room picker with live availability, conflict warnings
- Rooms view: rooms × hours availability board
- Keyboard shortcuts (T, D/W/M/A, ←/→, N), responsive layout, dark mode
- **Done when:** faculty and admin can do day-to-day scheduling end to end.

### Phase 3 — Authentication and roles
- SAML SP (login, ACS, metadata, logout); SimpleSAMLphp test IdP with test personas
- Attribute → role mapping; Redis sessions; CSRF protection on mutating routes
- Header mode for Shibboleth SP deployments; dev-mode user picker
- **Done when:** sign-in via the test IdP lands the user in the app with the right role.

### Phase 4 — Constraint engine
- Timefold service: sections × (meeting pattern, room) assignment
  - Hard: room double-booking, instructor double-booking, cohort overlap, room capacity,
    required room features, instructor unavailability, meeting-pattern fit
  - Soft: instructor preferences, wasted seats, early/late slots, building changes
- Pinned (locked) sections, score analysis with justifications
- BullMQ job pipeline, SSE progress, Schedule Builder UI: run, watch score, inspect conflicts,
  accept → publish meetings as recurring class events on the course calendars
- **Done when:** a scheduler can solve the seeded term and publish the result.

### Phase 5 — Workflow and polish
- Room booking request → approval flow with notifications (email via campus SMTP)
- ICS export and subscribable feeds; Outlook/Google import
- Real-time updates across open tabs (SSE)
- Admin: users/roles, rooms, terms, meeting patterns
- Accessibility audit (WCAG 2.2 AA), Playwright end-to-end tests, load test on the room board
- Deployment: container images, health checks, backups, observability

## Status

As of 2026-11-04.

| Phase | Status | Verified | Still to do |
| --- | --- | --- | --- |
| 0 Foundations | Done | Monorepo, Docker services, design tokens, `npm run dev` runner | |
| 1 Data and API | Done | Schema and migration, seed, events CRUD with recurrence scopes, room and person conflicts, Redis cache, audit log | API integration tests (only unit tests exist) |
| 2 Calendar experience | Done | Day, week, month and agenda views, term ribbon, drag to create, move and resize, editor with repeat rules, room picker, live conflicts, Rooms board, light and dark themes | ICS import; phone layout not yet tested on a device |
| 3 Authentication | Done | SAML round trip against SimpleSAMLphp (assertion validation, replay rejection, return URL, provisioning, role mapping), dev mode | Header mode is written but untested; registering with the campus IdP |
| 4 Constraint engine | Done | Timefold service, 8 passing tests, BullMQ job, live progress, score review, apply, publish (holidays skipped) | |
| 5 Workflow and polish | Started | Room request approvals, live updates over SSE. Admin screens for people and roles, departments, buildings and rooms, terms, term dates and meeting patterns. Course and section CSV import with a checked preview ([format](import-sections.md)). Teaching availability editor for faculty, and for schedulers on anyone's behalf | Email notifications, ICS feeds, WCAG audit, Playwright tests, deployment |

### Findings along the way

- Timefold Solver 2.x made built-in score analysis a commercial feature. The service explains
  scores with its own `ScoreReport`, and a test checks it against Timefold's score.
- Timefold 2.x renamed several APIs (`allowsUnassigned`, `ai.timefold.solver.core.api.score.*`,
  `solveBuilder()`, `ConstraintRef.id()`); the code targets 2.8.0.
- Drizzle leaves table names off columns in single-table queries, so a correlated subquery
  written with `sql` and column objects compares a table with itself. Those subqueries name
  their tables by hand.
- Next.js 16 checks in development that every page can render on the server ("instant
  navigation"). A layout that waits for the signed-in user before rendering its page fails that
  check, so admin pages always render and show a placeholder until the browser takes over.
