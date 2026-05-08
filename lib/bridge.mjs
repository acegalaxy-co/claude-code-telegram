/**
 * Bridge orchestration: wire Telegram polling → Claude/Codex CLI → reply.
 *
 * Per-chat state:
 *   - cli: "claude" (default) | "codex" | "deepseek" | "gemini"
 *   - project: project name (subdir of PROJECTS_ROOT) or null
 *   - cwd: resolved absolute path for spawning CLI
 *   - sessionsByProjectCli: { "<project>|<cli>": "<sessionId>" } — preserved
 *     across /project and /cli switches. Only /new clears the current combo.
 *   - currentJob: AbortController for /cancel
 *   - currentJob: AbortController for /cancel
 *   (pending voice transcripts live in voicePendingStore, keyed by promptMsgId)
 *
 * Session persistence: state-store.mjs writes a debounced .sessions.json next
 * to .env so chat sessions survive bridge restarts. Claude itself also keeps
 * a session-id-keyed log per cwd at ~/.claude/projects/<slug>/ — /last reads
 * those for resume-by-history.
 */

import path from "node:path";
import { createTelegramClient } from "./telegram/api.mjs";
import { renderToolBlock, renderStatus, renderFinal, newRenderState, applyEventToState, escapeHtml } from "./telegram/render.mjs";
import { runClaude } from "./runners/claude.mjs";
import { runCodex } from "./runners/codex.mjs";
import { runDeepseek } from "./runners/deepseek.mjs";
import { runGemini } from "./runners/gemini.mjs";
import { transcribeOggBuffer, downloadTelegramFile, validateVoiceMessage, redactSecrets } from "./voice/stt.mjs";
import { createVoicePendingStore } from "./voice/pending.mjs";
import { createStateStore } from "./session/store.mjs";
import { listClaudeSessions, formatRelativeTime } from "./session/history.mjs";
import { listProjects, resolveProject } from "./util/projects.mjs";
import { createRateLimiter } from "./util/rate-limit.mjs";

const BOT_COMMANDS = [
  { command: "help",     description: "Show help" },
  { command: "new",      description: "Reset session for current project × CLI" },
  { command: "cancel",   description: "Stop the running task" },
  { command: "session",  description: "Show CLI / project / live sessions" },
  { command: "cli",      description: "Switch CLI: claude | codex | deepseek | gemini" },
  { command: "projects", description: "List projects (numbered)" },
  { command: "project",  description: "Switch project: /project <num|name>" },
  { command: "pwd",      description: "Show current cwd" },
  { command: "last",     description: "List / resume recent Claude sessions" },
  { command: "ping",     description: "Sanity check (replies pong)" },
  { command: "status",   description: "Bot uptime + active job state" },
  { command: "whoami",   description: "Show your chat ID + username" },
];

const STATUS_INTERVAL_MS = 3000;       // periodic "⏳ <tool> — <hint>" while running
const MAX_PROMPT_CHARS = 4000;

const DEFAULT_CLI = "claude";

// Rate limits — per-chat token buckets (in-memory, reset on restart).
const TEXT_LIMIT = { capacity: 60, windowMs: 60 * 60 * 1000 };  // 60 msgs / hour
const VOICE_LIMIT = { capacity: 10, windowMs: 60 * 60 * 1000 }; // 10 voice / hour

