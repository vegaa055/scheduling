import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  buildingInputSchema,
  departmentInputSchema,
  patternInputSchema,
  roomInputSchema,
  ROLES,
  sectionImportSchema,
  termDateInputSchema,
  termInputSchema,
  userCreateSchema,
  userPatchSchema,
  type AdminUserDTO,
  type BuildingDTO,
  type DepartmentDTO,
  type Role,
} from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { requireUser } from "../auth/session.ts";
import { requireRole } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { bump } from "../lib/cache.ts";
import { parseCsv, toCsv } from "../lib/csv.ts";
import { badRequest, HttpError, notFound } from "../lib/errors.ts";
import { publish } from "../lib/pubsub.ts";
import { EXPORT_HEADER, planImport, type ExistingSection } from "../lib/section-import.ts";
import { roomList, termList } from "./directory.ts";

const { users, departments, calendars, buildings, rooms, terms, termDates, meetingPatterns, courses, sections, events, bookingRequests } =
  schema;

const conflict = (message: string) => new HttpError(409, "conflict", message);

/** Postgres unique violations, whether or not Drizzle wraps the driver error. */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
async function unique<T>(run: () => Promise<T>, message: string): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(message);
    throw e;
  }
}

const idParam = z.object({ id: z.uuid() });
const roomCalendarName = (buildingCode: string, number: string, name: string | null) =>
  `${buildingCode} ${number}${name ? ` · ${name}` : ""}`;

async function adminUser(id: string): Promise<AdminUserDTO> {
  const [row] = await userQuery().where(eq(users.id, id));
  if (!row) throw notFound("Person");
  return toAdminUser(row);
}
const userQuery = () =>
  db.select({ u: users, departmentName: departments.name }).from(users).leftJoin(departments, eq(departments.id, users.departmentId));
const toAdminUser = ({ u, departmentName }: { u: typeof users.$inferSelect; departmentName: string | null }): AdminUserDTO => ({
  id: u.id,
  netid: u.netid,
  email: u.email,
  displayName: u.displayName,
  title: u.title,
  roles: u.roles as Role[],
  rolesLocked: u.rolesLocked,
  affiliations: u.affiliations,
  departmentId: u.departmentId,
  departmentName,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
});

