# Launch posts — copy & paste

Repo: https://github.com/acegalaxy-co/claude-code-telegram
npm: https://www.npmjs.com/package/@acegalaxy/claude-code-telegram

---

## 1. Hacker News — Show HN

**Title (HN sweet spot, < 80 chars):**

```
Show HN: Use Claude Code (and Codex/DeepSeek/Gemini) from Telegram
```

**Body:**

```
Hi HN — I built a tiny bridge between Telegram and the major coding-agent CLIs. SSH-install on a server, point a Telegram bot at it, and you can chat with Claude Code (or Codex / DeepSeek / Gemini) from your phone.

Why I built it: I love Claude Code on the desktop, but I wanted to start agents from anywhere — airport, lunch, bed — and watch them stream while I do something else. Existing wrappers either ship a heavyweight queue + database or only support one model.

It's intentionally small: ~17 KB tarball, one runtime dep (dotenv), Node 20+. The whole thing is one Node process — no Redis, no DB, no orchestrator. State is per-chat in memory.

What it does:
- Streams stdout of `claude --output-format stream-json` (and codex/deepseek/gemini equivalents) back to Telegram, batched every ~1.5s.
- Per-chat session memory (uses `claude --resume <session-id>`).
- Switch CLI mid-chat: `/cli claude|codex|deepseek|gemini`. Inline force per message: `codex: refactor this`.
- Multi-project: drop git checkouts in `projects/`, switch with `/project alpha`. Each project's `.claude/` harness (CLAUDE.md, agents, commands, hooks, skills, MCP) is auto-loaded by Claude CLI on cwd switch.
- Voice in: send a Telegram voice note → OpenAI Whisper transcribes (deterministic temperature=0) → Confirm/Edit/Cancel buttons → dispatch to the chat's CLI.

Security I cared about (v1.1.0):
- Bot refuses to start without `TELEGRAM_ALLOWED_CHAT_IDS` (explicit `TELEGRAM_ALLOW_ANY_CHAT=true` to opt out).
- Per-chat token-bucket rate limits (60 text/h, 10 voice/h).
- Voice caps: 10 MB / 5 min / MIME allowlist.
- Secret redaction (sk-/ghp_/xoxb-/glpat-/AKIA/AIza/JWT/telegram tokens) on user prompts AND Whisper transcripts before display, dispatch, and audit log.
- Message size cap 4000 chars.

The bridge runs `claude --dangerously-skip-permissions`, so the agent has full tool access in cwd. That's the model I wanted (it's my server, my files), but the README is explicit about not running on a host with secrets you don't trust the allowlist for.

Quickstart:

  npm i -g @anthropic-ai/claude-code         # required
  npm i -g @acegalaxy/claude-code-telegram
  mkdir ~/cc-bot && cd ~/cc-bot
  claude-code-telegram init                  # scaffolds .env + projects/
  # edit .env, drop a repo into projects/
  claude-code-telegram

Repo: https://github.com/acegalaxy-co/claude-code-telegram
npm: https://www.npmjs.com/package/@acegalaxy/claude-code-telegram

MIT licensed. Feedback / issues / PRs very welcome — especially around the four CLI runners (claude is mature, gemini/deepseek are best-effort right now).
```

---

## 2. Reddit — r/ClaudeAI (also r/LocalLLaMA, r/ChatGPTCoding)

**Title:**

```
[Open source] Use Claude Code from Telegram (also Codex/DeepSeek/Gemini) — 17 KB, 1 dep
```

**Body:**

