import path from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { defaultDataRoot } from "./store.js";

const { join, posix, win32 } = path;

const WIN_DRIVE = /^[A-Za-z]:[\\/]/;
const WIN_UNC = /^\\\\/;
const WIN_LONG_UNC = /^\\\\\?\\UNC\\/i;
const WIN_LONG = /^\\\\\?\\/;

/**
 * True when Cursor left a template unexpanded (e.g. literal `${workspaceFolder}`).
 * @param {string} value
 */
export function isUnexpandedTemplate(value) {
  return /\$\{[^}]+\}/.test(value);
}

/**
 * String looks like a Windows path (drive, UNC, `\\?\`) even on POSIX hosts.
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksWindowsPath(value) {
  if (typeof value !== "string") return false;
  const p = value.trim();
  return WIN_DRIVE.test(p) || WIN_UNC.test(p) || WIN_LONG.test(p);
}

/**
 * Use win32 path semantics: native Windows, or a Windows-shaped path on POSIX.
 * @param {unknown} value
 * @returns {boolean}
 */
export function usesWindowsPathApi(value) {
  return process.platform === "win32" || looksWindowsPath(value);
}

/**
 * @param {unknown} value
 * @returns {path.PlatformPath}
 */
export function pathApiFor(value) {
  return usesWindowsPathApi(value) ? win32 : posix;
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripWinLongPathPrefix(value) {
  if (WIN_LONG_UNC.test(value)) return `\\\\${value.slice(8)}`;
  if (WIN_LONG.test(value)) return value.slice(4);
  return value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function uppercaseDriveLetter(value) {
  return value.replace(/^([a-zA-Z]):/, (_, d) => `${d.toUpperCase()}:`);
}

/**
 * @param {string} value
 * @param {boolean} win
 * @returns {string}
 */
function stripTrailingSeparators(value, win) {
  if (win) {
    if (/^[A-Z]:\\$/i.test(value)) return value;
    if (/^\\\\[^\\]+\\[^\\]+$/.test(value)) return value;
    return value.replace(/[\\/]+$/, "");
  }
  if (value === "/") return value;
  return value.replace(/\/+$/, "");
}

/**
 * Stable workspace identity for store keys and board matching.
 * Trims; expands `~`; resolves `.`/`..`; unifies separators; strips trailing
 * `/` or `\`; uppercases a Windows drive letter. Rest of the path keeps case
 * for display; {@link workspaceIdentityKey} case-folds Windows paths for hashing.
 * @param {string} workspacePath
 * @returns {string}
 */
export function canonicalizeWorkspacePath(workspacePath) {
  const trimmed =
    typeof workspacePath === "string" ? workspacePath.trim() : "";
  const expanded = expandHomePath(trimmed);
  const win = usesWindowsPathApi(trimmed) || usesWindowsPathApi(expanded);
  if (win) {
    const stripped = stripWinLongPathPrefix(expanded);
    const resolved = uppercaseDriveLetter(win32.resolve(stripped));
    return stripTrailingSeparators(resolved, true);
  }
  const resolved = posix.resolve(expanded);
  return stripTrailingSeparators(resolved, false);
}

/**
 * Hash/compare key: canonical path, case-insensitive for Windows-style paths.
 * @param {string} workspacePath
 * @returns {string}
 */
export function workspaceIdentityKey(workspacePath) {
  const canonical = canonicalizeWorkspacePath(workspacePath);
  if (usesWindowsPathApi(workspacePath) || usesWindowsPathApi(canonical)) {
    return canonical.toLowerCase();
  }
  return canonical;
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
  const resolved = canonicalizeWorkspacePath(workspacePath);
  if (resolved === canonicalizeWorkspacePath(homedir())) return;
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
    return canonicalizeWorkspacePath(raw);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a caller-supplied workspace for MCP tool calls.
 * No env / active-workspace.txt fallback; never writes the active pointer.
 * @param {unknown} candidate
 * @returns {string}
 */
export function resolveExplicitWorkspace(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(
      "workspace is required (absolute path to the project root)",
    );
  }
  const trimmed = candidate.trim();
  if (isUnexpandedTemplate(trimmed)) {
    throw new Error(
      "workspace must be an absolute path (unexpanded template rejected)",
    );
  }
  return canonicalizeWorkspacePath(trimmed);
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
  const home = canonicalizeWorkspacePath(homedir());
  const remembered = readActiveWorkspace(dataRoot);

  if (candidate && typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed && !isUnexpandedTemplate(trimmed)) {
      const resolved = canonicalizeWorkspacePath(trimmed);
      if (resolved !== home) {
        rememberActiveWorkspace(resolved, dataRoot);
        return resolved;
      }
    }
  }

  if (remembered) return remembered;

  const fb = canonicalizeWorkspacePath(fallback);
  if (fb !== home) {
    rememberActiveWorkspace(fb, dataRoot);
    return fb;
  }

  return remembered ?? fb;
}
