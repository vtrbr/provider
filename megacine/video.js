'use strict';
/**
 * GET /video/*  ou  GET /video?url=
 *
 * Recebe a URL do player e devolve a URL final do vídeo (m3u8/mp4).
 * Zero dependência além do Node (http/https/crypto).
 *
 * Aceita:
 *   - https://bysebuho.com/e/jrurapf5nqdk
 *   - https://viewplayer.online/filme/tt33764258
 *   - https://n1mwq.org/{token}/jrurapf5nqdk
 *   - só o code: jrurapf5nqdk
 *   - m3u8/mp4 direto (repasse)
 *
 * Exemplo:
 *   GET /video/https%3A%2F%2Fbysebuho.com%2Fe%2Fjrurapf5nqdk
 *   GET /video?url=https://bysebuho.com/e/jrurapf5nqdk
 *
 * No Express / Fastify:
 *   const { handler } = require('./video');
 *   app.get('/video', handler);
 *   app.get('/video/*', handler);
 *
 * Uso direto:
 *   const { getVideo } = require('./video');
 *   const r = await getVideo('https://bysebuho.com/e/jrurapf5nqdk');
 *   // r.url → master.m3u8
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const TIMEOUT = Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;
const BYSE = 'https://bysebuho.com';
const VIEWPLAYER = 'https://viewplayer.online';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ───────────────── HTTP ───────────────── */

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error('URL inválida: ' + url));
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent': UA,
      Accept: opts.accept || 'application/json,text/html,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      ...(opts.headers || {}),
    };
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers,
        timeout: TIMEOUT,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          resolve({ status: res.statusCode || 0, headers: res.headers, text, buf });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getJson(url, headers = {}) {
  const res = await request(url, {
    accept: 'application/json',
    headers: { Accept: 'application/json', ...headers },
  });
  if (res.status >= 400) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error('JSON inválido de ' + url);
  }
}

async function getText(url, headers = {}) {
  const res = await request(url, {
    accept: 'text/html',
    headers: { Accept: 'text/html', ...headers },
  });
  if (res.status >= 400) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text;
}

/* ───────────────── helpers ───────────────── */

function b64urlToBuf(s) {
  const t = String(s || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = t.length % 4 === 0 ? 0 : 4 - (t.length % 4);
  return Buffer.from(t + '='.repeat(pad), 'base64');
}

function extractByseCode(input) {
  const s = String(input || '').trim();
  let m = s.match(/\/e\/([a-zA-Z0-9]{6,})/i);
  if (m) return m[1];
  m = s.match(/(?:bysebuho\.com|n1mwq\.org|byse\.sx)\/(?:[a-z0-9]+\/)?([a-zA-Z0-9]{8,})/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]{8,20}$/.test(s)) return s;
  return null;
}

