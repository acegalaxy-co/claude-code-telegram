#!/usr/bin/env node
/**
 * claude-code-telegram — entry CLI.
 *
 * Subcommands:
 *   (none)        Start the bridge (long-poll loop).
 *   init          Scaffold .env + projects/ in cwd.
 *   --help        Print help.
 *   --version     Print version.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const HELP = `claude-code-telegram — Telegram ↔ Claude Code / Codex / DeepSeek / Gemini CLI bridge with optional voice

Usage:
  claude-code-telegram          Start the bridge (long-poll loop).
  claude-code-telegram init     Scaffold .env + projects/ in current dir.
  claude-code-telegram --help   Show this help.
  claude-code-telegram --version

Recommended layout:
  <install-dir>/
  ├── .env                        # config (token, allowed chats, OPENAI_API_KEY, ...)
  └── projects/                   # checkout your projects here
      ├── alpha/                  # each project may have its own .claude/ harness
      ├── beta/
      └── gamma/

Environment variables:
  TELEGRAM_BOT_TOKEN              required — bot token from @BotFather
  TELEGRAM_ALLOWED_CHAT_IDS       optional — comma-separated chat IDs (recommended)
  PROJECTS_ROOT                   optional — dir of projects (default: ./projects)
  DEFAULT_PROJECT                 optional — auto-select on /new (project subdir name)
  CLAUDE_MODEL                    optional — pass to claude --model
  CLAUDE_CWD                      optional — single-cwd fallback if no PROJECTS_ROOT
  OPENAI_API_KEY                  optional — enables Whisper voice transcription
  WHISPER_MODEL                   optional — default whisper-1
  VOICE_LANGUAGE                  optional — BCP-47 hint, e.g. "vi" or "en"
  DEEPSEEK_API_KEY                optional — required for /cli deepseek (uses aider)

Loads .env from current working directory if present.

Requirements:
  - Node.js >= 20
  - claude CLI on PATH (npm i -g @anthropic-ai/claude-code) — default
  - codex CLI on PATH (npm i -g @openai/codex) — optional, for /cli codex
  - aider on PATH (pipx install aider-chat) — optional, for /cli deepseek
  - gemini CLI on PATH (npm i -g @google/gemini-cli) — optional, for /cli gemini
  - Authenticated CLIs (claude /login, codex login; gemini/deepseek via env keys)

Each project directory may contain its own .claude/ (CLAUDE.md, agents,
commands, settings, hooks, skills, MCP). Claude CLI auto-loads them when
spawned with cwd=<project-path>.

Docs:
  https://github.com/acegalaxy-co/claude-code-telegram
`;

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help") || args[0] === "help") {
  console.log(HELP);
  process.exit(0);
}
if (args.includes("-v") || args.includes("--version") || args[0] === "version") {
  const pkg = require(path.resolve(__dirname, "..", "package.json"));
  console.log(pkg.version);
  process.exit(0);
}

if (args[0] === "init") {
  await scaffoldInit();
  process.exit(0);
}

// Default: start bridge.
// Load .env from cwd (optional)
try {
  const dotenvPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(dotenvPath)) {
    const dotenv = await import("dotenv");
    dotenv.config({ path: dotenvPath });
  }
} catch { /* no dotenv — continue with raw process.env */ }

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN env var required.\n");
  console.error("Run `claude-code-telegram init` to scaffold a starter .env in this dir.\n");
  console.error(HELP);
  process.exit(1);
}

// Resolve PROJECTS_ROOT default to <cwd>/projects/ if dir exists.
let projectsRoot = process.env.PROJECTS_ROOT;
if (!projectsRoot) {
  const auto = path.resolve(process.cwd(), "projects");
  if (fs.existsSync(auto) && fs.statSync(auto).isDirectory()) projectsRoot = auto;
}
if (projectsRoot) projectsRoot = path.resolve(projectsRoot);

const { startBridge } = await import("../lib/bridge.mjs");

await startBridge({
  token,
  allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS,
  model: process.env.CLAUDE_MODEL,
  projectsRoot,
  defaultProject: process.env.DEFAULT_PROJECT,
  fallbackCwd: process.env.CLAUDE_CWD,
  openaiApiKey: process.env.OPENAI_API_KEY,
  whisperModel: process.env.WHISPER_MODEL,
  voiceLanguage: process.env.VOICE_LANGUAGE,
});

// ─────────────────────────────────────────────────────────────
// init scaffolder
// ─────────────────────────────────────────────────────────────
async function scaffoldInit() {
  const cwd = process.cwd();
  const envPath = path.join(cwd, ".env");
  const projectsDir = path.join(cwd, "projects");
  const exampleSrc = path.resolve(__dirname, "..", ".env.example");

  if (fs.existsSync(envPath)) {
    console.log(`✓ .env already exists at ${envPath} — leaving as-is`);
  } else if (fs.existsSync(exampleSrc)) {
    fs.copyFileSync(exampleSrc, envPath);
    console.log(`✓ Created .env from .env.example`);
  } else {
    fs.writeFileSync(envPath, "TELEGRAM_BOT_TOKEN=\nTELEGRAM_ALLOWED_CHAT_IDS=\nOPENAI_API_KEY=\n");
    console.log(`✓ Created minimal .env`);
  }

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
    console.log(`✓ Created projects/ directory`);
  } else {
    console.log(`✓ projects/ already exists`);
  }

  console.log(`
Next steps:
  1. Edit .env — paste your TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_IDS.
  2. Optional: set OPENAI_API_KEY to enable voice messages.
  3. Optional: set DEFAULT_PROJECT=<subdir-name> to auto-select on /new.
  4. cd projects/ && git clone <your-project>   (or just create dirs)
  5. claude-code-telegram

Each subdir of projects/ becomes a switchable target on Telegram via /project <name>.
Each project may carry its own .claude/ harness (CLAUDE.md, agents, commands, hooks).
`);
}