export async function startBridge({
  token,
  allowedChatIds,
  model,
  projectsRoot,
  defaultProject,
  fallbackCwd,
  openaiApiKey,
  whisperModel,
  voiceLanguage,
  logger = console,
} = {}) {
  // Enforce allowlist BEFORE network calls so misconfigured deploys fail fast.
  const allowSet = parseAllowList(allowedChatIds);
  const allowAnonymous = String(process.env.TELEGRAM_ALLOW_ANY_CHAT || "").toLowerCase() === "true";
  if (!allowSet && !allowAnonymous) {
    throw new Error(
      "TELEGRAM_ALLOWED_CHAT_IDS is required. Set comma-separated chat IDs in .env, " +
      "or explicitly opt out by setting TELEGRAM_ALLOW_ANY_CHAT=true (NOT recommended for production).",
    );
  }

  const tg = createTelegramClient(token);
  const me = await tg.getMe();
  logger.log(`🤖 Bot: @${me.username} (${me.first_name})`);
  const startedAt = Date.now();

  // Register the bot's slash-command menu so users get autocomplete in Telegram.
  try {
    await tg.setMyCommands(BOT_COMMANDS);
    logger.log(`📜 Registered ${BOT_COMMANDS.length} bot commands`);
  } catch (e) {
    logger.warn(`setMyCommands failed: ${e.message}`);
  }

  const voicePendingStore = createVoicePendingStore();

  if (allowSet) {
    logger.log(`🔒 Restricted to ${allowSet.size} chat(s): ${Array.from(allowSet).join(", ")}`);
  } else {
    logger.warn("⚠️  TELEGRAM_ALLOW_ANY_CHAT=true — bot accepts ANY chat. Highly insecure.");
  }
  const textLimiter = createRateLimiter(TEXT_LIMIT);
  const voiceLimiter = createRateLimiter(VOICE_LIMIT);

  // Persist session map to disk so chat sessions survive bridge restarts.
  const stateDir = process.env.STATE_DIR || process.cwd();
  const store = createStateStore({ dir: stateDir, logger });
  logger.log(`💾 State store: ${store.file}`);
  process.on("SIGTERM", () => { try { store.flush(); } catch {} });
  process.on("SIGINT", () => { try { store.flush(); } catch {} process.exit(0); });
  if (openaiApiKey) {
    logger.log(`🎤 Voice STT enabled (model: ${whisperModel || "whisper-1"})`);
  } else {
    logger.log("🎤 Voice STT disabled (set OPENAI_API_KEY to enable)");
  }
  if (projectsRoot) {
    const projs = listProjects(projectsRoot);
    logger.log(`📁 PROJECTS_ROOT: ${projectsRoot} (${projs.length} project${projs.length !== 1 ? "s" : ""})`);
    if (projs.length) logger.log(`   ${projs.map((p) => p.name).join(", ")}`);
    if (defaultProject) {
      const dp = resolveProject(projectsRoot, defaultProject);
      logger.log(dp ? `   Default project: ${defaultProject}` : `   ⚠ DEFAULT_PROJECT="${defaultProject}" not found under PROJECTS_ROOT`);
    }
  } else {
    logger.log(`📁 PROJECTS_ROOT not set — single-cwd mode (using ${fallbackCwd || process.cwd()})`);
  }

  const sessions = new Map();
  let offset = 0;
  let consecutiveFailures = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let updates;
    try {
      updates = await tg.getUpdates(offset);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures += 1;
      // Exponential backoff: 1s, 2s, 4s, … capped at 30s. Avoids hammering
      // Telegram during outages or token revocation.
      const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(consecutiveFailures - 1, 5)));
      logger.error(`getUpdates failed (attempt ${consecutiveFailures}, retry in ${wait}ms): ${e.message}`);
      await sleep(wait);
      continue;
    }

    for (const upd of updates) {
      offset = upd.update_id + 1;
      try {
        if (upd.callback_query) {
          await handleCallback(tg, sessions, upd.callback_query, { model, logger, store, voicePendingStore });
          continue;
        }
        const msg = upd.message;
        if (!msg) continue;
        const chatId = String(msg.chat.id);
        if (allowSet && !allowSet.has(chatId)) {
          logger.warn(`Denied chat ${chatId} (${msg.from?.username || "?"})`);
          continue;
        }
        const s = ensureSession(sessions, chatId, { projectsRoot, defaultProject, fallbackCwd, store });

        if (msg.voice || msg.audio) {
          const vrl = voiceLimiter.take(chatId);
          if (!vrl.ok) {
            await tg.sendMessage(chatId, `🚦 Voice rate limit. Retry in ${Math.ceil(vrl.retryAfterMs / 1000)}s.`, { replyTo: msg.message_id });
            continue;
          }
          await handleVoice(tg, s, chatId, msg, { openaiApiKey, whisperModel, voiceLanguage, logger, store, voicePendingStore });
          continue;
        }

        // If the user replied with text after pressing ✏️ Edit on a voice prompt,
        // intercept here and dispatch the corrected text instead of routing as a normal msg.
        if (msg.text && !msg.text.startsWith("/")) {
          const fromUserId = msg.from?.id;
          if (fromUserId != null) {
            const editPending = voicePendingStore.findEditPending(chatId, fromUserId);
            if (editPending) {
              voicePendingStore.takeByKey(editPending.key);
              await tg.sendMessage(chatId, `✏️ Using corrected text. Dispatching to ${s.cli}…`, { replyTo: msg.message_id });
              dispatch(tg, s, chatId, msg, msg.text, { cli: s.cli, model, logger, store })
                .catch((e) => logger.error(`bridge error (voice edit): ${e.message}`));
              continue;
            }
          }
        }

        if (msg.text?.startsWith("/")) {
          await handleCommand(tg, s, chatId, msg, { projectsRoot, defaultProject, fallbackCwd, logger, store, me, startedAt });
          continue;
        }

        if (msg.text) {
          if (msg.text.length > MAX_PROMPT_CHARS) {
            await tg.sendMessage(chatId, `❌ Message too long (${msg.text.length} > ${MAX_PROMPT_CHARS} chars). Split it or pipe via a file.`, { replyTo: msg.message_id });
            continue;
          }
          const trl = textLimiter.take(chatId);
          if (!trl.ok) {
            await tg.sendMessage(chatId, `🚦 Rate limit (60 msg/hour). Retry in ${Math.ceil(trl.retryAfterMs / 1000)}s.`, { replyTo: msg.message_id });
            continue;
          }
          let text = msg.text;
          let forcedCli = null;
          const m = text.match(/^(claude|codex|deepseek|gemini)\s*:\s*(.+)/is);
          if (m) {
            forcedCli = m[1].toLowerCase();
            text = m[2].trim();
          }
          // Redact accidental secrets in user prompt before dispatch + logs.
          const { text: safeText, redactedCount } = redactSecrets(text);
          if (redactedCount > 0) {
            await tg.sendMessage(chatId, `⚠️ Redacted ${redactedCount} secret-like token(s) from your message before dispatch.`, { replyTo: msg.message_id });
          }
          const cli = forcedCli || s.cli;
          logger.log(`▶ dispatch chat=${chatId} cli=${cli} project=${s.project || "-"} prompt="${safeText.slice(0, 80).replace(/\n/g, " ")}${safeText.length > 80 ? "…" : ""}"`);
          dispatch(tg, s, chatId, msg, safeText, { cli, model, logger, store })
            .catch((e) => logger.error(`bridge error: ${e.message}`));
        }
      } catch (e) {
        logger.error(`update handle error: ${e.message}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Session helpers
// ─────────────────────────────────────────────────────────────

function ensureSession(sessions, chatId, { projectsRoot, defaultProject, fallbackCwd, store }) {
  let s = sessions.get(chatId);
  if (!s) {
    const persisted = store?.get(chatId) || {};
    s = {
      cli: persisted.cli || DEFAULT_CLI,
      project: persisted.project || null,
      cwd: null,
      sessionsByProjectCli: persisted.sessionsByProjectCli || {},
      currentJob: null,
    };
    // Resolve cwd from persisted project, then default project, then fallback.
    if (s.project && projectsRoot) {
      const p = resolveProject(projectsRoot, s.project);
      if (p) s.cwd = p.path; else s.project = null;
    }
    if (!s.cwd && projectsRoot && defaultProject) {
      const p = resolveProject(projectsRoot, defaultProject);
      if (p) { s.project = p.name; s.cwd = p.path; }
    }
    if (!s.cwd) s.cwd = fallbackCwd || process.cwd();
    sessions.set(chatId, s);
  }
  return s;
}

function describeProject(s) {
  return s.project ? s.project : "(no project — using bot cwd)";
}

function sessionKey(s, cli = s.cli) {
  return `${s.project || "_"}|${cli}`;
}

function getSessionId(s, cli = s.cli) {
  return s.sessionsByProjectCli[sessionKey(s, cli)] || null;
}

function setSessionId(s, sessionId, cli = s.cli) {
  s.sessionsByProjectCli[sessionKey(s, cli)] = sessionId;
}

function clearSessionId(s, cli = s.cli) {
  delete s.sessionsByProjectCli[sessionKey(s, cli)];
}

function persist(store, chatId, s) {
  if (!store) return;
  store.set(chatId, {
    cli: s.cli,
    project: s.project,
    sessionsByProjectCli: s.sessionsByProjectCli,
  });
}

// ─────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────

async function handleCommand(tg, s, chatId, msg, { projectsRoot, defaultProject, fallbackCwd, logger, store, me, startedAt }) {
  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].split("@")[0];
  const arg = parts.slice(1).join(" ").trim();

  switch (cmd) {
    case "/start":
    case "/help":
      await tg.sendMessage(chatId, helpText(s, projectsRoot));
      return;

    case "/ping":
      await tg.sendMessage(chatId, "🏓 pong");
      return;

    case "/whoami": {
      const u = msg.from || {};
      await tg.sendMessage(chatId,
        `chat_id: ${chatId}\n` +
        `user_id: ${u.id ?? "?"}\n` +
        `username: ${u.username ? "@" + u.username : "(none)"}\n` +
        `name: ${[u.first_name, u.last_name].filter(Boolean).join(" ") || "(none)"}`,
      );
      return;
    }

    case "/status": {
      const upMs = Date.now() - (startedAt || Date.now());
      const upSec = Math.floor(upMs / 1000);
      const days = Math.floor(upSec / 86400);
      const hours = Math.floor((upSec % 86400) / 3600);
      const mins = Math.floor((upSec % 3600) / 60);
      const secs = upSec % 60;
      const upStr = days ? `${days}d ${hours}h ${mins}m` : hours ? `${hours}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
      const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      await tg.sendMessage(chatId,
        `🤖 <b>${escapeHtml((me && me.username) ? "@" + me.username : "bot")}</b>\n` +
        `Uptime: ${upStr}\n` +
        `Mem: ${memMB} MB\n` +
        `Active job: ${s.currentJob ? "yes (use /cancel)" : "no"}\n` +
        `CLI: ${s.cli} · Project: ${escapeHtml(describeProject(s))}\n` +
        `Live sessions: ${Object.keys(s.sessionsByProjectCli || {}).length}`,
        { parseMode: "HTML" },
      );
      return;
    }

    case "/new":
    case "/reset": {
      // Only clear the session for the current (project, cli) combo.
      // Other combos and the current project/cli selection are preserved.
      clearSessionId(s);
      persist(store, chatId, s);
      await tg.sendMessage(chatId, `🆕 New session for ${s.project || "(no project)"} × ${s.cli}.\nOther project/CLI sessions are preserved. Use /sessions to see them, /last to resume one.`);
      return;
    }

    case "/cancel":
    case "/stop":
      if (s.currentJob) {
        s.currentJob.abort();
        await tg.sendMessage(chatId, "🛑 Cancel signal sent.");
      } else {
        await tg.sendMessage(chatId, "Nothing to cancel.");
      }
      return;

    case "/session":
    case "/sessions": {
      const cur = getSessionId(s);
      const lines = [
        `CLI: ${s.cli}`,
        `Project: ${describeProject(s)}`,
        `cwd: ${s.cwd}`,
        `Current session: ${cur ? cur.slice(0, 8) + "…" : "(none yet — first message creates one)"}  [${s.cli}]`,
      ];
      const others = Object.entries(s.sessionsByProjectCli).filter(([k]) => k !== sessionKey(s));
      if (others.length) {
        lines.push("", "Other live sessions for this chat:");
        for (const [k, sid] of others) {
          const [proj, cli] = k.split("|");
          lines.push(`  • ${proj} × ${cli}: ${sid.slice(0, 8)}…`);
        }
      }
      lines.push("", "/last — list recent sessions in current project (resume with /last <num>)");
      await tg.sendMessage(chatId, lines.join("\n"));
      return;
    }

    case "/cli": {
      if (!arg) {
        await tg.sendMessage(chatId, `Current CLI: ${s.cli}\nSwitch: /cli <name>\n  1 claude    (Anthropic Claude Code)\n  2 codex     (OpenAI Codex CLI)\n  3 deepseek  (via aider, requires DEEPSEEK_API_KEY)\n  4 gemini    (Google Gemini CLI)`);
        return;
      }
      const norm = arg.toLowerCase();
      let next = null;
      if (norm === "claude" || norm === "1") next = "claude";
      else if (norm === "codex" || norm === "2") next = "codex";
      else if (norm === "deepseek" || norm === "3") next = "deepseek";
      else if (norm === "gemini" || norm === "4") next = "gemini";
      if (!next) {
        await tg.sendMessage(chatId, `Unknown CLI: "${arg}". Use: claude | codex | deepseek | gemini (or 1..4).`);
        return;
      }
      s.cli = next;
      persist(store, chatId, s);
      const sid = getSessionId(s);
      const sidNote = sid ? `Resuming session: ${sid.slice(0, 8)}…` : "New session will be created on next message.";
      await tg.sendMessage(chatId, `🔁 Switched CLI to: ${s.cli} (project: ${describeProject(s)})\n${sidNote}`);
      return;
    }

    case "/projects":
    case "/list": {
      if (!projectsRoot) {
        await tg.sendMessage(chatId, "PROJECTS_ROOT not configured. Set it in .env to enable multi-project mode.");
        return;
      }
      const projs = listProjects(projectsRoot);
      if (!projs.length) {
        await tg.sendMessage(chatId, `No projects found under ${projectsRoot}.\n\nCheckout / create projects there:\n  cd ${projectsRoot}\n  git clone <your-repo>`);
        return;
      }
      const lines = projs.map((p, i) => {
        const marks = [];
        if (p.hasClaudeHarness) marks.push(".claude");
        if (p.hasCodexHarness) marks.push(".codex");
        const suffix = marks.length ? ` [${marks.join(", ")}]` : "";
        const cur = s.project === p.name ? " ← current" : "";
        return `${i + 1}. ${p.name}${suffix}${cur}`;
      });
      await tg.sendMessage(chatId, `📁 Projects under ${projectsRoot}:\n\n${lines.join("\n")}\n\nSwitch: /project <number-or-name>\n  e.g. /project 2  or  /project nexus`);
      return;
    }

    case "/project": {
      if (!projectsRoot) {
        await tg.sendMessage(chatId, "PROJECTS_ROOT not configured.");
        return;
      }
      if (!arg) {
        await tg.sendMessage(chatId, `Current project: ${describeProject(s)}\ncwd: ${s.cwd}\n\nList: /projects\nSwitch: /project <number-or-name>`);
        return;
      }
      // Accept index (1-based) or name.
      let p = null;
      const allProjs = listProjects(projectsRoot);
      const asNum = /^\d+$/.test(arg) ? parseInt(arg, 10) : null;
      if (asNum !== null && asNum >= 1 && asNum <= allProjs.length) {
        p = allProjs[asNum - 1];
      } else {
        p = resolveProject(projectsRoot, arg);
      }
      if (!p) {
        await tg.sendMessage(chatId, `Project "${arg}" not found under ${projectsRoot}.\nUse /projects to list.`);
        return;
      }
      s.project = p.name;
      s.cwd = p.path;
      persist(store, chatId, s);
      const sid = getSessionId(s);
      const sidNote = sid ? `\nResuming session: ${sid.slice(0, 8)}… [${s.cli}]` : `\nNew session will be created on next message [${s.cli}]`;
      const harnessNote = p.hasClaudeHarness || p.hasCodexHarness
        ? `\nHarness: ${[p.hasClaudeHarness && ".claude", p.hasCodexHarness && ".codex"].filter(Boolean).join(", ")}`
        : "\n(no .claude / .codex harness in this project)";
      await tg.sendMessage(chatId, `📂 Switched to project: ${p.name}\ncwd: ${p.path}${harnessNote}${sidNote}`);
      return;
    }

    case "/last": {
      if (s.cli !== "claude") {
        await tg.sendMessage(chatId, `/last currently supports Claude only (current CLI: ${s.cli}). Switch with /cli claude.`);
        return;
      }
      const items = listClaudeSessions(s.cwd, { limit: 5 });
      if (!items.length) {
        await tg.sendMessage(chatId, `No Claude sessions found for cwd:\n${s.cwd}\n\n(Sessions are created on first message.)`);
        return;
      }
      if (!arg) {
        const lines = items.map((it, i) => {
          const tag = it.sessionId === getSessionId(s) ? " ← current" : "";
          const prompt = it.firstPrompt ? `: ${it.firstPrompt.slice(0, 60)}` : "";
          return `${i + 1}. ${formatRelativeTime(it.mtime)} · ${it.sessionId.slice(0, 8)}…${tag}${prompt}`;
        });
        await tg.sendMessage(chatId, `🕘 Recent Claude sessions for ${s.project || s.cwd}:\n\n${lines.join("\n")}\n\nResume: /last <number>`);
        return;
      }
      const idx = /^\d+$/.test(arg) ? parseInt(arg, 10) : NaN;
      if (!idx || idx < 1 || idx > items.length) {
        await tg.sendMessage(chatId, `Invalid index "${arg}". Use /last to list, then /last <1-${items.length}>.`);
        return;
      }
      const picked = items[idx - 1];
      setSessionId(s, picked.sessionId);
      persist(store, chatId, s);
      await tg.sendMessage(chatId, `↩️ Resumed session ${picked.sessionId.slice(0, 8)}… [${s.cli}] for ${s.project || s.cwd}.\nFirst prompt: ${picked.firstPrompt || "(unknown)"}`);
      return;
    }

    case "/pwd":
      await tg.sendMessage(chatId, `cwd: ${s.cwd}`);
      return;

    default:
      await tg.sendMessage(chatId, `Unknown command: ${cmd}\n\n${helpText(s, projectsRoot)}`);
  }
}