export async function adminRoutes(app: FastifyInstance) {
  /* ---------------- People ---------------- */

  app.get("/admin/users", async (req) => {
    requireRole(requireUser(req), "admin");
    const q = z.object({ q: z.string().max(80).default(""), role: z.enum(ROLES).optional() }).parse(req.query);
    const term = `%${q.q.trim()}%`;
    const rows = await userQuery()
      .where(
        and(
          q.q.trim() ? or(ilike(users.displayName, term), ilike(users.netid, term), ilike(users.email, term)) : undefined,
          q.role ? sql`${q.role}::role = any(${users.roles})` : undefined,
        ),
      )
      .orderBy(asc(users.displayName))
      .limit(500);
    return rows.map(toAdminUser);
  });

  /** Adds a person ahead of their first sign-in, e.g. a new instructor to assign to sections. */
  app.post("/admin/users", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const body = userCreateSchema.parse(req.body);
    const created = await unique(
      () =>
        db.transaction(async (tx) => {
          const [u] = await tx
            .insert(users)
            .values({ ...body, departmentId: body.departmentId ?? null, rolesLocked: true })
            .returning({ id: users.id });
          await tx.insert(calendars).values({ name: body.displayName, kind: "personal", ownerId: u!.id, isPublic: false, color: "mesa" });
          return u!;
        }),
      `Someone with NetID "${body.netid}" is already here.`,
    );
    await audit(me.id, "create", "user", created.id, body);
    reply.code(201);
    return adminUser(created.id);
  });

  app.patch("/admin/users/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const { id } = idParam.parse(req.params);
    const body = userPatchSchema.parse(req.body);
    if (id === me.id && body.roles && !body.roles.includes("admin")) {
      throw badRequest("You can't remove your own admin role. Ask another admin to do it.");
    }
    const set: Partial<typeof users.$inferInsert> = {};
    if (body.displayName !== undefined) set.displayName = body.displayName;
    if (body.email !== undefined) set.email = body.email;
    if (body.title !== undefined) set.title = body.title || null;
    if (body.departmentId !== undefined) set.departmentId = body.departmentId;
    if (body.roles) {
      set.roles = [...new Set(body.roles)];
      // Roles an admin chose shouldn't be overwritten at the next sign-in.
      set.rolesLocked = body.rolesLocked ?? true;
    } else if (body.rolesLocked !== undefined) {
      set.rolesLocked = body.rolesLocked;
    }
    if (Object.keys(set).length === 0) return adminUser(id);
    const res = await db.update(users).set(set).where(eq(users.id, id)).returning({ id: users.id });
    if (!res.length) throw notFound("Person");
    await audit(me.id, "update", "user", id, body);
    return adminUser(id);
  });

  /* ---------------- Departments ---------------- */

  app.get("/admin/departments", async (req): Promise<DepartmentDTO[]> => {
    requireRole(requireUser(req), "admin", "scheduler");
    return db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        // Drizzle leaves table names off columns in single-table queries, so qualify by hand.
        people: sql<number>`(select count(*)::int from users u where u.department_id = "departments"."id")`,
        courses: sql<number>`(select count(*)::int from courses c where c.department_id = "departments"."id")`,
      })
      .from(departments)
      .orderBy(asc(departments.name));
  });

  /** A department comes with its own calendar and a class calendar that published sections go to. */
  app.post("/admin/departments", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const body = departmentInputSchema.parse(req.body);
    const dept = await unique(
      () =>
        db.transaction(async (tx) => {
          const [d] = await tx.insert(departments).values(body).returning();
          await tx.insert(calendars).values([
            { name: d!.name, kind: "department", departmentId: d!.id, color: "azurite" },
            { name: `${d!.code} classes`, kind: "course", departmentId: d!.id, color: "azurite", description: `Published class meetings for ${d!.name}` },
          ]);
          return d!;
        }),
      `There's already a department with code ${body.code}.`,
    );
    await audit(me.id, "create", "department", dept.id, body);
    reply.code(201);
    return dept;
  });

  app.patch("/admin/departments/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const { id } = idParam.parse(req.params);
    const body = departmentInputSchema.parse(req.body);
    const dept = await unique(
      () =>
        db.transaction(async (tx) => {
          const [d] = await tx.update(departments).set(body).where(eq(departments.id, id)).returning();
          if (!d) throw notFound("Department");
          await tx.update(calendars).set({ name: d.name }).where(and(eq(calendars.departmentId, id), eq(calendars.kind, "department")));
          await tx
            .update(calendars)
            .set({ name: `${d.code} classes`, description: `Published class meetings for ${d.name}` })
            .where(and(eq(calendars.departmentId, id), eq(calendars.kind, "course")));
          return d;
        }),
      `There's already a department with code ${body.code}.`,
    );
    await audit(me.id, "update", "department", id, body);
    return dept;
  });

  /* ---------------- Buildings and rooms ---------------- */

  app.get("/admin/buildings", async (req): Promise<BuildingDTO[]> => {
    requireRole(requireUser(req), "admin");
    return db
      .select({
        id: buildings.id,
        code: buildings.code,
        name: buildings.name,
        rooms: sql<number>`(select count(*)::int from rooms r where r.building_id = "buildings"."id")`,
      })
      .from(buildings)
      .orderBy(asc(buildings.code));
  });

  app.post("/admin/buildings", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const body = buildingInputSchema.parse(req.body);
    const [b] = await unique(() => db.insert(buildings).values(body).returning(), `There's already a building with code ${body.code}.`);
    await audit(me.id, "create", "building", b!.id, body);
    reply.code(201);
    return b;
  });

  app.patch("/admin/buildings/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const { id } = idParam.parse(req.params);
    const body = buildingInputSchema.parse(req.body);
    const b = await unique(
      () =>
        db.transaction(async (tx) => {
          const [b] = await tx.update(buildings).set(body).where(eq(buildings.id, id)).returning();
          if (!b) throw notFound("Building");
          // Room calendars are named after their building code.
          const its = await tx.select().from(rooms).where(eq(rooms.buildingId, id));
          for (const r of its) {
            await tx.update(calendars).set({ name: roomCalendarName(b.code, r.number, r.name) }).where(eq(calendars.roomId, r.id));
          }
          return b;
        }),
      `There's already a building with code ${body.code}.`,
    );
    await bump("rooms-list", "rooms");
    await audit(me.id, "update", "building", id, body);
    return b;
  });

  const roomDTO = async (id: string) => (await roomList()).find((r) => r.id === id)!;

  /** Each room gets a calendar, which is where its bookings live. */
  app.post("/admin/rooms", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const body = roomInputSchema.parse(req.body);
    const [b] = await db.select().from(buildings).where(eq(buildings.id, body.buildingId));
    if (!b) throw badRequest("Pick a building");
    const room = await unique(
      () =>
        db.transaction(async (tx) => {
          const [r] = await tx.insert(rooms).values({ ...body, features: [...new Set(body.features)] }).returning();
          await tx.insert(calendars).values({ name: roomCalendarName(b.code, r!.number, r!.name), kind: "room", roomId: r!.id, color: "sage" });
          return r!;
        }),
      `${b.code} ${body.number} already exists.`,
    );
    await bump("rooms-list", "rooms");
    await audit(me.id, "create", "room", room.id, body);
    reply.code(201);
    return roomDTO(room.id);
  });

  app.put("/admin/rooms/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const { id } = idParam.parse(req.params);
    const body = roomInputSchema.parse(req.body);
    const [b] = await db.select().from(buildings).where(eq(buildings.id, body.buildingId));
    if (!b) throw badRequest("Pick a building");
    await unique(
      () =>
        db.transaction(async (tx) => {
          const res = await tx
            .update(rooms)
            .set({ ...body, features: [...new Set(body.features)] })
            .where(eq(rooms.id, id))
            .returning({ id: rooms.id });
          if (!res.length) throw notFound("Room");
          await tx.update(calendars).set({ name: roomCalendarName(b.code, body.number, body.name ?? null) }).where(eq(calendars.roomId, id));
        }),
      `${b.code} ${body.number} already exists.`,
    );
    await bump("rooms-list", "rooms");
    await audit(me.id, "update", "room", id, body);
    return roomDTO(id);
  });

  /** Only rooms nothing refers to can be deleted; others can be taken out of booking and scheduling. */
  app.delete("/admin/rooms/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin");
    const { id } = idParam.parse(req.params);
    const [[ev], [sec], [bk]] = await Promise.all([
      db.select({ n: count() }).from(events).where(eq(events.roomId, id)),
      db.select({ n: count() }).from(sections).where(eq(sections.roomId, id)),
      db.select({ n: count() }).from(bookingRequests).where(eq(bookingRequests.roomId, id)),
    ]);
    const used = [
      ev!.n && `${ev!.n} event${ev!.n === 1 ? "" : "s"}`,
      sec!.n && `${sec!.n} section${sec!.n === 1 ? "" : "s"}`,
      bk!.n && `${bk!.n} room request${bk!.n === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (used.length) {
      const list = used.length > 1 ? `${used.slice(0, -1).join(", ")} and ${used.at(-1)}` : used[0];
      throw conflict(`This room has ${list}. Turn off booking and class scheduling instead, so its history stays.`);
    }
    const res = await db.delete(rooms).where(eq(rooms.id, id)).returning({ id: rooms.id });
    if (!res.length) throw notFound("Room");
    await bump("rooms-list", "rooms");
    await audit(me.id, "delete", "room", id);
    return { ok: true };
  });

  /* ---------------- Terms and term dates ---------------- */

  const termDTO = async (id: string) => (await termList()).find((t) => t.id === id)!;

  app.post("/admin/terms", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { copyPatternsFrom, ...body } = termInputSchema.parse(req.body);
    const term = await unique(
      () =>
        db.transaction(async (tx) => {
          if (body.isCurrent) await tx.update(terms).set({ isCurrent: false });
          const [t] = await tx.insert(terms).values(body).returning();
          if (copyPatternsFrom) {
            const src = await tx.select().from(meetingPatterns).where(eq(meetingPatterns.termId, copyPatternsFrom));
            if (src.length) {
              await tx
                .insert(meetingPatterns)
                .values(src.map((p) => ({ termId: t!.id, family: p.family, days: p.days, startTime: p.startTime, endTime: p.endTime })));
            }
          }
          return t!;
        }),
      `There's already a term with code ${body.code}.`,
    );
    await bump("terms");
    await audit(me.id, "create", "term", term.id, { ...body, copyPatternsFrom });
    reply.code(201);
    return termDTO(term.id);
  });

  app.put("/admin/terms/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const { copyPatternsFrom: _ignored, ...body } = termInputSchema.parse(req.body);
    await unique(
      () =>
        db.transaction(async (tx) => {
          if (body.isCurrent) await tx.update(terms).set({ isCurrent: false }).where(ne(terms.id, id));
          const res = await tx.update(terms).set(body).where(eq(terms.id, id)).returning({ id: terms.id });
          if (!res.length) throw notFound("Term");
        }),
      `There's already a term with code ${body.code}.`,
    );
    await bump("terms");
    await audit(me.id, "update", "term", id, body);
    return termDTO(id);
  });

  app.post("/admin/terms/:id/dates", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const body = termDateInputSchema.parse(req.body);
    const [term] = await db.select({ id: terms.id }).from(terms).where(eq(terms.id, id));
    if (!term) throw notFound("Term");
    const [d] = await db
      .insert(termDates)
      .values({ ...body, endsOn: body.endsOn || null, termId: id })
      .returning();
    await bump("terms");
    await audit(me.id, "create", "term_date", d!.id, body);
    reply.code(201);
    return d;
  });

  app.put("/admin/term-dates/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const body = termDateInputSchema.parse(req.body);
    const [d] = await db
      .update(termDates)
      .set({ ...body, endsOn: body.endsOn || null })
      .where(eq(termDates.id, id))
      .returning();
    if (!d) throw notFound("Date");
    await bump("terms");
    await audit(me.id, "update", "term_date", id, body);
    return d;
  });

  app.delete("/admin/term-dates/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const res = await db.delete(termDates).where(eq(termDates.id, id)).returning();
    if (!res.length) throw notFound("Date");
    await bump("terms");
    await audit(me.id, "delete", "term_date", id, res[0]);
    return { ok: true };
  });

  /* ---------------- Meeting patterns ---------------- */

  const inUse = async (patternId: string) =>
    (await db.select({ n: count() }).from(sections).where(eq(sections.meetingPatternId, patternId)))[0]!.n;

  app.post("/admin/terms/:id/patterns", async (req, reply) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const body = patternInputSchema.parse(req.body);
    const days = [...new Set(body.days)];
    const dup = await db
      .select({ id: meetingPatterns.id })
      .from(meetingPatterns)
      .where(
        and(
          eq(meetingPatterns.termId, id),
          eq(meetingPatterns.family, body.family),
          eq(meetingPatterns.startTime, body.startTime),
          eq(meetingPatterns.endTime, body.endTime),
          sql`${meetingPatterns.days} = ${sql.param(days)}::text[]`,
        ),
      );
    if (dup.length) throw conflict("That meeting pattern already exists for this term.");
    const [p] = await db.insert(meetingPatterns).values({ ...body, days, termId: id }).returning();
    await audit(me.id, "create", "meeting_pattern", p!.id, body);
    reply.code(201);
    return p;
  });

  app.delete("/admin/patterns/:id", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const n = await inUse(id);
    if (n) throw conflict(`${n} section${n === 1 ? " is" : "s are"} placed in this pattern. Move ${n === 1 ? "it" : "them"} first.`);
    const res = await db.delete(meetingPatterns).where(eq(meetingPatterns.id, id)).returning();
    if (!res.length) throw notFound("Meeting pattern");
    await audit(me.id, "delete", "meeting_pattern", id, res[0]);
    return { ok: true };
  });

  /** Copies another term's patterns, skipping ones this term already has. */
  app.post("/admin/terms/:id/patterns/copy", async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const { fromTermId } = z.object({ fromTermId: z.uuid() }).parse(req.body);
    if (fromTermId === id) throw badRequest("Pick a different term to copy from");
    const key = (p: { family: string; days: string[]; startTime: string; endTime: string }) =>
      `${p.family}|${p.days.join(",")}|${p.startTime.slice(0, 5)}|${p.endTime.slice(0, 5)}`;
    const [src, have] = await Promise.all([
      db.select().from(meetingPatterns).where(eq(meetingPatterns.termId, fromTermId)),
      db.select().from(meetingPatterns).where(eq(meetingPatterns.termId, id)),
    ]);
    const existing = new Set(have.map(key));
    const add = src.filter((p) => !existing.has(key(p)));
    if (add.length) {
      await db
        .insert(meetingPatterns)
        .values(add.map((p) => ({ termId: id, family: p.family, days: p.days, startTime: p.startTime, endTime: p.endTime })));
    }
    await audit(me.id, "copy", "meeting_pattern", id, { fromTermId, copied: add.length });
    return { copied: add.length };
  });

  /* ---------------- Course and section import ---------------- */

  async function importContext(termId: string) {
    const [term] = await db.select().from(terms).where(eq(terms.id, termId));
    if (!term) throw notFound("Term");
    const [depts, courseRows, people, patterns, roomRows, sectionRows] = await Promise.all([
      db.select().from(departments),
      db.select().from(courses),
      db.select({ id: users.id, netid: users.netid }).from(users),
      db.select({ family: meetingPatterns.family }).from(meetingPatterns).where(eq(meetingPatterns.termId, termId)),
      db.select({ features: rooms.features }).from(rooms).where(eq(rooms.schedulable, true)),
      db.select().from(sections).where(eq(sections.termId, termId)),
    ]);
    return {
      termName: term.name,
      departments: new Map(depts.map((d) => [d.code, d.id])),
      courses: new Map(
        courseRows.map((c) => [`${c.subject} ${c.number}`, { id: c.id, title: c.title, credits: c.credits, departmentId: c.departmentId }]),
      ),
      people: new Map(people.map((p) => [p.netid, p.id])),
      patternFamilies: new Set(patterns.map((p) => p.family)),
      roomFeatures: new Set(roomRows.flatMap((r) => r.features)),
      sections: new Map<string, ExistingSection>(
        sectionRows.map((s) => [
          `${s.courseId}|${s.sectionNumber}`,
          {
            id: s.id,
            instructorId: s.instructorId,
            enrollmentCap: s.enrollmentCap,
            allowedPatterns: s.allowedPatterns,
            requiredFeatures: s.requiredFeatures,
            cohorts: s.cohorts,
            status: s.status,
          },
        ]),
      ),
    };
  }

  /**
   * Checks a CSV of courses and sections against the term. With `apply: false` it only reports
   * what would change; with `apply: true` it makes every change in one transaction, or none if
   * the file has errors.
   */
  app.post("/admin/terms/:id/import", { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const me = requireUser(req);
    requireRole(me, "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const body = sectionImportSchema.parse(req.body);
    const ctx = await importContext(id);
    const plan = planImport(parseCsv(body.csv), ctx);
    if (!body.apply || plan.result.errors.length > 0) return plan.result;

    await db.transaction(async (tx) => {
      const personId = new Map(ctx.people);
      if (plan.newPeople.length) {
        const created = await tx
          .insert(users)
          .values(plan.newPeople.map((p) => ({ ...p, roles: ["faculty" as const] })))
          .returning({ id: users.id, netid: users.netid, displayName: users.displayName });
        await tx
          .insert(calendars)
          .values(created.map((u) => ({ name: u.displayName, kind: "personal" as const, ownerId: u.id, isPublic: false, color: "mesa" })));
        for (const u of created) personId.set(u.netid, u.id);
      }
      const courseId = new Map([...ctx.courses].map(([k, c]) => [k, c.id]));
      if (plan.newCourses.length) {
        const created = await tx
          .insert(courses)
          .values(plan.newCourses.map(({ key: _key, ...c }) => c))
          .returning({ id: courses.id, subject: courses.subject, number: courses.number });
        for (const c of created) courseId.set(`${c.subject} ${c.number}`, c.id);
      }
      for (const { id: cid, ...change } of plan.courseUpdates) {
        await tx.update(courses).set(change).where(eq(courses.id, cid));
      }
      const instructor = (netid: string | null | undefined) =>
        netid === undefined ? undefined : netid === null ? null : (personId.get(netid) ?? null);
      if (plan.newSections.length) {
        await tx.insert(sections).values(
          plan.newSections.map((s) => ({
            courseId: courseId.get(s.courseKey)!,
            termId: id,
            sectionNumber: s.sectionNumber,
            instructorId: instructor(s.instructorNetid) ?? null,
            enrollmentCap: s.enrollmentCap,
            allowedPatterns: s.allowedPatterns,
            requiredFeatures: s.requiredFeatures ?? [],
            cohorts: s.cohorts ?? [],
          })),
        );
      }
      for (const s of plan.sectionUpdates) {
        const next = instructor(s.instructorNetid);
        await tx
          .update(sections)
          .set({
            enrollmentCap: s.enrollmentCap,
            allowedPatterns: s.allowedPatterns,
            ...(next !== undefined ? { instructorId: next } : {}),
            ...(s.requiredFeatures ? { requiredFeatures: s.requiredFeatures } : {}),
            ...(s.cohorts ? { cohorts: s.cohorts } : {}),
          })
          .where(eq(sections.id, s.id));
      }
    });
    await audit(me.id, "import", "sections", id, {
      rows: plan.result.rows,
      courses: plan.result.courses,
      sections: plan.result.sections,
      newPeople: plan.result.newPeople,
    });
    await publish({ type: "sections.changed", termId: id });
    return { ...plan.result, applied: true };
  });

  /** The term's sections in the import format, to edit in a spreadsheet and import again. */
  app.get("/admin/terms/:id/sections.csv", async (req, reply) => {
    requireRole(requireUser(req), "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const [term] = await db.select().from(terms).where(eq(terms.id, id));
    if (!term) throw notFound("Term");
    const instructor = alias(users, "instructor");
    const rows = await db
      .select({ s: sections, c: courses, d: departments, netid: instructor.netid, name: instructor.displayName })
      .from(sections)
      .innerJoin(courses, eq(courses.id, sections.courseId))
      .innerJoin(departments, eq(departments.id, courses.departmentId))
      .leftJoin(instructor, eq(instructor.id, sections.instructorId))
      .where(eq(sections.termId, id))
      .orderBy(asc(courses.subject), asc(courses.number), asc(sections.sectionNumber));
    const csv = toCsv([
      [...EXPORT_HEADER],
      ...rows.map(({ s, c, d, netid, name }) => [
        c.subject,
        c.number,
        c.title,
        d.code,
        c.credits,
        s.sectionNumber,
        netid,
        name,
        s.enrollmentCap,
        s.allowedPatterns.join(" "),
        s.requiredFeatures.join(" "),
        s.cohorts.join(" "),
      ]),
    ]);
    const filename = `${term.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-sections.csv`;
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${filename}"`);
    return csv;
  });

  /* ---------------- Availability overview for schedulers ---------------- */

  /** Instructors teaching in the term and how many availability blocks each has set. */
  app.get("/terms/:id/availability/summary", async (req) => {
    requireRole(requireUser(req), "admin", "scheduler");
    const { id } = idParam.parse(req.params);
    const teaching = await db
      .selectDistinct({ id: users.id, displayName: users.displayName, netid: users.netid })
      .from(sections)
      .innerJoin(users, eq(users.id, sections.instructorId))
      .where(eq(sections.termId, id))
      .orderBy(asc(users.displayName));
    const ids = teaching.map((t) => t.id);
    const counts = ids.length
      ? await db
          .select({ userId: schema.instructorAvailability.userId, n: count() })
          .from(schema.instructorAvailability)
          .where(and(eq(schema.instructorAvailability.termId, id), inArray(schema.instructorAvailability.userId, ids)))
          .groupBy(schema.instructorAvailability.userId)
      : [];
    const byUser = new Map(counts.map((c) => [c.userId, c.n]));
    return teaching.map((t) => ({ ...t, blocks: byUser.get(t.id) ?? 0 }));
  });
}
