import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvCell, parseCsv, toCsv, unguard } from "./csv.ts";
import { planImport, type ImportContext } from "./section-import.ts";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, embedded line breaks and CRLF", () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"two, too","say ""hi"""\r\n3,"multi\nline",x\n');
    assert.deepEqual(
      rows.map((r) => r.cells),
      [
        ["a", "b", "c"],
        ["1", "two, too", 'say "hi"'],
        ["3", "multi\nline", "x"],
      ],
    );
    assert.deepEqual(
      rows.map((r) => r.line),
      [1, 2, 3],
    );
  });

  it("keeps line numbers right after a quoted line break", () => {
    const rows = parseCsv('h\n"a\nb"\nc');
    assert.deepEqual(
      rows.map((r) => [r.line, r.cells[0]]),
      [
        [1, "h"],
        [2, "a\nb"],
        [4, "c"],
      ],
    );
  });

  it("round-trips through toCsv, guarding formula-like cells", () => {
    const out = toCsv([
      ["CHEM", "General Chemistry, I", '"Quoted"'],
      ["=SUM(A1)", "+1", "@x"],
    ]);
    const back = parseCsv(out).map((r) => r.cells.map(unguard));
    assert.deepEqual(back, [
      ["CHEM", "General Chemistry, I", '"Quoted"'],
      ["=SUM(A1)", "+1", "@x"],
    ]);
    assert.equal(csvCell("=1+1"), "'=1+1");
  });
});

const ctx = (): ImportContext => ({
  termName: "Spring 2027",
  departments: new Map([
    ["CHEM", "dept-chem"],
    ["MATH", "dept-math"],
  ]),
  courses: new Map([["CHEM 151", { id: "c151", title: "General Chemistry I", credits: 4, departmentId: "dept-chem" }]]),
  people: new Map([
    ["dchen", "u-dchen"],
    ["jpatel", "u-jpatel"],
  ]),
  patternFamilies: new Set(["MWF50", "TR75", "LAB170"]),
  roomFeatures: new Set(["projector", "wet_lab", "lecture_capture"]),
  sections: new Map([
    ["c151|001", { id: "s1", instructorId: "u-dchen", enrollmentCap: 200, allowedPatterns: ["MWF50", "TR75"], requiredFeatures: ["lecture_capture"], cohorts: [], status: "published" }],
    ["c151|002", { id: "s2", instructorId: "u-jpatel", enrollmentCap: 200, allowedPatterns: ["MWF50"], requiredFeatures: [], cohorts: [], status: "unscheduled" }],
  ]),
});
const plan = (csv: string, c = ctx()) => planImport(parseCsv(csv), c);

describe("planImport", () => {
  it("creates new courses, sections and people, and leaves unchanged sections alone", () => {
    const p = plan(
      [
        "Subject,Catalog Nbr,Title,Dept,Section,Instructor NetID,Instructor Name,Cap,Patterns,Features,Cohorts",
        "CHEM,151,General Chemistry I,CHEM,001,dchen,,200,TR75 MWF50,lecture_capture,",
        "MATH,122A,Functions for Calculus,MATH,001,newprof,Ada Byron,45,MWF50;TR75,projector,first-year",
        "MATH,122A,Functions for Calculus,MATH,002,newprof,Ada Byron,45,MWF50,projector,",
      ].join("\n"),
    );
    assert.deepEqual(p.result.errors, []);
    assert.equal(p.result.rows, 3);
    assert.deepEqual(p.result.sections, { created: 2, updated: 0, unchanged: 1 });
    assert.deepEqual(p.result.courses, { created: 1, updated: 0 });
    assert.deepEqual(p.result.newPeople, ["newprof"]);
    assert.deepEqual(p.newPeople, [{ netid: "newprof", displayName: "Ada Byron", email: "", departmentId: "dept-math" }]);
    assert.equal(p.result.notInFile, 1);
    assert.deepEqual(p.newSections[0], {
      courseKey: "MATH 122A",
      sectionNumber: "001",
      enrollmentCap: 45,
      allowedPatterns: ["MWF50", "TR75"],
      instructorNetid: "newprof",
      requiredFeatures: ["projector"],
      cohorts: ["first-year"],
    });
  });

  it("only changes the columns the file has, and counts published sections that need republishing", () => {
    const p = plan("subject,number,section,cap,patterns\nCHEM,151,001,180,MWF50 TR75\nCHEM,151,002,200,MWF50\n");
    assert.deepEqual(p.result.errors, []);
    assert.deepEqual(p.result.sections, { created: 0, updated: 1, unchanged: 1 });
    assert.deepEqual(p.sectionUpdates, [{ id: "s1", enrollmentCap: 180, allowedPatterns: ["MWF50", "TR75"] }]);
    assert.equal(p.result.republishNeeded, 1);
  });

  it("clears the instructor when the instructor column is blank", () => {
    const p = plan("subject,number,section,instructor_netid,cap,patterns\nCHEM,151,002,,200,MWF50\n");
    assert.deepEqual(p.sectionUpdates, [{ id: "s2", enrollmentCap: 200, allowedPatterns: ["MWF50"], instructorNetid: null }]);
  });

  it("reports missing columns before anything else", () => {
    const p = plan("subject,number,cap\nCHEM,151,10\n");
    assert.equal(p.result.errors.length, 1);
    assert.match(p.result.errors[0]!.message, /Missing columns: section, patterns/);
  });

  it("explains each bad row with its line number", () => {
    const p = plan(
      [
        "subject,number,title,department,section,instructor_netid,cap,patterns,features",
        "PHYS,141,Mechanics,PHYS,001,dchen,175,MWF50,",
        "CHEM,151,,,003,ghost,abc,XYZ99,",
        "CHEM,151,,,002,jpatel,200,MWF50,hologram",
        "CHEM,151,,,002,jpatel,200,MWF50,",
      ].join("\r\n"),
    );
    const byLine = (n: number) => p.result.errors.filter((e) => e.line === n).map((e) => e.message);
    assert.match(byLine(2).join(" "), /no department with code "PHYS"/);
    assert.match(byLine(3).join(" "), /Enrollment cap "abc"/);
    assert.match(byLine(3).join(" "), /XYZ99 isn't a meeting pattern in Spring 2027/);
    assert.match(byLine(3).join(" "), /No one with NetID "ghost"/);
    assert.match(byLine(5).join(" "), /already on line 4/);
    assert.match(p.result.warnings.map((w) => w.message).join(" "), /"hologram"/);
  });

  it("updates a course title and credits once, however many sections mention it", () => {
    const p = plan(
      "subject,number,title,credits,section,cap,patterns\nCHEM,151,General Chemistry I (with lab),5,001,200,MWF50 TR75\nCHEM,151,General Chemistry I (with lab),5,002,200,MWF50\n",
    );
    assert.deepEqual(p.courseUpdates, [{ id: "c151", title: "General Chemistry I (with lab)", credits: 5 }]);
  });
});
