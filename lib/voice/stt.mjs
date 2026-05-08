/**
 * Whisper STT — direct fetch to OpenAI API. No SDK dep.
 *
 * Hardened: file size cap, MIME allowlist, deterministic decoding (temperature=0).
 */

import { Buffer } from "node:buffer";

const OPENAI_API = "https://api.openai.com/v1";

export const VOICE_MAX_BYTES = 10 * 1024 * 1024;       // 10 MB
export const VOICE_MAX_DURATION_SEC = 5 * 60;          // 5 minutes
export const ALLOWED_MIME = new Set([
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "audio/aac",
]);

export function validateVoiceMessage({ duration, mimeType, fileSize }) {
  if (typeof duration === "number" && duration > VOICE_MAX_DURATION_SEC) {
    return `voice too long (${duration}s > ${VOICE_MAX_DURATION_SEC}s)`;
  }
  if (typeof fileSize === "number" && fileSize > VOICE_MAX_BYTES) {
    return `voice file too large (${(fileSize / 1024 / 1024).toFixed(1)} MB > ${VOICE_MAX_BYTES / 1024 / 1024} MB)`;
  }
  if (mimeType && !ALLOWED_MIME.has(String(mimeType).toLowerCase())) {
    return `unsupported audio type: ${mimeType}`;
  }
  return null;
}

export async function transcribeOggBuffer(oggBuffer, {
  apiKey,
  model = "whisper-1",
  language,
  mimeType = "audio/ogg",
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY required for voice STT");
  if (!oggBuffer || !oggBuffer.length) throw new Error("empty audio buffer");
  if (oggBuffer.length > VOICE_MAX_BYTES) {
    throw new Error(`audio buffer too large (${oggBuffer.length} > ${VOICE_MAX_BYTES})`);
  }

  const form = new FormData();
  form.append("file", new Blob([oggBuffer], { type: mimeType }), `voice.${mimeType.split("/")[1] || "ogg"}`);
  form.append("model", model);
  if (language) form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");

  const res = await fetch(`${OPENAI_API}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Whisper ${res.status}: ${json.error?.message || JSON.stringify(json).slice(0, 200)}`);
  }
  return String(json.text || "").trim();
}

/**
 * Download a Telegram file by file_id with size cap.
 * Reads Content-Length first; aborts if > maxBytes.
 */
export async function downloadTelegramFile(token, fileId, { maxBytes = VOICE_MAX_BYTES } = {}) {
  const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const getFileJson = await getFileRes.json();
  if (!getFileJson.ok) throw new Error(`getFile failed: ${getFileJson.description}`);
  const filePath = getFileJson.result.file_path;
  const fileSize = getFileJson.result.file_size;
  if (!filePath) throw new Error("getFile returned no file_path");
  if (typeof fileSize === "number" && fileSize > maxBytes) {
    throw new Error(`file too large (${fileSize} > ${maxBytes})`);
  }

  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) throw new Error(`file download HTTP ${fileRes.status}`);
  const contentLength = Number(fileRes.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxBytes) {
    throw new Error(`Content-Length ${contentLength} exceeds cap ${maxBytes}`);
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`downloaded ${arrayBuffer.byteLength} bytes exceeds cap ${maxBytes}`);
  }
  return Buffer.from(arrayBuffer);
}

/**
 * Redact common secret patterns from text. Used on Whisper transcripts and
 * inbound message text before display + dispatch — prevents accidentally
 * pasting credentials into a public-ish chat or logs.
 *
 * Returns { text, redactedCount }.
 */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,                     // OpenAI/Anthropic style
  /sk-ant-[A-Za-z0-9_-]{20,}/g,                 // Anthropic explicit
  /ghp_[A-Za-z0-9]{20,}/g,                      // GitHub PAT
  /gho_[A-Za-z0-9]{20,}/g,                      // GitHub OAuth
  /ghs_[A-Za-z0-9]{20,}/g,                      // GitHub Server-to-server
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,              // Slack
  /glpat-[A-Za-z0-9_-]{20,}/g,                  // GitLab PAT
  /AKIA[0-9A-Z]{16}/g,                          // AWS Access Key
  /AIza[0-9A-Za-z_-]{35}/g,                     // Google API
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /[0-9]{8,10}:[A-Za-z0-9_-]{35}/g,             // Telegram bot token
];

export function redactSecrets(input) {
  if (!input) return { text: input, redactedCount: 0 };
  let text = String(input);
  let redactedCount = 0;
  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, (m) => {
      redactedCount += 1;
      return `[REDACTED:${m.slice(0, 4)}…${m.length}c]`;
    });
  }
  return { text, redactedCount };
}
