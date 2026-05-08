/**
 * Spawn `aider` with DeepSeek model and stream stdout as text events.
 *
 * Reason: DeepSeek does not ship its own first-party CLI yet; the de-facto
 * way to use DeepSeek as a coding agent is via aider (https://aider.chat).
 *
 * Invocation:
 *   aider --model deepseek/deepseek-chat --no-pretty --no-stream --yes \
 *         --message "<prompt>" [--subtree-only]
 *
 * Requires:
 *   - aider on PATH (`pipx install aider-chat`)
 *   - DEEPSEEK_API_KEY env
 */

import { spawn } from "node:child_process";

export function runDeepseek({ prompt, cwd, model, onEvent, signal } = {}) {
  if (!prompt) throw new Error("prompt required");
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not set. Get one at https://platform.deepseek.com/");
  }

  const args = [
    "--model", model || "deepseek/deepseek-chat",
    "--no-pretty",
    "--no-stream",
    "--yes",
    "--message", prompt,
  ];

  const child = spawn("aider", args, {
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
      reject(new Error("`aider` CLI not found in PATH. Install: pipx install aider-chat"));
    } else {
      reject(err);
    }
  });

  child.on("close", (code) => {
    if (resolved) return;
    resolved = true;
    if (onEvent) onEvent({ type: "result", subtype: code === 0 ? "success" : "error" });
    if (code === 0) resolve({ exitCode: 0 });
    else reject(new Error(`aider/deepseek exited ${code}${stderr ? `\n${stderr.slice(0, 500)}` : ""}`));
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    }, { once: true });
  }

  return { done, child };
}
