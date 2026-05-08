# Security Policy

## Reporting a vulnerability

If you discover a security issue in `@acegalaxy/claude-code-telegram`, please **do not** open a public GitHub issue.

Email **security@acegalaxy.co** with: description + impact, steps to reproduce, affected versions, your contact.

We will acknowledge within **48 hours** and provide a timeline for fix and disclosure.

## What this bridge does that you should understand

- Spawns `claude --dangerously-skip-permissions` — Claude can use any tool (filesystem, shell, web fetch) without asking. Only run on hosts where you accept that.
- Listens on Telegram long-poll. Anyone in the allowlist can send messages that become Claude prompts.
- Persists per-chat `session_id` in process memory only.

## Hardening recommendations

1. **Always set `TELEGRAM_ALLOWED_CHAT_IDS`** — without it, anyone who finds the bot username can run Claude on your machine.
2. **Run in a sandboxed user** (not root) — limit blast radius of file/shell tool use.
3. **Use a chroot / container / VM** if you handle sensitive data on the same host.
4. **Rotate the bot token** if you suspect leak. Token is a long-lived credential.
5. **Audit Claude tool use** via `claude` logs — the bridge does not enforce a tool allowlist beyond what `claude` itself does.

## Supported versions

Only the latest minor of the current major receives security fixes.
