import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { defaultDataRoot } from "./store.js";

/**
 * True when Cursor left a template unexpanded (e.g. literal `${workspaceFolder}`).
 * @param {string} value
 */
export function isUnexpandedTemplate(value) {
  return /\$\{[^}]+\}/.test(value);
}

/**
 * Expand leading `~` and collapse corrupt `/~/` (or `\~\`) segments.
 * `path.resolve` does not expand `~`; without this, `~/proj` and
 * `/Users/u/~/proj` hash to different store buckets than the real path.
 * @param {string} value
 * @returns {string}
 */
export function expandHomePath(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  let p = value;
  if (p === "~") {
    p = homedir();
  } else if (p.startsWith("~/") || p.startsWith("~\\")) {
    p = join(homedir(), p.slice(2));
  }
  // Corrupt literal-tilde segment after an absolute prefix (posix + windows).
  while (p.includes("/~/")) {
    p = p.replace("/~/", "/");
  }
  while (p.includes("\\~\\")) {
    p = p.replace("\\~\\", "\\");
  }
  return p;
}

/**
 * @param {string} [dataRoot]
 * @returns {string}
 */
function activeWorkspaceFile(dataRoot) {
  return join(defaultDataRoot(dataRoot), "active-workspace.txt");
}

/**
 * Remember last good workspace so MCP/UI can recover when Cursor leaves
 * `${workspaceFolder}` unexpanded and process.cwd() is $HOME.
 * @param {string} workspacePath
 * @param {string} [dataRoot]
 */
export function rememberActiveWorkspace(workspacePath, dataRoot) {
  if (!workspacePath || isUnexpandedTemplate(workspacePath)) return;
  const resolved = resolve(expandHomePath(workspacePath));
  if (resolved === resolve(homedir())) return;
  try {
    const root = defaultDataRoot(dataRoot);
    mkdirSync(root, { recursive: true });
    writeFileSync(activeWorkspaceFile(dataRoot), resolved, "utf8");
  } catch {
    // best-effort pointer only
  }
}

/**
 * @param {string} [dataRoot]
 * @returns {string | undefined}
 */
export function readActiveWorkspace(dataRoot) {
  try {
    const raw = readFileSync(activeWorkspaceFile(dataRoot), "utf8").trim();
    if (!raw || isUnexpandedTemplate(raw)) return undefined;
    return resolve(expandHomePath(raw));
  } catch {
    return undefined;
  }
}

/**
 * Pick a usable workspace path. Plugin MCP env sometimes ships the literal
 * `${workspaceFolder}` string; never use that as a store key.
 * @param {string | undefined} candidate
 * @param {string} [fallback]
 * @param {string} [dataRoot]
 */
export function sanitizeWorkspacePath(
  candidate,
  fallback = process.cwd(),
  dataRoot,
) {
  const home = resolve(homedir());
  const remembered = readActiveWorkspace(dataRoot);

  if (candidate && typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed && !isUnexpandedTemplate(trimmed)) {
      const resolved = resolve(expandHomePath(trimmed));
      if (resolved !== home) {
        rememberActiveWorkspace(resolved, dataRoot);
        return resolved;
      }
    }
  }

  if (remembered) return remembered;

  const fb = resolve(expandHomePath(fallback));
  if (fb !== home) {
    rememberActiveWorkspace(fb, dataRoot);
    return fb;
  }

  return remembered ?? fb;
}
