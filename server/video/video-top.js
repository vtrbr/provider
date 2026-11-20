'use strict';
/**
 * GET /play/v2/*  — TopFilmes
 * Resolve player -> /direct/... -> MP4 final (MediaFire)
 * Sem axios (http/https nativo).
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const SOURCE = 'topfilmes';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_REDIRECTS = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new Error('URL invalida: ' + url));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = Object.assign({
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    }, opts.headers || {});
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers: headers,
        timeout: opts.timeout || 25000,
      },
      (res) => {
        if (opts.streamOnly) {
          res.resume();
          resolve({ status: res.statusCode || 0, headers: res.headers, text: '' });
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode || 0, headers: res.headers, text: buf.toString('utf8'), buffer: buf });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + url)); });
    req.end();
  });
}

function absUrl(href, base) {
  base = base || BASE;
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, base.endsWith('/') ? base : base + '/').toString();
  } catch (e) {
    return base + (href.startsWith('/') ? href : '/' + href);
  }
}

function extractPlayerUrl(raw, playerNum) {
  playerNum = playerNum || 1;
  if (!raw) return null;
  raw = String(raw).trim();
  if (/^https?:\/\//i.test(raw)) {
    const m = raw.match(/\/assistir\/([^/?#]+)/i);
    if (m) return BASE + '/player/' + m[1] + '?player=' + playerNum;
    return raw;
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  if (/^\/player\//i.test(raw)) return BASE + raw;
  if (/^player\//i.test(raw)) return BASE + '/' + raw;
  const slug = raw.replace(/^\/+/, '').replace(/^assistir\//i, '').replace(/^player\//i, '').split(/[?#]/)[0];
  if (!slug) return null;
  return BASE + '/player/' + slug + '?player=' + playerNum;
}

function extractSourceFromHtml(html) {
  let m = html.match(/<source[^>]+src=["']([^"']+)["']/i);
  if (m) return m[1];
  m = html.match(/<video[^>]+src=["']([^"']+)["']/i);
  if (m) return m[1];
  m = html.match(/(?:https?:)?\/\/[^"'\\\s]*\/direct\/[^"'\\\s]+/i);
  if (m) return m[0];
  m = html.match(/["'](\/direct\/[^"']+)["']/i);
  if (m) return m[1];
  return null;
}

function parseSize(headers) {
  const cr = headers['content-range'];
  if (cr) {
    const m = String(cr).match(/\/(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
  }
  const cl = headers['content-length'];
  if (cl) return parseInt(cl, 10);
  return null;
}

function guessFormat(url, contentType) {
  const u = String(url || '').toLowerCase();
  if (u.includes('.m3u8')) return 'hls';
  if (u.includes('.mkv')) return 'mkv';
  if (u.includes('.mp4')) return 'mp4';
  if (contentType && String(contentType).includes('mpegurl')) return 'hls';
  if (contentType && String(contentType).includes('video/')) {
    return String(contentType).split('/')[1].split(';')[0].trim();
  }
  return 'mp4';
}

async function followToFinalUrl(startUrl, referer) {
  let currentUrl = startUrl;
  const hops = [];
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    let resp;
    try {
      resp = await request(currentUrl, {
        method: 'HEAD',
        streamOnly: true,
        headers: { Referer: referer },
        timeout: 15000,
      });
    } catch (e) {
      resp = null;
    }
    if (!resp || resp.status === 405 || resp.status === 501) {
      resp = await request(currentUrl, {
        method: 'GET',
        streamOnly: true,
        headers: { Referer: referer, Range: 'bytes=0-0' },
        timeout: 15000,
      });
    }
    hops.push({ url: currentUrl, status: resp.status });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.location;
      if (!loc) throw new Error('Redirect sem Location');
      currentUrl = absUrl(loc, currentUrl);
      continue;
    }
    if (resp.status === 200 || resp.status === 206) {
      return { finalUrl: currentUrl, hops: hops, headers: resp.headers };
    }
    if (resp.status === 403 || resp.status === 401) {
      const g = await request(currentUrl, {
        method: 'GET',
        streamOnly: true,
        headers: { Referer: referer, Range: 'bytes=0-0' },
        timeout: 15000,
      });
      hops.push({ url: currentUrl, status: g.status, via: 'GET-range' });
      if (g.status >= 300 && g.status < 400 && g.headers.location) {
        currentUrl = absUrl(g.headers.location, currentUrl);
        continue;
      }
      if (g.status === 200 || g.status === 206) {
        return { finalUrl: currentUrl, hops: hops, headers: g.headers };
      }
    }
    const e = new Error('HTTP ' + resp.status + ' ao seguir redirect');
    e.status = resp.status;
    throw e;
  }
  throw new Error('Muitos redirects');
}

async function resolveVideo(playerUrl) {
  if (!playerUrl) {
    const e = new Error('URL do player ausente');
    e.status = 400;
    throw e;
  }
  if (/\/direct\//i.test(playerUrl) || /\.mp4(\?|$)/i.test(playerUrl)) {
    const directUrl = absUrl(playerUrl);
    const followed = await followToFinalUrl(directUrl, BASE + '/');
    return {
      success: true,
      source: SOURCE,
      playerUrl: null,
      directUrl: directUrl,
      finalUrl: followed.finalUrl,
      url: followed.finalUrl,
      format: guessFormat(followed.finalUrl, followed.headers['content-type']),
      size: parseSize(followed.headers),
      title: null,
      poster: null,
    };
  }

  const page = await request(playerUrl, {
    headers: { Referer: BASE + '/', Accept: 'text/html,*/*' },
  });
  if (page.status >= 400) {
    const e = new Error('Player page HTTP ' + page.status);
    e.status = page.status;
    throw e;
  }

  const srcRaw = extractSourceFromHtml(page.text);
  if (!srcRaw) {
    const e = new Error('Nenhum source de video encontrado no player');
    e.status = 404;
    throw e;
  }

  const directUrl = absUrl(srcRaw, playerUrl);
  const titleTag = (page.text.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
  const title = titleTag.replace(/^Player\s+/i, '').trim() || null;
  const posterM = page.text.match(/<video[^>]+poster=["']([^"']+)["']/i);
  const poster = posterM ? absUrl(posterM[1], playerUrl) : null;

  const followed = await followToFinalUrl(directUrl, playerUrl);

  return {
    success: true,
    source: SOURCE,
    playerUrl: playerUrl,
    directUrl: directUrl,
    finalUrl: followed.finalUrl,
    url: followed.finalUrl,
    format: guessFormat(followed.finalUrl, followed.headers['content-type']),
    size: parseSize(followed.headers),
    title: title,
    poster: poster,
  };
}

