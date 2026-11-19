'use strict';
/**
 * GET /topfilmes/filme
 *
 * Recebe URL (ou slug) de filme do topfilmes.biz e devolve detalhes + players.
 *
 * Aceita:
 *   /topfilmes/filme?url=https://topfilmes.biz/assistir/alem-da-morte-flatliners
 *   /topfilmes/filme?url=/assistir/alem-da-morte-flatliners
 *   /topfilmes/filme?url=alem-da-morte-flatliners   (slug)
 *   /topfilmes/filme/alem-da-morte-flatliners       (via path)
 *
 * NÃO prefixa com api.tedflix.site — devolve a URL crua:
 *   https://topfilmes.biz/player/alem-da-morte-flatliners?player=1
 *
 * Express / Fastify:
 *   const topfilmesFilme = require('./topfilmes_filme');
 *   app.get('/topfilmes/filme', topfilmesFilme.handler);
 *   app.get('/topfilmes/filme/*', topfilmesFilme.handler);
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

// ---------- Config ----------
const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const SOURCE = 'topfilmes';
const CACHE_TTL = 15 * 60 * 1000; // 15min — detalhe muda pouco

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

function extractSlug(raw) {
  if (!raw) return null;
  // URL completa → extrai /assistir/<slug>
  if (/^https?:\/\//i.test(raw)) {
    const m = raw.match(/\/assistir\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
  // path começando com /assistir/
  if (raw.startsWith('/assistir/')) return raw.replace(/^\/assistir\//, '').split(/[?#]/)[0];
  // já é slug
  return raw.replace(/^\/+/, '').split(/[?#]/)[0];
}

function pageUrl(slug) {
  return `${BASE}/assistir/${slug}`;
}

// ---------- Parser ----------
function parseDetail(html, pageUrlAbs) {
  const $ = cheerio.load(html);

  const title = $('.post .infos h2').first().text().trim() || null;

  // infos: [0]=ano, [1]=duração, [2+]=gênero(s)
  const infoTexts = [];
  $('.post .infos .info').each((_, el) => {
    const t = $(el).text().trim();
    if (t) infoTexts.push(t);
  });

  let year = null;
  let duration = null;
  const genres = [];
  for (const t of infoTexts) {
    if (/^\d{4}$/.test(t)) {
      year = Number(t);
    } else if (/^\d+\s*(?:min|h|hr|horas?|minutos?)/i.test(t)) {
      duration = t;
    } else {
      genres.push(t);
    }
  }

  // fallback: ano via <title>"... (2017) ..."
  if (!year) {
    const titleTag = $('title').first().text();
    const ym = titleTag.match(/\((\d{4})\)/);
    if (ym) year = Number(ym[1]);
  }

  const synopsis = $('.post .infos .sinopse').first().text().trim() || null;
  const trailer = absUrl($('.post .infos .trailer').first().attr('href'));

  const ratingText = $('.post .infos .imdb span').first().text().trim();
  const rating = ratingText ? Number(ratingText.replace(',', '.')) : null;

  const poster = absUrl($('.post .poster img').first().attr('src'));
  const backdrop = absUrl($('.post .player img').first().attr('src'));

  // players
  const players = [];
  function pushPlayer(audio, a) {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    players.push({
      audio,
      label: $a.text().trim() || null,
      url: absUrl(href), // https://topfilmes.biz/player/... cru
    });
  }
  $('.post .links .links_dub a').each((_, a) => pushPlayer('dublado', a));
  $('.post .links .links_leg a').each((_, a) => pushPlayer('legendado', a));

  return {
    title,
    year,
    duration,
    genres,
    synopsis,
    trailer,
    rating,
    poster,
    backdrop,
    pageUrl: pageUrlAbs,
    players,
  };
}

// ---------- Cache ----------
const cache = new Map();

async function resolveDetail(raw, refresh = false) {
  const slug = extractSlug(raw);
  if (!slug) {
    const e = new Error(
      'URL/slug inválido. Envie ?url=https://topfilmes.biz/assistir/<slug>, /assistir/<slug> ou apenas <slug>.'
    );
    e.status = 400;
    throw e;
  }

  if (!refresh && cache.has(slug)) {
    const entry = cache.get(slug);
    if (Date.now() - entry.at < CACHE_TTL) return entry.data;
  }

  const url = pageUrl(slug);
  const { data: html, status } = await httpClient.get(url, {
    Referer: `${BASE}/home`,
  });

  if (status >= 400) {
    const e = new Error(`Página não encontrada (HTTP ${status})`);
    e.status = status;
    throw e;
  }

  const detail = parseDetail(html, url);
  if (!detail.title) {
    const e = new Error('Não foi possível extrair os dados (página inválida?)');
    e.status = 422;
    throw e;
  }

  const payload = {
    success: true,
    type: 'movie',
    source: SOURCE,
    slug,
    ...detail,
  };

  cache.set(slug, { data: payload, at: Date.now() });
  return payload;
}

// ---------- API pública ----------
async function getFilme(raw, refresh) {
  return resolveDetail(raw, refresh);
}

function rawFromReq(req) {
  let raw = null;

  if (req && req.params && req.params[0]) raw = req.params[0];
  if (!raw && req && req.query) {
    raw = req.query.url || req.query.u || req.query.link || req.query.slug || null;
  }
  if (!raw && req && req.url) {
    const m = String(req.url).match(/\/topfilmes\/filme\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  if (raw) {
    try {
      raw = decodeURIComponent(String(raw).trim());
    } catch {
      raw = String(raw).trim();
    }
  }
  return raw;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      return res.status(400).json({
        success: false,
        error: 'Envie ?url=<slug-ou-url> (ex: ?url=alem-da-morte-flatliners)',
      });
    }
    const refresh = !!(req && req.query && req.query.refresh === '1');
    const data = await getFilme(raw, refresh);
    res.json(data);
  } catch (err) {
    const status = err.status || 500;
    console.error(`[${SOURCE}:filme] error:`, err.message);
    res.status(status).json({
      success: false,
      error: err.message || 'Falha ao resolver filme',
    });
  }
}

module.exports = { handler, getFilme, resolveDetail, parseDetail };
