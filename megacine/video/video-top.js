'use strict';
/**
 * GET /video
 *
 * Recebe URL do player topfilmes.biz e devolve o MP4 final
 * (segue o redirect 302 do /direct/... até o servidor de mídia).
 *
 * Formas de uso:
 *   /video?url=<URL-encoded-full-player-url>
 *   /video?slug=<slug>&player=<N>
 *   /video/<URL-encoded-full-player-url>       (via path)
 *
 * Exemplos:
 *   /video?url=https%3A%2F%2Ftopfilmes.biz%2Fplayer%2Falem-da-morte-flatliners%3Fplayer%3D1
 *   /video?slug=alem-da-morte-flatliners&player=1
 *
 * Retorno:
 *   {
 *     success: true,
 *     source: "topfilmes",
 *     playerUrl: "https://topfilmes.biz/player/alem-da-morte-flatliners?player=1",
 *     directUrl: "https://topfilmes.biz/direct/mf/28/.../hd?expires=...",
 *     finalUrl:  "https://download1530.mediafire.com/.../Alem.da.Morte-HD.mp4",
 *     format: "mp4",
 *     size: 852702184,
 *     title: "Além da Morte",
 *     poster: "https://image.tmdb.org/t/p/w780/xa4CnNdPmVPeT1qFuQgiCgASKE1.jpg"
 *   }
 *
 * Express / Fastify:
 *   const video = require('./video');
 *   app.get('/video', video.handler);
 *   app.get('/video/*', video.handler);
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

// ---------- Config ----------
const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const SOURCE = 'topfilmes';
const CACHE_TTL = 5 * 60 * 1000; // 5min (o token `expires` expira)
const MAX_REDIRECTS = 5;

// ---------- HTTP ----------
const httpClient = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
  httpAgent: new NodeHttp.Agent({ keepAlive: true, maxSockets: 10 }),
});

// ---------- Helpers ----------
function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (/^https?:\/\//i.test(href)) return href;
  return BASE + (href.startsWith('/') ? href : '/' + href);
}

function extractPlayerUrl(raw, playerNum = 1) {
  if (!raw) return null;
  raw = String(raw).trim();

  // URL completa (já é o player ou o /direct)
  if (/^https?:\/\//i.test(raw)) return raw;

  // path absoluto /player/...
  if (/^\/player\//i.test(raw)) return BASE + raw;

  // path relativo player/...
  if (/^player\//i.test(raw)) return BASE + '/' + raw;

  // slug puro → monta URL canônica
  const slug = raw
    .replace(/^\/+/, '')
    .replace(/^assistir\//i, '')
    .replace(/^player\//i, '')
    .split(/[?#]/)[0];
  return `${BASE}/player/${slug}?player=${playerNum}`;
}

function parseSize(headers) {
  const cr = headers['content-range'];
  if (cr) {
    const m = cr.match(/\/(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
  }
  const cl = headers['content-length'];
  if (cl) return parseInt(cl, 10);
  return null;
}

function guessFormat(url, contentType) {
  const u = String(url).toLowerCase();
  if (u.includes('.m3u8')) return 'hls';
  if (u.includes('.mkv')) return 'mkv';
  if (u.includes('.webm')) return 'webm';
  if (u.includes('.mp4')) return 'mp4';
  if (contentType && contentType.includes('video/')) {
    return contentType.split('/')[1].split(';')[0].trim();
  }
  return 'mp4';
}

/** Segue o 302 do /direct/... até o arquivo final. Não baixa o arquivo. */
async function followToFinalUrl(startUrl, referer) {
  let currentUrl = startUrl;
  const hops = [];

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const resp = await httpClient.get(currentUrl, {
      headers: {
        Referer: referer,
        Range: 'bytes=0-0', // pega 1 byte no máximo
      },
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 15000,
      responseType: 'stream', // não bufferiza o arquivo
    });

    // mata o corpo imediatamente (1 byte que seja)
    if (resp.data && typeof resp.data.destroy === 'function') {
      resp.data.destroy();
    }

    hops.push({ url: currentUrl, status: resp.status });

    // 3xx → próximo hop
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.location;
      if (!loc) throw new Error('Redirect sem Location');
      currentUrl = loc.startsWith('http')
        ? loc
        : new URL(loc, currentUrl).toString();
      continue;
    }

    // 200/206 → é o arquivo final
    if (resp.status === 200 || resp.status === 206) {
      return {
        finalUrl: currentUrl,
        hops,
        headers: resp.headers,
      };
    }

    const e = new Error(`HTTP ${resp.status} ao seguir redirect`);
    e.status = resp.status;
    throw e;
  }

  throw new Error('Muitos redirects (>' + MAX_REDIRECTS + ')');
}

