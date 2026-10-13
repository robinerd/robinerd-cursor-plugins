import { basename } from "node:path";
import { SLICE_COLUMNS } from "./transitions.js";

/** @typedef {import("./store.js").BoardState} BoardState */
/** @typedef {import("./store.js").Initiative} Initiative */
/** @typedef {import("./store.js").InitiativeStatus} InitiativeStatus */
/** @typedef {import("./store.js").Slice} Slice */
/** @typedef {import("./store.js").SliceColumn} SliceColumn */

const INITIATIVE_STATUS_ORDER = [
  "planning",
  "building",
  "integrating",
  "done",
  "parked",
];

/** @type {Record<InitiativeStatus, string>} */
const INITIATIVE_STATUS_EMOJI = {
  planning: "✏️",
  building: "👷",
  integrating: "📦",
  done: "✅",
  parked: "⏸",
};

/** @type {Record<SliceColumn, string>} */
const LANE_BLOB = {
  ready: "⬜",
  approved: "✅",
  implement: "🟡",
  review: "🟣",
  verify: "🔵",
  blocked: "🔴",
  done: "🟢",
};

const DEFAULT_BOARD_UI_BASE = "http://127.0.0.1:4173";

/**
 * @param {string} [boardUiBase]
 * @returns {string}
 */
export function resolveBoardUiBase(boardUiBase) {
  const raw =
    boardUiBase ??
    process.env.HARNESS_BOARD_PUBLIC_URL ??
    DEFAULT_BOARD_UI_BASE;
  return String(raw).replace(/\/$/, "");
}

/**
 * @param {string} workspacePath
 * @param {string} [boardUiBase]
 * @returns {string}
 */
export function boardUiUrl(workspacePath, boardUiBase) {
  const base = resolveBoardUiBase(boardUiBase);
  return `${base}/?workspace=${encodeURIComponent(workspacePath)}`;
}

/**
 * @param {string} workspacePath
 * @returns {string}
 */
export function boardNameFromWorkspace(workspacePath) {
  const trimmed = String(workspacePath).replace(/[\\/]+$/, "");
  return basename(trimmed) || trimmed;
}

/**
 * @param {Initiative} initiative
 * @returns {boolean}
 */
function isSkippedInitiativeTitle(initiative) {
  const title = initiative.title ?? "";
  return title.startsWith("[SKIPPED]") || title.startsWith("[DUPLICATE]");
}

/**
 * @param {Initiative} initiative
 * @returns {boolean}
 */
export function isOpenInitiative(initiative) {
  if (isSkippedInitiativeTitle(initiative)) return false;
  return initiative.status !== "done";
}

/**
 * @param {Initiative} initiative
 * @returns {boolean}
 */
function initiativeNeedsAttention(initiative) {
  if (initiative.status === "done" || initiative.status === "parked") {
    return false;
  }
  return initiative.awaitingHuman === true;
}

/**
 * @param {BoardState} state
 * @param {string} initiativeId
 * @returns {Initiative | undefined}
 */
function findInitiative(state, initiativeId) {
  return state.initiatives.find((i) => i.id === initiativeId);
}

/**
 * @param {BoardState} state
 * @param {string} initiativeId
 * @returns {Slice[]}
 */
function slicesForInitiative(state, initiativeId) {
  return state.slices.filter((s) => s.initiativeId === initiativeId);
}

/**
 * @param {Slice[]} slices
 * @returns {Record<SliceColumn, Slice[]>}
 */
function groupSlicesByColumn(slices) {
  /** @type {Record<SliceColumn, Slice[]>} */
  const groups = Object.fromEntries(
    SLICE_COLUMNS.map((col) => [col, []]),
  );
  for (const slice of slices) {
    if (groups[slice.column]) {
      groups[slice.column].push(slice);
    }
  }
  return groups;
}

/**
 * @param {Record<SliceColumn, Slice[]>} groups
 * @returns {string}
 */
