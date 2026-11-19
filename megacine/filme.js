'use strict';
/**
 * GET /filme/*  ou  GET /filme?url=
 *
 * Recebe a URL do filme no MegaCine (ou direto do ViewPlayer)
 * e devolve metadados + URL do player de cada qualidade/áudio.
 *
 * NÃO resolve m3u8/mp4 — isso fica no video.js:
 *   player do filme → /video?url=https://viewplayer.online/filme/{imdbId}
 *
 * Aceita:
 *   - https://megacine.yachts/filmes/assistir-...
 *   - /filmes/assistir-...
 *   - filmes/assistir-...
 *   - assistir-...                 (assume prefixo /filmes/)
 *   - https://viewplayer.online/filme/{imdbId}
 *
 * Express / Fastify:
 *   const { handler } = require('./filme');
 *   app.get('/filme', handler);
 *   app.get('/filme/*', handler);
 *
 * Uso direto:
 *   const { getMovie } = require('./filme');
 *   const data = await getMovie('https://megacine.yachts/filmes/...');
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

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
    req.query && (req.query.url || req.query.u || req.query.link || req.query.filme),
  ].filter(Boolean);

  let raw = candidates[0] ? String(candidates[0]) : '';

  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/filme\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  if (!raw && req.url) {
    const m = String(req.url).match(/\/filme\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }

  try {
    raw = decodeURIComponent(String(raw || '').trim());
  } catch {
    raw = String(raw || '').trim();
  }

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

/** Normaliza a URL passada para pageUrl do MegaCine */
function buildPageUrl(raw) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return MEGACINE + raw;
  if (/^filmes?\//i.test(raw)) return MEGACINE + '/' + raw;
  // Assume slug → /filmes/{slug}
  return MEGACINE + '/filmes/' + raw;
}

/** URL canônica do player de filme no ViewPlayer */
function moviePlayerUrl(imdbId) {
  return `${VIEWPLAYER}/filme/${imdbId}`;
}

/* ───────────────── parse MegaCine page ───────────────── */

