---
name: prod layout
description: Where the bridge runs on AWS prod, who owns it, how it's started.
type: project
---

Prod runs on `aws-prod` (108.136.162.94, ssh alias in ~/.ssh/config).

- User: `kane` (NOPASSWD sudo)
- Process manager: pm2, process name `cc-bot`, id 0
- Working dir: `/home/kane/ai-control/cc-bot/` (sibling to `framework/`, `ace-commons/`, `ace-ace_nexus-one_nodejs/`)
- `.env` and `.audit.log`: mode 0600, owner `kane`
- Global package: `@acegalaxy/claude-code-telegram` installed via `sudo npm i -g`
- pm2 dump: `/home/kane/.pm2/dump.pm2` — `pm2 save` after process changes so they survive reboot

**Why:** Customer asked to colocate with framework + nexus under `ai-control/` (one canonical home for AI services).

**How to apply:** When deploying or debugging prod, always work inside `/home/kane/ai-control/cc-bot/`. State store and audit log live there. Never start the bridge from a different cwd or the state path drifts.
