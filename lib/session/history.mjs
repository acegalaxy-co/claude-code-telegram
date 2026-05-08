/**
 * Discover Claude CLI sessions for a given cwd.
 *
 * Claude CLI persists each session as `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`,
 * where `<cwd-slug>` is the absolute cwd with all '/' replaced by '-' (incl. leading).
 * The first `type=user` line carries the first user prompt — we use it as a label.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function cwdToClaudeSlug(cwd) {
  // Resolve symlinks so we match the dir Claude actually persisted under.
  let real = cwd;
  try { real = fs.realpathSync(cwd); } catch { /* keep input */ }
  return real.replace(/\//g, "-");
}

export function claudeSessionsDir(cwd) {
  return path.join(os.homedir(), ".claude", "projects", cwdToClaudeSlug(cwd));
}

/**
 * Return up to `limit` Claude sessions for this cwd, newest-first.
 * Each entry: { sessionId, mtime, firstPrompt, file }.
 */
export function listClaudeSessions(cwd, { limit = 5 } = {}) {
  const dir = claudeSessionsDir(cwd);
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }

  const items = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const full = path.join(dir, f);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    items.push({
      sessionId: f.replace(/\.jsonl$/, ""),
      mtime: stat.mtimeMs,
      file: full,
      firstPrompt: null,
    });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  const top = items.slice(0, limit);
  for (const it of top) {
    it.firstPrompt = readFirstUserPrompt(it.file);
  }
  return top;
}

function readFirstUserPrompt(file) {
  try {
    // Read up to first 64 KB; first user line is almost always within that.
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const text = buf.slice(0, n).toString("utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === "user" && obj.message?.content) {
        const c = obj.message.content;
        const s = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x.text || "").join(" ") : "";
        return s.trim().slice(0, 100);
      }
    }
  } catch { /* fall through */ }
  return null;
}

export function formatRelativeTime(ms) {
  const sec = Math.round((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}
