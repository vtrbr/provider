'use strict';

const { request } = require('../lib/http');
const { cached } = require('../lib/cache');

const BASE = (process.env.TMDB_API_URL || process.env.TMDB_BASE_URL || 'https://tmdb.tedflix.site').replace(/\/+$/, '');
const TIMEOUT = Number(process.env.TMDB_TIMEOUT_MS) || 15000;

async function getJson(path, cacheKey, ttl = 3600) {
  return cached('global', `tmdb:${cacheKey}`, ttl, async () => {
    const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await request(url, {
      timeout: TIMEOUT,
      maxBytes: 8 * 1024 * 1024,
      headers: { Accept: 'application/json' },
    });
    let data;
    try {
      data = JSON.parse(response.text || '{}');
    } catch {
      throw new Error(`TMDB service returned invalid JSON (HTTP ${response.status})`);
    }
    if (response.status >= 400 || data.ok === false) {
      const error = new Error(data.erro || data.error || `TMDB service HTTP ${response.status}`);
      error.status = response.status;
      error.code = data.codigo || data.code || 'TMDB_UPSTREAM_ERROR';
      throw error;
    }
    return data;
  });
}

function mediaPath(type) {
  return type === 'series' || type === 'serie' || type === 'tv' ? 'serie' : 'filme';
}

async function getById(type, id) {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('TMDB ID inválido');
  const media = mediaPath(type);
  return getJson(`/v5/meta/${media}/${encodeURIComponent(String(id))}`, `meta:${media}:${id}`);
}

async function enrichByTitle(title, type, year) {
  if (!String(title || '').trim()) throw new Error('Título ausente para consultar o TMDB');
  const params = new URLSearchParams({
    titulo: String(title).trim(),
    tipo: mediaPath(type),
  });
  if (year && Number.isFinite(Number(year))) params.set('ano', String(Number(year)));
  return getJson(`/v5/enrich?${params.toString()}`, `enrich:${params.toString()}`, 3600);
}

module.exports = { BASE, getById, enrichByTitle };