function formatLaneBlobSummary(groups) {
  const parts = [];
  for (const col of SLICE_COLUMNS) {
    const n = groups[col].length;
    if (n > 0) {
      parts.push(`${LANE_BLOB[col]}${n}`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : "no slices";
}

/**
 * @param {Record<SliceColumn, Slice[]>} groups
 * @returns {string[]}
 */
function formatLaneTableLines(groups) {
  const lines = [
    "| | Lane | Slices |",
    "|---|--------|--------|",
  ];
  for (const col of SLICE_COLUMNS) {
    const titles = groups[col].map((s) => s.title);
    const cell =
      titles.length > 0 ? titles.join("; ") : "—";
    lines.push(`| ${LANE_BLOB[col]} | ${col} | ${cell} |`);
  }
  return lines;
}

/**
 * @param {BoardState} state
 * @param {{ initiativeId?: string, boardName?: string }} [options]
 * @returns {string}
 */
export function formatInitiativeCard(state, options = {}) {
  const initiativeId = options.initiativeId;
  if (!initiativeId) {
    throw new Error("initiativeId is required");
  }
  const initiative = findInitiative(state, initiativeId);
  if (!initiative) {
    throw new Error(`initiative not found: ${initiativeId}`);
  }

  const boardName =
    options.boardName ?? boardNameFromWorkspace(state.workspacePath);
  const status = initiative.status;
  const emoji = INITIATIVE_STATUS_EMOJI[status] ?? "";
  const slices = slicesForInitiative(state, initiativeId);
  const groups = groupSlicesByColumn(slices);
  const summary = formatLaneBlobSummary(groups);

  const lines = [
    `:::${boardName}`,
    `### ${initiative.title}`,
    `**Status:** ${emoji} ${status}`,
    "<details>",
    `<summary>${summary}</summary>`,
    "",
    ...formatLaneTableLines(groups),
    "",
    "</details>",
    ":::",
  ];
  return lines.join("\n");
}

/**
 * @param {BoardState} state
 * @param {{ boardUiBase?: string }} [options]
 * @returns {string[]}
 */
function formatBoardSummarySection(state, options = {}) {
  const open = state.initiatives.filter(isOpenInitiative);
  if (open.length === 0) {
    return [];
  }

  const boardName = boardNameFromWorkspace(state.workspacePath);
  const url = boardUiUrl(state.workspacePath, options.boardUiBase);
  const boardAttention = open.some(initiativeNeedsAttention);
  const boardDot = boardAttention ? "❗ " : "";

  /** @type {Record<InitiativeStatus, Initiative[]>} */
  const groups = Object.fromEntries(
    INITIATIVE_STATUS_ORDER.map((s) => [s, []]),
  );
  for (const initiative of open) {
    const status = initiative.status;
    if (groups[status]) {
      groups[status].push(initiative);
    }
  }

  const statusCounts = [];
  for (const status of INITIATIVE_STATUS_ORDER) {
    const n = groups[status].length;
    if (n > 0) {
      statusCounts.push(`${INITIATIVE_STATUS_EMOJI[status]}${n}`);
    }
  }

  const lines = [
    `### ${boardDot}${boardName} [[↗]](${url})`,
    "<details>",
    `<summary>${open.length} open · ${statusCounts.join(" ")}</summary>`,
    "",
  ];

  for (const status of INITIATIVE_STATUS_ORDER) {
    const items = groups[status];
    if (items.length === 0) continue;
    lines.push(`**${INITIATIVE_STATUS_EMOJI[status]} ${status}**`);
    for (const initiative of items) {
      const idot = initiativeNeedsAttention(initiative) ? "❗ " : "";
      const blurb = (initiative.blurb ?? "").trim() || "_No description._";
      const nxt = (initiative.nextSteps ?? "").trim();
      lines.push(`- **${idot}${initiative.title}**`);
      lines.push("  <details>");
      lines.push("  <summary>details</summary>");
      lines.push("");
      if (nxt) {
        lines.push(`  ${blurb}  `);
        lines.push(`  **Next steps:** ${nxt}`);
      } else {
        lines.push(`  ${blurb}`);
      }
      lines.push("");
      lines.push("  </details>");
    }
    lines.push("");
  }

  lines.push("</details>");
  return lines;
}

/**
 * @param {BoardState} state
 * @returns {number}
 */
export function countOpenInitiatives(state) {
  return state.initiatives.filter(isOpenInitiative).length;
}

/**
 * @param {BoardState[]} states
 * @param {{ boardUiBase?: string }} [options]
 * @returns {string}
 */
export function formatBoardSummary(states, options = {}) {
  const sections = [];
  for (const state of states) {
    const part = formatBoardSummarySection(state, options);
    if (part.length > 0) {
      sections.push(part.join("\n"));
    }
  }
  if (sections.length === 0) {
    return ":::Board_Summary\n:::";
  }
  return [":::Board_Summary", ...sections, ":::"].join("\n");
}