function helpText(s, projectsRoot) {
  const pl = projectsRoot
    ? `\n\nMulti-project:\n  /projects                List projects (numbered) under ${projectsRoot}\n  /project <num|name>      Switch project (preserves session per project × CLI)\n  /pwd                     Show current cwd`
    : "\n\n(Single-cwd mode — set PROJECTS_ROOT in .env for multi-project)";
  return `🤖 Telegram ↔ AI CLI bridge (with optional voice)

Send any text → forwarded to ${s.cli} CLI in cwd=${s.cwd}, response streamed back.
Send a voice message → transcribed via Whisper → confirm → forwarded.

Sessions are remembered per (project × CLI) and survive bridge restarts.
Switching project or CLI resumes the matching session if one exists.

Inline force per-message:
  claude: <prompt>     codex: <prompt>
  deepseek: <prompt>   gemini: <prompt>

Commands:
  /cli [claude|codex|deepseek|gemini|1..4]   Switch CLI (session preserved)
  /new                      Reset session for current project × CLI only
  /cancel                   Stop the running task
  /session                  Show CLI, project, cwd, all live sessions
  /last [<num>]             List recent Claude sessions in cwd / resume one${pl}
  /ping                     Sanity check (replies pong)
  /status                   Bot uptime, memory, active job, live session count
  /whoami                   Show your chat_id, user_id, username
  /help                     This help

Current:
  CLI: ${s.cli}
  Project: ${describeProject(s)}`;
}

