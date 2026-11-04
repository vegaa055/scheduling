import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRecurUntil, expand, fromFloating, toFloating } from "./recurrence.ts";

const PHX = "America/Phoenix";
const NY = "America/New_York";

test("floating conversion round-trips", () => {
  const d = new Date("2026-11-04T16:30:00Z"); // 9:30am in Phoenix
  assert.equal(toFloating(d, PHX).toISOString(), "2026-11-04T09:30:00.000Z");
  assert.equal(fromFloating(toFloating(d, PHX), PHX).toISOString(), d.toISOString());
});

test("weekly MWF class expands within a week", () => {
  const series = {
    startsAt: new Date("2026-08-24T16:00:00Z"), // Mon 9:00 MST
    endsAt: new Date("2026-08-24T16:50:00Z"),
    timezone: PHX,
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261209T235959Z",
    exdates: [],
  };
  const week = expand(series, new Date("2026-11-01T07:00:00Z"), new Date("2026-11-08T07:00:00Z"));
  assert.deepEqual(
    week.map((o) => o.start.toISOString()),
    ["2026-11-02T16:00:00.000Z", "2026-11-04T16:00:00.000Z", "2026-11-06T16:00:00.000Z"],
  );
});

test("exdates remove holidays", () => {
  const series = {
    startsAt: new Date("2026-11-02T16:00:00Z"),
    endsAt: new Date("2026-11-02T16:50:00Z"),
    timezone: PHX,
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6",
    exdates: [new Date("2026-11-11T16:00:00Z")], // Veterans Day
  };
  const all = expand(series, new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
  assert.equal(all.length, 5);
  assert.ok(!all.some((o) => o.start.toISOString().startsWith("2026-11-11")));
});

test("wall-clock time is kept across a DST change in zones that observe it", () => {
  const series = {
    startsAt: new Date("2026-10-26T13:00:00Z"), // Mon 9:00 EDT
    endsAt: new Date("2026-10-26T14:00:00Z"),
    timezone: NY,
    rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=2",
    exdates: [],
  };
  const [a, b] = expand(series, new Date("2026-10-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z"));
  assert.equal(a!.start.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.equal(b!.start.toISOString(), "2026-11-02T14:00:00.000Z"); // still 9:00, now EST
});

test("recurUntil is the end of the final occurrence", () => {
  const until = computeRecurUntil({
    startsAt: new Date("2026-11-02T16:00:00Z"),
    endsAt: new Date("2026-11-02T16:50:00Z"),
    timezone: PHX,
    rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=3",
    exdates: [],
  });
  assert.equal(until?.toISOString(), "2026-11-16T16:50:00.000Z");
});

test("open-ended series have no recurUntil", () => {
  assert.equal(
    computeRecurUntil({ startsAt: new Date(), endsAt: new Date(Date.now() + 3600e3), timezone: PHX, rrule: "FREQ=WEEKLY", exdates: [] }),
    null,
  );
});
