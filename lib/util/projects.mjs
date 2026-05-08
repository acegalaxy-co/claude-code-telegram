/**
 * Project discovery: list children of PROJECTS_ROOT.
 *
 * A "project" is any direct child directory of PROJECTS_ROOT.
 * Hidden dirs (.git, .vscode, etc.) and broken symlinks are skipped.
 * Each project may have its own .claude/ harness — Claude CLI auto-loads it
 * when spawned with cwd=<project-path>.
 */

import fs from "node:fs";
import path from "node:path";

export function listProjects(projectsRoot) {
  if (!projectsRoot) return [];
  let entries;
  try { entries = fs.readdirSync(projectsRoot, { withFileTypes: true }); }
  catch { return []; }

  const projects = [];
  for (const ent of entries) {
    if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
    if (ent.name.startsWith(".")) continue;
    if (ent.name.startsWith("__")) continue;       // skip __auto, __templates conventions
    if (ent.name === "node_modules") continue;
    const full = path.join(projectsRoot, ent.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;

    projects.push({
      name: ent.name,
      path: full,
      hasClaudeHarness: fs.existsSync(path.join(full, "CLAUDE.md")) || fs.existsSync(path.join(full, ".claude")),
      hasCodexHarness: fs.existsSync(path.join(full, "AGENTS.md")) || fs.existsSync(path.join(full, ".codex")),
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

export function resolveProject(projectsRoot, name) {
  if (!projectsRoot || !name) return null;
  const norm = String(name).trim();
  if (!norm || norm.includes("/") || norm.includes("..") || norm.startsWith(".")) return null;
  const full = path.join(projectsRoot, norm);
  if (!fs.existsSync(full)) return null;
  const projects = listProjects(projectsRoot);
  return projects.find((p) => p.name === norm) || null;
}

export function defaultProjectsRoot(installDir) {
  // installDir = where the user runs `claude-code-telegram` from
  // Convention: <installDir>/projects/
  return path.resolve(installDir, "projects");
}
