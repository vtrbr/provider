const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const store = new Map();

function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (store.size > 800) {
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expiresAt) store.delete(k);
  }
  return value;
}

async function wrap(key, fn, ttlMs = DEFAULT_TTL_MS) {
  const cached = get(key);
  if (cached != null) return { data: cached, cache: 'HIT' };
  const data = await fn();
  // Nunca cachear falha (502 VidLink, sem stream, etc.)
  if (data && data.ok === false) {
    return { data, cache: 'MISS' };
  }
  set(key, data, ttlMs);
  return { data, cache: 'MISS' };
}

function stats() {
  const now = Date.now();
  let valid = 0;
  for (const v of store.values()) if (now <= v.expiresAt) valid++;
  return { entries: store.size, valid, ttl_ms: DEFAULT_TTL_MS };
}

module.exports = { get, set, wrap, stats, DEFAULT_TTL_MS };