// ─────────────────────────────────────────────────────────────
// Voice
// ─────────────────────────────────────────────────────────────

async function handleVoice(tg, s, chatId, msg, { openaiApiKey, whisperModel, voiceLanguage, logger, voicePendingStore }) {
  if (!openaiApiKey) {
    await tg.sendMessage(chatId, "🎤 Voice transcription not configured. Set OPENAI_API_KEY on the server to enable.", { replyTo: msg.message_id });
    return;
  }
  const audio = msg.voice || msg.audio;
  const fileId = audio?.file_id;
  if (!fileId) return;

  const validationError = validateVoiceMessage({
    duration: audio.duration,
    mimeType: audio.mime_type,
    fileSize: audio.file_size,
  });
  if (validationError) {
    logger.warn(`voice rejected chat=${chatId}: ${validationError}`);
    await tg.sendMessage(chatId, `❌ Voice rejected: ${validationError}`, { replyTo: msg.message_id });
    return;
  }

  const tokenForDownload = process.env.TELEGRAM_BOT_TOKEN;
  let transcript;
  try {
    const ack = await tg.sendMessage(chatId, "🎤 Transcribing…", { replyTo: msg.message_id });
    const audioBuf = await downloadTelegramFile(tokenForDownload, fileId);
    transcript = await transcribeOggBuffer(audioBuf, {
      apiKey: openaiApiKey,
      model: whisperModel,
      language: voiceLanguage,
      mimeType: audio.mime_type || "audio/ogg",
    });
    if (ack?.message_id) await tg.deleteMessage(chatId, ack.message_id);
  } catch (e) {
    logger.error(`voice STT failed: ${e.message}`);
    await tg.sendMessage(chatId, `❌ Transcription failed: ${e.message}`, { replyTo: msg.message_id });
    return;
  }
  if (!transcript) {
    await tg.sendMessage(chatId, "🤷 Transcription empty.", { replyTo: msg.message_id });
    return;
  }

  const { text: safeTranscript, redactedCount } = redactSecrets(transcript);
  const redactNote = redactedCount > 0 ? `\n\n⚠️ Redacted ${redactedCount} secret-like token(s).` : "";
  const promptMsg = await tg.sendMessage(
    chatId,
    `🎤 I heard:\n${safeTranscript}${redactNote}\n\nDispatch to ${s.cli} (project: ${describeProject(s)})?`,
    {
      replyTo: msg.message_id,
      replyMarkup: {
        inline_keyboard: [[
          { text: "✅ Confirm", callback_data: "voice:ok" },
          { text: "✏️ Edit", callback_data: "voice:edit" },
          { text: "❌ Cancel", callback_data: "voice:cancel" },
        ]],
      },
    },
  );
  // Persist by promptMessageId so multiple in-flight voice messages don't
  // collide. Editing later will look up by (chatId, fromUserId).
  if (promptMsg?.message_id) {
    voicePendingStore.put(chatId, promptMsg.message_id, {
      transcript: safeTranscript,
      fromUserId: msg.from?.id ?? null,
      fromUsername: msg.from?.username,
      originalMessageId: msg.message_id,
      awaitingEdit: false,
    });
  }
}

