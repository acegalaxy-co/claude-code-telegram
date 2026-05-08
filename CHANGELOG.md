# Changelog

## [2.0.1] - 2026-05-08

### Fixed
- **Codex CLI 0.129+ JSON event shapes** — runner now parses `thread.started`, `turn.started`, `item.completed` (`agent_message` / `reasoning` / `command_execution`), `turn.completed` in addition to the legacy `AgentMessage` / `TaskComplete` shapes. Previously Codex output rendered as `(no response)` because no events matched.
- **Codex prompt invocation** — pass prompt via stdin instead of `--` positional argv, avoiding quoting issues.
- **Filter Codex internal `Reconnecting...` warnings** — they fire while the agent is still working and aren't user-facing errors.

## [2.0.0] - 2026-05-08

Initial public snapshot under `@acegalaxy/claude-code-telegram@2.x`.

Earlier `0.x` and `1.x` versions on npm were experimental iterations and are deprecated; please use `2.x`.

### Highlights

- **Telegram ↔ AI CLI bridge** for Claude Code, OpenAI Codex, DeepSeek (via aider), and Google Gemini. Default CLI: Claude. Switch per-chat with `/cli`.
- **Multi-project switching.** Drop git checkouts under `projects/`, switch with `/projects` (numbered list) and `/project <num|name>`. Each project's `.claude/` harness (CLAUDE.md, agents, commands, hooks, skills, MCP) is auto-loaded by Claude CLI on cwd switch.
- **Persistent per-(project × CLI) sessions.** Switching project or CLI resumes the matching session if one exists. State written to `.sessions.json` next to `.env` (override with `STATE_DIR`); survives bridge restarts. `/last` lists recent Claude sessions in cwd; `/last <num>` resumes one.
- **Voice in.** Telegram voice → OpenAI Whisper (deterministic temperature=0) → Confirm/Edit/Cancel buttons → dispatch to chat's selected CLI. ✏️ Edit-flow intercepts the next text reply as the corrected transcript.
- **Claude-CLI-native UX.** Periodic `⏳ <tool> — <hint>` status while running, one HTML block per `tool_use` on completion (red icon on errors), final `💬 <answer>` + `$cost · duration · N tools` footer.
- **Security defaults.** `TELEGRAM_ALLOWED_CHAT_IDS` required at startup (explicit `TELEGRAM_ALLOW_ANY_CHAT=true` to opt out). Per-chat rate limits (60 text/h, 10 voice/h). Voice: 10 MB / 5 min cap with MIME allowlist + Content-Length pre-check. 4 KB message cap. Secret redaction (sk-/ghp_/xoxb-/glpat-/AKIA/AIza/JWT/telegram tokens) on prompts AND transcripts before dispatch + audit log.
- **Telegram parity** with the Anthropic framework reference: BotCommands menu (`/`-autocomplete in Telegram), `sendChatAction "typing"` pulsed every 4s during dispatch, `getUpdates` with exponential backoff (1s..30s), HTML parse-mode plain-text fallback, voice pending TTL store keyed by `chatId:promptMessageId`.
- **Commands**: `/help /new /cancel /session /cli /projects /project /pwd /last /ping /status /whoami`.
- **Layout**:
  ```
  lib/
  ├── bridge.mjs                    # entry — main loop
  ├── runners/   {claude,codex,deepseek,gemini}.mjs
  ├── telegram/  {api,render}.mjs
  ├── voice/     {stt,pending}.mjs
  ├── session/   {store,history}.mjs
  └── util/      {projects,rate-limit}.mjs
  ```
- **Footprint.** 1 runtime dep (`dotenv`), Node 20+, ~22 KB tarball.

### Breaking changes vs `1.x`

- Package renamed earlier from `@acegalaxy/telegram-claude-bridge` (deprecated). Use `@acegalaxy/claude-code-telegram@2.x`.
- `TELEGRAM_ALLOWED_CHAT_IDS` is required at startup (opt out with `TELEGRAM_ALLOW_ANY_CHAT=true`).

[2.0.0]: https://github.com/acegalaxy-co/claude-code-telegram/releases/tag/v2.0.0
