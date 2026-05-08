# claude-code-telegram — engineering harness

## What this is

Telegram ↔ AI CLI bridge. A user sends a Telegram message, the bridge spawns a CLI (Claude Code / Codex / DeepSeek-via-aider / Gemini) in a project cwd, streams events back to chat. Voice in via Whisper. Multi-project, persistent session per (project × CLI).

Published as `@acegalaxy/claude-code-telegram` on npm. Single binary `claude-code-telegram` at [bin/cli.mjs](bin/cli.mjs).

## Layout

```
bin/cli.mjs              Entry — env load, scaffold init, start bridge
lib/bridge.mjs           Main loop: long-poll Telegram, route to handler/dispatch
lib/runners/*.mjs        Per-CLI runner (claude, codex, deepseek, gemini) — spawn + parse stream
lib/telegram/{api,render}.mjs   Telegram HTTP client + event → HTML render
lib/voice/{stt,pending}.mjs     Whisper STT + pending-confirm store
lib/session/{store,history}.mjs Persistent .sessions.json + Claude history reader
lib/util/{access,audit,projects,rate-limit}.mjs  Security + project listing + rate buckets
```

## Security model — read this before changing anything

This bridge spawns shell processes on behalf of a Telegram user. Treat it as a security-critical surface. Specifically:

1. **Never log raw prompts.** The audit log stores SHA-256 hash + length only. Don't add `prompt:` fields to audit events. Don't `console.log` prompt content (existing dispatch log truncates to 80 chars — keep that pattern).
2. **Never log absolute `cwd` or filesystem paths in audit events.** Use `project` (logical name) instead. Past leak fixed in 2.1.1.
3. **Truncate `error.message` before audit.** Errors can carry path/prompt fragments. Cap at 200 chars. See [lib/bridge.mjs:225](lib/bridge.mjs#L225).
4. **Access checks ordering.** Block list → chat allowlist → user allowlist. Block always wins. See [lib/util/access.mjs](lib/util/access.mjs).
5. **Project ACL must apply on bootstrap too**, not just `/project` switches — fixed in 2.1.1 inside `ensureSession()`. If you add a new way to set `s.project`, gate it through `projectAllowed()`.
6. **`resolveProject()` is the path-traversal boundary.** It rejects names containing `/`, `..`, or leading `.`. If you add a new project lookup path, use it; do not `path.join(root, userInput)` raw.
7. **Spawn with args array, never shell strings.** All runners use `spawn(cmd, [args...])`. Do not pass `{ shell: true }` to runners.
8. **Secret redaction runs on both text and Whisper transcripts before dispatch.** See [lib/voice/stt.mjs](lib/voice/stt.mjs) `redactSecrets`. Extending patterns is welcome; widening accepted input without redaction is not.
9. **`.env` and `.audit.log` must be 0600.** Audit logger enforces; on prod, `.env` was chmod'd manually. Don't ship code that re-creates `.env` with default umask.
10. **Brute-force alerts go to admin DMs.** Don't broadcast to all chats. See `trackDeny()` in [lib/bridge.mjs](lib/bridge.mjs).

## Conventions

- **ESM, Node ≥20.** No TypeScript, no transpile. `import`, top-level `await` ok.
- **No deps beyond `dotenv`.** Telegram API is hand-rolled `fetch`. Adding a dep needs a strong reason.
- **Comments**: WHY only, not WHAT. Delete obvious comments. Existing module headers explain the contract — mirror that style.
- **Error handling**: trust internal callers; validate at the boundary (Telegram update, env, file read). No defensive try/catch around our own pure functions.
- **Telegram parse mode**: HTML, with plain-text fallback in `tg.sendMessage` on entity errors (already handled in `api.mjs`).

## Release flow

Releases are published via `npm publish` against the public registry. Steps:

1. Bump `version` in [package.json](package.json) (semver: feat → minor, fix/sec → patch).
2. Prepend a CHANGELOG entry under today's date. Pre-existing lint warnings in older sections are not your problem; don't touch them.
3. Commit: `feat(<scope>):` / `fix(<scope>):` / `chore:`. Commit body explains the *why*.
4. `git push origin main`.
5. `npm publish` (you must be `kanelr` or another publisher on the org).
6. Redeploy to the prod server (see below).

Do NOT publish without committing first — npm tarball doesn't show diffs in PRs.

## Prod deployment

Prod runs under `kane@aws-prod` (108.136.162.94, alias in `~/.ssh/config`):

- Process manager: **pm2** (process name `cc-bot`, id 0)
- Working dir: `/home/kane/ai-control/cc-bot/`
- Sibling repos: `framework/`, `ace-commons/`, `ace-ace_nexus-one_nodejs/` (all under `/home/kane/ai-control/`)
- `.env` and `.audit.log`: mode 0600, owner `kane`
- Global package install: `sudo npm i -g @acegalaxy/claude-code-telegram@<v>` (kane has NOPASSWD sudo)

Deploy a new version:

```sh
ssh aws-prod 'sudo npm i -g @acegalaxy/claude-code-telegram@<v> && pm2 restart cc-bot && sleep 3 && pm2 logs cc-bot --lines 12 --nostream'
```

If npm cache is stale (`ETARGET no matching version`), wait ~30s for registry propagation, or:
```sh
ssh aws-prod 'sudo npm cache clean --force && sudo npm i -g @acegalaxy/claude-code-telegram@<v> --registry=https://registry.npmjs.org/'
```

Verify after restart:

- Logs show `🛡 Security: chat allowlist + user allowlist + admin set ✓` (no warnings)
- `📜 Registered 13 bot commands`
- Telegram `/audit 5` returns recent events

## Testing changes

There is no automated test suite. Validate manually:

1. `node --check lib/<file>.mjs` after every edit (catch syntax errors fast).
2. Local run: copy `.env.example` → `.env`, fill `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_CHAT_IDS`, then `node bin/cli.mjs`.
3. End-to-end on prod after deploy: `/ping`, `/whoami`, `/audit 5`, send a normal message to a project, then `/cancel` mid-run.

If you change anything in the access or audit path, you MUST exercise:
- A denied chat (set up a 2nd account, send a message, confirm `auth.deny.chat` event + DM alert after 5 tries)
- `/audit` from admin and from non-admin
- A `/project` switch into a non-permitted project (with `TELEGRAM_PROJECT_ACL` set)

## Common pitfalls

- **Don't commit `.claude/scheduled_tasks.lock`** — it's a Claude Code local artifact. Already in `.gitignore` since 2.1.1; if you re-add `.claude/` files, check they don't slip in.
- **`pm2 restart` does NOT pick up new env vars** unless you pass `--update-env` or `pm2 restart cc-bot --update-env`. After editing `.env`, use update-env.
- **Whisper costs $.** Validate voice (duration/size/MIME) before calling OpenAI — already handled in `stt.mjs`. Don't bypass.
- **Telegram bot token in `.env` is sensitive**. If it leaks, revoke via @BotFather (`/revoke`) and rotate.
- **Prod sudo is NOPASSWD** but only for `kane`. Don't write scripts that require root for normal operation.

## When in doubt

- Read [SECURITY.md](SECURITY.md) for the threat model + reporting policy.
- Read the matching CHANGELOG entry — every security fix documents WHY.
- If a change adds a new attack surface (new env var, new command, new external call), update this file under "Security model" with a numbered rule.