async function handleCallback(tg, sessions, cb, { model, logger, store, voicePendingStore }) {
  const chatId = String(cb.message.chat.id);
  const s = sessions.get(chatId);
  if (!s) return tg.answerCallbackQuery(cb.id, "Session expired");

  const data = cb.data;
  const promptMsgId = cb.message.message_id;

  if (data === "voice:cancel") {
    voicePendingStore.take(chatId, promptMsgId);
    await tg.answerCallbackQuery(cb.id, "Cancelled");
    await tg.editMessage(chatId, promptMsgId, "❌ Voice cancelled.");
    return;
  }
  if (data === "voice:edit") {
    const pending = voicePendingStore.peek(chatId, promptMsgId);
    voicePendingStore.setAwaitingEdit(chatId, promptMsgId, true);
    await tg.answerCallbackQuery(cb.id, "Send the corrected text as a normal message");
    await tg.editMessage(chatId, promptMsgId, `🎤 ${pending?.transcript || "(expired)"}\n\n✏️ Send the corrected text as a regular message — the bridge will pick it up.`);
    return;
  }
  if (data === "voice:ok") {
    const pending = voicePendingStore.take(chatId, promptMsgId);
    if (!pending) {
      await tg.answerCallbackQuery(cb.id, "Pending voice expired");
      return;
    }
    await tg.answerCallbackQuery(cb.id, `Dispatching to ${s.cli}…`);
    await dispatch(tg, s, chatId, cb.message, pending.transcript, { cli: s.cli, model, logger, store });
    return;
  }
  await tg.answerCallbackQuery(cb.id);
}

