# claude-code-telegram

[![npm version](https://img.shields.io/npm/v/@acegalaxy/claude-code-telegram.svg)](https://www.npmjs.com/package/@acegalaxy/claude-code-telegram)
[![license](https://img.shields.io/npm/l/@acegalaxy/claude-code-telegram.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@acegalaxy/claude-code-telegram.svg)](https://nodejs.org)

> **Use Claude Code (and Codex / DeepSeek / Gemini) from Telegram.** A tiny bridge that streams between any Telegram chat and your favorite coding-agent CLI — text or voice in, real-time stream out, full `.claude/` harness per project. Zero queue, zero orchestrator, zero database.

## Why

[Claude Code CLI](https://github.com/anthropics/claude-code) is amazing on the desktop. But you can't always be at your desk. This bridge lets you SSH-install it on a server, point Telegram at it, and **chat with Claude Code from your phone** — same context, same tools, same model, same `.claude/` harness per project.

Switch CLI mid-session: `/cli codex`, `/cli deepseek`, `/cli gemini`. Switch project: `/project alpha`. Send a voice note: it gets transcribed via Whisper and shown for confirmation before dispatch.

## Features

- 📱 Two-way Telegram chat ↔ coding-agent CLI subprocess
- 🤖 **4 CLIs supported:** Claude Code · OpenAI Codex · DeepSeek (via aider) · Google Gemini
- 📁 **Multi-project switching** — checkout repos under `projects/`, switch per-chat with `/project <name>`. Each project's `.claude/` harness (CLAUDE.md, agents, commands, hooks, skills, MCP) is auto-loaded by Claude CLI on cwd switch.
- 🌊 Real-time streaming: text + tool calls + tool results
- 🎤 Voice in: Telegram voice → OpenAI Whisper → confirm/edit/cancel buttons → dispatch
- 🧠 Per-chat session memory (Claude `--resume`)
- 🔒 Chat-ID allowlist (recommended)
- 🛑 `/cancel` to interrupt
- 📦 ~17 KB tarball, 1 runtime dep (`dotenv`), Node 20+

## Quickstart

```bash
# 1. Install your coding CLI(s)
npm install -g @anthropic-ai/claude-code   # required (default)
npm install -g @openai/codex                # optional
pipx install aider-chat                     # optional (for /cli deepseek)
npm install -g @google/gemini-cli           # optional

# 2. Authenticate them once
claude /login
codex login   # if using codex
# (gemini & deepseek use API keys via env)

# 3. Install the bridge
npm install -g @acegalaxy/claude-code-telegram

# 4. Scaffold an install dir
mkdir ~/cc-bot && cd ~/cc-bot
claude-code-telegram init      # creates .env + projects/
# edit .env — paste TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_IDS

# 5. Drop your projects in
cd projects && git clone https://github.com/you/your-app.git alpha
cd ..

# 6. Run
claude-code-telegram
```

Layout:

```
~/cc-bot/
├── .env                # config (token, allowed chats, API keys)
└── projects/
    ├── alpha/          # may carry its own .claude/ harness
    ├── beta/
    └── gamma/
```

Configure `DEFAULT_PROJECT=alpha` in `.env` to auto-select on `/new`.

## Telegram commands

| Command | What |
|---|---|
| `/help` | Show help + current state |
| `/new` | New session (reset to default CLI + project) |
| `/cancel` | Stop the running task |
| `/session` | Show CLI, project, cwd, session id |
| `/cli [claude\|codex\|deepseek\|gemini]` | Show or switch CLI for this chat |
| `/projects` | List projects under `PROJECTS_ROOT` |
| `/project <name>` | Switch to project (cwd) |
| `/pwd` | Show current cwd |

**Inline force per-message** (overrides current `/cli` for one turn):

```
codex: refactor this script to use top-level await
deepseek: write unit tests for utils/parse.js
gemini: explain what this regex does: ^(?=.*[A-Z])(?=.*\d).{8,}$
claude: summarize today's git log
```

**Voice input** (set `OPENAI_API_KEY` to enable): send a voice/audio message → Whisper transcribes → bot shows `[✅ Confirm] [✏️ Edit] [❌ Cancel]` → dispatch to the chat's selected CLI.

## Run as a service

PM2:

```bash
pm2 start claude-code-telegram --name cc-bot --cwd ~/cc-bot
pm2 save && pm2 startup
```

systemd:

```ini
[Service]
ExecStart=/usr/bin/env claude-code-telegram
WorkingDirectory=/home/you/cc-bot
Restart=always
EnvironmentFile=/home/you/cc-bot/.env
```

## How it works

```
┌──────────┐  long-poll   ┌─────────────┐  spawn(cwd=projects/alpha) ┌────────────┐
│ Telegram │ ──────────►  │   bridge    │ ─────────────────────────► │ claude CLI │
│  (user)  │ ◄──────────  │   (Node)    │ ◄───────── stream-json ─── │ (--print)  │
└──────────┘   batched    └─────────────┘                            └────────────┘
                                │
                          per-chat state:
                            cli, project, cwd,
                            sessionId, abort, pendingVoice
```

- One Node process. No Redis. No DB. No queue.
- Per-chat state lives in memory (cli + project + sessionId + abort controller).
- Crash = restart from scratch (PM2/systemd handles this; Claude side keeps sessions).
- Each project's `.claude/` directory is auto-loaded by Claude CLI when spawned with `cwd=<project-path>` — your project agents, commands, hooks, skills, and MCP servers Just Work.

## Environment

| Var | Required | What |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | strongly recommended | Comma-separated chat IDs |
| `PROJECTS_ROOT` | optional | Default: `./projects` |
| `DEFAULT_PROJECT` | optional | Subdir to auto-select on `/new` |
| `CLAUDE_MODEL` | optional | `sonnet`, `opus`, `haiku`, or full id |
| `CLAUDE_CWD` | optional | Single-cwd fallback when no `PROJECTS_ROOT` |
| `OPENAI_API_KEY` | optional | Enables voice STT (Whisper) |
| `WHISPER_MODEL` | optional | Default `whisper-1` |
| `VOICE_LANGUAGE` | optional | BCP-47 hint, e.g. `vi`, `en` |
| `DEEPSEEK_API_KEY` | for `/cli deepseek` | Get at [platform.deepseek.com](https://platform.deepseek.com/) |

## Security

- **Always set `TELEGRAM_ALLOWED_CHAT_IDS`** in production. Without it, anyone who finds your bot username can run agent CLIs on your machine.
- The bridge runs `claude --dangerously-skip-permissions` so the model can use tools without prompts. **Do not run on a host with sensitive files** unless you trust the chat allowlist.
- Bot token + API keys are long-lived credentials. Store in `.env` (chmod 600), never commit.

See [SECURITY.md](SECURITY.md).

## License

MIT © ACE Galaxy

---

Built by humans + agents at [acegalaxy.co](https://acegalaxy.co). Issues + PRs welcome.
