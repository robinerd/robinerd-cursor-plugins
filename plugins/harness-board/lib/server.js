import http from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve as pathResolve, sep } from "node:path";
import { getState } from "./store.js";
import { initiativeNeedsAttention, resolveSelectedWorkspace } from "./boards.js";
import {
  ACTIONS,
  SLICE_COLUMNS,
  TransitionError,
  humanUnblock,
  implementerStart,
  implementerSubmit,
  initiativeUpsert,
  park,
  reviewerVerdict,
  sliceAdd,
  sliceApprove,
  verifierVerdict,
} from "./transitions.js";

/** @typedef {import("./store.js").BoardState} BoardState */
/** @typedef {import("./store.js").StoreOptions} StoreOptions */
/** @typedef {import("./boards.js").BoardSummary} BoardSummary */

const INITIATIVE_STATUS_LABELS = Object.freeze({
  planning: "Planning",
  building: "Building",
  integrating: "Integrating",
  done: "Done",
  parked: "Parked",
});

const COLUMN_LABELS = Object.freeze({
  ready: "Ready",
  approved: "Approved",
  implement: "Implement",
  review: "Review",
  verify: "Verify",
  done: "Done",
  blocked: "Blocked",
});

/**
 * @typedef {object} BoardServerOptions
 * @property {string} [workspacePath] Optional default workspace (e2e / HARNESS_BOARD_WORKSPACE).
 * @property {string} [dataRoot]
 * @property {string} [host]
 * @property {number} [port]
 */

/**
 * Dispatch a named transition action (same names MCP will expose).
 * @param {string} workspacePath
 * @param {Record<string, unknown>} body
 * @param {StoreOptions} [options]
 */
