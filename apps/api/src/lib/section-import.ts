/**
 * Plans a course and section import from a CSV file without touching the database, so the same
 * code produces the preview and the changes that are applied. See `docs/import-sections.md`
 * for the file format.
 */
import type { ImportIssue, SectionImportResultDTO } from "@sched/shared";
import { unguard, type CsvRow } from "./csv.ts";

/** Accepted header names for each column. Headers are matched case-insensitively. */
export const IMPORT_COLUMNS = {
  subject: ["subject", "subj", "subject_code"],
  number: ["number", "catalog", "catalog_number", "catalog_nbr", "course_number", "nbr"],
  title: ["title", "course_title", "descr", "description"],
  department: ["department", "dept", "department_code", "dept_code"],
  credits: ["credits", "units", "credit_hours"],
  section: ["section", "section_number", "class_section", "sect"],
  instructor: ["instructor_netid", "instructor", "netid"],
  instructorName: ["instructor_name"],
  instructorEmail: ["instructor_email"],
  cap: ["cap", "enrollment_cap", "enrl_cap", "capacity", "max_enrollment"],
  patterns: ["patterns", "allowed_patterns", "pattern", "meeting_patterns"],
  features: ["features", "required_features", "room_features"],
  cohorts: ["cohorts", "cohort"],
} as const;
type Column = keyof typeof IMPORT_COLUMNS;

const REQUIRED: Column[] = ["subject", "number", "section", "cap", "patterns"];

/** The columns a downloaded template or export uses, in order. */
export const EXPORT_HEADER = [
  "subject",
  "number",
  "title",
  "department",
  "credits",
  "section",
  "instructor_netid",
  "instructor_name",
  "cap",
  "patterns",
  "features",
  "cohorts",
] as const;

export interface ExistingSection {
  id: string;
  instructorId: string | null;
  enrollmentCap: number;
  allowedPatterns: string[];
  requiredFeatures: string[];
  cohorts: string[];
  status: "unscheduled" | "scheduled" | "published";
}

export interface ImportContext {
  termName: string;
  /** Department code → id */
  departments: Map<string, string>;
  /** "SUBJ NUM" → course */
  courses: Map<string, { id: string; title: string; credits: number; departmentId: string }>;
  /** NetID → user id */
  people: Map<string, string>;
  patternFamilies: Set<string>;
  /** Features of rooms the solver may use. */
  roomFeatures: Set<string>;
  /** `${courseId}|${sectionNumber}` → section in this term */
  sections: Map<string, ExistingSection>;
}

export interface SectionFields {
  instructorNetid?: string | null;
  enrollmentCap: number;
  allowedPatterns: string[];
  requiredFeatures?: string[];
  cohorts?: string[];
}

export interface ImportPlan {
  result: SectionImportResultDTO;
  /** New instructors join the department of the first course the file lists them for. */
  newPeople: { netid: string; displayName: string; email: string; departmentId: string | null }[];
  newCourses: { key: string; subject: string; number: string; title: string; credits: number; departmentId: string }[];
  courseUpdates: { id: string; title?: string; credits?: number }[];
  newSections: ({ courseKey: string; sectionNumber: string } & SectionFields)[];
  sectionUpdates: ({ id: string } & SectionFields)[];
}

const MAX_ISSUES = 200;
const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const splitList = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

