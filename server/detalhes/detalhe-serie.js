'use strict';
/**
 * GET /serie/*  ou  GET /serie?url=
 *
 * Recebe a URL da série no MegaCine (ou o embed do ViewPlayer)
 * e devolve metadados + temporadas/episódios com a URL do player de cada ep.
 *
 * NÃO resolve m3u8/mp4 — isso fica no video.js:
 *   player do ep → /video?url=https://viewplayer.online/episodio/{id}
 *
 * Aceita:
 *   - https://megacine.yachts/series/assistir-...
 *   - https://viewplayer.online/embed/{slug}/
 *
 * Express / Fastify:
 *   const { handler } = require('./serie');
 *   app.get('/serie', handler);
 *   app.get('/serie/*', handler);
 *
 * Uso direto:
 *   const { getSerie } = require('./serie');
 *   const data = await getSerie('https://megacine.yachts/series/...');
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const cheerio = require('cheerio');

const TIMEOUT = Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;
const MEGACINE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');
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
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers: {
          'User-Agent': UA,
          Accept: opts.accept || 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          ...(opts.headers || {}),
        },
        timeout: TIMEOUT,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

async function getHtml(url, headers = {}) {
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

function rawFromReq(req) {
  const candidates = [
    req.params && (req.params[0] || req.params.url || req.params.path),
    req.query && (req.query.url || req.query.u || req.query.link || req.query.serie),
  ].filter(Boolean);

  let raw = candidates[0] ? String(candidates[0]) : '';

  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/(?:serie|detalhe\/v1)\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  if (!raw && req.url) {
    const m = String(req.url).match(/\/serie\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }

  try {
    raw = decodeURIComponent(String(raw || '').trim());
  } catch {
    raw = String(raw || '').trim();
  }
  raw = raw.replace(/^https?:\/\/[^/]+\/serie\//i, '');
  return raw;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMatch(html, re, group = 1) {
  const m = String(html).match(re);
  return m ? (m[group] || m[0]).trim() : null;
}

function absUrl(base, href) {
  if (!href) return null;
  href = href.replace(/^['"]|['"]$/g, '').trim();
  if (href.startsWith('//')) return 'https:' + href;
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function episodePlayerUrl(episodeId) {
  return `${VIEWPLAYER}/episodio/${episodeId}`;
}

/** Extrai número do ep do título "1 - Nome" */
function parseEpNumber(title) {
  const m = String(title || '').match(/^\s*(\d+)\s*[-.:\u2013]\s*/);
  return m ? Number(m[1]) : null;
}

function audioKey(label) {
  const t = String(label || '').toLowerCase();
  if (/legend|sub/i.test(t)) return 'legendado';
  if (/dub/i.test(t)) return 'dublado';
  return t || 'default';
}

/* ───────────────── JSON-LD helper ───────────────── */

function parseJSONLD(html) {
  const patterns = [
    /<script[^>]*class=["'][^"']*megacine-schema-tvseries["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*class=["'][^"']*megacine-schema-movie["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?TVSeries[\s\S]*?)<\/script>/i,
  ];
  for (const re of patterns) {
    const m = String(html).match(re);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[1].trim());
      if (obj && obj['@graph']) {
        const node = obj['@graph'].find(
          (n) => n['@type'] === 'TVSeries' || n['@type'] === 'Movie'
        );
        if (node) return node;
      }
      return obj;
    } catch {
      /* ignora JSON quebrado */
    }
  }
  return null;
}

/* ───────────────── parse MegaCine page ───────────────── */

