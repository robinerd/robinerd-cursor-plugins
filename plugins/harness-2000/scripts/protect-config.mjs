#!/usr/bin/env node
/**
 * Deny edits (and shell that targets) control-plane paths.
 * Defaults: `.cursor/`, `secrets/`.
 * Optional workspace override: `.cursor/protect-paths.json`
 *   { "denyPrefixes": [], "denyExact": [], "shellTargets": [] }
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PREFIXES = [".cursor/", "secrets/"];
const DEFAULT_EXACT = [];
const DEFAULT_SHELL_TARGETS = [".cursor/", "secrets/"];

function loadOverrides(roots) {
  for (const root of roots) {
    const p = path.join(root, ".cursor", "protect-paths.json");
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      if (raw && typeof raw === "object") return raw;
    } catch {
      // ignore malformed override; keep defaults
    }
  }
  return {};
}

function asStringList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function buildPolicy(roots) {
  const o = loadOverrides(roots);
  const denyPrefixes = asStringList(o.denyPrefixes);
  const denyExact = asStringList(o.denyExact);
  const shellTargets = asStringList(o.shellTargets);
  return {
    denyPrefixes: denyPrefixes.length ? denyPrefixes : DEFAULT_PREFIXES,
    denyExact: new Set(denyExact.length ? denyExact : DEFAULT_EXACT),
    shellTargets: shellTargets.length ? shellTargets : DEFAULT_SHELL_TARGETS,
  };
}

function relNorm(p, roots) {
  if (!p || typeof p !== "string") return null;
  let abs = p;
  if (!path.isAbsolute(abs) && roots[0]) {
    abs = path.resolve(roots[0], abs);
  }
  abs = path.normalize(abs).replace(/\\/g, "/");
  for (const root of roots) {
    const r = path.normalize(root).replace(/\\/g, "/").replace(/\/$/, "");
    const prefix = r + "/";
    if (abs === r) return "";
    if (abs.startsWith(prefix)) return abs.slice(prefix.length);
  }
  return abs.replace(/^\.\//, "");
}

function isDeniedRel(rel, policy) {
  if (rel == null) return false;
  const n = rel.replace(/\\/g, "/");
  if (policy.denyExact.has(n)) return true;
  return policy.denyPrefixes.some(
    (p) => n === p.replace(/\/$/, "") || n.startsWith(p.endsWith("/") ? p : p + "/"),
  );
}

function pathsFromToolInput(input) {
  if (!input || typeof input !== "object") return [];
  const keys = ["path", "file_path", "filePath", "target_notebook", "notebook_path"];
  const out = [];
  for (const k of keys) {
    if (typeof input[k] === "string") out.push(input[k]);
  }
  return out;
}

function shellLooksLikeControlPlaneEdit(command, policy) {
  if (!command || typeof command !== "string") return false;
  const c = command.toLowerCase();
  const writey = />|>>|tee |rm |del |move |mv |cp |copy |sed -i|perl -i/;
  if (!writey.test(c)) return false;
  return policy.shellTargets.some((t) => c.includes(t.toLowerCase()));
}

const raw = fs.readFileSync(0, "utf8");
let data;
try {
  data = JSON.parse(raw || "{}");
} catch {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const roots = Array.isArray(data.workspace_roots) ? data.workspace_roots : [];
const policy = buildPolicy(roots);
const event = data.hook_event_name || "";

if (event === "beforeShellExecution" || data.command) {
  const command = data.command || data.tool_input?.command;
  if (shellLooksLikeControlPlaneEdit(command, policy)) {
    console.log(
      JSON.stringify({
        permission: "deny",
        user_message: "Blocked: shell would modify protected control-plane files.",
        agent_message:
          "Do not modify protected paths (see `.cursor/protect-paths.json` or plugin defaults). Escalate in chat if the user explicitly requested that change.",
      }),
    );
    process.exit(0);
  }
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const toolInput = data.tool_input || data;
const candidates = pathsFromToolInput(toolInput);
for (const p of candidates) {
  const rel = relNorm(p, roots);
  if (isDeniedRel(rel, policy)) {
    console.log(
      JSON.stringify({
        permission: "deny",
        user_message: `Blocked write to protected path: ${rel}`,
        agent_message:
          "That path is control-plane (immutable at runtime). Delegate elsewhere or escalate to the user.",
      }),
    );
    process.exit(0);
  }
}

console.log(JSON.stringify({ permission: "allow" }));