function rawFromReq(req) {
  const candidates = [
    req.params && (req.params[0] || req.params.url || req.params.path),
    req.query && (req.query.url || req.query.u || req.query.link || req.query.player),
  ].filter(Boolean);

  let raw = candidates[0] ? String(candidates[0]) : '';

  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  // Fastify raw url
  if (!raw && req.url) {
    const m = String(req.url).match(/\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }

  try {
    raw = decodeURIComponent(String(raw || '').trim());
  } catch {
    raw = String(raw || '').trim();
  }
  raw = raw.replace(/^https?:\/\/[^/]+\/video\//i, '');
  return raw;
}

function formatOf(url) {
  if (/\.m3u8(\?|$)/i.test(url) || /mpegurl|hls/i.test(url)) return 'hls';
  if (/\.mp4(\?|$)/i.test(url)) return 'mp4';
  if (/\.webm(\?|$)/i.test(url)) return 'webm';
  return 'hls';
}

/* ───────────────── Bysebuho AES-GCM ───────────────── */

/**
 * version N → índices 1-based [N, 31-N] nos key_parts
 * (mesma lógica do front byse)
 */
function selectKeyParts(playback) {
  const parts = Array.isArray(playback.key_parts) ? playback.key_parts : [];
  const n = Number(String(playback.version || '').trim());
  if (!Number.isFinite(n) || n < 1 || n > 20 || parts.length === 0) return parts;
  const picked = [n, 31 - n]
    .filter((i) => Number.isInteger(i) && i >= 1 && i <= parts.length)
    .map((i) => parts[i - 1])
    .filter((s) => typeof s === 'string' && s.length > 0);
  return picked.length > 0 ? picked : parts;
}

function decryptPlayback(playback) {
  if (!playback || !Array.isArray(playback.key_parts) || !playback.iv || !playback.payload) {
    throw new Error('playback inválido');
  }
  const keyParts = selectKeyParts(playback);
  const keyFull = Buffer.concat(keyParts.map(b64urlToBuf));
  const key = keyFull.length >= 32 ? keyFull.subarray(0, 32) : keyFull;
  const iv = b64urlToBuf(playback.iv);
  const payload = b64urlToBuf(playback.payload);
  if (payload.length < 17) throw new Error('payload curto');

  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

async function resolveByseCode(code) {
  const data = await getJson(`${BYSE}/api/videos/${encodeURIComponent(code)}`, {
    Referer: `${BYSE}/e/${code}`,
    Origin: BYSE,
  });

  // source em claro (se um dia vier)
  const plain =
    data.source ||
    data.file ||
    data.url ||
    data.stream ||
    (Array.isArray(data.sources) && data.sources[0] && (data.sources[0].url || data.sources[0].file));

  if (plain && /^https?:\/\//i.test(String(plain))) {
    return {
      url: String(plain),
      format: formatOf(String(plain)),
      quality: null,
      title: data.title || null,
      expiresAt: null,
      sources: [{ url: String(plain) }],
      headers: { Referer: `${BYSE}/` },
    };
  }

  if (!data.playback) throw new Error('Byse: playback ausente');

  const dec = decryptPlayback(data.playback);
  const sources = Array.isArray(dec.sources) ? dec.sources : [];
  if (!sources.length || !sources[0].url) throw new Error('Byse: nenhuma source após decrypt');

  const ranked = [...sources].sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0));
  const best = ranked[0];
  const url = String(best.url).replace(/\\u0026/g, '&');

  return {
    url,
    format: formatOf(url) || (String(best.mime_type || '').includes('mpegurl') ? 'hls' : 'mp4'),
    quality: best.label || (best.height ? `${best.height}p` : null),
    title: data.title || null,
    expiresAt: dec.expires_at || data.playback.expires_at || null,
    sources: ranked.map((s) => ({
      url: String(s.url).replace(/\\u0026/g, '&'),
      quality: s.label || (s.height ? `${s.height}p` : null),
      mime: s.mime_type || null,
      height: s.height || null,
      bitrate: s.bitrate_kbps || null,
    })),
    headers: { Referer: `${BYSE}/` },
  };
}

/* ───────────────── ViewPlayer ───────────────── */

function parseDataSources(html) {
  const out = [];
  const re = /data-source=["']([^"']+)["'][^>]*data-audio=["']([^"']*)["']|data-audio=["']([^"']*)["'][^>]*data-source=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1] || m[4];
    const audio = (m[2] || m[3] || '').toLowerCase();
    if (src) out.push({ src, audio });
  }
  if (out.length === 0) {
    const re2 = /data-source=["']([^"']+)["']/gi;
    while ((m = re2.exec(html))) out.push({ src: m[1], audio: '' });
  }
  return out;
}

async function resolveViewPlayer(url) {
  const html = await getText(url, { Referer: 'https://megacine.yachts/' });
  const options = parseDataSources(html);
  if (!options.length) throw new Error('ViewPlayer: nenhum data-source');

  const ordered = [
    ...options.filter((o) => /bysebuho|byse\.sx|n1mwq/i.test(o.src) && /dub/i.test(o.audio)),
    ...options.filter((o) => /bysebuho|byse\.sx|n1mwq/i.test(o.src)),
    ...options,
  ];

  const tried = new Set();
  let lastErr = null;

  for (const opt of ordered) {
    if (tried.has(opt.src)) continue;
    tried.add(opt.src);

    const code = extractByseCode(opt.src);
    if (code) {
      try {
        const stream = await resolveByseCode(code);
        return { ...stream, playerSource: opt.src, audio: opt.audio || null };
      } catch (e) {
        lastErr = e;
        continue;
      }
    }

    if (/\.m3u8|\.mp4/i.test(opt.src)) {
      return {
        url: opt.src,
        format: formatOf(opt.src),
        quality: null,
        title: null,
        expiresAt: null,
        sources: [{ url: opt.src }],
        headers: { Referer: VIEWPLAYER + '/' },
        playerSource: opt.src,
        audio: opt.audio || null,
      };
    }
  }

  throw lastErr || new Error('ViewPlayer: nenhum source resolveu stream');
}

