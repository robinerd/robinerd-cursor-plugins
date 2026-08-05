import http from "node:http";
import { getState } from "./store.js";
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
 * @property {string} workspacePath
 * @property {string} [dataRoot]
 * @property {string} [host]
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
          status:
            typeof body.status === "string"
              ? /** @type {import("./store.js").InitiativeStatus} */ (body.status)
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
 * View-only board HTML (no mutation controls).
 * @param {BoardState} state
 * @returns {string}
 */
export function renderBoardHtml(state) {
  const initiatives = state.initiatives ?? [];
  const slices = state.slices ?? [];

  const swimlanes =
    initiatives.length === 0
      ? `<p class="empty" data-empty-board>No initiatives yet. Agents create them via the API.</p>`
      : initiatives
          .map((initiative) => {
            const statusLabel =
              INITIATIVE_STATUS_LABELS[initiative.status] ?? initiative.status;
            const mine = slices.filter(
              (s) => s.initiativeId === initiative.id,
            );
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

            return `
            <section class="initiative" data-initiative-id="${escapeHtml(initiative.id)}" data-status="${escapeHtml(initiative.status)}">
              <header class="initiative-header">
                <div class="initiative-title-row">
                  <h2 class="initiative-title">${escapeHtml(initiative.title)}</h2>
                  <span class="badge status-${escapeHtml(initiative.status)}" data-status-badge>${escapeHtml(statusLabel)}</span>
                </div>
                <p class="initiative-blurb" data-blurb>${escapeHtml(initiative.blurb || "")}</p>
                <a class="plan-link" data-plan-link href="${escapeHtml(initiative.planPath)}">${escapeHtml(initiative.planPath)}</a>
              </header>
              <div class="columns" role="list">${columns}</div>
            </section>`;
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
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      color: var(--ink);
      background: var(--bg);
      line-height: 1.45;
    }
    .page {
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
    .initiative {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 1rem 1rem 1.25rem;
      margin-bottom: 1.25rem;
    }
    .initiative-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
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
      .columns { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="page-header">
      <h1>Harness Board</h1>
      <p>View-only — agents advance slices via API / MCP. Refresh to reload.</p>
    </header>
    <main id="board" data-workspace="${escapeHtml(state.workspacePath)}">
      ${swimlanes}
    </main>
    <p class="meta" data-updated-at>Updated ${escapeHtml(state.updatedAt || "")}</p>
  </div>
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
 * @param {BoardServerOptions} options
 * @returns {http.Server}
 */
export function createBoardServer(options) {
  const workspacePath = options.workspacePath;
  if (!workspacePath) {
    throw new Error("workspacePath is required");
  }
  /** @type {StoreOptions} */
  const storeOptions = {};
  if (options.dataRoot) storeOptions.dataRoot = options.dataRoot;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const method = req.method || "GET";

      if (method === "GET" && url.pathname === "/api/state") {
        const state = await getState(workspacePath, storeOptions);
        sendJson(res, 200, state);
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
        try {
          const result = await dispatchAction(workspacePath, body, storeOptions);
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

      if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const state = await getState(workspacePath, storeOptions);
        const html = renderBoardHtml(state);
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
 * Bind a random free port on localhost and print the URL.
 * @param {BoardServerOptions} options
 * @returns {Promise<{ server: http.Server, url: string, port: number }>}
 */
export function startBoardServer(options) {
  const host = options.host ?? "127.0.0.1";
  const server = createBoardServer(options);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
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