function parseMegaCineMovie(html, pageUrl) {
  // título
  const title =
    firstMatch(html, /id=["']titleHis["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /<h1[^>]*itemprop=["']name["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /property=["']og:title["'][^>]*content=["']([^"']+)/i) ||
    firstMatch(html, /<title>\s*Assistir\s+(.+?)\s+Dublado/i) ||
    firstMatch(html, /<title>([^<]+)/i);

  // título original
  const originalTitle =
    firstMatch(html, /T[ií]tulo original:\s*<span[^>]*class=["']valor["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /T[ií]tulo original:\s*<span[^>]*>([^<]+)/i);

  // nota + votos
  const rating =
    firstMatch(html, /itemprop=["']ratingValue["'][^>]*>([0-9.,]+)/i) ||
    firstMatch(html, /data-rating=["']([^"']+)/i);
  const ratingCount = firstMatch(html, /itemprop=["']ratingCount["'][^>]*>(\d+)/i);

  // data de lançamento + ano
  const releaseDate = firstMatch(
    html,
    /itemprop=["']dateCreated["'][^>]*>([^<]+)/i
  ) || firstMatch(html, /DATA DE LAN[ÇC]AMENTO:[\s\S]{0,120}?<span[^>]*>([^<]+)/i);
  const yearM = releaseDate ? releaseDate.match(/(\d{4})/) : null;
  const year = yearM ? Number(yearM[1]) : null;

  // duração (opcional)
  const runtimeM =
    firstMatch(html, /DURA[ÇC][ÃA]O:[\s\S]{0,120}?<span[^>]*class=["']valor["'][^>]*>([^<]+)/i) ||
    firstMatch(html, /class=["']runtime["'][^>]*>([^<]+)/i);
  const runtime = runtimeM ? decodeHtml(runtimeM) : null;

  // poster
  const poster =
    firstMatch(html, /id=["']thumbHis["'][^>]*src=["']([^"']+)/i) ||
    firstMatch(html, /itemprop=["']image["'][^>]*src=["']([^"']+)/i) ||
    firstMatch(html, /property=["']og:image["'][^>]*content=["']([^"']+)/i);

  // backdrop (inline style em #dt_contenedor)
  const backdropMatch = html.match(
    /#dt_contenedor\s*\{[^}]*background-image:\s*url\((['"]?)([^)'"]+)\1\)/i
  );
  const backdrop = backdropMatch ? backdropMatch[2] : null;

  // sinopse
  let overview = null;
  const sin = firstMatch(html, /class=["']sinopse-texto["'][^>]*>([\s\S]*?)<\/div>/i);
  if (sin) overview = decodeHtml(sin);

  // gêneros (do bloco .sgeneros, evita menu)
  const genres = [];
  const genreBlock = firstMatch(html, /class=["']sgeneros["'][^>]*>([\s\S]*?)<\/div>/i);
  if (genreBlock) {
    const re = /\/generos\/[^"']+["'][^>]*>([^<]+)/gi;
    let m;
    while ((m = re.exec(genreBlock))) {
      const g = decodeHtml(m[1]).trim();
      if (g && !genres.includes(g)) genres.push(g);
    }
  }

  // trailer (YouTube) — iframe preferido, JSON-LD como fallback
  const trailerUrl =
    firstMatch(
      html,
      /id=["']source-player-trailer["'][\s\S]{0,800}?<iframe[^>]*src=["'](https?:\/\/www\.youtube\.com\/embed\/[^"']+)["']/i
    ) ||
    firstMatch(html, /"embedUrl":\s*"(https?:\/\/[^"]*youtube\.com\/embed\/[^"]*)"/i);

  // id do post
  const postId =
    firstMatch(html, /postid-(\d+)/i) ||
    firstMatch(html, /data-post=["'](\d+)["']/i);

  // labels das opções (data-nume → "PRINCIPAL"/"DUBLADO"/...)
  const playerLabels = {};
  const reOpt = /data-nume=["'](\d+)["'][^>]*>[\s\S]{0,400}?<span class=["']title["']>([^<]+)</gi;
  let om;
  while ((om = reOpt.exec(html))) {
    playerLabels[om[1]] = decodeHtml(om[2]).trim();
  }

  // extrai cada <div id="source-player-N"> com iframe viewplayer
  const players = [];
  const reIframe =
    /id=["']source-player-(\d+)["'][\s\S]{0,1200}?<iframe[^>]*src=["'](https?:\/\/viewplayer\.online\/filme\/[^"']+)["']/gi;
  let im;
  while ((im = reIframe.exec(html))) {
    const nume = im[1];
    const playerUrl = im[2];
    const imdbM = playerUrl.match(/\/filme\/(tt\d+)/i);
    players.push({
      nume,
      label: playerLabels[nume] || 'PRINCIPAL',
      player: playerUrl,
      imdbId: imdbM ? imdbM[1] : null,
    });
  }

  // fallback: se não achou iframe dentro de source-player, procura solto no HTML
  if (players.length === 0) {
    const fb = firstMatch(html, /(https?:\/\/viewplayer\.online\/filme\/tt\d+)/i);
    if (fb) {
      const imdbM = fb.match(/\/filme\/(tt\d+)/i);
      players.push({
        nume: '1',
        label: 'PRINCIPAL',
        player: fb,
        imdbId: imdbM ? imdbM[1] : null,
      });
    }
  }

  // dedupe por (label + imdbId) — mantém só o primeiro
  const seen = new Set();
  const uniquePlayers = [];
  for (const p of players) {
    const key = `${p.label}::${p.imdbId || p.player}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePlayers.push(p);
  }

  const imdbId = uniquePlayers.length && uniquePlayers[0].imdbId
    ? uniquePlayers[0].imdbId
    : null;

  return {
    id: postId || null,
    imdbId,
    title: title ? decodeHtml(title) : null,
    originalTitle: originalTitle ? decodeHtml(originalTitle) : null,
    year,
    releaseDate: releaseDate ? decodeHtml(releaseDate) : null,
    runtime,
    rating: rating ? Number(String(rating).replace(',', '.')) : null,
    ratingCount: ratingCount ? Number(ratingCount) : null,
    poster: absUrl(pageUrl, poster),
    backdrop: absUrl(pageUrl, backdrop),
    overview: overview || null,
    genres,
    trailerUrl: trailerUrl || null,
    players: uniquePlayers,
    pageUrl,
  };
}

/* ───────────────── resolve ───────────────── */

async function resolveMovie(raw) {
  if (!raw) {
    const e = new Error('URL do filme ausente');
    e.status = 400;
    throw e;
  }

  // ─── ViewPlayer direto ───
  if (/viewplayer\.online/i.test(raw)) {
    const imdbM = raw.match(/tt\d+/);
    if (!imdbM) {
      const e = new Error(
        'Não foi possível extrair o IMDb ID da URL do ViewPlayer (esperado tt\\d+)'
      );
      e.status = 400;
      throw e;
    }
    const imdbId = imdbM[0];
    return {
      success: true,
      type: 'movie',
      source: 'megacine',
      id: null,
      imdbId,
      title: null,
      originalTitle: null,
      year: null,
      releaseDate: null,
      runtime: null,
      rating: null,
      ratingCount: null,
      poster: null,
      backdrop: null,
      overview: null,
      genres: [],
      trailerUrl: null,
      pageUrl: raw,
      player: moviePlayerUrl(imdbId),
      players: [
        {
          nume: '1',
          label: 'PRINCIPAL',
          player: moviePlayerUrl(imdbId),
          imdbId,
        },
      ],
    };
  }

  // ─── Página do MegaCine ───
  const pageUrl = buildPageUrl(raw);
  const html = await getHtml(pageUrl, { Referer: MEGACINE + '/' });
  const meta = parseMegaCineMovie(html, pageUrl);

  if (!meta.players.length) {
    const e = new Error(
      'Nenhum player do ViewPlayer encontrado nesta página (talvez seja só trailer ou página de série)'
    );
    e.status = 404;
    throw e;
  }

  // Reforça o player canônico caso a página use uma URL “suja”
  for (const p of meta.players) {
    if (p.imdbId) p.player = moviePlayerUrl(p.imdbId);
  }

  const primary = meta.players[0];

  return {
    success: true,
    type: 'movie',
    source: 'megacine',
    id: meta.id,
    imdbId: meta.imdbId || primary.imdbId,
    title: meta.title,
    originalTitle: meta.originalTitle,
    year: meta.year,
    releaseDate: meta.releaseDate,
    runtime: meta.runtime,
    rating: meta.rating,
    ratingCount: meta.ratingCount,
    poster: meta.poster,
    backdrop: meta.backdrop,
    overview: meta.overview,
    genres: meta.genres,
    trailerUrl: meta.trailerUrl,
    pageUrl: meta.pageUrl,
    /** atalho: primeiro player (PRINCIPAL) */
    player: primary.player,
    /** lista completa (Dublado / Legendado / HD / …) */
    players: meta.players,
    /**
     * Como usar no app:
     *   data.players[i].player  →  /video?url=...
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
        error: 'Envie a URL do filme em /filme/{url} ou ?url=',
      };
      if (typeof reply.status === 'function') {
        const r = reply.status(400);
        return typeof r.send === 'function' && !r.json ? r.send(body) : r.json(body);
      }
      reply.statusCode = 400;
      return reply.end(JSON.stringify(body));
    }

    const data = await resolveMovie(raw);

    if (typeof reply.send === 'function' && !reply.json) return reply.send(data);
    if (typeof reply.json === 'function') return reply.json(data);
    reply.end(JSON.stringify(data));
  } catch (err) {
    const status = err.status || 500;
    const body = { success: false, error: err.message || 'Falha ao resolver filme' };
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

async function getMovie(movieUrl) {
  return resolveMovie(String(movieUrl || '').trim());
}

module.exports = {
  handler,
  getMovie,
  resolveMovie,
  parseMegaCineMovie,
  moviePlayerUrl,
};
