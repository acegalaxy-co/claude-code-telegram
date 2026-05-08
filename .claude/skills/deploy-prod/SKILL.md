---
name: deploy-prod
description: Deploy a published npm version of @acegalaxy/claude-code-telegram to the prod server (aws-prod, pm2 cc-bot). Use when version is already on npm and you just need to roll prod forward.
---

# deploy-prod

Updates the prod bridge to a specified version that's already published to npm.

## When to use

- A version is already on npm (verified via `npm view @acegalaxy/claude-code-telegram versions`).
- Prod is on an older version and needs to be updated.
- You only want to roll prod forward — not publish.

If you also need to publish, use the `release-manager` agent instead.

## Inputs

- `<version>`: semver string, e.g. `2.2.0`. Default: latest tag from npm.

## Steps

1. **Verify target version exists on npm**:
   ```sh
   npm view @acegalaxy/claude-code-telegram@<version>
   ```

2. **Check current prod version**:
   ```sh
   ssh aws-prod 'npm ls -g --depth=0 2>/dev/null | grep claude-code-telegram'
   ```

3. **Install + restart**:
   ```sh
   ssh aws-prod 'sudo npm i -g @acegalaxy/claude-code-telegram@<version> && pm2 restart cc-bot && sleep 3 && pm2 logs cc-bot --lines 12 --nostream'
   ```

4. **Cache-bust fallback** (if `ETARGET no matching version`):
   ```sh
   ssh aws-prod 'sudo npm cache clean --force && sudo npm i -g @acegalaxy/claude-code-telegram@<version> --registry=https://registry.npmjs.org/ && pm2 restart cc-bot'
   ```

5. **Verify**:
   - Logs contain `🛡 Security: chat allowlist + user allowlist + admin set ✓`
   - Logs contain `📜 Registered 13 bot commands` (current expected count)
   - `pm2 list` shows `cc-bot` status `online`

6. **Smoke test from Telegram**: tell the user to send `/ping` and `/audit 5` to verify end-to-end.

## Failure modes

- **`ETARGET no matching version`** — registry mirror lag. Wait 30s + retry once with cache-bust.
- **`EACCES`** — sudo missing. Confirm user is `kane` (NOPASSWD sudo).
- **pm2 restart succeeds but logs show old version** — global install hit a different prefix. Check `which claude-code-telegram` on prod.
- **Bot starts but security warnings appear** — `.env` was edited and lost ACL keys. Check `/home/kane/ai-control/cc-bot/.env`.

## Boundaries

- Do NOT run any code on prod beyond the documented commands.
- Do NOT read or copy `.env` or `.audit.log` off the server.
- Do NOT modify `.env` on prod without telling the user — env changes affect access control.