// ---------- Resolve ----------
async function resolveVideo(playerUrl) {
  if (!playerUrl) {
    const e = new Error('URL do player ausente');
    e.status = 400;
    throw e;
  }

  // 1. Buscar HTML do player
  const { data: html, status } = await httpClient.get(playerUrl, {
    headers: { Referer: `${BASE}/` },
  });

  if (status >= 400) {
    const e = new Error(`Player page HTTP ${status}`);
    e.status = status;
    throw e;
  }

  // 2. Extrair <source src> e metadados do player
  const $ = cheerio.load(html);

  const srcRaw =
    $('video source').first().attr('src') ||
    $('video').first().attr('src');

  if (!srcRaw) {
    const e = new Error('Nenhum <source> de vídeo encontrado no player');
    e.status = 404;
    throw e;
  }

  const directUrl = absUrl(srcRaw);

  const titleTag = $('title').first().text().trim();
  const title = titleTag
    ? titleTag.replace(/^Player\s+/i, '').trim() || null
    : null;

  const poster = absUrl($('video').first().attr('poster'));

  // 3. Seguir o 302 → MP4 final
  const { finalUrl, headers } = await followToFinalUrl(directUrl, playerUrl);

  const size = parseSize(headers);
  const format = guessFormat(finalUrl, headers['content-type']);

  return {
    playerUrl,
    directUrl,
    finalUrl,
    format,
    size,
    title,
    poster,
  };
}

// ---------- Cache ----------
const cache = new Map();

async function getVideo(raw, playerNum = 1, refresh = false) {
  const playerUrl = extractPlayerUrl(raw, playerNum);
  if (!playerUrl) {
    const e = new Error('URL do player inválida');
    e.status = 400;
    throw e;
  }

  if (!refresh && cache.has(playerUrl)) {
    const entry = cache.get(playerUrl);
    if (Date.now() - entry.at < CACHE_TTL) return entry.data;
  }

  const result = await resolveVideo(playerUrl);

  const payload = {
    success: true,
    source: SOURCE,
    ...result,
  };

  cache.set(playerUrl, { data: payload, at: Date.now() });
  return payload;
}

// ---------- Handler ----------
function rawFromReq(req) {
  if (!req) return null;

  // path param: /video/<encoded-url>
  if (req.params && req.params[0]) {
    try {
      return decodeURIComponent(String(req.params[0]).trim());
    } catch {
      return String(req.params[0]).trim();
    }
  }

  const q = req.query || {};

  // ?url=<encoded-url>
  if (q.url || q.u || q.link) {
    return String(q.url || q.u || q.link).trim();
  }

  // ?slug=<slug>  (usa ?player=N se vier)
  if (q.slug) {
    const slug = String(q.slug).trim();
    const n = parseInt(q.player, 10) || 1;
    return `${BASE}/player/${slug}?player=${n}`;
  }

  // fallback: tenta extrair de req.url (para /video?url=... sem encoding)
  if (req.url) {
    const m = String(req.url).match(/[?&](?:url|u|link)=([^&#]+)/i);
    if (m) {
      try {
        return decodeURIComponent(m[1]).trim();
      } catch {
        return m[1].trim();
      }
    }
  }

  return null;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      return res.status(400).json({
        success: false,
        error:
          'Envie ?slug=<slug>&player=<N> ou ?url=<URL-encoded> ' +
          '(ex: ?slug=alem-da-morte-flatliners&player=1)',
      });
    }

    const playerNum = parseInt(req?.query?.player, 10) || 1;
    const refresh = req?.query?.refresh === '1';

    const data = await getVideo(raw, playerNum, refresh);
    res.json(data);
  } catch (err) {
    const status = err.status || 500;
    console.error(`[${SOURCE}:video] error:`, err.message);
    res.status(status).json({
      success: false,
      error: err.message || 'Falha ao resolver vídeo',
    });
  }
}

module.exports = { handler, getVideo, resolveVideo, extractPlayerUrl };
