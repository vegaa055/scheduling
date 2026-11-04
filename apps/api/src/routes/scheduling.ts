import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  availabilityBlockSchema,
  solverRunInputSchema,
  type AvailabilityBlockDTO,
  type DayCode,
  type PatternDTO,
  type SectionDTO,
  type SolverRunDTO,
} from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { requireUser } from "../auth/session.ts";
import { hasRole, requireRole } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.ts";
import { roomLabelSql } from "../lib/occurrences.ts";
import { publish } from "../lib/pubsub.ts";
import { publishTerm } from "../lib/publish.ts";
import { requestCancel, solveQueue } from "../jobs/queue.ts";
import { solver } from "../solver/client.ts";

const { sections, courses, users, meetingPatterns, rooms, buildings, solverRuns } = schema;

const DAY_LABEL: Record<string, string> = { MO: "M", TU: "T", WE: "W", TH: "R", FR: "F", SA: "S", SU: "U" };

const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return m === 0 ? `${hh}${suffix}` : `${hh}:${String(m).padStart(2, "0")}${suffix}`;
};
export const patternLabel = (p: { days: string[]; startTime: string; endTime: string }) =>
  `${p.days.map((d) => DAY_LABEL[d] ?? d).join("")} ${fmtTime(p.startTime)}–${fmtTime(p.endTime)}`;

async function listSections(termId: string, where?: ReturnType<typeof eq>): Promise<SectionDTO[]> {
  const instructor = alias(users, "instructor");
  const rows = await db
    .select({ s: sections, c: courses, instructorName: instructor.displayName, p: meetingPatterns, roomLabel: roomLabelSql })
    .from(sections)
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .leftJoin(instructor, eq(instructor.id, sections.instructorId))
    .leftJoin(meetingPatterns, eq(meetingPatterns.id, sections.meetingPatternId))
    .leftJoin(rooms, eq(rooms.id, sections.roomId))
    .leftJoin(buildings, eq(buildings.id, rooms.buildingId))
    .where(where ? and(eq(sections.termId, termId), where) : eq(sections.termId, termId))
    .orderBy(asc(courses.subject), asc(courses.number), asc(sections.sectionNumber));
  return rows.map(({ s, c, instructorName, p, roomLabel }) => ({
    id: s.id,
    courseId: c.id,
    subject: c.subject,
    number: c.number,
    courseTitle: c.title,
    sectionNumber: s.sectionNumber,
    instructorId: s.instructorId,
    instructorName,
    enrollmentCap: s.enrollmentCap,
    allowedPatterns: s.allowedPatterns,
    requiredFeatures: s.requiredFeatures,
    cohorts: s.cohorts,
    meetingPatternId: s.meetingPatternId,
    meetingPatternLabel: p ? patternLabel(p) : null,
    roomId: s.roomId,
    roomLabel,
    locked: s.locked,
    status: s.status,
  }));
}

function runDTO(r: typeof solverRuns.$inferSelect, detail = false): SolverRunDTO {
  const summary = (r.summary ?? null) as (SolverRunDTO["summary"] & { solverJobId?: string }) | null;
  return {
    id: r.id,
    termId: r.termId,
    status: r.status,
    score: r.score,
    hardScore: r.hardScore,
    softScore: r.softScore,
    secondsLimit: r.secondsLimit,
    startedBy: r.startedBy,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    error: r.error,
    summary: summary && "sections" in summary ? summary : null,
    ...(detail
      ? {
          constraints: (r.analysis as SolverRunDTO["constraints"]) ?? [],
          assignments: ((r.solution as { sectionId: string; timeslotId: string | null; roomId: string | null }[]) ?? []).map(
            (a) => ({ sectionId: a.sectionId, meetingPatternId: a.timeslotId, roomId: a.roomId }),
          ),
        }
      : {}),
  };
}

