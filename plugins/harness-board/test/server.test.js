import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initiativeCollapsedByDefault,
  renderBoardHtml,
  sortInitiativesForDisplay,
} from "../lib/server.js";

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

test("initiativeCollapsedByDefault: done only", () => {
  assert.equal(initiativeCollapsedByDefault("done"), true);
  assert.equal(initiativeCollapsedByDefault("planning"), false);
  assert.equal(initiativeCollapsedByDefault("building"), false);
  assert.equal(initiativeCollapsedByDefault("integrating"), false);
  assert.equal(initiativeCollapsedByDefault("parked"), false);
});

test("renderBoardHtml: done starts collapsed; others expanded; toggle present", () => {
  const html = renderBoardHtml({
    workspacePath: "/tmp/ws",
    updatedAt: "2026-08-18T00:00:00.000Z",
    initiatives: [
      init("done-1", "done", "2026-08-18T00:00:00.000Z"),
      init("plan-1", "planning", "2026-08-18T00:00:00.000Z"),
      init("park-1", "parked", "2026-08-18T00:00:00.000Z"),
    ],
    slices: [
      {
        id: "s-done",
        initiativeId: "done-1",
        title: "Finished slice",
        column: "done",
        evidence: [],
        history: [],
      },
    ],
  });

  assert.match(
    html,
    /data-initiative-id="done-1"[^>]*data-collapsed="true"/,
  );
  assert.match(html, /class="initiative is-collapsed"[^>]*data-initiative-id="done-1"/);
  assert.match(
    html,
    /data-initiative-id="done-1"[\s\S]*?class="initiative-toggle"[^>]*aria-expanded="false"/,
  );
  assert.match(html, /id="initiative-details-done-1"/);
  assert.match(html, /data-plan-link/);
  assert.match(html, /class="columns"/);
  assert.match(html, /Finished slice/);

  assert.match(html, /data-initiative-id="plan-1"/);
  assert.doesNotMatch(
    html,
    /data-initiative-id="plan-1"[^>]*data-collapsed/,
  );
  assert.match(
    html,
    /data-initiative-id="plan-1"[\s\S]*?class="initiative-toggle"[^>]*aria-expanded="true"/,
  );

  assert.match(html, /data-initiative-id="park-1"/);
  assert.doesNotMatch(
    html,
    /data-initiative-id="park-1"[^>]*data-collapsed/,
  );

  assert.match(html, /harness-board:initiative-collapsed/);
});
