'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const TIMEOUT = Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;
const BYSE = 'https://bysebuho.com';
const VIEWPLAYER = 'https://viewplayer.online';
const ABYSS = 'https://abyssplayer.com';

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
    const err = new Error('HTTP ' + res.status);
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
    const err = new Error('HTTP ' + res.status);
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

function extractAbyssId(input) {
  const s = String(input || '').trim();
  let m = s.match(/abyssplayer\.com\/([A-Za-z0-9_-]{5,})/i);
  if (m) return m[1];
  m = s.match(/player\.abyssplayer\.com\/([A-Za-z0-9_-]{5,})/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{6,16}$/.test(s) && /[A-Z]/.test(s)) return s;
  return null;
}

function rawFromReq(req) {
  const candidates = [
    req.params && (req.params[0] || req.params.url || req.params.path),
    req.query && (req.query.url || req.query.u || req.query.link || req.query.player),
  ].filter(Boolean);

  let raw = candidates[0] ? String(candidates[0]) : '';

  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/(?:video(?:\/v1)?|play\/v1)\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
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
  return 'mp4';
}

/* ───────────────── Bysebuho AES-GCM ───────────────── */

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

function parseViewPlayerSources(html) {
  const out = [];
  const reBtn = /<button[^>]*class=["'][^"']*player-option[^"']*["'][^>]*>/gi;
  let mBtn;
  while ((mBtn = reBtn.exec(html))) {
    const tag = mBtn[0];
    const srcM = tag.match(/data-source=["']([^"']+)["']/i);
    const audioM = tag.match(/data-audio=["']([^"']*)["']/i);
    if (srcM) {
      out.push({
        src: srcM[1],
        audio: (audioM ? audioM[1] : '').toLowerCase(),
        label: null,
      });
    }
  }

  if (!out.length) {
    const re = /data-source=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) out.push({ src: m[1], audio: '', label: null });
  }

  return out;
}

async function resolveViewPlayer(url) {
  const html = await getText(url, { Referer: 'https://megacine.yachts/' });
  const options = parseViewPlayerSources(html);
  if (!options.length) throw new Error('ViewPlayer: nenhum data-source');

  // PRIORIDADE: Byse primeiro (stream real m3u8), depois Abyss, depois direto
  const score = (o) => {
    const s = o.src || '';
    if (/bysebuho|byse\.sx|n1mwq/i.test(s)) return 0;
    if (/\.m3u8|\.mp4/i.test(s)) return 1;
    if (/abyssplayer/i.test(s)) return 2;
    if (/voe\.sx/i.test(s)) return 3;
    return 4;
  };

  const ordered = [
    ...options.filter((o) => /dub/i.test(o.audio)).sort((a, b) => score(a) - score(b)),
    ...options.sort((a, b) => score(a) - score(b)),
  ];

  const tried = new Set();
  let lastErr = null;

  for (const opt of ordered) {
    if (tried.has(opt.src)) continue;
    tried.add(opt.src);

    // 1) Byse
    const code = extractByseCode(opt.src);
    if (code && /bysebuho|byse\.sx|n1mwq|\/e\//i.test(opt.src)) {
      try {
        const stream = await resolveByseCode(code);
        return { ...stream, playerSource: opt.src, audio: opt.audio || null };
      } catch (e) {
        lastErr = e;
        continue;
      }
    }

    // 2) URL direta
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

    // 3) Abyss por último (player proprietário com chunks)
    if (/abyssplayer\.com/i.test(opt.src)) {
      try {
        return await resolveAbyssPlayer(opt.src);
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
  }

  throw lastErr || new Error('ViewPlayer: nenhum source resolveu stream');
}

/* ───────────────── AbyssPlayer ─────────────────
 *
 * Fluxo real (investigado):
 * 1. HTML contém `datas` em Base64 → JSON { slug, md5_id, user_id, media: <binário cifrado>, config }
 * 2. window.SoTrym(JSON.parse(atob(datas))) no lite.bundle.js (iamcdn)
 * 3. `media` é decifrado com WebCrypto AES-CTR → metadados de qualities
 * 4. JWPlayer recebe sources tipo:
 *    https://storage.googleapis.com/mediastorage/{ts}/{rand}/{size}.mp4#mp4/chunk/1/{size}/2097152/{label}/{codec}?maxChunkSize=...
 * 5. Service Worker (sw.bundle.v3.js) intercepta o fetch e serve chunks cifrados
 *    → URL GCS pura responde 403 fora do player
 *
 * Limite: sem emular o SW/AES do iamcdn, não há MP4 progressivo estável.
 * Quando o ViewPlayer também oferece Byse, usamos Byse (prioridade acima).
 * Aqui tentamos extrair o máximo de metadados e falhamos com erro claro.
 */

function parseAbyssDatas(html) {
  const m = html.match(/(?:const|var|let)\s+datas\s*=\s*"([A-Za-z0-9+/=]+)"/);
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], 'base64');
    // JSON com campo media binário: parse manual
    const text = raw.toString('latin1');
    const slugM = text.match(/"slug"\s*:\s*"([^"]+)"/);
    const md5M = text.match(/"md5_id"\s*:\s*(\d+)/);
    const userM = text.match(/"user_id"\s*:\s*(\d+)/);
    const titleM = html.match(/<title>([^<]+)<\/title>/i);
    return {
      slug: slugM ? slugM[1] : null,
      md5_id: md5M ? Number(md5M[1]) : null,
      user_id: userM ? Number(userM[1]) : null,
      title: titleM ? titleM[1].trim() : null,
      poster: slugM ? `https://img.freeimagecdn.net/image/${slugM[1]}.jpg` : null,
      rawLen: raw.length,
    };
  } catch {
    return null;
  }
}

