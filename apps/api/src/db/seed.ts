/**
 * Seeds a realistic College of Science:
 *  - Fall 2026 (current term): sections placed by a greedy pass and published as class events
 *  - Spring 2027: sections unscheduled, ready for the Timefold solver
 *  - department/college calendars, office hours, seminars, meetings, bookings
 *
 * Re-running wipes and recreates everything.
 */
import { sql } from "drizzle-orm";
import { db, pool, schema } from "./client.ts";
import { publishTerm } from "../lib/publish.ts";
import { computeRecurUntil, fromFloating } from "../lib/recurrence.ts";
import { redis } from "../lib/redis.ts";

const TZ = "America/Phoenix";
/** Wall-clock time in Phoenix → instant. Month is 1-based. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromFloating(new Date(Date.UTC(y, mo - 1, d, h, mi)), TZ);

// Deterministic pseudo-random so the seed is stable between runs.
let seedState = 42;
const rand = () => ((seedState = (seedState * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

async function wipe() {
  await db.execute(sql`
    truncate table audit_log, solver_runs, instructor_availability, sections, meeting_patterns, courses,
      booking_requests, event_attendees, events, calendar_members, calendars, term_dates, terms,
      rooms, buildings, users, departments restart identity cascade`);
  const keys = await redis.keys("occ:*");
  const ver = await redis.keys("ver:*");
  const other = await redis.keys("rooms:*");
  const all = [...keys, ...ver, ...other, ...(await redis.keys("terms:*"))];
  if (all.length) await redis.del(...all);
}

async function main() {
  await wipe();

  /* ---------------- Departments ---------------- */
  const deptData = [
    { code: "DEAN", name: "Dean's Office" },
    { code: "CHEM", name: "Chemistry & Biochemistry" },
    { code: "MATH", name: "Mathematics" },
    { code: "PHYS", name: "Physics" },
    { code: "MCB", name: "Molecular & Cellular Biology" },
    { code: "CSC", name: "Computer Science" },
  ];
  const depts = await db.insert(schema.departments).values(deptData).returning();
  const dept = (code: string) => depts.find((d) => d.code === code)!.id;

  /* ---------------- People ---------------- */
  type P = { netid: string; name: string; title: string; dept: string; roles: ("admin" | "scheduler" | "staff" | "faculty" | "viewer")[] };
  const people: P[] = [
    { netid: "rmartinez", name: "Rosa Martinez", title: "Director of Operations", dept: "DEAN", roles: ["admin", "staff"] },
    { netid: "kokafor", name: "Kevin Okafor", title: "College Scheduling Officer", dept: "DEAN", roles: ["scheduler", "staff"] },
    { netid: "anguyen", name: "Alicia Nguyen", title: "Executive Assistant to the Dean", dept: "DEAN", roles: ["staff"] },
    { netid: "mwhitfield", name: "Margaret Whitfield", title: "Dean", dept: "DEAN", roles: ["faculty", "staff"] },
    { netid: "praman", name: "Priya Raman", title: "Department Coordinator", dept: "CHEM", roles: ["staff"] },
    { netid: "tbecker", name: "Tom Becker", title: "Program Coordinator", dept: "MATH", roles: ["staff"] },
    { netid: "dchen", name: "David Chen", title: "Professor", dept: "CHEM", roles: ["faculty"] },
    { netid: "lrodriguez", name: "Lucia Rodriguez", title: "Associate Professor", dept: "CHEM", roles: ["faculty"] },
    { netid: "jpatel", name: "Jay Patel", title: "Assistant Professor", dept: "CHEM", roles: ["faculty"] },
    { netid: "hsantos", name: "Helena Santos", title: "Lecturer", dept: "CHEM", roles: ["faculty"] },
    { netid: "sokoye", name: "Samuel Okoye", title: "Professor", dept: "MATH", roles: ["faculty"] },
    { netid: "egrant", name: "Emily Grant", title: "Associate Professor", dept: "MATH", roles: ["faculty"] },
    { netid: "rkim", name: "Ryan Kim", title: "Assistant Professor", dept: "MATH", roles: ["faculty"] },
    { netid: "nhassan", name: "Nadia Hassan", title: "Lecturer", dept: "MATH", roles: ["faculty"] },
    { netid: "bmorales", name: "Benjamin Morales", title: "Professor", dept: "PHYS", roles: ["faculty"] },
    { netid: "cwu", name: "Catherine Wu", title: "Associate Professor", dept: "PHYS", roles: ["faculty"] },
    { netid: "ojohnson", name: "Oliver Johnson", title: "Lecturer", dept: "PHYS", roles: ["faculty"] },
    { netid: "aflores", name: "Ana Flores", title: "Professor", dept: "MCB", roles: ["faculty"] },
    { netid: "mbrooks", name: "Marcus Brooks", title: "Associate Professor", dept: "MCB", roles: ["faculty"] },
    { netid: "ytanaka", name: "Yuki Tanaka", title: "Assistant Professor", dept: "MCB", roles: ["faculty"] },
    { netid: "sabbott", name: "Sarah Abbott", title: "Professor", dept: "CSC", roles: ["faculty"] },
    { netid: "dmurphy", name: "Daniel Murphy", title: "Associate Professor", dept: "CSC", roles: ["faculty"] },
    { netid: "iqbal", name: "Imran Iqbal", title: "Assistant Professor", dept: "CSC", roles: ["faculty"] },
    { netid: "kreyes", name: "Kim Reyes", title: "Lecturer", dept: "CSC", roles: ["faculty"] },
    { netid: "jlee", name: "Jordan Lee", title: "Student Assistant", dept: "DEAN", roles: ["viewer"] },
  ];
  const userRows = await db
    .insert(schema.users)
    .values(
      people.map((p) => ({
        netid: p.netid,
        email: `${p.netid}@college.example.edu`,
        displayName: p.name,
        title: p.title,
        departmentId: dept(p.dept),
        roles: p.roles,
        affiliations: p.roles.includes("faculty") ? ["faculty", "employee"] : p.roles.includes("viewer") ? ["student"] : ["staff", "employee"],
      })),
    )
    .returning();
  const u = (netid: string) => userRows.find((r) => r.netid === netid)!.id;

  /* ---------------- Buildings & rooms ---------------- */
  const bldgs = await db
    .insert(schema.buildings)
    .values([
      { code: "CHM", name: "Chemistry Building" },
      { code: "MTH", name: "Mathematics Building" },
      { code: "PAS", name: "Physics & Atmospheric Sciences" },
      { code: "LSS", name: "Life Sciences South" },
      { code: "GLD", name: "Gould-Simpson" },
      { code: "ADM", name: "Science Administration" },
    ])
    .returning();
  const b = (code: string) => bldgs.find((x) => x.code === code)!.id;
  const roomData = [
    { building: "CHM", number: "111", name: "Kemper Lecture Hall", capacity: 240, kind: "lecture_hall", features: ["projector", "document_camera", "lecture_capture"] },
    { building: "CHM", number: "134", capacity: 60, kind: "classroom", features: ["projector", "whiteboard"] },
    { building: "CHM", number: "201", name: "General Chemistry Lab A", capacity: 24, kind: "lab", features: ["wet_lab", "fume_hoods"] },
    { building: "CHM", number: "203", name: "General Chemistry Lab B", capacity: 24, kind: "lab", features: ["wet_lab", "fume_hoods"] },
    { building: "CHM", number: "310", name: "Chemistry Seminar Room", capacity: 30, kind: "seminar", features: ["projector", "video_conf"] },
    { building: "MTH", number: "101", capacity: 150, kind: "lecture_hall", features: ["projector", "document_camera", "lecture_capture"] },
    { building: "MTH", number: "205", capacity: 45, kind: "classroom", features: ["projector", "whiteboard"] },
    { building: "MTH", number: "207", capacity: 45, kind: "classroom", features: ["projector", "whiteboard"] },
    { building: "MTH", number: "301", capacity: 35, kind: "classroom", features: ["whiteboard"] },
    { building: "MTH", number: "402", name: "Math Commons", capacity: 20, kind: "seminar", features: ["whiteboard", "video_conf"] },
    { building: "PAS", number: "201", capacity: 180, kind: "lecture_hall", features: ["projector", "document_camera", "lecture_capture"] },
    { building: "PAS", number: "224", capacity: 32, kind: "lab", features: ["physics_lab", "projector"] },
    { building: "PAS", number: "318", capacity: 40, kind: "classroom", features: ["projector"] },
    { building: "LSS", number: "120", capacity: 200, kind: "lecture_hall", features: ["projector", "lecture_capture"] },
    { building: "LSS", number: "236", name: "Biology Teaching Lab", capacity: 28, kind: "lab", features: ["wet_lab", "microscopes"] },
    { building: "LSS", number: "250", capacity: 50, kind: "classroom", features: ["projector", "whiteboard"] },
    { building: "GLD", number: "701", capacity: 120, kind: "lecture_hall", features: ["projector", "lecture_capture"] },
    { building: "GLD", number: "906", name: "Computing Lab", capacity: 40, kind: "lab", features: ["computers", "projector"] },
    { building: "GLD", number: "930", name: "Computing Lab 2", capacity: 40, kind: "lab", features: ["computers", "projector"] },
    { building: "GLD", number: "813", capacity: 36, kind: "classroom", features: ["projector", "whiteboard"] },
    { building: "ADM", number: "210", name: "Dean's Boardroom", capacity: 18, kind: "conference", features: ["video_conf", "projector"], requiresApproval: true, schedulable: false },
    { building: "ADM", number: "118", name: "Conference Room", capacity: 12, kind: "conference", features: ["video_conf"], schedulable: false },
    { building: "ADM", number: "100", name: "Atrium", capacity: 150, kind: "event_space", features: [], requiresApproval: true, schedulable: false },
  ];
  const roomRows = await db
    .insert(schema.rooms)
    .values(
      roomData.map((r) => ({
        buildingId: b(r.building),
        number: r.number,
        name: r.name ?? null,
        capacity: r.capacity,
        kind: r.kind,
        features: r.features,
        requiresApproval: r.requiresApproval ?? false,
        schedulable: r.schedulable ?? true,
      })),
    )
    .returning();
  const room = (label: string) => {
    const [code, num] = label.split(" ");
    return roomRows.find((r) => r.buildingId === b(code!) && r.number === num)!;
  };

  /* ---------------- Calendars ---------------- */
  const college = (
    await db
      .insert(schema.calendars)
      .values({ name: "College of Science", kind: "college", color: "midnight", description: "College-wide events, deadlines and governance" })
      .returning()
  )[0]!;
  const deptColors: Record<string, string> = { DEAN: "chili", CHEM: "oasis", MATH: "leaf", PHYS: "sky", MCB: "river", CSC: "bloom" };
  const deptCals = await db
    .insert(schema.calendars)
    .values(depts.map((d) => ({ name: d.name, kind: "department" as const, departmentId: d.id, color: deptColors[d.code]! })))
    .returning();
  const deptCal = (code: string) => deptCals.find((c) => c.departmentId === dept(code))!.id;
  const courseCals = await db
    .insert(schema.calendars)
    .values(
      depts
        .filter((d) => d.code !== "DEAN")
        .map((d) => ({ name: `${d.code} classes`, kind: "course" as const, departmentId: d.id, color: "azurite", description: `Published class meetings for ${d.name}` })),
    )
    .returning();
  const courseCal = (code: string) => courseCals.find((c) => c.departmentId === dept(code))!.id;
  const roomCals = await db
    .insert(schema.calendars)
    .values(roomRows.map((r) => ({ name: `${bldgs.find((x) => x.id === r.buildingId)!.code} ${r.number}${r.name ? ` · ${r.name}` : ""}`, kind: "room" as const, roomId: r.id, color: "sage" })))
    .returning();
  const roomCal = (label: string) => roomCals.find((c) => c.roomId === room(label).id)!.id;
  const personal = await db
    .insert(schema.calendars)
    .values(userRows.map((x) => ({ name: x.displayName, kind: "personal" as const, ownerId: x.id, isPublic: false, color: "mesa" })))
    .returning();
  const mine = (netid: string) => personal.find((c) => c.ownerId === u(netid))!.id;
  // The Dean's assistant manages the Dean's calendar.
  await db.insert(schema.calendarMembers).values({ calendarId: mine("mwhitfield"), userId: u("anguyen"), role: "editor" });

  /* ---------------- Terms ---------------- */
  const [fall, spring] = await db
    .insert(schema.terms)
    .values([
      { code: "2264", name: "Fall 2026", startsOn: "2026-08-24", endsOn: "2026-12-22", classesEndOn: "2026-12-09", finalsStartOn: "2026-12-11", finalsEndOn: "2026-12-17", isCurrent: true },
      { code: "2271", name: "Spring 2027", startsOn: "2027-01-13", endsOn: "2027-05-14", classesEndOn: "2027-05-05", finalsStartOn: "2027-05-07", finalsEndOn: "2027-05-13" },
    ])
    .returning();
  await db.insert(schema.termDates).values([
    { termId: fall!.id, startsOn: "2026-08-24", label: "First day of classes", kind: "milestone" },
    { termId: fall!.id, startsOn: "2026-08-30", label: "Last day to add", kind: "deadline" },
    { termId: fall!.id, startsOn: "2026-09-07", label: "Labor Day", kind: "holiday" },
    { termId: fall!.id, startsOn: "2026-09-13", label: "Last day to drop without a W", kind: "deadline" },
    { termId: fall!.id, startsOn: "2026-11-01", label: "Last day to withdraw", kind: "deadline" },
    { termId: fall!.id, startsOn: "2026-11-11", label: "Veterans Day", kind: "holiday" },
    { termId: fall!.id, startsOn: "2026-11-13", label: "Spring schedule proofs due", kind: "deadline" },
    { termId: fall!.id, startsOn: "2026-11-26", endsOn: "2026-11-29", label: "Thanksgiving recess", kind: "break" },
    { termId: fall!.id, startsOn: "2026-12-09", label: "Last day of classes", kind: "milestone" },
    { termId: fall!.id, startsOn: "2026-12-10", label: "Reading day", kind: "milestone" },
    { termId: fall!.id, startsOn: "2026-12-11", endsOn: "2026-12-17", label: "Final exams", kind: "finals" },
    { termId: fall!.id, startsOn: "2026-12-22", label: "Final grades due", kind: "deadline" },
    { termId: spring!.id, startsOn: "2027-01-13", label: "First day of classes", kind: "milestone" },
    { termId: spring!.id, startsOn: "2027-01-18", label: "Martin Luther King Jr. Day", kind: "holiday" },
    { termId: spring!.id, startsOn: "2027-03-13", endsOn: "2027-03-21", label: "Spring recess", kind: "break" },
    { termId: spring!.id, startsOn: "2027-05-05", label: "Last day of classes", kind: "milestone" },
    { termId: spring!.id, startsOn: "2027-05-07", endsOn: "2027-05-13", label: "Final exams", kind: "finals" },
  ]);

  /* ---------------- Meeting patterns ---------------- */
  const patternDefs: { family: string; days: string[]; times: [string, string][] }[] = [
    { family: "MWF50", days: ["MO", "WE", "FR"], times: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"].map((s) => [s, s.replace(/:00$/, ":50")] as [string, string]) },
    { family: "TR75", days: ["TU", "TH"], times: [["08:00", "09:15"], ["09:30", "10:45"], ["11:00", "12:15"], ["12:30", "13:45"], ["14:00", "15:15"], ["15:30", "16:45"], ["17:00", "18:15"]] },
    { family: "MW75", days: ["MO", "WE"], times: [["13:00", "14:15"], ["14:30", "15:45"], ["16:00", "17:15"]] },
    ...["MO", "TU", "WE", "TH", "FR"].flatMap((d) => [
      { family: "LAB170", days: [d], times: [["08:00", "10:50"], ["13:00", "15:50"]] as [string, string][] },
    ]),
  ];
  const insertPatterns = (termId: string) =>
    db
      .insert(schema.meetingPatterns)
      .values(patternDefs.flatMap((p) => p.times.map(([s, e]) => ({ termId, family: p.family, days: p.days, startTime: s, endTime: e }))))
      .returning();
  const fallPatterns = await insertPatterns(fall!.id);
  const springPatterns = await insertPatterns(spring!.id);

  /* ---------------- Courses & sections ---------------- */
  type C = { subject: string; number: string; title: string; credits?: number; cap: number; patterns: string[]; features?: string[]; cohorts?: string[]; sections: string[] };
  const lecture = ["MWF50", "TR75"];
  const catalog: C[] = [
    { subject: "CHEM", number: "151", title: "General Chemistry I", cap: 200, patterns: lecture, features: ["lecture_capture"], cohorts: ["first-year-science"], sections: ["dchen", "lrodriguez"] },
    { subject: "CHEM", number: "151L", title: "General Chemistry I Lab", credits: 1, cap: 24, patterns: ["LAB170"], features: ["wet_lab"], sections: ["hsantos", "hsantos", "jpatel", "hsantos"] },
    { subject: "CHEM", number: "152", title: "General Chemistry II", cap: 180, patterns: lecture, features: ["lecture_capture"], cohorts: ["second-year-science"], sections: ["jpatel"] },
    { subject: "CHEM", number: "241A", title: "Organic Chemistry I", cap: 150, patterns: lecture, cohorts: ["chem-major-y2"], sections: ["lrodriguez"] },
    { subject: "CHEM", number: "480A", title: "Physical Chemistry", cap: 40, patterns: ["TR75", "MW75"], cohorts: ["chem-major-y4"], sections: ["dchen"] },
    { subject: "MATH", number: "122B", title: "Functions for Calculus", cap: 40, patterns: lecture, sections: ["nhassan", "nhassan"] },
    { subject: "MATH", number: "125", title: "Calculus I", cap: 45, patterns: ["MWF50"], cohorts: ["first-year-science"], sections: ["rkim", "egrant", "nhassan"] },
    { subject: "MATH", number: "129", title: "Calculus II", cap: 45, patterns: lecture, cohorts: ["second-year-science"], sections: ["sokoye", "rkim"] },
    { subject: "MATH", number: "223", title: "Vector Calculus", cap: 40, patterns: lecture, cohorts: ["chem-major-y2", "cs-y2"], sections: ["egrant"] },
    { subject: "MATH", number: "313", title: "Linear Algebra", cap: 35, patterns: ["TR75", "MW75"], cohorts: ["cs-y2"], sections: ["sokoye"] },
    { subject: "PHYS", number: "141", title: "Introductory Mechanics", cap: 175, patterns: lecture, features: ["lecture_capture"], cohorts: ["second-year-science"], sections: ["bmorales"] },
    { subject: "PHYS", number: "141L", title: "Mechanics Lab", credits: 1, cap: 30, patterns: ["LAB170"], features: ["physics_lab"], sections: ["ojohnson", "ojohnson"] },
    { subject: "PHYS", number: "241", title: "Electricity & Magnetism", cap: 40, patterns: lecture, sections: ["cwu"] },
    { subject: "MCB", number: "181R", title: "Introductory Biology", cap: 200, patterns: lecture, features: ["lecture_capture"], cohorts: ["first-year-science"], sections: ["aflores"] },
    { subject: "MCB", number: "181L", title: "Introductory Biology Lab", credits: 1, cap: 28, patterns: ["LAB170"], features: ["wet_lab", "microscopes"], sections: ["ytanaka", "ytanaka"] },
    { subject: "MCB", number: "301", title: "Molecular Basis of Life", cap: 48, patterns: lecture, sections: ["mbrooks"] },
    { subject: "CSC", number: "110", title: "Introduction to Computer Programming", cap: 40, patterns: ["MWF50", "TR75"], features: ["computers"], cohorts: ["cs-y1"], sections: ["kreyes", "kreyes"] },
    { subject: "CSC", number: "120", title: "Introduction to Computer Programming II", cap: 110, patterns: lecture, cohorts: ["cs-y1"], sections: ["iqbal"] },
    { subject: "CSC", number: "210", title: "Software Development", cap: 36, patterns: ["TR75", "MW75"], cohorts: ["cs-y2"], sections: ["dmurphy"] },
    { subject: "CSC", number: "335", title: "Object-Oriented Programming", cap: 36, patterns: lecture, sections: ["sabbott"] },
  ];
  const courseRows = await db
    .insert(schema.courses)
    .values(catalog.map((c) => ({ departmentId: dept(c.subject), subject: c.subject, number: c.number, title: c.title, credits: c.credits ?? 3 })))
    .returning();

  const sectionValues = (termId: string, springAdjust: boolean) =>
    catalog.flatMap((c) => {
      const course = courseRows.find((x) => x.subject === c.subject && x.number === c.number)!;
      const instructors = springAdjust && c.number === "151" ? ["dchen"] : c.sections;
      return instructors.map((netid, i) => ({
        courseId: course.id,
        termId,
        sectionNumber: String(i + 1).padStart(3, "0"),
        instructorId: u(netid),
        enrollmentCap: c.cap,
        allowedPatterns: c.patterns,
        requiredFeatures: c.features ?? [],
        cohorts: c.cohorts ?? [],
      }));
    });
  const fallSections = await db.insert(schema.sections).values(sectionValues(fall!.id, false)).returning();
  const springSections = await db.insert(schema.sections).values(sectionValues(spring!.id, true)).returning();

  /* ---------------- Greedy placement for the current term ---------------- */
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  type Pat = (typeof fallPatterns)[number];
  const patOverlap = (a: Pat, b: Pat) =>
    a.days.some((d) => b.days.includes(d)) && toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime);
  const placed: { s: (typeof fallSections)[number]; p: Pat; roomId: string }[] = [];
  const order = [...fallSections].sort((a, b) => b.enrollmentCap - a.enrollmentCap);
  const schedulableRooms = roomRows.filter((r) => r.schedulable).sort((a, b) => a.capacity - b.capacity);
  for (const s of order) {
    const pats = fallPatterns
      .filter((p) => s.allowedPatterns.includes(p.family))
      .sort((a, b) => Math.abs(toMin(a.startTime) - 600) - Math.abs(toMin(b.startTime) - 600) + (rand() - 0.5) * 240);
    const fits = schedulableRooms.filter((r) => r.capacity >= s.enrollmentCap && s.requiredFeatures.every((f) => r.features.includes(f)));
    let done = false;
    for (const p of pats) {
      const clash = placed.some(
        (x) =>
          patOverlap(x.p, p) &&
          (x.s.instructorId === s.instructorId || x.s.cohorts.some((c) => s.cohorts.includes(c))),
      );
      if (clash) continue;
      const r = fits.find((r) => !placed.some((x) => x.roomId === r.id && patOverlap(x.p, p)));
      if (!r) continue;
      placed.push({ s, p, roomId: r.id });
      done = true;
      break;
    }
    if (!done) console.warn(`Could not place ${s.id}`);
  }
  for (const x of placed) {
    await db
      .update(schema.sections)
      .set({ meetingPatternId: x.p.id, roomId: x.roomId, status: "scheduled" })
      .where(sql`${schema.sections.id} = ${x.s.id}`);
  }
  const published = await publishTerm(fall!.id);

  // Spring: a couple of sections already locked in place by departments.
  const lockSpring = async (subject: string, number: string, family: string, start: string, roomLabel: string) => {
    const course = courseRows.find((c) => c.subject === subject && c.number === number)!;
    const s = springSections.find((x) => x.courseId === course.id && x.sectionNumber === "001")!;
    const p = springPatterns.find((x) => x.family === family && x.startTime.startsWith(start))!;
    await db
      .update(schema.sections)
      .set({ meetingPatternId: p.id, roomId: room(roomLabel).id, locked: true, status: "scheduled" })
      .where(sql`${schema.sections.id} = ${s.id}`);
  };
  await lockSpring("CHEM", "152", "MWF50", "09:00", "CHM 111");
  await lockSpring("MCB", "181R", "TR75", "11:00", "LSS 120");

  /* ---------------- Instructor availability (Spring) ---------------- */
  const avail: (typeof schema.instructorAvailability.$inferInsert)[] = [];
  const block = (netid: string, days: string[], s: string, e: string, preference: "unavailable" | "undesired" | "preferred") => {
    for (const day of days) avail.push({ userId: u(netid), termId: spring!.id, day, startTime: s, endTime: e, preference });
  };
  block("dchen", ["TU", "TH"], "08:00", "12:00", "unavailable"); // research group
  block("lrodriguez", ["MO", "WE", "FR"], "08:00", "09:00", "undesired");
  block("sokoye", ["FR"], "08:00", "18:00", "unavailable"); // chairs department meetings
  block("egrant", ["MO", "WE", "FR"], "09:00", "12:00", "preferred");
  block("bmorales", ["TU", "TH"], "14:00", "18:00", "unavailable");
  block("aflores", ["MO", "WE", "FR"], "13:00", "17:00", "undesired");
  block("kreyes", ["TU", "TH"], "08:00", "10:00", "undesired");
  block("sabbott", ["MO", "WE"], "13:00", "17:00", "preferred");
  block("mwhitfield", ["MO", "TU", "WE", "TH", "FR"], "08:00", "18:00", "unavailable");
  await db.insert(schema.instructorAvailability).values(avail);

  /* ---------------- Everyday events ---------------- */
  type E = typeof schema.events.$inferInsert;
  const ev = (e: Omit<E, "timezone">): E => {
    const series = { startsAt: e.startsAt, endsAt: e.endsAt, timezone: TZ, rrule: e.rrule ?? null, exdates: (e.exdates as Date[]) ?? [] };
    return { ...e, timezone: TZ, recurUntil: computeRecurUntil(series) };
  };
  const weeklyUntil = "UNTIL=20261209T235959Z";
  const holidays = [at(2026, 11, 11), at(2026, 11, 26), at(2026, 11, 27)];
  const exAt = (h: number, m: number) => holidays.map((d) => new Date(d.getTime() + (h * 60 + m) * 60_000));

  const everyday: E[] = [
    // College
    ev({ calendarId: college.id, title: "Dean's Town Hall", kind: "event", startsAt: at(2026, 11, 10, 12), endsAt: at(2026, 11, 10, 13), roomId: room("CHM 111").id, organizerId: u("mwhitfield"), description: "State of the college, budget outlook, Q&A." }),
    ev({ calendarId: college.id, title: "Science Career Fair", kind: "event", startsAt: at(2026, 11, 18, 10), endsAt: at(2026, 11, 18, 14), roomId: room("ADM 100").id, organizerId: u("anguyen") }),
    ev({ calendarId: college.id, title: "Spring 2027 schedule proofs due", kind: "deadline", startsAt: at(2026, 11, 13), endsAt: at(2026, 11, 14), allDay: true, organizerId: u("kokafor") }),
    ev({ calendarId: college.id, title: "College Faculty Assembly", kind: "meeting", startsAt: at(2026, 11, 20, 15), endsAt: at(2026, 11, 20, 16, 30), roomId: room("PAS 201").id, organizerId: u("mwhitfield") }),
    ev({ calendarId: college.id, title: "Undergraduate Research Symposium", kind: "event", startsAt: at(2026, 12, 4, 9), endsAt: at(2026, 12, 4, 15), roomId: room("ADM 100").id, organizerId: u("anguyen") }),
    ev({ calendarId: college.id, title: "Final grades due", kind: "deadline", startsAt: at(2026, 12, 22), endsAt: at(2026, 12, 23), allDay: true, organizerId: u("kokafor") }),
    // Dean's office
    ev({ calendarId: deptCal("DEAN"), title: "Leadership team", kind: "meeting", startsAt: at(2026, 9, 1, 9), endsAt: at(2026, 9, 1, 10), rrule: `FREQ=WEEKLY;BYDAY=TU;${weeklyUntil}`, roomId: room("ADM 210").id, organizerId: u("mwhitfield") }),
    ev({ calendarId: deptCal("DEAN"), title: "Space & facilities committee", kind: "meeting", startsAt: at(2026, 9, 2, 14), endsAt: at(2026, 9, 2, 15), rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;${weeklyUntil}`, roomId: room("ADM 118").id, organizerId: u("rmartinez") }),
    ev({ calendarId: mine("rmartinez"), title: "Budget review with the Dean", kind: "meeting", startsAt: at(2026, 11, 4, 10), endsAt: at(2026, 11, 4, 11), roomId: room("ADM 210").id, organizerId: u("rmartinez") }),
    ev({ calendarId: mine("rmartinez"), title: "Hold: spring room assignments", kind: "hold", startsAt: at(2026, 11, 5, 13), endsAt: at(2026, 11, 5, 15), organizerId: u("rmartinez") }),
    ev({ calendarId: mine("rmartinez"), title: "Facilities walkthrough, LSS", kind: "meeting", startsAt: at(2026, 11, 6, 9, 30), endsAt: at(2026, 11, 6, 10, 30), locationText: "Life Sciences South lobby", organizerId: u("rmartinez") }),
    ev({ calendarId: mine("kokafor"), title: "Spring timetable working session", kind: "meeting", startsAt: at(2026, 11, 3, 13), endsAt: at(2026, 11, 3, 15), roomId: room("ADM 118").id, organizerId: u("kokafor") }),
    ev({ calendarId: mine("kokafor"), title: "Registrar sync", kind: "meeting", startsAt: at(2026, 9, 3, 10), endsAt: at(2026, 9, 3, 10, 30), rrule: `FREQ=WEEKLY;BYDAY=TH;${weeklyUntil}`, locationText: "Teams", organizerId: u("kokafor") }),
    ev({ calendarId: mine("mwhitfield"), title: "Provost's council", kind: "meeting", startsAt: at(2026, 11, 5, 9), endsAt: at(2026, 11, 5, 11), locationText: "Administration 512", organizerId: u("mwhitfield") }),
    // Departments
    ev({ calendarId: deptCal("CHEM"), title: "Chemistry Colloquium", kind: "event", startsAt: at(2026, 8, 27, 16), endsAt: at(2026, 8, 27, 17), rrule: `FREQ=WEEKLY;BYDAY=TH;${weeklyUntil}`, exdates: exAt(16, 0), roomId: room("CHM 310").id, organizerId: u("praman") }),
    ev({ calendarId: deptCal("CHEM"), title: "Chemistry faculty meeting", kind: "meeting", startsAt: at(2026, 9, 4, 12), endsAt: at(2026, 9, 4, 13), rrule: `FREQ=MONTHLY;BYDAY=1FR;${weeklyUntil}`, roomId: room("CHM 310").id, organizerId: u("dchen") }),
    ev({ calendarId: deptCal("MATH"), title: "Analysis seminar", kind: "event", startsAt: at(2026, 8, 25, 15, 30), endsAt: at(2026, 8, 25, 16, 30), rrule: `FREQ=WEEKLY;BYDAY=TU;${weeklyUntil}`, roomId: room("MTH 402").id, organizerId: u("tbecker") }),
    ev({ calendarId: deptCal("MATH"), title: "Calculus coordination", kind: "meeting", startsAt: at(2026, 11, 6, 13), endsAt: at(2026, 11, 6, 14), roomId: room("MTH 402").id, organizerId: u("tbecker") }),
    ev({ calendarId: deptCal("PHYS"), title: "Physics Colloquium", kind: "event", startsAt: at(2026, 8, 26, 16), endsAt: at(2026, 8, 26, 17), rrule: `FREQ=WEEKLY;BYDAY=WE;${weeklyUntil}`, exdates: exAt(16, 0), roomId: room("PAS 318").id, organizerId: u("cwu") }),
    ev({ calendarId: deptCal("MCB"), title: "Thesis defense: J. Alvarez", kind: "exam", startsAt: at(2026, 11, 9, 10), endsAt: at(2026, 11, 9, 12), roomId: room("LSS 250").id, organizerId: u("aflores") }),
    ev({ calendarId: deptCal("CSC"), title: "CS research talks", kind: "event", startsAt: at(2026, 8, 28, 12), endsAt: at(2026, 8, 28, 13), rrule: `FREQ=WEEKLY;BYDAY=FR;${weeklyUntil}`, exdates: exAt(12, 0), roomId: room("GLD 813").id, organizerId: u("sabbott") }),
    // Exams
    ev({ calendarId: courseCal("CHEM"), title: "CHEM 151 Midterm 3", kind: "exam", startsAt: at(2026, 11, 12, 18), endsAt: at(2026, 11, 12, 20), roomId: room("CHM 111").id, organizerId: u("dchen") }),
    ev({ calendarId: courseCal("MATH"), title: "MATH 125 common exam", kind: "exam", startsAt: at(2026, 11, 17, 19), endsAt: at(2026, 11, 17, 21), roomId: room("MTH 101").id, organizerId: u("egrant") }),
    ev({ calendarId: courseCal("PHYS"), title: "PHYS 141 review session", kind: "event", startsAt: at(2026, 11, 8, 14), endsAt: at(2026, 11, 8, 16), roomId: room("PAS 201").id, organizerId: u("bmorales") }),
  ];
  // Office hours: weekly, on each faculty member's personal calendar, public so students can see.
  const officeHours: [string, string, number, number, string][] = [
    ["dchen", "MO,WE", 15, 0, "CHM 322"],
    ["lrodriguez", "TU", 13, 0, "CHM 330"],
    ["jpatel", "TH", 10, 0, "CHM 318"],
    ["sokoye", "MO,WE", 11, 0, "MTH 612"],
    ["egrant", "TU,TH", 13, 0, "MTH 604"],
    ["rkim", "WE", 14, 0, "MTH 516"],
    ["bmorales", "MO", 13, 0, "PAS 470"],
    ["cwu", "TH", 11, 0, "PAS 462"],
    ["aflores", "TU", 10, 0, "LSS 340"],
    ["sabbott", "WE", 10, 0, "GLD 745"],
    ["dmurphy", "TU,TH", 15, 30, "GLD 737"],
  ];
  const dayStart: Record<string, number> = { MO: 24, TU: 25, WE: 26, TH: 27, FR: 28 };
  for (const [netid, days, h, m, office] of officeHours) {
    const firstDay = dayStart[days.split(",")[0]!]!;
    everyday.push(
      ev({
        calendarId: mine(netid),
        title: "Office hours",
        kind: "office_hours",
        startsAt: at(2026, 8, firstDay, h, m),
        endsAt: at(2026, 8, firstDay, h + 1, m),
        rrule: `FREQ=WEEKLY;BYDAY=${days};${weeklyUntil}`,
        exdates: exAt(h, m),
        locationText: office,
        organizerId: u(netid),
      }),
    );
  }
  // Make faculty personal calendars readable (students and staff look up office hours).
  await db.execute(sql`update calendars set is_public = true where kind = 'personal' and owner_id in (select id from users where 'faculty' = any(roles))`);
  const inserted = await db.insert(schema.events).values(everyday).returning();
  const find = (title: string) => inserted.find((e) => e.title === title)!.id;
  await db.insert(schema.eventAttendees).values([
    ...["rmartinez", "kokafor", "anguyen"].map((n) => ({ eventId: find("Leadership team"), userId: u(n), response: "accepted" })),
    { eventId: find("Budget review with the Dean"), userId: u("mwhitfield"), response: "accepted" },
    { eventId: find("Spring timetable working session"), userId: u("rmartinez"), response: "accepted" },
    { eventId: find("Spring timetable working session"), userId: u("praman"), response: "tentative" },
    { eventId: find("Spring timetable working session"), userId: u("tbecker"), response: "needs_action" },
    ...["dchen", "lrodriguez", "jpatel", "hsantos"].map((n) => ({ eventId: find("Chemistry faculty meeting"), userId: u(n), response: "accepted" })),
    ...["egrant", "rkim", "nhassan"].map((n) => ({ eventId: find("Calculus coordination"), userId: u(n), response: "needs_action" })),
    ...["aflores", "mbrooks", "ytanaka"].map((n) => ({ eventId: find("Thesis defense: J. Alvarez"), userId: u(n), response: "accepted" })),
  ]);

  /* ---------------- Room bookings ---------------- */
  const roomBooking = async (label: string, netid: string, title: string, s: Date, e: Date, status: "pending" | "approved" | "denied", headcount: number, purpose?: string, note?: string) => {
    const [br] = await db
      .insert(schema.bookingRequests)
      .values({ roomId: room(label).id, requesterId: u(netid), title, purpose: purpose ?? null, startsAt: s, endsAt: e, attendeeCount: headcount, status, reviewerId: status === "pending" ? null : u("rmartinez"), reviewNote: note ?? null, reviewedAt: status === "pending" ? null : new Date() })
      .returning();
    if (status === "approved") {
      const [evRow] = await db.insert(schema.events).values(ev({ calendarId: roomCal(label), title, kind: "booking", startsAt: s, endsAt: e, roomId: room(label).id, organizerId: u(netid) })).returning();
      await db.update(schema.bookingRequests).set({ eventId: evRow!.id }).where(sql`${schema.bookingRequests.id} = ${br!.id}`);
    }
  };
  await roomBooking("ADM 210", "mbrooks", "Graduate admissions committee", at(2026, 11, 10, 14), at(2026, 11, 10, 15, 30), "pending", 9, "Reviewing PhD applications; need the video link for two remote members.");
  await roomBooking("ADM 100", "praman", "Chemistry alumni reception", at(2026, 11, 19, 17), at(2026, 11, 19, 19), "pending", 80, "Catered reception after the alumni lecture.");
  await roomBooking("ADM 210", "sabbott", "Industry advisory board", at(2026, 11, 6, 10), at(2026, 11, 6, 12), "approved", 14);
  await roomBooking("CHM 310", "jpatel", "Group meeting", at(2026, 11, 5, 9), at(2026, 11, 5, 10), "approved", 10);
  await roomBooking("ADM 100", "jlee", "Study night", at(2026, 11, 12, 18), at(2026, 11, 12, 22), "denied", 60, undefined, "The atrium isn't available for student-run events after 6pm; try LSS 250.");

  const [{ count }] = (await db.execute(sql`select count(*)::int as count from events`)).rows as [{ count: number }];
  console.log(
    `Seeded ${depts.length} departments, ${userRows.length} people, ${roomRows.length} rooms, ` +
      `${fallSections.length + springSections.length} sections (${published} published), ${count} events.`,
  );
}

await main();
await pool.end();
redis.disconnect();
