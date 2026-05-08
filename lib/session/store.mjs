/**
 * Persist per-chat session state to a JSON file next to the .env file.
 *
 * Shape:
 *   {
 *     "<chatId>": {
 *       cli: "claude",
 *       project: "demo",
 *       sessionsByProjectCli: {
 *         "demo|claude": "uuid-1",
 *         "nexus|codex": "uuid-2"
 *       },
 *       updatedAt: 1234567890
 *     }
 *   }
 *
 * Writes are debounced (~500 ms) to avoid disk thrashing under load.
 * Survives bridge restarts; cleared by deleting the file.
 */

import fs from "node:fs";
import path from "node:path";

const FILENAME = ".sessions.json";
const WRITE_DEBOUNCE_MS = 500;

export function createStateStore({ dir, logger = console } = {}) {
  const file = path.join(dir, FILENAME);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object") data = {};
  } catch {
    data = {};
  }

  let writeTimer = null;
  function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      try {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
      } catch (e) {
        logger.warn(`state-store write failed: ${e.message}`);
      }
    }, WRITE_DEBOUNCE_MS);
  }

  return {
    get(chatId) {
      return data[String(chatId)] || null;
    },
    set(chatId, patch) {
      const id = String(chatId);
      const cur = data[id] || {};
      data[id] = { ...cur, ...patch, updatedAt: Date.now() };
      scheduleWrite();
      return data[id];
    },
    delete(chatId) {
      delete data[String(chatId)];
      scheduleWrite();
    },
    flush() {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      try {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
      } catch (e) {
        logger.warn(`state-store flush failed: ${e.message}`);
      }
    },
    file,
  };
}