// ─────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────

async function dispatch(tg, s, chatId, replyToMsg, prompt, { cli, model, logger, store }) {
  if (s.currentJob) {
    await tg.sendMessage(chatId, "⏳ A task is already running. Use /cancel first.", {
      replyTo: replyToMsg.message_id,
    });
    return;
  }

  const ac = new AbortController();
  s.currentJob = ac;

  // Typing indicator pulse — Telegram clears it after ~5s, so refresh every 4s.
  tg.sendTyping(chatId).catch(() => {});
  const typingTimer = setInterval(() => { tg.sendTyping(chatId).catch(() => {}); }, 4000);

  // FW-style streaming: collect events, send periodic status while tools run,
  // flush one tool block per tool_use on completion + final assistant text.
  const state = newRenderState();
  let lastStatusSent = "";
  let statusTimer = null;
  const sendStatus = async () => {
    statusTimer = null;
    const text = renderStatus(state);
    if (text && text !== lastStatusSent) {
      lastStatusSent = text;
      try { await tg.sendMessage(chatId, text, { parseMode: "HTML" }); }
      catch (e) { logger.warn(`status send failed: ${e.message}`); }
    }
  };
  const scheduleStatus = () => {
    if (statusTimer) return;
    statusTimer = setTimeout(() => sendStatus().catch(() => {}), STATUS_INTERVAL_MS);
  };

  try {
    const onEvent = (event) => {
      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        setSessionId(s, event.session_id, cli);
        persist(store, chatId, s);
      }
      applyEventToState(state, event);
      // Trigger a status update soon after activity, so users see progress.
      if (event.type === "assistant") scheduleStatus();
    };

    const cwd = s.cwd;
    const resumeSid = getSessionId(s, cli);
    let runResult;
    if (cli === "codex") {
      runResult = runCodex({ prompt, cwd, signal: ac.signal, onEvent });
    } else if (cli === "deepseek") {
      runResult = runDeepseek({ prompt, cwd, signal: ac.signal, onEvent });
    } else if (cli === "gemini") {
      runResult = runGemini({ prompt, cwd, model, signal: ac.signal, onEvent });
    } else {
      runResult = runClaude({ prompt, sessionId: resumeSid, model, cwd, signal: ac.signal, onEvent, onError: (e) => logger.warn(`claude stream: ${e.message}`) });
    }
    await runResult.done;

    // Drain: send each tool block as its own message, then final text + footer.
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    for (const t of state.tools) {
      try {
        await tg.sendMessage(chatId, renderToolBlock(t.name, t.input, t.result || "", t.isError), { parseMode: "HTML" });
      } catch (e) {
        logger.warn(`tool block send failed: ${e.message}`);
      }
    }
    try {
      await tg.sendMessage(chatId, renderFinal(state), { parseMode: "HTML", replyTo: replyToMsg.message_id });
    } catch (e) {
      logger.warn(`final send failed: ${e.message}`);
    }
  } catch (e) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    try {
      await tg.sendMessage(chatId, `❌ <b>${escapeHtml(e.message)}</b>`, { parseMode: "HTML", replyTo: replyToMsg.message_id });
    } catch { /* ignore */ }
  } finally {
    clearInterval(typingTimer);
    s.currentJob = null;
  }
}

function parseAllowList(input) {
  if (!input) return null;
  const arr = Array.isArray(input) ? input : String(input).split(/[,\s]+/).filter(Boolean);
  if (!arr.length) return null;
  return new Set(arr.map(String));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
