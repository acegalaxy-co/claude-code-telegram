/**
 * Append-only JSONL audit log for security-relevant events.
 *
 * One line per event, written to <STATE_DIR>/.audit.log. Never includes raw
 * prompts — only a SHA-256 prefix + length so operators can correlate without
 * leaking content. Designed to be tail-able and grep-able.
 *
 * Events (kind):
 *   auth.allow          chat passed allowlist
 *   auth.deny.chat      chat_id not in TELEGRAM_ALLOWED_CHAT_IDS
 *   auth.deny.user      user_id not in TELEGRAM_ALLOWED_USER_IDS / blocked
 *   auth.deny.project   chat tried to switch to non-permitted project
 *   ratelimit.text      text rate limit hit
 *   ratelimit.voice     voice rate limit hit
 *   dispatch            prompt dispatched to a CLI runner
 *   redact              secret-like tokens redacted from a prompt
 *   voice.reject        voice message validation failed
 *   voice.transcribe    whisper transcription completed
 *   command             slash command invoked
 *   project.switch      project changed
 *   cli.switch          CLI changed
 *   error               unhandled error in update loop
 *   startup             bridge startup banner
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_RING = 500; // in-memory ring for /audit command

export function createAuditLogger({ dir, logger = console } = {}) {
  const file = path.join(dir || process.cwd(), ".audit.log");
  const ring = [];
  let stream = null;
  try {
    stream = fs.createWriteStream(file, { flags: "a" });
    stream.on("error", (e) => logger.warn(`audit stream error: ${e.message}`));
  } catch (e) {
    logger.warn(`audit logger disabled (cannot open ${file}): ${e.message}`);
  }

  function write(kind, fields = {}) {
    const evt = {
      ts: new Date().toISOString(),
      kind,
      ...fields,
    };
    ring.push(evt);
    if (ring.length > MAX_RING) ring.shift();
    if (stream) {
      try { stream.write(JSON.stringify(evt) + "\n"); } catch { /* ignore */ }
    }
    return evt;
  }

  function recent(n = 50, filter = null) {
    const arr = filter ? ring.filter(filter) : ring;
    return arr.slice(-n);
  }

  function hashPrompt(text) {
    if (!text) return null;
    const h = crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 12);
    return { h, len: String(text).length };
  }

  function close() {
    try { stream?.end(); } catch { /* ignore */ }
  }

  return { write, recent, hashPrompt, close, file };
}