export async function dispatchAction(workspacePath, body, options = {}) {
  if (!body || typeof body !== "object") {
    throw new TransitionError("request body must be a JSON object", {
      allowedActions: Object.values(ACTIONS),
    });
  }
  const action = body.action;
  if (typeof action !== "string" || !action) {
    throw new TransitionError("missing action", {
      allowedActions: Object.values(ACTIONS),
    });
  }

  switch (action) {
    case ACTIONS.INITIATIVE_UPSERT: {
      if (typeof body.planPath !== "string" || typeof body.title !== "string") {
        throw new TransitionError(
          "initiative_upsert requires planPath and title",
          { action, allowedActions: Object.values(ACTIONS) },
        );
      }
      return initiativeUpsert(
        workspacePath,
        {
          id: typeof body.id === "string" ? body.id : undefined,
          planPath: body.planPath,
          title: body.title,
          blurb: typeof body.blurb === "string" ? body.blurb : undefined,
          nextSteps:
            typeof body.nextSteps === "string" ? body.nextSteps : undefined,
          status:
            typeof body.status === "string"
              ? /** @type {import("./store.js").InitiativeStatus} */ (body.status)
              : undefined,
          awaitingHuman:
            typeof body.awaitingHuman === "boolean"
              ? body.awaitingHuman
              : undefined,
        },
        options,
      );
    }
    case ACTIONS.SLICE_ADD: {
      if (
        typeof body.initiativeId !== "string" ||
        typeof body.title !== "string"
      ) {
        throw new TransitionError(
          "slice_add requires initiativeId and title",
          { action, allowedActions: Object.values(ACTIONS) },
        );
      }
      return sliceAdd(
        workspacePath,
        {
          initiativeId: body.initiativeId,
          title: body.title,
          notes: typeof body.notes === "string" ? body.notes : undefined,
          checklist: Array.isArray(body.checklist)
            ? /** @type {string[]} */ (body.checklist)
            : undefined,
        },
        options,
      );
    }
    case ACTIONS.SLICE_APPROVE: {
      if (typeof body.sliceId !== "string") {
        throw new TransitionError("slice_approve requires sliceId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return sliceApprove(
        workspacePath,
        {
          sliceId: body.sliceId,
          note: typeof body.note === "string" ? body.note : undefined,
        },
        options,
      );
    }
    case ACTIONS.IMPLEMENTER_START: {
      if (typeof body.sliceId !== "string") {
        throw new TransitionError("implementer_start requires sliceId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return implementerStart(
        workspacePath,
        { sliceId: body.sliceId },
        options,
      );
    }
    case ACTIONS.IMPLEMENTER_SUBMIT: {
      if (typeof body.sliceId !== "string") {
        throw new TransitionError("implementer_submit requires sliceId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return implementerSubmit(
        workspacePath,
        {
          sliceId: body.sliceId,
          summary: typeof body.summary === "string" ? body.summary : "",
          filesTouched: Array.isArray(body.filesTouched)
            ? /** @type {string[]} */ (body.filesTouched)
            : undefined,
        },
        options,
      );
    }
    case ACTIONS.REVIEWER_VERDICT: {
      if (typeof body.sliceId !== "string") {
        throw new TransitionError("reviewer_verdict requires sliceId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return reviewerVerdict(
        workspacePath,
        {
          sliceId: body.sliceId,
          verdict: /** @type {"approve" | "revise" | "bounce"} */ (body.verdict),
          findings: body.findings,
        },
        options,
      );
    }
    case ACTIONS.VERIFIER_VERDICT: {
      if (typeof body.sliceId !== "string") {
        throw new TransitionError("verifier_verdict requires sliceId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return verifierVerdict(
        workspacePath,
        {
          sliceId: body.sliceId,
          verdict: /** @type {"pass" | "fail" | "bounce" | "replan"} */ (
            body.verdict
          ),
          evidence: body.evidence,
        },
        options,
      );
    }
    case ACTIONS.HUMAN_UNBLOCK: {
      if (typeof body.sliceId !== "string") {
        throw new TransitionError("human_unblock requires sliceId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return humanUnblock(
        workspacePath,
        {
          sliceId: body.sliceId,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        },
        options,
      );
    }
    case ACTIONS.PARK: {
      if (typeof body.initiativeId !== "string") {
        throw new TransitionError("park requires initiativeId", {
          action,
          allowedActions: Object.values(ACTIONS),
        });
      }
      return park(
        workspacePath,
        {
          initiativeId: body.initiativeId,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        },
        options,
      );
    }
    default:
      throw new TransitionError(
        `unknown action: ${action}; allowed: ${Object.values(ACTIONS).join(", ")}`,
        { action, allowedActions: Object.values(ACTIONS) },
      );
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {string | null | undefined} path
 * @returns {string}
 */
function normPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Resolve planPath under workspace; reject path traversal.
 * @param {string} workspacePath
 * @param {string} planPath
 * @returns {string | null}
 */
export function resolveSafePlanPath(workspacePath, planPath) {
  if (
    typeof workspacePath !== "string" ||
    !workspacePath.trim() ||
    typeof planPath !== "string" ||
    !planPath.trim()
  ) {
    return null;
  }
  const root = pathResolve(workspacePath.trim());
  const candidate = isAbsolute(planPath.trim())
    ? pathResolve(planPath.trim())
    : pathResolve(root, planPath.trim());
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  const candNorm = candidate.toLowerCase();
  const rootNorm = root.toLowerCase();
  const prefixNorm = rootPrefix.toLowerCase();
  if (candNorm !== rootNorm && !candNorm.startsWith(prefixNorm)) {
    return null;
  }
  return candidate;
}

/**
 * @param {string} absPath
 * @returns {string}
 */
export function toFileUrl(absPath) {
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

/**
 * @param {string} workspacePath
 * @param {string} planPath
 */
function planViewHref(workspacePath, planPath) {
  const qs = new URLSearchParams({
    workspace: workspacePath,
    path: planPath,
  });
  return `/api/plan?${qs.toString()}`;
}

/**
 * Short label for sidebar (last path segment).
 * @param {string} workspacePath
 * @returns {string}
 */
function boardLabel(workspacePath) {
  const parts = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || workspacePath;
}

/**
 * Display rank: unfinished first, done last.
 * @param {string} [status]
 */
function initiativeDisplayRank(status) {
  return status === "done" ? 1 : 0;
}

/**
 * Done initiatives start collapsed; all other statuses start expanded.
 * @param {string} [status]
 * @returns {boolean}
 */
export function initiativeCollapsedByDefault(status) {
  return status === "done";
}

/**
 * Swimlane order: not done first, done last; newest `updatedAt` first within a group.
 * @param {import("./store.js").Initiative[]} initiatives
 * @returns {import("./store.js").Initiative[]}
 */
export function sortInitiativesForDisplay(initiatives) {
  return [...initiatives].sort((a, b) => {
    const rank = initiativeDisplayRank(a.status) - initiativeDisplayRank(b.status);
    if (rank !== 0) return rank;
    const aTime = a.updatedAt || "";
    const bTime = b.updatedAt || "";
    if (aTime !== bTime) return aTime < bTime ? 1 : -1;
    return (a.id || "").localeCompare(b.id || "");
  });
}

/**
 * Board swimlanes HTML (markers used by e2e).
 * @param {BoardState} state
 * @returns {string}
 */
function renderSwimlanes(state) {
  const initiatives = sortInitiativesForDisplay(state.initiatives ?? []);
  const slices = state.slices ?? [];
  const workspacePath = state.workspacePath || "";

  if (initiatives.length === 0) {
    return `<p class="empty" data-empty-board>No initiatives yet. Agents create them via the API.</p>`;
  }

  return initiatives
    .map((initiative) => {
      const statusLabel =
        INITIATIVE_STATUS_LABELS[initiative.status] ?? initiative.status;
      const mine = slices.filter((s) => s.initiativeId === initiative.id);
      const columns = SLICE_COLUMNS.map((col) => {
        const cards = mine
          .filter((s) => s.column === col)
          .map(
            (s) => `
                <article class="card" data-slice-id="${escapeHtml(s.id)}" data-column="${escapeHtml(col)}">
                  <h3 class="card-title">${escapeHtml(s.title)}</h3>
                  ${s.notes ? `<p class="card-notes">${escapeHtml(s.notes)}</p>` : ""}
                </article>`,
          )
          .join("");
        return `
              <div class="column" data-column="${escapeHtml(col)}">
                <h4 class="column-title">${escapeHtml(COLUMN_LABELS[col] ?? col)}</h4>
                <div class="column-cards">${cards || `<p class="column-empty">—</p>`}</div>
              </div>`;
      }).join("");

      const planPath = initiative.planPath || "";
      const abs = resolveSafePlanPath(workspacePath, planPath);
      const href =
        workspacePath && planPath ? planViewHref(workspacePath, planPath) : "#";
      const fileHref = abs ? toFileUrl(abs) : "";
      const titleAttr = fileHref ? ` title="${escapeHtml(fileHref)}"` : "";
      const needsAttention = initiativeNeedsAttention(initiative);
      const attentionAttr = needsAttention ? ` data-attention="true"` : "";
      const titleAria = needsAttention
        ? ` aria-label="${escapeHtml(`${initiative.title} — Needs your input`)}"`
        : "";
      const attentionDot = needsAttention
        ? `<span class="nav-dot" aria-hidden="true"></span>`
        : "";
      const collapsed = initiativeCollapsedByDefault(initiative.status);
      const collapsedClass = collapsed ? " is-collapsed" : "";
      const collapsedAttr = collapsed ? ` data-collapsed="true"` : "";
      const ariaExpanded = collapsed ? "false" : "true";
      const toggleLabel = collapsed ? "Expand initiative" : "Collapse initiative";
      const detailsId = `initiative-details-${escapeHtml(initiative.id)}`;
      const nextSteps =
        initiative.status === "integrating" &&
        typeof initiative.nextSteps === "string" &&
        initiative.nextSteps.trim()
          ? `<span class="initiative-next-steps"><strong>Next steps:</strong> ${escapeHtml(initiative.nextSteps)}</span>`
          : "";

      return `
            <section class="initiative${collapsedClass}" data-initiative-id="${escapeHtml(initiative.id)}" data-status="${escapeHtml(initiative.status)}"${attentionAttr}${collapsedAttr}>
              <header class="initiative-header">
                <div class="initiative-title-row">
                  <button type="button" class="initiative-toggle" aria-expanded="${ariaExpanded}" aria-controls="${detailsId}" aria-label="${escapeHtml(toggleLabel)}">
                    <span class="initiative-toggle-icon" aria-hidden="true"></span>
                  </button>
                  <h2 class="initiative-title"${titleAria}>${escapeHtml(initiative.title)}</h2>
                  ${attentionDot}
                  <span class="badge status-${escapeHtml(initiative.status)}" data-status-badge>${escapeHtml(statusLabel)}</span>
                </div>
                <p class="initiative-blurb" data-blurb>${escapeHtml(initiative.blurb || "")}${nextSteps}</p>
              </header>
              <div class="initiative-details" id="${detailsId}">
                <a class="plan-link" data-plan-link href="${escapeHtml(href)}"${titleAttr}>${escapeHtml(planPath)}</a>
                <div class="columns" role="list">${columns}</div>
              </div>
            </section>`;
    })
    .join("");
}

/**
 * @typedef {object} RenderShellOptions
 * @property {Array<BoardSummary & { selected?: boolean, active?: boolean, attention?: boolean }>} [boards]
 * @property {string | null} [selectedWorkspace]
 * @property {number} [selectedMtimeMs]
 */

/**
 * View-only board HTML with multi-board sidebar (no mutation controls).
 * @param {BoardState | null} state
 * @param {RenderShellOptions} [shell]
 * @returns {string}
 */
export function renderBoardHtml(state, shell = {}) {
  const boards = shell.boards ?? [];
  const selectedWorkspace =
    shell.selectedWorkspace ?? state?.workspacePath ?? null;
  const selectedMtimeMs = shell.selectedMtimeMs ?? 0;
  const swimlanes = state
    ? renderSwimlanes(state)
    : `<p class="empty" data-empty-board>No board selected. Pick a workspace from the sidebar, or wait for MCP to create one.</p>`;

  const navItems =
    boards.length === 0
      ? `<p class="nav-empty">No boards under data root yet.</p>`
      : boards
          .map((b) => {
            const selected = Boolean(b.selected);
            const active = Boolean(b.active);
            const attention = Boolean(b.attention ?? b.hasAttention);
            const href = `/?workspace=${encodeURIComponent(b.workspacePath)}`;
            const classes = [
              "nav-item",
              selected ? "is-selected" : "",
              active ? "is-active" : "",
              attention ? "has-attention" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const attentionAttr = attention ? ` data-attention="true"` : "";
            const attentionDot = attention
              ? `<span class="nav-dot" aria-hidden="true"></span>`
              : "";
            return `
            <a class="${classes}" href="${escapeHtml(href)}" data-board-hash="${escapeHtml(b.hash)}" data-workspace="${escapeHtml(b.workspacePath)}" title="${escapeHtml(b.workspacePath)}"${attentionAttr}>
              <span class="nav-label">${escapeHtml(boardLabel(b.workspacePath))}</span>
              ${attentionDot}
              ${active ? `<span class="nav-pill">active</span>` : ""}
            </a>`;
          })
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Harness Board</title>
  <style>
    :root {
      --bg: #f3f4f6;
      --surface: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #e5e7eb;
      --accent: #0f766e;
      --badge-bg: #ecfdf5;
      --badge-ink: #115e59;
      --nav-w: 240px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      color: var(--ink);
      background: var(--bg);
      line-height: 1.45;
    }
    .app {
      display: flex;
      min-height: 100vh;
    }
    .sidebar {
      width: var(--nav-w);
      flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--line);
      padding: 1rem 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .sidebar h1 {
      margin: 0 0 0.35rem;
      font-size: 1rem;
      letter-spacing: -0.02em;
      padding: 0 0.35rem;
    }
    .sidebar-hint {
      margin: 0 0 0.5rem;
      padding: 0 0.35rem;
      font-size: 0.75rem;
      color: var(--muted);
    }
    .nav-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      overflow-y: auto;
    }
    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.35rem;
      padding: 0.45rem 0.55rem;
      border-radius: 6px;
      color: var(--ink);
      text-decoration: none;
      font-size: 0.85rem;
      border: 1px solid transparent;
    }
    .nav-item:hover { background: var(--bg); }
    .nav-item.is-selected {
      background: #ecfdf5;
      border-color: #99f6e4;
      font-weight: 600;
    }
    .nav-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nav-pill {
      flex-shrink: 0;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent);
      font-weight: 700;
    }
    .nav-dot {
      flex-shrink: 0;
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #dc2626;
    }
    .nav-item.is-selected .nav-dot,
    .initiative .nav-dot {
      display: inline-block;
    }
    .nav-empty {
      margin: 0;
      padding: 0.35rem;
      color: var(--muted);
      font-size: 0.8rem;
    }
    .page {
      flex: 1;
      min-width: 0;
      max-width: 1400px;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 3rem;
    }
    .page-header h1 {
      margin: 0 0 0.25rem;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
    }
    .page-header p {
      margin: 0 0 1.5rem;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .workspace-path {
      margin: 0 0 1rem;
      font-size: 0.8rem;
      color: var(--muted);
      word-break: break-all;
    }
    .initiative {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 1rem 1rem 1.25rem;
      margin-bottom: 1.25rem;
    }
    .initiative.is-collapsed {
      padding-bottom: 0.75rem;
    }
    .initiative-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
    }
    .initiative-toggle {
      flex-shrink: 0;
      width: 1.5rem;
      height: 1.5rem;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .initiative-toggle:hover {
      background: var(--bg);
      color: var(--ink);
    }
    .initiative-toggle-icon {
      display: block;
      width: 0;
      height: 0;
      border-top: 5px solid transparent;
      border-bottom: 5px solid transparent;
      border-left: 7px solid currentColor;
      transform-origin: 35% 50%;
      transition: transform 0.12s ease;
    }
    .initiative:not(.is-collapsed) .initiative-toggle-icon {
      transform: rotate(90deg);
    }
    .initiative.is-collapsed .initiative-details {
      display: none;
    }
    .initiative-title {
      margin: 0;
      font-size: 1.15rem;
    }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--badge-bg);
      color: var(--badge-ink);
      text-transform: capitalize;
    }
    .status-parked { background: #f3f4f6; color: #4b5563; }
    .status-done { background: #eff6ff; color: #1d4ed8; }
    .status-integrating { background: #fef3c7; color: #92400e; }
    .initiative-blurb {
      margin: 0.5rem 0 0.35rem;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .initiative-next-steps {
      display: block;
      margin-top: 0.45rem;
    }
    .initiative-next-steps strong {
      color: #111827;
    }
    .plan-link {
      color: var(--accent);
      font-size: 0.85rem;
      word-break: break-all;
    }
    .columns {
      display: grid;
      grid-template-columns: repeat(7, minmax(120px, 1fr));
      gap: 0.65rem;
      margin-top: 1rem;
      overflow-x: auto;
    }
    .column {
      background: var(--bg);
      border-radius: 6px;
      padding: 0.5rem;
      min-height: 6rem;
    }
    .column-title {
      margin: 0 0 0.5rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0.55rem 0.65rem;
      margin-bottom: 0.45rem;
    }
    .card-title {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .card-notes {
      margin: 0.35rem 0 0;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .column-empty, .empty {
      margin: 0;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .meta {
      margin-top: 1rem;
      font-size: 0.8rem;
      color: var(--muted);
    }
    @media (max-width: 900px) {
      .app { flex-direction: column; }
      .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--line); }
      .columns { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar" data-boards-nav>
      <h1>Boards</h1>
      <p class="sidebar-hint">All workspaces · newest activity first</p>
      <nav class="nav-list">${navItems}</nav>
    </aside>
    <div class="page">
      <header class="page-header">
        <h1>Harness Board</h1>
        <p>View-only — agents advance slices via API / MCP. Auto-refreshes on activity.</p>
      </header>
      ${
        selectedWorkspace
          ? `<p class="workspace-path" data-selected-workspace>${escapeHtml(selectedWorkspace)}</p>`
          : ""
      }
      <main id="board"
        data-workspace="${escapeHtml(selectedWorkspace || "")}"
        data-mtime-ms="${escapeHtml(String(selectedMtimeMs))}">
        ${swimlanes}
      </main>
      <p class="meta" data-updated-at>Updated ${escapeHtml(state?.updatedAt || "")}</p>
    </div>
  </div>
  <script>
(function () {
  var POLL_MS = 2500;
  var STORAGE_KEY = "harness-board:initiative-collapsed";
  var boardEl = document.getElementById("board");
  if (!boardEl) return;
  var selectedPath = boardEl.getAttribute("data-workspace") || "";
  var lastMtime = Number(boardEl.getAttribute("data-mtime-ms") || "0");

  function norm(p) {
    var bs = String.fromCharCode(92);
    return String(p || "").split(bs).join("/").replace(new RegExp("/+$"), "").toLowerCase();
  }

  function readPrefs() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writePref(id, collapsed) {
    if (!id) return;
    var prefs = readPrefs();
    prefs[id] = collapsed;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) { /* quota / private mode */ }
  }

  function setCollapsed(el, collapsed) {
    el.classList.toggle("is-collapsed", collapsed);
    if (collapsed) el.setAttribute("data-collapsed", "true");
    else el.removeAttribute("data-collapsed");
    var btn = el.querySelector(".initiative-toggle");
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.setAttribute("aria-label", collapsed ? "Expand initiative" : "Collapse initiative");
    }
  }

  function applyPrefs() {
    var prefs = readPrefs();
    var nodes = boardEl.querySelectorAll(".initiative");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var id = el.getAttribute("data-initiative-id") || "";
      if (!id || !Object.prototype.hasOwnProperty.call(prefs, id)) continue;
      setCollapsed(el, Boolean(prefs[id]));
    }
  }

  boardEl.addEventListener("click", function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var btn = target.closest(".initiative-toggle");
    if (!btn || !boardEl.contains(btn)) return;
    var el = btn.closest(".initiative");
    if (!el) return;
    var next = !el.classList.contains("is-collapsed");
    setCollapsed(el, next);
    writePref(el.getAttribute("data-initiative-id") || "", next);
  });

  applyPrefs();

  function poll() {
    var url = "/api/boards";
    if (selectedPath) {
      url += "?workspace=" + encodeURIComponent(selectedPath);
    }
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var boards = data.boards || [];
        var current = boards.find(function (b) {
          return norm(b.workspacePath) === norm(selectedPath);
        }) || boards.find(function (b) { return b.selected; });
        if (current && Number(current.mtimeMs) !== lastMtime) {
          location.reload();
        }
      })
      .catch(function () { /* ignore transient poll errors */ });
  }

  setInterval(poll, POLL_MS);
})();
  </script>
</body>
</html>`;
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/**
 * @param {StoreOptions} storeOptions
 * @param {string | null | undefined} defaultWorkspace
 * @param {string | null | undefined} requested
 */
async function resolveSelection(storeOptions, defaultWorkspace, requested) {
  const { workspacePath, boards } = await resolveSelectedWorkspace({
    dataRoot: storeOptions.dataRoot,
    requested: requested ?? null,
    defaultWorkspace: defaultWorkspace ?? null,
  });
  return { workspacePath, boards };
}

/**
 * Mark selected (view) vs Active (has ongoing initiative work). Independent.
 * @param {BoardSummary[]} boards
 * @param {string | null} selectedWorkspace
 */
function annotateBoards(boards, selectedWorkspace) {
  const sel = normPath(selectedWorkspace);
  return boards.map((b) => ({
    ...b,
    selected: normPath(b.workspacePath) === sel,
    active: Boolean(b.hasActiveWork),
    attention: Boolean(b.hasAttention),
  }));
}

/**
 * @param {BoardServerOptions} options
 * @returns {http.Server}
 */
export function createBoardServer(options = {}) {
  const defaultWorkspace = options.workspacePath || undefined;
  /** @type {StoreOptions} */
  const storeOptions = {};
  if (options.dataRoot) storeOptions.dataRoot = options.dataRoot;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "127.0.0.1"}`,
      );
      const method = req.method || "GET";

      if (method === "GET" && url.pathname === "/api/boards") {
        const requested =
          url.searchParams.get("workspace") ||
          url.searchParams.get("hash") ||
          null;
        const { workspacePath, boards } = await resolveSelection(
          storeOptions,
          defaultWorkspace,
          requested,
        );
        const annotated = annotateBoards(boards, workspacePath);
        sendJson(res, 200, {
          boards: annotated,
          selectedWorkspace: workspacePath,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/api/state") {
        const requested =
          url.searchParams.get("workspace") ||
          url.searchParams.get("hash") ||
          null;
        const { workspacePath } = await resolveSelection(
          storeOptions,
          defaultWorkspace,
          requested,
        );
        if (!workspacePath) {
          sendJson(res, 404, {
            ok: false,
            error: "no board selected",
          });
          return;
        }
        const state = await getState(workspacePath, storeOptions);
        sendJson(res, 200, state);
        return;
      }

      if (method === "POST" && url.pathname === "/api/select") {
        const raw = await readBody(req);
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid JSON body" });
          return;
        }
        const workspace =
          typeof body.workspace === "string" ? body.workspace.trim() : "";
        if (!workspace) {
          sendJson(res, 400, { ok: false, error: "workspace is required" });
          return;
        }
        // Selection is client-side (?workspace=); do not write active-workspace.txt.
        sendJson(res, 200, { ok: true, workspace });
        return;
      }

      if (method === "POST" && url.pathname === "/api/action") {
        const raw = await readBody(req);
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, {
            ok: false,
            error: "invalid JSON body",
            allowedActions: Object.values(ACTIONS),
          });
          return;
        }
        const fromBody =
          typeof body.workspace === "string" && body.workspace.trim()
            ? body.workspace.trim()
            : null;
        const workspacePath = fromBody || defaultWorkspace;
        if (!workspacePath) {
          sendJson(res, 400, {
            ok: false,
            error: "workspace required (body.workspace or server default)",
            allowedActions: Object.values(ACTIONS),
          });
          return;
        }
        try {
          const result = await dispatchAction(
            workspacePath,
            body,
            storeOptions,
          );
          sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          if (err instanceof TransitionError) {
            sendJson(res, 400, {
              ok: false,
              error: err.message,
              action: err.action,
              column: err.column,
              allowedActions: err.allowedActions,
              sliceId: err.sliceId,
            });
            return;
          }
          throw err;
        }
        return;
      }

      if (method === "GET" && url.pathname === "/api/plan") {
        const workspace =
          url.searchParams.get("workspace") || defaultWorkspace || "";
        const planPath = url.searchParams.get("path") || "";
        const abs = resolveSafePlanPath(workspace, planPath);
        if (!abs) {
          sendJson(res, 400, {
            ok: false,
            error: "invalid plan path (must stay under workspace)",
          });
          return;
        }
        let text;
        try {
          text = await readFile(abs, "utf8");
        } catch (err) {
          const code = /** @type {NodeJS.ErrnoException} */ (err).code;
          sendJson(res, code === "ENOENT" ? 404 : 500, {
            ok: false,
            error:
              code === "ENOENT"
                ? `plan not found: ${planPath}`
                : err instanceof Error
                  ? err.message
                  : String(err),
          });
          return;
        }
        const fileHref = toFileUrl(abs);
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(planPath)}</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif; background: #f3f4f6; color: #1f2937; }
    header { padding: 1rem 1.25rem; background: #fff; border-bottom: 1px solid #e5e7eb; }
    header a { color: #0f766e; }
    pre {
      margin: 1rem 1.25rem 2rem;
      padding: 1rem;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .meta { color: #6b7280; font-size: 0.85rem; margin-top: 0.35rem; }
  </style>
</head>
<body>
  <header>
    <div><strong>${escapeHtml(planPath)}</strong></div>
    <div class="meta">${escapeHtml(abs)}</div>
    <div class="meta"><a href="${escapeHtml(fileHref)}">${escapeHtml(fileHref)}</a> (may be blocked from http pages — copy into Explorer / Cursor)</div>
  </header>
  <pre>${escapeHtml(text)}</pre>
</body>
</html>`;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      if (
        method === "GET" &&
        (url.pathname === "/" || url.pathname === "/index.html")
      ) {
        const requested =
          url.searchParams.get("workspace") ||
          url.searchParams.get("hash") ||
          null;
        const { workspacePath, boards } = await resolveSelection(
          storeOptions,
          defaultWorkspace,
          requested,
        );
        const annotated = annotateBoards(boards, workspacePath);
        const selectedSummary = annotated.find((b) => b.selected);
        /** @type {BoardState | null} */
        let state = null;
        if (workspacePath) {
          state = await getState(workspacePath, storeOptions);
        }
        const html = renderBoardHtml(state, {
          boards: annotated,
          selectedWorkspace: workspacePath,
          selectedMtimeMs: selectedSummary?.mtimeMs ?? 0,
        });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  return server;
}

/**
 * Bind the board server on localhost and print the URL.
 * @param {BoardServerOptions} options
 * @returns {Promise<{ server: http.Server, url: string, port: number }>}
 */
export function startBoardServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  const server = createBoardServer(options);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind server"));
        return;
      }
      const port = addr.port;
      const url = `http://${host}:${port}`;
      console.log(url);
      resolve({ server, url, port });
    });
  });
}
