/**
 * Spawn `codex exec` CLI in JSON-line mode and yield parsed events.
 *
 * Codex emits JSON-line events on stdout when run with `--json` (mirrors
 * Claude's --output-format stream-json shape but with different field names).
 * We normalize each event into the same shape claude-runner.formatEvent expects:
 *   { type, text?, tool_name?, tool_input?, tool_result?, exit_code?, ... }
 *
 * Invocation:
 *   codex exec --json --skip-git-repo-check [--cd <cwd>] -- "<prompt>"
 */

import { spawn } from "node:child_process";

export function runCodex({ prompt, cwd, onEvent, onError, signal } = {}) {
  if (!prompt) throw new Error("prompt required");

  // Codex 0.129+: pass prompt via stdin to avoid quoting / argv injection.
  // --json emits NDJSON (thread.started, turn.started, item.completed, turn.completed).
  // --skip-git-repo-check lets us run outside a git repo.
  const args = ["exec", "--json", "--skip-git-repo-check"];
  if (cwd) args.push("--cd", cwd);

  const child = spawn("codex", args, {
    cwd: cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  child.stdin.write(prompt);
  child.stdin.end();

  let buffer = "";
  let stderr = "";
  let resolved = false;
  let resolve, reject;
  const done = new Promise((r, j) => { resolve = r; reject = j; });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      // Try JSON first; if not JSON, treat as raw text (older codex).
      try {
        const ev = JSON.parse(line);
        if (onEvent) onEvent(normalizeCodexEvent(ev));
      } catch {
        if (onEvent) onEvent({ type: "text", text: line });
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => {
    if (resolved) return;
    resolved = true;
    if (err.code === "ENOENT") {
      reject(new Error("`codex` CLI not found in PATH. Install: npm i -g @openai/codex"));
    } else {
      reject(err);
    }
  });

  child.on("close", (code) => {
    if (resolved) return;
    resolved = true;
    if (code === 0) resolve({ exitCode: 0 });
    else reject(new Error(`codex exited ${code}${stderr ? `\n${stderr.slice(0, 500)}` : ""}`));
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    }, { once: true });
  }

  return { done, child };
}

/**
 * Codex JSON event shapes (best-effort — depends on codex version).
 * Normalize into the same shape claude-runner.formatEvent expects so a
 * single formatEvent can render either CLI's output uniformly.
 */
function normalizeCodexEvent(ev) {
  if (!ev || typeof ev !== "object") return { type: "raw", raw: ev };

  // Codex 0.129+ shape (observed 2026-05-08):
  //   {type:"thread.started", thread_id}
  //   {type:"turn.started"}
  //   {type:"item.completed", item:{id, type:"agent_message"|"reasoning"|"command_execution", text, ...}}
  //   {type:"turn.completed", usage:{input_tokens, output_tokens, ...}}
  //   {type:"error", message}
  // Older shape:
  //   {type:"AgentMessage"|"AgentReasoning"|"ToolCall"|"ToolResult"|"TaskComplete"|"Error", ...}
  const t = ev.type || ev.kind || ev.event;

  // ── Codex 0.129+ ────────────────────────────────────────────────
  if (t === "thread.started" || t === "turn.started") return { type: "noop" };
  if (t === "item.completed" && ev.item) {
    const it = ev.item;
    const itType = it.type;
    if (itType === "agent_message" || itType === "assistant_message") {
      const text = it.text || it.content || "";
      if (!text) return { type: "noop" };
      return { type: "assistant", message: { content: [{ type: "text", text: String(text) }] } };
    }
    if (itType === "reasoning" || itType === "agent_reasoning") {
      const text = it.text || it.content || "";
      if (!text) return { type: "noop" };
      return { type: "assistant", message: { content: [{ type: "text", text: `💭 ${String(text).slice(0, 400)}` }] } };
    }
    if (itType === "command_execution" || itType === "shell_call" || itType === "tool_use") {
      const name = it.tool || it.name || "command";
      const input = it.input || it.command ? { command: it.command, ...it.input } : (it.args || it.parameters || {});
      const result = it.output || it.result || it.text || "";
      return { type: "assistant", message: { content: [{ type: "tool_use", id: it.id || `codex-${Date.now()}`, name, input }] } };
    }
    if (itType === "file_change" || itType === "edit") {
      const text = it.summary || it.text || JSON.stringify(it).slice(0, 200);
      return { type: "assistant", message: { content: [{ type: "text", text: `📝 ${String(text)}` }] } };
    }
    // Unknown item type — pass through
    return { type: "assistant", message: { content: [{ type: "text", text: `${it.type}: ${JSON.stringify(it).slice(0, 200)}` }] } };
  }
  if (t === "turn.completed") {
    const u = ev.usage || {};
    return { type: "result", subtype: "success", usage: u };
  }

  // ── Older Codex shape ───────────────────────────────────────────
  if (t === "AgentMessage" || t === "agent_message" || ev.role === "assistant") {
    const text = ev.message || ev.text || ev.content || "";
    return { type: "assistant", message: { content: [{ type: "text", text: String(text) }] } };
  }
  if (t === "AgentReasoning" || t === "agent_reasoning" || t === "reasoning") {
    const text = ev.text || ev.content || "";
    if (!text) return { type: "noop" };
    return { type: "assistant", message: { content: [{ type: "text", text: `💭 ${String(text).slice(0, 400)}` }] } };
  }
  if (t === "ToolCall" || t === "tool_call" || ev.tool) {
    const name = ev.tool || ev.name || "tool";
    const input = ev.args || ev.input || ev.parameters;
    return { type: "assistant", message: { content: [{ type: "tool_use", name, input }] } };
  }
  if (t === "ToolResult" || t === "tool_result") {
    const text = ev.result || ev.output || ev.text || "";
    return { type: "user", message: { content: [{ type: "tool_result", content: String(text) }] } };
  }
  if (t === "TaskComplete" || t === "task_complete" || t === "result") {
    return { type: "result", subtype: "success", total_cost_usd: ev.cost_usd || 0, usage: ev.usage };
  }
  if (t === "Error" || t === "error") {
    // Filter Codex CLI internal "Reconnecting..." warnings — they fire while
    // the agent is still working and are not user-facing errors.
    const msg = String(ev.message || JSON.stringify(ev));
    if (/reconnecting/i.test(msg)) return { type: "noop" };
    return { type: "assistant", message: { content: [{ type: "text", text: `❌ ${msg}` }] } };
  }
  // Unknown type — pass through as raw text if it has a text field
  if (ev.text || ev.message || ev.content) {
    return { type: "assistant", message: { content: [{ type: "text", text: String(ev.text || ev.message || ev.content) }] } };
  }
  return { type: "noop" };
}