export function planImport(table: CsvRow[], ctx: ImportContext): ImportPlan {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const err = (line: number, message: string) => errors.length < MAX_ISSUES && errors.push({ line, message });
  const warn = (line: number, message: string) => warnings.length < MAX_ISSUES && warnings.push({ line, message });

  const plan: ImportPlan = {
    result: {
      applied: false,
      rows: 0,
      errors,
      warnings,
      courses: { created: 0, updated: 0 },
      sections: { created: 0, updated: 0, unchanged: 0 },
      newPeople: [],
      notInFile: 0,
      republishNeeded: 0,
    },
    newPeople: [],
    newCourses: [],
    courseUpdates: [],
    newSections: [],
    sectionUpdates: [],
  };

  const nonEmpty = table.filter((r) => r.cells.some((c) => c.trim() !== ""));
  const [header, ...rows] = nonEmpty;
  if (!header) {
    err(1, "The file has no header row. Start it with the column names, like subject,number,section,cap,patterns.");
    return plan;
  }

  const index = new Map<Column, number>();
  const ignored: string[] = [];
  header.cells.forEach((raw, i) => {
    const h = normHeader(raw);
    const col = (Object.keys(IMPORT_COLUMNS) as Column[]).find((c) => (IMPORT_COLUMNS[c] as readonly string[]).includes(h));
    if (col && !index.has(col)) index.set(col, i);
    else if (h) ignored.push(raw.trim());
  });
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length) {
    err(header.line, `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
    return plan;
  }
  if (ignored.length) warn(header.line, `Ignored column${ignored.length > 1 ? "s" : ""} not used by the import: ${ignored.join(", ")}.`);

  const has = (c: Column) => index.has(c);
  const seenSections = new Map<string, number>();
  const plannedCourses = new Map<string, ImportPlan["newCourses"][number]>();
  const updatedCourses = new Map<string, ImportPlan["courseUpdates"][number]>();
  const plannedPeople = new Map<string, ImportPlan["newPeople"][number]>();
  const matched = new Set<string>();

  for (const row of rows) {
    plan.result.rows++;
    const { line } = row;
    const get = (c: Column) => {
      const i = index.get(c);
      return i === undefined ? "" : unguard((row.cells[i] ?? "").trim());
    };
    const before = errors.length;

    const subject = get("subject").toUpperCase();
    const number = get("number").toUpperCase();
    const sectionNumber = get("section");
    if (!subject) err(line, "Add a subject, like CHEM.");
    if (!number) err(line, "Add a course number, like 151.");
    if (!sectionNumber) err(line, "Add a section number, like 001.");

    const capRaw = get("cap");
    const cap = Number(capRaw);
    if (!capRaw || !Number.isInteger(cap) || cap < 1 || cap > 5000) err(line, `Enrollment cap "${capRaw}" must be a whole number from 1 to 5000.`);

    const patterns = splitList(get("patterns").toUpperCase(), /[\s;|,]+/);
    if (patterns.length === 0) err(line, "Add at least one allowed meeting pattern, like MWF50.");
    for (const p of patterns) {
      if (!ctx.patternFamilies.has(p)) err(line, `${p} isn't a meeting pattern in ${ctx.termName}. Add it under Terms first, or fix the name.`);
    }

    let features: string[] | undefined;
    if (has("features")) {
      features = splitList(get("features").toLowerCase(), /[\s;|,]+/).map((f) => f.replace(/-/g, "_"));
      for (const f of features) {
        if (!ctx.roomFeatures.has(f)) warn(line, `No room the solver can use has "${f}", so this section can't be placed until one does.`);
      }
    }
    const cohorts = has("cohorts") ? splitList(get("cohorts"), /[\s;|]+/) : undefined;

    let credits: number | undefined;
    if (has("credits") && get("credits")) {
      credits = Number(get("credits"));
      if (!Number.isInteger(credits) || credits < 0 || credits > 12) {
        err(line, `Credits "${get("credits")}" must be a whole number from 0 to 12.`);
        credits = undefined;
      }
    }

    // Instructor
    let instructorNetid: string | null | undefined;
    if (has("instructor")) {
      const netid = get("instructor").toLowerCase().replace(/@.*$/, "");
      instructorNetid = netid || null;
      if (netid && !ctx.people.has(netid) && !plannedPeople.has(netid)) {
        const name = get("instructorName");
        if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(netid)) {
          err(line, `"${netid}" doesn't look like a NetID.`);
        } else if (!name) {
          err(line, `No one with NetID "${netid}". Add an instructor_name column to create them, or add them under People first.`);
        } else {
          const email = get("instructorEmail");
          plannedPeople.set(netid, { netid, displayName: name, email: /^[^@\s]+@[^@\s]+$/.test(email) ? email : "", departmentId: null });
        }
      }
    }

    // Course
    const courseKey = `${subject} ${number}`;
    const title = get("title");
    const existingCourse = ctx.courses.get(courseKey);
    if (subject && number) {
      if (existingCourse) {
        const change: ImportPlan["courseUpdates"][number] = updatedCourses.get(courseKey) ?? { id: existingCourse.id };
        if (title && title !== existingCourse.title) change.title = title;
        if (credits !== undefined && credits !== existingCourse.credits) change.credits = credits;
        if (change.title !== undefined || change.credits !== undefined) updatedCourses.set(courseKey, change);
      } else if (!plannedCourses.has(courseKey)) {
        const deptCode = get("department").toUpperCase();
        const departmentId = ctx.departments.get(deptCode);
        if (!title) err(line, `${courseKey} is a new course. Add its title.`);
        if (!deptCode) err(line, `${courseKey} is a new course. Add its department code, like ${subject}.`);
        else if (!departmentId) err(line, `There's no department with code "${deptCode}". Add it under Departments first.`);
        if (title && departmentId) {
          plannedCourses.set(courseKey, { key: courseKey, subject, number, title, credits: credits ?? 3, departmentId });
        }
      }
    }

    // Section
    const sectionKey = `${courseKey}|${sectionNumber}`;
    if (subject && number && sectionNumber) {
      const dup = seenSections.get(sectionKey);
      if (dup) err(line, `${courseKey}-${sectionNumber} is already on line ${dup}.`);
      else seenSections.set(sectionKey, line);
    }
    if (errors.length > before) continue;

    const newPerson = instructorNetid ? plannedPeople.get(instructorNetid) : undefined;
    if (newPerson && !newPerson.departmentId) {
      newPerson.departmentId = existingCourse?.departmentId ?? plannedCourses.get(courseKey)?.departmentId ?? null;
    }

    const fields: SectionFields = {
      enrollmentCap: cap,
      allowedPatterns: patterns,
      ...(instructorNetid !== undefined ? { instructorNetid } : {}),
      ...(features ? { requiredFeatures: features } : {}),
      ...(cohorts ? { cohorts } : {}),
    };
    const existing = existingCourse ? ctx.sections.get(`${existingCourse.id}|${sectionNumber}`) : undefined;
    if (!existing) {
      plan.newSections.push({ courseKey, sectionNumber, ...fields });
      continue;
    }
    matched.add(existing.id);
    const nextInstructor =
      instructorNetid === undefined ? existing.instructorId : instructorNetid === null ? null : (ctx.people.get(instructorNetid) ?? `new:${instructorNetid}`);
    const changed =
      nextInstructor !== existing.instructorId ||
      cap !== existing.enrollmentCap ||
      !sameSet(patterns, existing.allowedPatterns) ||
      (features !== undefined && !sameSet(features, existing.requiredFeatures)) ||
      (cohorts !== undefined && !sameSet(cohorts, existing.cohorts));
    if (!changed) {
      plan.result.sections.unchanged++;
      continue;
    }
    plan.sectionUpdates.push({ id: existing.id, ...fields });
    if (existing.status === "published") plan.result.republishNeeded++;
  }

  if (rows.length === 0) err(header.line, "The file has a header but no sections.");

  plan.newPeople = [...plannedPeople.values()];
  plan.newCourses = [...plannedCourses.values()];
  plan.courseUpdates = [...updatedCourses.values()];
  plan.result.newPeople = plan.newPeople.map((p) => p.netid);
  plan.result.courses = { created: plan.newCourses.length, updated: plan.courseUpdates.length };
  plan.result.sections.created = plan.newSections.length;
  plan.result.sections.updated = plan.sectionUpdates.length;
  plan.result.notInFile = [...ctx.sections.values()].filter((s) => !matched.has(s.id)).length;
  return plan;
}