async function resolveAbyssPlayer(playerUrl) {
  const id = extractAbyssId(playerUrl) || playerUrl;
  const pageUrl = /^https?:\/\//i.test(playerUrl)
    ? playerUrl
    : `${ABYSS}/${id}`;

  const res = await request(pageUrl, {
    accept: 'text/html',
    headers: {
      Referer: 'https://viewplayer.online/',
      // simula iframe (o player redireciona se top==self)
    },
  });

  if (res.status >= 400) {
    const e = new Error('AbyssPlayer HTTP ' + res.status);
    e.status = res.status;
    throw e;
  }

  const html = res.text || '';
  const meta = parseAbyssDatas(html);

  // Tentar achar qualquer URL direta rara (alguns embeds legados)
  const patterns = [
    /["'](https?:\/\/storage\.googleapis\.com\/mediastorage\/[^"']+\.mp4[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      let url = m[1].replace(/\\/g, '');
      // remover hash de chunk protocol se for só metadado
      return {
        url,
        format: formatOf(url),
        quality: null,
        title: meta && meta.title,
        expiresAt: null,
        sources: [{ url }],
        headers: { Referer: ABYSS + '/', Origin: ABYSS },
        playerSource: pageUrl,
        audio: 'dubbed',
        abyss: meta,
      };
    }
  }

  // Abyss moderno: stream só via Service Worker + AES-CTR (não é MP4 direto)
  const e = new Error(
    'AbyssPlayer: stream protegido (GCS + SW chunks). ' +
      'Use o source Byse do mesmo episódio quando existir. ' +
      (meta && meta.slug ? 'slug=' + meta.slug : '')
  );
  e.status = 422;
  e.abyss = meta;
  throw e;
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

  // Byse direto
  const byseCode = extractByseCode(raw);
  if (byseCode && (/bysebuho|byse\.sx|n1mwq|\/e\//i.test(raw) || /^[a-zA-Z0-9]{8,20}$/.test(raw))) {
    return resolveByseCode(byseCode);
  }

  // ViewPlayer
  if (/viewplayer\.online/i.test(raw)) return resolveViewPlayer(raw);

  // Abyss
  if (/abyssplayer\.com/i.test(raw)) return resolveAbyssPlayer(raw);

  // fallback: tentar byse code solto
  if (byseCode) {
    try {
      return await resolveByseCode(byseCode);
    } catch (_) {}
  }

  // página genérica
  const html = await getText(raw);
  const options = parseViewPlayerSources(html);
  const hrefs = String(html).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const candidates = [
    ...options.map((o) => o.src),
    ...hrefs.filter((u) => /bysebuho|abyssplayer|\/e\/[a-z0-9]+|\.m3u8|\.mp4|viewplayer/i.test(u)),
  ];

  // byse first
  for (const src of [...new Set(candidates)]) {
    const c = extractByseCode(src);
    if (c && /bysebuho|\/e\//i.test(src)) {
      try {
        return await resolveByseCode(c);
      } catch (_) {}
    }
  }
  for (const src of [...new Set(candidates)]) {
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
  for (const src of [...new Set(candidates)]) {
    if (/abyssplayer\.com/i.test(src)) {
      try {
        return await resolveAbyssPlayer(src);
      } catch (_) {}
    }
  }

  const e = new Error('Não foi possível resolver o vídeo desse player');
  e.status = 404;
  throw e;
}

/* ───────────────── handler ───────────────── */

async function handler(req, res) {
  const reply = res;
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      const body = { success: false, error: 'Envie a URL do player em /video/{url} ou ?url=' };
      if (typeof reply.status === 'function') {
        const r = reply.status(400);
        return typeof r.send === 'function' && !r.json ? r.send(body) : r.json(body);
      }
      reply.statusCode = 400;
      return reply.end(JSON.stringify(body));
    }

    const stream = await resolvePlayer(raw);
    const referer = (stream.headers && stream.headers.Referer) || '';
    const directUrl = stream.url;

    // proxy HLS se disponível
    let url = directUrl;
    let proxied = false;
    try {
      const { wrapStreamUrl } = require('../lib/hls-proxy');
      if (stream.format === 'hls' && String(process.env.HLS_PROXY || '1') !== '0') {
        url = wrapStreamUrl(req, directUrl, referer || BYSE + '/');
        proxied = url !== directUrl;
      }
    } catch (_) {}

    const body = {
      success: true,
      format: stream.format || 'mp4',
      url,
      directUrl,
      proxied,
      quality: stream.quality || null,
      title: stream.title || null,
      expiresAt: stream.expiresAt || null,
      headers: proxied ? {} : stream.headers || (referer ? { Referer: referer } : {}),
      sources: stream.sources || [{ url: directUrl }],
      player: raw,
      audio: stream.audio || null,
    };

    if (typeof reply.send === 'function' && !reply.json) return reply.send(body);
    return reply.json(body);
  } catch (err) {
    const status = err.status || 500;
    const body = {
      success: false,
      error: err.message || 'Falha ao resolver vídeo',
      abyss: err.abyss || undefined,
    };
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

async function getVideo(playerUrl) {
  return resolvePlayer(String(playerUrl || '').trim());
}

module.exports = {
  handler,
  getVideo,
  resolvePlayer,
  resolveByseCode,
  resolveViewPlayer,
  resolveAbyssPlayer,
  decryptPlayback,
  extractByseCode,
  extractAbyssId,
};
