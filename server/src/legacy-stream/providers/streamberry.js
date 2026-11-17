/**
 * Streamberry.com.br — catálogo JSON + players BYSE (mesmo decrypt bysebuho)
 * Filme/série: GET /api/v1/movies|series?q=title → tmdbId match → players[].embedUrl byse
 */
const crypto = require('crypto');
const { request, probe } = require('./http');

const API = 'https://streamberry.com.br/api/v1';

function b64urlDecode(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 === 0 ? 0 : 4 - (t.length % 4);
  if (pad) t += '='.repeat(pad);
  return Buffer.from(t, 'base64');
}

function selectKeyParts(version, parts) {
  const list = Array.isArray(parts) ? parts : [];
  let indexes = [];
  const v = typeof version === 'string' ? version.trim() : '';
  if (v) {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 20) {
      const a = n;
      const b = 31 - n;
      if (a >= 1 && a <= list.length && b >= 1 && b <= list.length) indexes = [a, b];
    }
  }
  if (!indexes.length) return list;
  const selected = indexes.map((i) => list[i - 1]).filter(Boolean);
  return selected.length ? selected : list;
}

function decryptBysePlayback(playback) {
  const parts = selectKeyParts(playback.version, playback.key_parts);
  const key = Buffer.concat(parts.map((p) => b64urlDecode(p))).slice(0, 32);
  const iv = b64urlDecode(playback.iv);
  const payload = b64urlDecode(playback.payload);
  const tag = payload.slice(payload.length - 16);
  const data = payload.slice(0, payload.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

async function resolveByse(embedUrl) {
  const m = String(embedUrl || '').match(/\/e\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  for (const host of ['https://bysebuho.com', 'https://byseqekaho.com']) {
    try {
      const r = await request(host + '/api/videos/' + m[1], {
        headers: {
          Referer: host + '/',
          Origin: host,
          Accept: 'application/json'
        },
        timeout: 18000,
        maxBytes: 256 * 1024
      });
      if (r.status >= 400) continue;
      let data;
      try {
        data = JSON.parse(r.text);
      } catch {
        continue;
      }
      if (!data.playback) continue;
      const decrypted = decryptBysePlayback(data.playback);
      const src =
        (decrypted.sources || []).find(
          (s) => /m3u8/i.test(s.mime_type || '') || /\.m3u8/i.test(s.url || '')
        ) || (decrypted.sources || [])[0];
      if (!src || !src.url) continue;
      return {
        stream: src.url,
        stream_type: /\.m3u8/i.test(src.url) || /m3u8/i.test(src.mime_type || '') ? 'hls' : 'mp4',
        headers: { Referer: host + '/' },
        quality: src.quality || null
      };
    } catch (_) {}
  }
  return null;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function searchList(kind, title, tmdb_id) {
  const q = encodeURIComponent(String(title || '').trim());
  if (!q) return null;
  const url = `${API}/${kind}?q=${q}&limit=50`;
  const r = await request(url, {
    headers: { Accept: 'application/json', Referer: 'https://streamberry.com.br/' },
    timeout: 20000,
    maxBytes: 2 * 1024 * 1024
  });
  if (r.status >= 400) return null;
  let data;
  try {
    data = JSON.parse(r.text);
  } catch {
    return null;
  }
  const items = data.items || [];
  const tid = Number(tmdb_id) || 0;
  let hit = items.find((i) => Number(i.tmdbId) === tid);
  if (!hit && title) {
    const n = norm(title);
    hit = items.find((i) => norm(i.title) === n || norm(i.originalTitle) === n);
  }
  // NÃO aceitar "único resultado" sem match de título — causa filme errado
  return hit || null;
}

async function resolveMovie({ title, tmdb_id }) {
  const hit = await searchList('movies', title, tmdb_id);
  if (!hit) return null;
  const detailR = await request(`${API}/movies/${hit.id}`, {
    headers: { Accept: 'application/json', Referer: 'https://streamberry.com.br/' },
    timeout: 20000,
    maxBytes: 2 * 1024 * 1024
  });
  if (detailR.status >= 400) return null;
  let detail;
  try {
    detail = JSON.parse(detailR.text);
  } catch {
    return null;
  }
  const players = (detail.players || []).filter((p) => p.isActive !== false);
  // prefer BYSE DUB
  const ordered = [
    ...players.filter((p) => /byse/i.test(p.serverName || '') && /dub/i.test(p.audioType || p.serverName || '')),
    ...players.filter((p) => /byse/i.test(p.serverName || '')),
    ...players
  ];
  for (const p of ordered) {
    if (!p.embedUrl || !/byse/i.test(p.embedUrl + p.serverName)) continue;
    const got = await resolveByse(p.embedUrl);
    if (got && got.stream) return got;
  }
  return null;
}

async function resolveSeries({ title, tmdb_id, season, episode }) {
  const hit = await searchList('series', title, tmdb_id);
  if (!hit) return null;
  const detailR = await request(`${API}/series/${hit.id}`, {
    headers: { Accept: 'application/json', Referer: 'https://streamberry.com.br/' },
    timeout: 25000,
    maxBytes: 4 * 1024 * 1024
  });
  if (detailR.status >= 400) return null;
  let detail;
  try {
    detail = JSON.parse(detailR.text);
  } catch {
    return null;
  }
  const sNum = Number(season) || 1;
  const eNum = Number(episode) || 1;
  const seasons = detail.seasons || [];
  const sea = seasons.find((s) => Number(s.seasonNumber) === sNum) || seasons[0];
  if (!sea) return null;
  const eps = sea.episodes || [];
  const ep = eps.find((e) => Number(e.episodeNumber) === eNum) || eps[0];
  if (!ep) return null;
  const players = (ep.players || []).filter((p) => p.isActive !== false);
  const ordered = [
    ...players.filter((p) => /byse/i.test(p.serverName || '') && /dub/i.test(p.audioType || p.serverName || '')),
    ...players.filter((p) => /byse/i.test(p.serverName || '')),
    ...players
  ];
  for (const p of ordered) {
    if (!p.embedUrl || !/byse/i.test(p.embedUrl + (p.serverName || ''))) continue;
    const got = await resolveByse(p.embedUrl);
    if (got && got.stream) return got;
  }
  return null;
}

async function resolve(opts) {
  try {
    const media = opts.media === 'tv' ? 'tv' : 'movie';
    const got =
      media === 'tv'
        ? await resolveSeries(opts)
        : await resolveMovie(opts);
    if (!got || !got.stream) {
      return { ok: false, provider: 'streamberry', erro: 'sem stream' };
    }
    // validar
    const pr = await probe(got.stream, { headers: got.headers || {}, timeout: 12000 });
    if (!pr.ok) {
      return { ok: false, provider: 'streamberry', erro: 'probe falhou' };
    }
    if (pr.bodyPreview && /nenhuma qualidade|not found|error/i.test(pr.bodyPreview)) {
      return { ok: false, provider: 'streamberry', erro: 'stream inválido' };
    }
    return {
      ok: true,
      provider: 'streamberry',
      stream: got.stream,
      stream_type: got.stream_type || pr.stream_type || 'hls',
      headers: got.headers || {},
      quality: got.quality
    };
  } catch (e) {
    return { ok: false, provider: 'streamberry', erro: String(e.message || e) };
  }
}

module.exports = { resolve };
