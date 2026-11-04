import { asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";

/**
 * Contract with the Timefold service (services/solver). Times are campus wall-clock "HH:mm".
 */
export interface TimeslotJson {
  id: string;
  family: string;
  days: string[];
  start: string;
  end: string;
}
export interface RoomJson {
  id: string;
  label: string;
  building: string;
  capacity: number;
  features: string[];
}
export interface SectionJson {
  id: string;
  label: string;
  instructorId: string | null;
  instructorName: string | null;
  enrollmentCap: number;
  allowedFamilies: string[];
  requiredFeatures: string[];
  cohorts: string[];
  pinned: boolean;
  timeslotId: string | null;
  roomId: string | null;
}
export interface AvailabilityJson {
  instructorId: string;
  day: string;
  start: string;
  end: string;
  preference: "UNAVAILABLE" | "UNDESIRED" | "PREFERRED";
}
export interface ProblemJson {
  name: string;
  timeslots: TimeslotJson[];
  rooms: RoomJson[];
  sections: SectionJson[];
  availability: AvailabilityJson[];
}
export interface SolutionJson {
  jobId: string;
  status: "SOLVING_SCHEDULED" | "SOLVING_ACTIVE" | "NOT_SOLVING";
  score: string | null;
  hard: number | null;
  medium: number | null;
  soft: number | null;
  assignments: { sectionId: string; timeslotId: string | null; roomId: string | null }[];
}
export interface AnalysisJson {
  score: string;
  constraints: { name: string; score: string; matchCount: number; justifications: string[] }[];
}

const hhmm = (t: string) => t.slice(0, 5);

export async function buildProblem(termId: string): Promise<ProblemJson> {
  const { terms, meetingPatterns, rooms, buildings, sections, courses, users, instructorAvailability } = schema;
  const [term] = await db.select().from(terms).where(eq(terms.id, termId));
  if (!term) throw new Error("Term not found");

  const patterns = await db
    .select()
    .from(meetingPatterns)
    .where(eq(meetingPatterns.termId, termId))
    .orderBy(asc(meetingPatterns.startTime));
  const roomRows = await db
    .select({ room: rooms, building: buildings })
    .from(rooms)
    .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
    .where(eq(rooms.schedulable, true));
  const instructor = alias(users, "instructor");
  const sectionRows = await db
    .select({ s: sections, c: courses, instructorName: instructor.displayName })
    .from(sections)
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .leftJoin(instructor, eq(instructor.id, sections.instructorId))
    .where(eq(sections.termId, termId));
  const instructorIds = [...new Set(sectionRows.map((r) => r.s.instructorId).filter((x): x is string => !!x))];
  const avail = instructorIds.length
    ? await db
        .select()
        .from(instructorAvailability)
        .where(inArray(instructorAvailability.userId, instructorIds))
    : [];

  return {
    name: term.name,
    timeslots: patterns.map((p) => ({
      id: p.id,
      family: p.family,
      days: p.days,
      start: hhmm(p.startTime),
      end: hhmm(p.endTime),
    })),
    rooms: roomRows.map(({ room, building }) => ({
      id: room.id,
      label: `${building.code} ${room.number}`,
      building: building.code,
      capacity: room.capacity,
      features: room.features,
    })),
    sections: sectionRows.map(({ s, c, instructorName }) => ({
      id: s.id,
      label: `${c.subject} ${c.number}-${s.sectionNumber}`,
      instructorId: s.instructorId,
      instructorName,
      enrollmentCap: s.enrollmentCap,
      allowedFamilies: s.allowedPatterns,
      requiredFeatures: s.requiredFeatures,
      cohorts: s.cohorts,
      pinned: s.locked && !!s.meetingPatternId && !!s.roomId,
      timeslotId: s.meetingPatternId,
      roomId: s.roomId,
    })),
    availability: avail
      .filter((a) => a.termId === termId)
      .map((a) => ({
        instructorId: a.userId,
        day: a.day,
        start: hhmm(a.startTime),
        end: hhmm(a.endTime),
        preference: a.preference.toUpperCase() as AvailabilityJson["preference"],
      })),
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.SOLVER_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Solver ${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const solver = {
  submit: (problem: ProblemJson, secondsLimit: number) =>
    call<{ jobId: string }>(`/timetables?secondsLimit=${secondsLimit}`, {
      method: "POST",
      body: JSON.stringify(problem),
    }),
  get: (jobId: string) => call<SolutionJson>(`/timetables/${jobId}`),
  analyze: (jobId: string) => call<AnalysisJson>(`/timetables/${jobId}/analysis`),
  stop: (jobId: string) => call<SolutionJson>(`/timetables/${jobId}`, { method: "DELETE" }),
  health: async () => {
    try {
      const res = await fetch(`${env.SOLVER_URL}/actuator/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  },
};
