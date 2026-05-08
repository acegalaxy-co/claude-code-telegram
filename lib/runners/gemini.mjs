/**
 * Spawn `gemini` CLI (Google Gemini CLI, https://github.com/google-gemini/gemini-cli)
 * in non-interactive mode and stream output as plain text events.
 *
 * Invocation:
 *   gemini -p "<prompt>"   (yolo / one-shot)
 *
 * Gemini CLI does not (yet) emit JSON-line stream events, so we treat stdout
 * as raw assistant text and emit a single result event on close.
 */

import { spawn } from "node:child_process";

export function runGemini({ prompt, cwd, model, onEvent, signal } = {}) {
  if (!prompt) throw new Error("prompt required");

  const args = ["-p", prompt];
  if (model) args.push("-m", model);

  const child = spawn("gemini", args, {
    cwd: cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stderr = "";
  let resolved = false;
  let resolve, reject;
  const done = new Promise((r, j) => { resolve = r; reject = j; });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (!chunk) return;
    if (onEvent) onEvent({ type: "assistant", message: { content: [{ type: "text", text: String(chunk) }] } });
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => {
    if (resolved) return;
    resolved = true;
    if (err.code === "ENOENT") {
      reject(new Error("`gemini` CLI not found in PATH. Install: npm i -g @google/gemini-cli"));
    } else {
      reject(err);
    }
  });

  child.on("close", (code) => {
    if (resolved) return;
    resolved = true;
    if (onEvent) onEvent({ type: "result", subtype: code === 0 ? "success" : "error" });
    if (code === 0) resolve({ exitCode: 0 });
    else reject(new Error(`gemini exited ${code}${stderr ? `\n${stderr.slice(0, 500)}` : ""}`));
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    }, { once: true });
  }

  return { done, child };
}
