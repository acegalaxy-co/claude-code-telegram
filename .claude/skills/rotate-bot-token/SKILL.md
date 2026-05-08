---
name: rotate-bot-token
description: Rotate the Telegram bot token (TELEGRAM_BOT_TOKEN) on prod after a suspected leak. Walks through @BotFather revoke + .env update + pm2 restart with --update-env.
---

# rotate-bot-token

Rotates the Telegram bot token on prod safely. Use when:
- Token may have leaked (committed accidentally, shared in chat, server compromise suspected).
- Routine rotation policy.

## Pre-flight

This skill REQUIRES the user to:
1. Open Telegram → @BotFather → `/revoke` → select the bot → confirm.
2. Receive the new token from BotFather (looks like `123456789:AAH...`).
3. Paste the new token to you.

Do NOT proceed until you have the new token in hand. Old token is dead the moment user revokes — bot will be offline until rotated.

## Steps

1. **Confirm bot is currently running** (so we know baseline):
   ```sh
   ssh aws-prod 'pm2 list'
   ```

2. **Update .env on prod** — use a here-doc, never echo the token to logs:
   ```sh
   ssh aws-prod 'sed -i "s/^TELEGRAM_BOT_TOKEN=.*/TELEGRAM_BOT_TOKEN=<NEW_TOKEN>/" /home/kane/ai-control/cc-bot/.env && grep "^TELEGRAM_BOT_TOKEN" /home/kane/ai-control/cc-bot/.env | head -c 30'
   ```
   (The `head -c 30` only prints the first 30 chars so you can confirm format without leaking the full token.)

3. **Verify .env perms still 0600**:
   ```sh
   ssh aws-prod 'ls -la /home/kane/ai-control/cc-bot/.env'
   ```
   If not 0600, `chmod 600` immediately.

4. **Restart with `--update-env`** (pm2 caches env from start time):
   ```sh
   ssh aws-prod 'pm2 restart cc-bot --update-env && sleep 3 && pm2 logs cc-bot --lines 8 --nostream'
   ```

5. **Verify** — first log line should be `🤖 Bot: @<username>`. If you see `getUpdates 401`, token is wrong or wasn't loaded.

6. **Audit trail** — record the rotation in audit log by sending `/whoami` to the bot. The `command` event proves end-to-end auth still works.

## After rotation

- Tell the user the rotation is complete.
- Remind them to update any other places the old token lived (local `.env`, password manager, deployment docs).
- If this was a leak response, also recommend checking `.audit.log` for unexpected activity around the leak window.

## Boundaries

- NEVER print the new token in your output to the user (they have it; don't echo it back).
- NEVER write the new token into any file other than `.env` on prod.
- If the user pastes the token in chat, treat the chat as compromised channel and recommend revoking again via BotFather.
