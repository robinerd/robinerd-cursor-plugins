import assert from "node:assert/strict";
import { test } from "node:test";
import { sortInitiativesForDisplay } from "../lib/server.js";

/**
 * @param {string} id
 * @param {string} status
 * @param {string} updatedAt
 */
function init(id, status, updatedAt) {
  return {
    id,
    planPath: "plans/x.md",
    title: id,
    blurb: "",
    status,
    updatedAt,
  };
}

test("sortInitiativesForDisplay: not done first then done; newest first within each", () => {
  const t1 = "2026-01-01T00:00:00.000Z";
  const t2 = "2026-06-01T00:00:00.000Z";
  const t3 = "2026-08-17T00:00:00.000Z";
  const t4 = "2026-08-17T12:00:00.000Z";
  const sorted = sortInitiativesForDisplay([
    init("done-new", "done", t3),
    init("plan-old", "planning", t1),
    init("build-old", "building", t1),
    init("park-mid", "parked", t2),
    init("integ-new", "integrating", t3),
    init("done-old", "done", t1),
    init("build-new", "building", t4),
    init("plan-new", "planning", t4),
  ]);
  assert.deepEqual(
    sorted.map((i) => i.id),
    [
      "build-new",
      "plan-new",
      "integ-new",
      "park-mid",
      "build-old",
      "plan-old",
      "done-new",
      "done-old",
    ],
  );
});