function parseMegaCineSerie(html, pageUrl) {
  const ld = parseJSONLD(html);

  /* ---- título ---- */
  const title =
    (ld && ld.name) ||
    firstMatch(html, /id=["']titleHis["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /property=["']og:title["'][^>]*content=["']([^"']+)/i) ||
    firstMatch(html, /<title>([^<]+)/i);

  /* ---- título original ---- */
  const originalTitle =
    (ld && ld.alternateName) ||
    firstMatch(html, /T[ií]tulo original:\s*<span[^>]*class=["']valor["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /T[ií]tulo original:\s*<span[^>]*>([^<]+)/i);

  /* ---- nota ---- */
  const rating =
    (ld && ld.aggregateRating && ld.aggregateRating.ratingValue) ||
    firstMatch(html, /data-rating=["']([^"']+)/i) ||
    firstMatch(html, /class=["'][^"']*rating["'][^>]*>([0-9.]+)/i);

  /* ---- temporadas ---- */
  const seasonsCount =
    (ld && ld.numberOfSeasons) ||
    firstMatch(html, /TEMPORADAS:\s*<\/b>\s*<span[^>]*class=["']valor["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /TEMPORADAS:[\s\S]{0,80}?class=["']valor["'][^>]*>([^<]+)/i);

  /* ---- poster (capa) ---- */
  const poster =
    (ld && ld.image) ||
    firstMatch(html, /id=["']thumbHis["'][^>]*src=["']([^"']+)/i) ||
    firstMatch(html, /itemprop=["']image["'][^>]*src=["']([^"']+)/i) ||
    firstMatch(html, /class=["'][^"']*poster["'][\s\S]{0,400}?<img[^>]*src=["']([^"']+)/i) ||
    firstMatch(html, /property=["']og:image["'][^>]*content=["']([^"']+)/i);

  /* ---- backdrop ---- */
  const bgMatch = html.match(
    /#dt_contenedor\s*\{[^}]*background-image:\s*url\(['"]?([^)'"]+)['"]?\)/i
  );
  const backdrop =
    (bgMatch && bgMatch[1]) ||
    firstMatch(html, /background-image:\s*url\(['"]?(https?:\/\/[^)'"]+)['"]?\)/i);

  /* ---- sinopse ---- */
  let overview = null;
  if (ld && ld.description) {
    overview = decodeHtml(ld.description);
  } else {
    const sin = firstMatch(html, /class=["']sinopse-texto["'][^>]*>([\s\S]*?)<\/div>/i);
    if (sin) overview = decodeHtml(sin.replace(/<iframe[\s\S]*?<\/iframe>/gi, ''));
  }

  /* ---- embed viewplayer ---- */
  let embed =
    firstMatch(html, /src=["'](https?:\/\/viewplayer\.online\/embed\/[^"']+)["']/i) ||
    (ld && ld.embedUrl) ||
    firstMatch(html, /(https?:\/\/viewplayer\.online\/embed\/[a-zA-Z0-9\-_]+\/?)/i);
  if (embed && !embed.endsWith('/')) embed += '/';

  /* ---- id ---- */
  const postId =
    firstMatch(html, /data-id=["'](\d+)["']/i) ||
    firstMatch(html, /postid-(\d+)/i);

  /* ---- ano ---- */
  const year =
    (ld && ld.datePublished && ld.datePublished.slice(0, 4)) ||
    firstMatch(html, /date[^>]*>\s*(\d{4})/i);

  /* ---- gêneros (JSON-LD é mais limpo) ---- */
  const genres = [];
  if (ld && Array.isArray(ld.genre)) {
    for (const g of ld.genre) {
      const t = decodeHtml(String(g)).trim();
      if (t && !genres.includes(t)) genres.push(t);
    }
  } else {
    const genreBlock = firstMatch(html, /class=["']sgeneros["'][^>]*>([\s\S]*?)<\/div>/i);
    if (genreBlock) {
      const re = /\/generos\/[^"']+["'][^>]*>([^<]+)/gi;
      let m;
      while ((m = re.exec(genreBlock))) {
        const g = decodeHtml(m[1]).trim();
        if (g && !genres.includes(g)) genres.push(g);
      }
    }
  }

  return {
    id: postId || null,
    title: title ? decodeHtml(title) : null,
    originalTitle: originalTitle ? decodeHtml(originalTitle) : null,
    year: year ? Number(year) : null,
    rating: rating ? Number(String(rating).replace(',', '.')) : null,
    seasonsCount: seasonsCount ? Number(String(seasonsCount).replace(/\D/g, '')) || null : null,
    poster: absUrl(pageUrl, poster),
    backdrop: absUrl(pageUrl, backdrop ? backdrop.replace(/['"]/g, '') : null),
    overview: overview || null,
    genres,
    embedUrl: embed || null,
    pageUrl,
  };
}

/* ───────────────── parse ViewPlayer embed (cheerio) ───────────────── */

function parseViewPlayerEmbed(html, embedUrl) {
  const $ = cheerio.load(html);

  // 1) Mapa seasonId → seasonNumber
  const seasonMap = {};
  $('ul.header-navigation li[data-season-id]').each((_, el) => {
    const $el = $(el);
    const sid = $el.attr('data-season-id');
    const snum = $el.attr('data-season-number');
    if (sid && snum) {
      const n = parseInt(snum, 10);
      if (Number.isFinite(n)) seasonMap[String(sid)] = n;
    }
  });

  // 2) Parse de cada card (Dublado / Legendado / etc)
  const byAudio = {};

  $('.card').each((_, cardEl) => {
    const $card = $(cardEl);
    const audioLabel = ($card.find('.card-title').first().text() || '').trim() || 'default';
    const key = audioKey(audioLabel);

    const eps = [];
    $card.find('li[data-season-id][data-episode-id]').each((_, liEl) => {
      const $li = $(liEl);
      const seasonId = String($li.attr('data-season-id') || '').trim();
      const episodeId = String($li.attr('data-episode-id') || '').trim();
      if (!seasonId || !episodeId) return;

      const epTitle = ($li.find('.episode-title').first().text() || '').trim();
      if (!epTitle) return;
      if (/pr[oó]ximo\s*ep/i.test(epTitle)) return;

      eps.push({
        seasonId,
        seasonNumber: seasonMap[seasonId] != null ? seasonMap[seasonId] : null,
        episodeId,
        episodeNumber: parseEpNumber(epTitle),
        title: decodeHtml(epTitle),
        player: episodePlayerUrl(episodeId),
      });
    });

    if (eps.length) byAudio[key] = eps;
  });

  // 3) Fallback: se nenhum card funcionou, extrai direto do DOM
  const hasEpisodes = Object.values(byAudio).some((arr) => arr.length > 0);
  if (!hasEpisodes) {
    const eps = [];
    $('li[data-season-id][data-episode-id]').each((_, liEl) => {
      const $li = $(liEl);
      const seasonId = String($li.attr('data-season-id') || '').trim();
      const episodeId = String($li.attr('data-episode-id') || '').trim();
      if (!seasonId || !episodeId) return;

      const epTitle = ($li.find('.episode-title').first().text() || '').trim();
      if (!epTitle) return;
      if (/pr[oó]ximo\s*ep/i.test(epTitle)) return;

      eps.push({
        seasonId,
        seasonNumber: seasonMap[seasonId] || null,
        episodeId,
        episodeNumber: parseEpNumber(epTitle),
        title: decodeHtml(epTitle),
        player: episodePlayerUrl(episodeId),
      });
    });
    if (eps.length) byAudio.default = eps;
  }

  // 4) Consolida temporadas
  const seasonBucket = new Map();

  function ensureSeason(seasonNumber, seasonId) {
    const key = seasonNumber != null ? String(seasonNumber) : `id:${seasonId}`;
    if (!seasonBucket.has(key)) {
      seasonBucket.set(key, {
        seasonNumber: seasonNumber != null ? Number(seasonNumber) : null,
        seasonId: seasonId || null,
        episodes: new Map(),
      });
    }
    return seasonBucket.get(key);
  }

  for (const [audio, list] of Object.entries(byAudio)) {
    for (const ep of list) {
      const season = ensureSeason(ep.seasonNumber, ep.seasonId);
      if (!season.seasonId && ep.seasonId) season.seasonId = ep.seasonId;

      const ek = ep.episodeNumber != null ? `n:${ep.episodeNumber}` : `id:${ep.episodeId}`;
      if (!season.episodes.has(ek)) {
        season.episodes.set(ek, {
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          players: {},
        });
      }
      const row = season.episodes.get(ek);
      if (audio === 'dublado' && ep.title) row.title = ep.title;
      if (!row.title) row.title = ep.title;
      row.players[audio] = {
        episodeId: ep.episodeId,
        player: ep.player,
      };
    }
  }

  const seasons = [...seasonBucket.values()]
    .map((s) => ({
      seasonNumber: s.seasonNumber,
      seasonId: s.seasonId,
      episodes: [...s.episodes.values()].sort((a, b) => {
        const na = a.episodeNumber ?? 9999;
        const nb = b.episodeNumber ?? 9999;
        return na - nb;
      }),
    }))
    .sort((a, b) => {
      const na = a.seasonNumber ?? 9999;
      const nb = b.seasonNumber ?? 9999;
      return na - nb;
    });

  return {
    embedUrl: embedUrl || null,
    audios: Object.keys(byAudio),
    seasons,
    totalEpisodes: seasons.reduce((acc, s) => acc + s.episodes.length, 0),
  };
}

/* ───────────────── resolve ───────────────── */

async function resolveSerie(raw) {
  if (!raw) {
    const e = new Error('URL da série ausente');
    e.status = 400;
    throw e;
  }

  let meta = {
    id: null,
    title: null,
    originalTitle: null,
    year: null,
    rating: null,
    seasonsCount: null,
    poster: null,
    backdrop: null,
    overview: null,
    genres: [],
    embedUrl: null,
    pageUrl: null,
  };

  let embedUrl = null;

  if (/viewplayer\.online\/embed\//i.test(raw)) {
    embedUrl = raw.endsWith('/') ? raw : raw + '/';
    meta.embedUrl = embedUrl;
    meta.pageUrl = raw;
  } else {
    const pageUrl = /^https?:\/\//i.test(raw)
      ? raw
      : `${MEGACINE}${raw.startsWith('/') ? '' : '/'}${raw}`;
    const html = await getHtml(pageUrl, { Referer: MEGACINE + '/' });
    meta = parseMegaCineSerie(html, pageUrl);
    embedUrl = meta.embedUrl;
  }

  if (!embedUrl) {
    const e = new Error('Embed ViewPlayer não encontrado na página');
    e.status = 404;
    throw e;
  }

  const embedHtml = await getHtml(embedUrl, { Referer: meta.pageUrl || MEGACINE + '/' });
  const parsed = parseViewPlayerEmbed(embedHtml, embedUrl);

  const seasonsCount =
    Math.max(
      Number(meta.seasonsCount) || 0,
      parsed.seasons.length || 0
    ) || null;

  return {
    success: true,
    type: 'series',
    source: 'megacine',
    id: meta.id,
    title: meta.title,
    originalTitle: meta.originalTitle,
    year: meta.year,
    rating: meta.rating,
    poster: meta.poster,
    backdrop: meta.backdrop,
    overview: meta.overview,
    genres: meta.genres,
    seasonsCount,
    pageUrl: meta.pageUrl,
    embedUrl: parsed.embedUrl,
    audios: parsed.audios,
    totalEpisodes: parsed.totalEpisodes,
    seasons: parsed.seasons,
    /**
     * Como usar no app:
     * seasons[i].episodes[j].players.dublado.player
     *   → enviar para /video?url=...
     */
  };
}

/* ───────────────── handler ───────────────── */

async function handler(req, res) {
  const reply = res;
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      const body = {
        success: false,
        error: 'Envie a URL da série em /serie/{url} ou ?url=',
      };
      if (typeof reply.status === 'function') {
        const r = reply.status(400);
        return typeof r.send === 'function' && !r.json ? r.send(body) : r.json(body);
      }
      reply.statusCode = 400;
      return reply.end(JSON.stringify(body));
    }

    const data = await resolveSerie(raw);

    if (typeof reply.send === 'function' && !reply.json) return reply.send(data);
    if (typeof reply.json === 'function') return reply.json(data);
    reply.end(JSON.stringify(data));
  } catch (err) {
    const status = err.status || 500;
    const body = { success: false, error: err.message || 'Falha ao resolver série' };
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

async function getSerie(serieUrl) {
  return resolveSerie(String(serieUrl || '').trim());
}

module.exports = {
  handler,
  getSerie,
  resolveSerie,
  parseMegaCineSerie,
  parseViewPlayerEmbed,
  parseJSONLD,
  episodePlayerUrl,
};
