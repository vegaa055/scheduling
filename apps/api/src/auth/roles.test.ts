import assert from "node:assert/strict";
import { test } from "node:test";
import { rolesFromAttributes } from "./roles.ts";

const base = { netid: "x", affiliations: [] as string[], groups: [] as string[] };
const roles = (a: Partial<typeof base>) => rolesFromAttributes({ ...base, ...a }).sort();

test("faculty with the generic employee affiliation are not staff", () => {
  assert.deepEqual(roles({ affiliations: ["faculty", "employee", "member"] }), ["faculty"]);
});

test("staff and employee-only accounts are staff", () => {
  assert.deepEqual(roles({ affiliations: ["staff", "member"] }), ["staff"]);
  assert.deepEqual(roles({ affiliations: ["employee"] }), ["staff"]);
});

test("a dean with faculty and staff affiliations gets both", () => {
  assert.deepEqual(roles({ affiliations: ["faculty", "staff"] }), ["faculty", "staff"]);
});

test("scoped affiliations are understood", () => {
  assert.deepEqual(roles({ affiliations: ["faculty@college.example.edu"] }), ["faculty"]);
});

test("group membership grants admin and scheduler", () => {
  assert.deepEqual(roles({ affiliations: ["staff"], groups: ["sched-admins"] }), ["admin", "staff"]);
  assert.deepEqual(roles({ affiliations: ["staff"], groups: ["SCHED-SCHEDULERS"] }), ["scheduler", "staff"]);
});

test("students and affiliates can only view", () => {
  assert.deepEqual(roles({ affiliations: ["student", "member"] }), ["viewer"]);
});