export async function schedulingRoutes(app: FastifyInstance) {
  app.get("/terms/:id/sections", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    if (hasRole(user, "admin", "scheduler", "staff")) return listSections(id);
    if (hasRole(user, "faculty")) return listSections(id, eq(sections.instructorId, user.id));
    throw forbidden();
  });

  app.get("/terms/:id/patterns", async (req): Promise<PatternDTO[]> => {
    requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const rows = await db
      .select({
        p: meetingPatterns,
        // Qualified by hand: Drizzle leaves table names off columns in single-table queries.
        sectionCount: sql<number>`(select count(*)::int from sections s where s.meeting_pattern_id = "meeting_patterns"."id")`,
      })
      .from(meetingPatterns)
      .where(eq(meetingPatterns.termId, id))
      .orderBy(asc(meetingPatterns.family), asc(meetingPatterns.startTime));
    return rows.map(({ p, sectionCount }) => ({
      id: p.id,
      termId: p.termId,
      family: p.family,
      days: p.days as DayCode[],
      startTime: p.startTime.slice(0, 5),
      endTime: p.endTime.slice(0, 5),
      label: patternLabel(p),
      sectionCount,
    }));
  });

  /** Manual placement and locking. */
  app.patch("/sections/:id", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({
        locked: z.boolean().optional(),
        meetingPatternId: z.uuid().nullable().optional(),
        roomId: z.uuid().nullable().optional(),
      })
      .parse(req.body);
    const [s] = await db.select().from(sections).where(eq(sections.id, id));
    if (!s) throw notFound("Section");
    const next = { ...s, ...body };
    const status = next.meetingPatternId && next.roomId ? (s.status === "published" ? "published" : "scheduled") : "unscheduled";
    await db.update(sections).set({ ...body, status }).where(eq(sections.id, id));
    await audit(user.id, "update", "section", id, body);
    await publish({ type: "sections.changed", termId: s.termId });
    const [dto] = await listSections(s.termId, eq(sections.id, id));
    return dto;
  });

  /* ---------------- Instructor availability ---------------- */

  app.get("/terms/:id/availability", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { userId } = z.object({ userId: z.uuid().optional() }).parse(req.query);
    const target = userId ?? user.id;
    if (target !== user.id) requireRole(user, "admin", "scheduler");
    const rows = await db
      .select()
      .from(schema.instructorAvailability)
      .where(and(eq(schema.instructorAvailability.termId, id), eq(schema.instructorAvailability.userId, target)))
      .orderBy(asc(schema.instructorAvailability.day), asc(schema.instructorAvailability.startTime));
    return rows.map<AvailabilityBlockDTO>((r) => ({
      day: r.day as DayCode,
      startTime: r.startTime.slice(0, 5),
      endTime: r.endTime.slice(0, 5),
      preference: r.preference,
    }));
  });

  app.put("/terms/:id/availability", async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({
        userId: z.uuid().optional(),
        blocks: z.array(availabilityBlockSchema).max(200),
      })
      .parse(req.body);
    const target = body.userId ?? user.id;
    if (target !== user.id) requireRole(user, "admin", "scheduler");
    else requireRole(user, "faculty", "admin", "scheduler");
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.instructorAvailability)
        .where(and(eq(schema.instructorAvailability.termId, id), eq(schema.instructorAvailability.userId, target)));
      if (body.blocks.length) {
        await tx
          .insert(schema.instructorAvailability)
          .values(body.blocks.map((b) => ({ ...b, termId: id, userId: target })));
      }
    });
    await audit(user.id, "update", "availability", target, { termId: id, blocks: body.blocks.length });
    return { ok: true };
  });

  /* ---------------- Solver runs ---------------- */

  app.get("/solver/health", async (req) => {
    requireUser(req);
    return { ok: await solver.health() };
  });

  app.get("/solver/runs", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const { termId } = z.object({ termId: z.uuid() }).parse(req.query);
    const rows = await db
      .select()
      .from(solverRuns)
      .where(eq(solverRuns.termId, termId))
      .orderBy(desc(solverRuns.createdAt))
      .limit(20);
    return rows.map((r) => runDTO(r));
  });

  app.get("/solver/runs/:id", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [r] = await db.select().from(solverRuns).where(eq(solverRuns.id, id));
    if (!r) throw notFound("Solver run");
    return runDTO(r, true);
  });

  app.post("/solver/runs", async (req, reply) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const input = solverRunInputSchema.parse(req.body);
    const active = await db
      .select({ id: solverRuns.id })
      .from(solverRuns)
      .where(and(eq(solverRuns.termId, input.termId), inArray(solverRuns.status, ["queued", "solving"])));
    if (active.length) throw new HttpError(409, "already_solving", "A solve is already running for this term");
    const [run] = await db
      .insert(solverRuns)
      .values({ termId: input.termId, secondsLimit: input.secondsLimit, startedBy: user.id })
      .returning();
    await solveQueue.add("solve", { runId: run!.id }, { jobId: run!.id, removeOnComplete: 100, removeOnFail: 100 });
    await audit(user.id, "start", "solver_run", run!.id, input);
    reply.code(202);
    return runDTO(run!);
  });

  app.post("/solver/runs/:id/stop", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await requestCancel(id);
    return { ok: true };
  });

  /** Copies a run's assignments onto the sections (locked sections are left as they are). */
  app.post("/solver/runs/:id/apply", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [r] = await db.select().from(solverRuns).where(eq(solverRuns.id, id));
    if (!r) throw notFound("Solver run");
    if (r.status !== "completed" && r.status !== "cancelled") throw badRequest("Only finished runs can be applied");
    const assignments = (r.solution ?? []) as { sectionId: string; timeslotId: string | null; roomId: string | null }[];
    const current = await db.select().from(sections).where(eq(sections.termId, r.termId));
    const byId = new Map(current.map((s) => [s.id, s]));
    let changedCount = 0;
    await db.transaction(async (tx) => {
      for (const a of assignments) {
        const s = byId.get(a.sectionId);
        if (!s || s.locked) continue;
        if (s.meetingPatternId === a.timeslotId && s.roomId === a.roomId) continue;
        changedCount++;
        await tx
          .update(sections)
          .set({
            meetingPatternId: a.timeslotId,
            roomId: a.roomId,
            status: a.timeslotId && a.roomId ? "scheduled" : "unscheduled",
          })
          .where(eq(sections.id, a.sectionId));
      }
      await tx.update(solverRuns).set({ status: "applied" }).where(eq(solverRuns.id, id));
    });
    await audit(user.id, "apply", "solver_run", id, { changed: changedCount });
    await publish({ type: "sections.changed", termId: r.termId });
    return { ok: true, changed: changedCount };
  });

  /**
   * Publishes scheduled sections as weekly recurring class events on each department's
   * course calendar, skipping holidays and breaks.
   */
  app.post("/terms/:id/publish", async (req) => {
    const user = requireUser(req);
    requireRole(user, "admin", "scheduler");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const published = await publishTerm(id);
    await audit(user.id, "publish", "term", id, { published });
    return { ok: true, published };
  });
}