const cache = new Map();

async function getVideo(raw, playerNum, refresh) {
  playerNum = playerNum || 1;
  refresh = !!refresh;
  const playerUrl = extractPlayerUrl(raw, playerNum);
  if (!playerUrl) {
    const e = new Error('URL do player invalida');
    e.status = 400;
    throw e;
  }
  if (!refresh && cache.has(playerUrl)) {
    const hit = cache.get(playerUrl);
    if (Date.now() - hit.at < CACHE_TTL) return hit.data;
  }
  const data = await resolveVideo(playerUrl);
  cache.set(playerUrl, { at: Date.now(), data: data });
  return data;
}

function rawFromReq(req) {
  if (!req) return null;
  if (req.params && req.params[0]) {
    try { return decodeURIComponent(String(req.params[0]).trim()); }
    catch (e) { return String(req.params[0]).trim(); }
  }
  const q = req.query || {};
  if (q.url || q.u || q.link) return String(q.url || q.u || q.link).trim();
  if (q.slug) {
    const n = parseInt(q.player, 10) || 1;
    return BASE + '/player/' + String(q.slug).trim() + '?player=' + n;
  }
  if (req.originalUrl) {
    const m = String(req.originalUrl).match(/\/(?:play|video)\/v2\/(.+?)(?:\?|$)/i);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
  }
  return null;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      return res.status(400).json({ success: false, error: 'Envie /play/v2/{url} ou ?slug=...&player=1' });
    }
    const playerNum = parseInt(req && req.query && req.query.player, 10) || 1;
    const refresh = req && req.query && req.query.refresh === '1';
    const data = await getVideo(raw, playerNum, refresh);
    return res.json(data);
  } catch (err) {
    const status = err.status || 500;
    console.error('[' + SOURCE + ':video] error:', err.message);
    return res.status(status).json({ success: false, error: err.message || 'Falha ao resolver video' });
  }
}

module.exports = { handler: handler, getVideo: getVideo, resolveVideo: resolveVideo, extractPlayerUrl: extractPlayerUrl };
