/**
 * Spawn `claude` CLI in stream-json mode and yield parsed events.
 *
 * CLI: claude --print --output-format stream-json --verbose --dangerously-skip-permissions
 *      [--resume <session-id>] [--model <model>] -p <prompt>
 *
 * Stream-json events (one JSON object per line):
 *   { type: "system", subtype: "init", session_id, model, ... }
 *   { type: "assistant", message: { content: [{ type:"text", text }, { type:"tool_use", name, input }] } }
 *   { type: "user", message: { content: [{ type:"tool_result", content }] } }
 *   { type: "result", subtype: "success", result: <text>, total_cost_usd, usage, ... }
 */

import { spawn } from "node:child_process";

export function runClaude({ prompt, sessionId, model, cwd, onEvent, onError, signal } = {}) {
  if (!prompt) throw new Error("prompt required");

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (sessionId) args.push("--resume", sessionId);
  if (model) args.push("--model", model);
  args.push("-p", prompt);

  const child = spawn("claude", args, {
    cwd: cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

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
      try {
        const event = JSON.parse(line);
        if (onEvent) onEvent(event);
      } catch (e) {
        if (onError) onError(new Error(`bad stream-json line: ${line.slice(0, 100)}`));
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => {
    if (resolved) return;
    resolved = true;
    if (err.code === "ENOENT") {
      reject(new Error("`claude` CLI not found in PATH. Install: npm i -g @anthropic-ai/claude-code"));
    } else {
      reject(err);
    }
  });

  child.on("close", (code) => {
    if (resolved) return;
    resolved = true;
    if (code === 0) resolve({ exitCode: 0 });
    else reject(new Error(`claude exited ${code}${stderr ? `\n${stderr.slice(0, 500)}` : ""}`));
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
 * Format a single stream-json event into a short human-readable string for Telegram.
 * Returns null if the event has nothing user-facing (e.g. usage stats).
 */
export function formatEvent(event) {
  if (!event || !event.type) return null;

  if (event.type === "system" && event.subtype === "init") {
    const model = event.model || "claude";
    return `🟢 Session started (${model})`;
  }

  if (event.type === "assistant") {
    const blocks = event.message?.content || [];
    const out = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) {
        out.push(b.text);
      } else if (b.type === "tool_use") {
        const name = b.name || "tool";
        const input = b.input ? JSON.stringify(b.input).slice(0, 200) : "";
        out.push(`🔧 ${name}${input ? ` ${input}` : ""}`);
      }
    }
    return out.length ? out.join("\n") : null;
  }

  if (event.type === "user") {
    const blocks = event.message?.content || [];
    for (const b of blocks) {
      if (b.type === "tool_result") {
        const text = typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((c) => c.text || "").join("")
            : "";
        const trimmed = text.length > 300 ? `${text.slice(0, 280)}…(${text.length}B)` : text;
        return trimmed ? `📤 ${trimmed}` : null;
      }
    }
    return null;
  }

  if (event.type === "result") {
    const cost = event.total_cost_usd ? ` · $${event.total_cost_usd.toFixed(4)}` : "";
    const tokens = event.usage
      ? ` · ${event.usage.input_tokens || 0}in/${event.usage.output_tokens || 0}out`
      : "";
    return `✅ Done${cost}${tokens}`;
  }

  return null;
}
