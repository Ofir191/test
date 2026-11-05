const g = globalThis;

if (!g.__mishmarListeners) g.__mishmarListeners = new Set();

export function publish(reason) {
  const payload = { type: "changed", reason, at: new Date().toISOString() };
  for (const listener of g.__mishmarListeners) {
    try {
      listener(payload);
    } catch {
      /* a disconnected client should not break the publisher */
    }
  }
}

export function subscribe(listener) {
  g.__mishmarListeners.add(listener);
  return () => g.__mishmarListeners.delete(listener);
}