```
**TL;DR:** `npm i -g @acegalaxy/claude-code-telegram` → talk to Claude Code (or Codex/DeepSeek/Gemini) from your phone via a Telegram bot. Each project keeps its own `.claude/` harness. Voice messages get Whisper-transcribed and confirmed before dispatch. MIT.

I wanted Claude Code on my phone without giving up the `.claude/` harness (CLAUDE.md, agents, commands, hooks, skills, MCP) of each project. So I wrote a tiny Telegram bridge that just spawns the CLI in `cwd=<project-dir>` and streams stream-json back.

**What's nice:**
- 4 CLIs in one bot. Switch with `/cli codex` or `deepseek: <prompt>` inline.
- Multi-project: drop checkouts in `projects/`, `/project alpha` to switch.
- Voice in: Telegram voice → Whisper → Confirm/Edit/Cancel → dispatch.
- ~17 KB, 1 runtime dep (dotenv). Node 20+. No DB, no queue.

**Security (v1.1.0):**
Strict allowlist required at startup. Per-chat rate limits. 4 KB message cap. 10 MB / 5 min voice cap with MIME allowlist. Secret-pattern redaction on prompts AND transcripts. Whisper temperature=0.

The bridge runs `claude --dangerously-skip-permissions`, so model has full tool access. Run on a server you control + an allowlist you trust.

**Repo:** https://github.com/acegalaxy-co/claude-code-telegram
**npm:** https://www.npmjs.com/package/@acegalaxy/claude-code-telegram

Issues + PRs very welcome.
```

---

## 3. X / Twitter — thread

**Tweet 1 (hook):**

```
Use Claude Code from your phone.

`npm i -g @acegalaxy/claude-code-telegram` → spin up a Telegram bot → chat with Claude Code (or Codex / DeepSeek / Gemini) from anywhere. Each project keeps its own .claude/ harness.

17 KB. 1 runtime dep. MIT.

🧵👇
```

**Tweet 2:**

```
Why: I wanted to start agents from airport / lunch / bed and watch them stream. Existing wrappers ship a queue + DB. This is one Node process, in-memory state, ~300 LOC of glue.

claude --output-format stream-json → Telegram, batched every 1.5s.
```

**Tweet 3:**

```
Multi-project: checkout repos under projects/, /project alpha to switch. Each subdir's .claude/ (CLAUDE.md, agents, commands, hooks, skills, MCP) is auto-loaded by Claude CLI on cwd switch.

So: 1 bot, N projects, N harnesses. /pwd to see where you are.
```

**Tweet 4:**

```
4 CLIs: /cli claude|codex|deepseek|gemini. Or inline: `codex: refactor this`.

Voice in: send a voice note → OpenAI Whisper (temperature=0) → Confirm/Edit/Cancel buttons → dispatch.
```

**Tweet 5 (security):**

```
Security v1.1.0:
- Strict allowlist required at startup
- Per-chat rate limits (60 text/h, 10 voice/h)
- 4 KB message cap, 10 MB / 5 min voice cap, MIME allowlist
- Secret redaction on prompts + transcripts (sk-, ghp_, JWT, AKIA, …)
- Audit log per dispatch
```

**Tweet 6 (CTA):**

```
Repo: github.com/acegalaxy-co/claude-code-telegram
npm: npmjs.com/package/@acegalaxy/claude-code-telegram

MIT. Issues + PRs welcome 🙌
```

---

## 4. dev.to / Hashnode (long form)

**Title:** *Use Claude Code from your phone — a 17 KB Telegram bridge that supports 4 CLIs*

(See README for body — adapt the README's intro + features + quickstart sections.)

---

## 5. LinkedIn

```
Just open-sourced a small project: claude-code-telegram.

npm i -g @acegalaxy/claude-code-telegram → spin up a Telegram bot on any Linux box → chat with Claude Code (or Codex / DeepSeek / Gemini) from anywhere. Each project carries its own .claude/ harness, switchable per chat. Voice messages get Whisper-transcribed.

17 KB tarball, 1 runtime dependency, MIT-licensed. Built it because I wanted to start coding agents from airports, not just my desk.

Repo + npm: https://github.com/acegalaxy-co/claude-code-telegram

Feedback welcome — especially from anyone running coding agents on a server.
```
