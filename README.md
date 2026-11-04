# Scheduling

Internal scheduling calendar for the College of Science: classes, rooms, office hours, meetings
and deadlines in one place, with a Timefold constraint solver that builds conflict-free course
timetables. See [docs/PLAN.md](docs/PLAN.md) for the architecture and phased plan.

| Part | Stack | Port |
| --- | --- | --- |
| `apps/web` | Next.js 16, React 19, shadcn/ui (Radix), Tailwind v4, TanStack Query | 3000 |
| `apps/api` | Node 24, Fastify 5, Drizzle ORM, BullMQ, node-saml | 4000 |
| `services/solver` | Java 21+, Spring Boot 4.1, Timefold Solver 2.8 | 8095 |
| PostgreSQL 17 | Docker | 5544 |
| Redis 8 | Docker: sessions, cache, job queue, pub/sub | 6380 |
| SimpleSAMLphp test IdP | Docker, `saml` profile | 8085 |

The ports avoid ones already in use on the development machine (a local Postgres on 5433, another
app on 8090). Change them in `infra/docker-compose.yml` and `apps/api/.env` together.

## Run it

Prerequisites: Node 24, Docker Desktop, a JDK 21 or newer (Maven comes through the wrapper).

```bash
npm install
```

```bash
npm run infra:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run solver:build
```

```bash
npm run dev
```

Open http://localhost:3000. In the default `AUTH_MODE=dev` the sign-in page lists every seeded
person; pick one to see the app with their role:

| Person | Role | Good for trying |
| --- | --- | --- |
| Rosa Martinez | admin, staff | Everything, including Admin (people, rooms, terms) and approving room requests |
| Kevin Okafor | scheduler, staff | Schedule builder (solve, apply, publish Spring 2027), importing sections, anyone's availability |
| Priya Raman | staff (Chemistry) | Department calendar, room bookings |
| David Chen | faculty (Chemistry) | Teaching schedule, office hours, teaching availability |
| Jordan Lee | viewer (student) | Read-only access |

`npm run db:seed` resets everything: Fall 2026 is published as class events, Spring 2027 has
30 unscheduled sections (two locked in place) ready for the solver.

## Setting up a term

1. **Admin → Terms**: add the term, copying meeting patterns from the last one, then add its
   holidays, breaks and deadlines.
2. **Admin → Import sections**: load courses and sections from a CSV export. The file is
   checked first, and nothing is saved until you import it. See
   [docs/import-sections.md](docs/import-sections.md) for the columns.
3. **Availability**: instructors mark when they can't teach, would rather not, and prefer.
   Schedulers can see who hasn't and fill it in for them.
4. **Builder**: build the timetable, review it, apply it and publish it to the class calendars.

Admin → People, Departments and Rooms are for admins; Terms and Import are also open to
schedulers.

## Sign-in modes

Set `AUTH_MODE` in `apps/api/.env`.

- **`dev`**: user picker, refused when `NODE_ENV=production`.
- **`saml`**: the API is a SAML 2.0 service provider. Locally, `npm run infra:saml` starts a
  SimpleSAMLphp IdP with test personas (see `infra/simplesamlphp/authsources.php`; each password
  is `<netid>-test`). For production, register the SP with the campus Shibboleth IdP using the
  metadata at `/api/auth/saml/metadata`, then set `SAML_IDP_METADATA_URL` (or `SAML_IDP_SSO_URL`
  and `SAML_IDP_CERT`), `SAML_SP_ENTITY_ID`, `SAML_ACS_URL` and the admin/scheduler group names.
  Roles come from `eduPersonAffiliation` and `isMemberOf`; an admin can lock a person's roles.
- **`header`**: trust identity headers (`eppn`, `mail`, `displayName`, `affiliation`,
  `isMemberOf`) set by a Shibboleth SP module in Apache or IIS. Only requests from
  `HEADER_TRUSTED_PROXIES` are trusted.

## Tests

```bash
npm test
```

```bash
npm run solver:test
```

```bash
npm run typecheck
```

API tests cover recurrence expansion (including DST), role mapping, CSV parsing and section import
planning. Solver tests verify each
constraint with Timefold's `ConstraintVerifier`, and check that the review report adds up to
exactly the score Timefold computes.

## Notes

- **Time zone.** Everything is stored in UTC and shown in campus time (`America/Phoenix`), whatever
  the viewer's computer is set to. Recurring events expand in wall-clock time, so they stay
  correct in zones with daylight saving too.
- **Score explanations.** Timefold Solver 2.x moved built-in score analysis to its commercial
  edition, so `ScoreReport.java` re-applies the same rules to explain a solution.
  `ScoreReportTest` fails if the report and the solver's score ever disagree.
- **Branding.** Colors are tokens at the top of `apps/web/src/app/globals.css`; names and the
  monogram are in `apps/web/src/lib/brand.ts` (or `NEXT_PUBLIC_*` env vars).
