'use strict';

const NodeCache = require('node-cache');

// Separate caches so one provider cannot pollute another
const caches = {
  v1: new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false }),
  v2: new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false }),
  v3: new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false }),
  v4: new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false }),
  v5: new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false }),
  global: new NodeCache({ stdTTL: 120, checkperiod: 30, useClones: false }),
};

function getCache(api) {
  return caches[api] || caches.global;
}

async function cached(api, key, ttlSeconds, fn) {
  const c = getCache(api);
  const hit = c.get(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined && value !== null) {
    c.set(key, value, ttlSeconds);
  }
  return value;
}

function invalidate(api, key) {
  getCache(api).del(key);
}

function stats() {
  const out = {};
  for (const [k, c] of Object.entries(caches)) {
    out[k] = c.getStats();
  }
  return out;
}

module.exports = { cached, invalidate, stats, getCache };