/* ───────────────── resolve ───────────────── */

async function resolvePlayer(raw) {
  if (!raw) {
    const e = new Error('URL do player ausente');
    e.status = 400;
    throw e;
  }

  if (/\.m3u8(\?|$)/i.test(raw) || /\.mp4(\?|$)/i.test(raw)) {
    return {
      url: raw,
      format: formatOf(raw),
      quality: null,
      title: null,
      expiresAt: null,
      sources: [{ url: raw }],
      headers: {},
    };
  }

  const code = extractByseCode(raw);
  if (code && (/bysebuho|byse\.sx|n1mwq|\/e\//i.test(raw) || /^[a-zA-Z0-9]{8,20}$/.test(raw))) {
    return resolveByseCode(code);
  }

  if (/viewplayer\.online/i.test(raw)) {
    return resolveViewPlayer(raw);
  }

  if (code) {
    try {
      return await resolveByseCode(code);
    } catch {
      /* genérico */
    }
  }

  const html = await getText(raw);
  const options = parseDataSources(html);
  const hrefs = String(html).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const candidates = [
    ...options.map((o) => o.src),
    ...hrefs.filter((u) => /bysebuho|\/e\/[a-z0-9]+|\.m3u8|\.mp4|viewplayer/i.test(u)),
  ];

  for (const src of [...new Set(candidates)]) {
    if (/viewplayer\.online/i.test(src)) {
      try {
        return await resolveViewPlayer(src);
      } catch {
        /* next */
      }
    }
    const c = extractByseCode(src);
    if (c) {
      try {
        return await resolveByseCode(c);
      } catch {
        /* next */
      }
    }
    if (/\.m3u8|\.mp4/i.test(src)) {
      return {
        url: src,
        format: formatOf(src),
        quality: null,
        title: null,
        expiresAt: null,
        sources: [{ url: src }],
        headers: { Referer: raw },
      };
    }
  }

  const e = new Error('Não foi possível resolver o vídeo desse player');
  e.status = 404;
  throw e;
}

/* ───────────────── handler ───────────────── */

async function handler(req, res) {
  // Fastify e Express
  const reply = res;
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      return reply.status(400).send
        ? reply.status(400).send({ success: false, error: 'Envie a URL do player em /video/{url} ou ?url=' })
        : reply.status(400).json({ success: false, error: 'Envie a URL do player em /video/{url} ou ?url=' });
    }

    const stream = await resolvePlayer(raw);
    const body = {
      success: true,
      format: stream.format || 'hls',
      url: stream.url,
      quality: stream.quality || null,
      title: stream.title || null,
      expiresAt: stream.expiresAt || null,
      headers: stream.headers || { Referer: `${BYSE}/` },
      sources: stream.sources || [{ url: stream.url }],
      player: raw,
    };

    if (typeof reply.send === 'function' && !reply.json) {
      return reply.send(body);
    }
    return reply.json(body);
  } catch (err) {
    const status = err.status || 500;
    const body = { success: false, error: err.message || 'Falha ao resolver vídeo' };
    if (typeof reply.status === 'function') {
      const r = reply.status(status);
      if (typeof r.send === 'function' && !r.json) return r.send(body);
      if (typeof r.json === 'function') return r.json(body);
    }
    if (typeof reply.code === 'function') return reply.code(status).send(body);
    reply.statusCode = status;
    reply.end(JSON.stringify(body));
  }
}

/** Uso programático */
async function getVideo(playerUrl) {
  return resolvePlayer(String(playerUrl || '').trim());
}

module.exports = {
  handler,
  getVideo,
  resolvePlayer,
  resolveByseCode,
  resolveViewPlayer,
  decryptPlayback,
  extractByseCode,
};
