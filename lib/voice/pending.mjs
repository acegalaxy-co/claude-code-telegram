/**
 * In-memory TTL store for pending voice transcripts awaiting user confirmation.
 * Keyed by `${chatId}:${promptMessageId}` — supports multiple in-flight voice
 * messages per chat (FW-style). 10-minute TTL; lazy purge on every operation.
 *
 * Restarting the bridge clears all pending voice — acceptable because the flow
 * is short and interactive (user clicks Confirm/Edit/Cancel on a fresh prompt).
 */

export const VOICE_TTL_MS = 10 * 60 * 1000; // 10 min

export function createVoicePendingStore() {
  const store = new Map();

  function _purge() {
    const cutoff = Date.now() - VOICE_TTL_MS;
    for (const [k, v] of store) {
      if (v.createdAt < cutoff) store.delete(k);
    }
  }

  function key(chatId, promptMessageId) {
    return `${chatId}:${promptMessageId}`;
  }

  return {
    put(chatId, promptMessageId, payload) {
      _purge();
      store.set(key(chatId, promptMessageId), { ...payload, createdAt: Date.now() });
    },
    take(chatId, promptMessageId) {
      _purge();
      const k = key(chatId, promptMessageId);
      const v = store.get(k);
      if (!v) return null;
      store.delete(k);
      return v;
    },
    peek(chatId, promptMessageId) {
      _purge();
      return store.get(key(chatId, promptMessageId)) || null;
    },
    findEditPending(chatId, userId) {
      _purge();
      const prefix = `${chatId}:`;
      let best = null;
      for (const [k, v] of store) {
        if (!k.startsWith(prefix)) continue;
        if (!v.awaitingEdit) continue;
        if (v.fromUserId !== userId) continue;
        if (!best || v.createdAt > best.value.createdAt) best = { key: k, value: v };
      }
      return best;
    },
    takeByKey(k) {
      const v = store.get(k);
      if (!v) return null;
      store.delete(k);
      return v;
    },
    setAwaitingEdit(chatId, promptMessageId, awaitingEdit) {
      const k = key(chatId, promptMessageId);
      const v = store.get(k);
      if (v) v.awaitingEdit = awaitingEdit;
    },
    size() { _purge(); return store.size; },
    clearAll() { store.clear(); },
  };
}
