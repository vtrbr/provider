'use strict';
/** GET /v3/play/* — MegaFilmesHD1 ficha (dados + link assistir). Sem resolver stream. */
const axios = require('axios');
const cheerio = require('cheerio');

const API = 3;
const BASE = (process.env.MEGAFILMES_URL || 'https://megafilmeshd1.com').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

function abs(base, href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('http')) return href;
  return base.replace(/\/+$/, '') + (href.startsWith('/') ? href : '/' + href);
}

function rawFromReq(req) {
  let raw = (req.params && (req.params[0] || req.params.url)) || (req.query && (req.query.url || req.query.u)) || '';
  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/v3\/play\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function videoLink(raw) {
  return `${PUBLIC_API}/v3/video/${encodeURIComponent(String(raw))}`;
}

function extractTmdb(html) {
  for (const re of [/player\.php\?[^"']*tmdb=(\d+)/i, /tmdb[=:\/](\d+)/i, /data-tmdb=["']?(\d+)/i]) {
    const m = String(html || '').match(re);
    if (m) return m[1];
  }
  return null;
}

async function getDetail(sourceUrl) {
  const url = sourceUrl.startsWith('http') ? sourceUrl : abs(BASE, sourceUrl);
  const { data: html, status } = await http.get(url, { headers: { Referer: BASE + '/' } });
  if (status >= 400 || !html) {
    const e = new Error(`Página MegaFilmes indisponível (HTTP ${status})`);
    e.status = status || 502;
    throw e;
  }
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
  const poster =
    $('meta[property="og:image"]').attr('content') ||
    (html.match(/poster-cache\.php\?[^"']+/i) || [])[0] ||
    null;
  const overview =
    $('meta[property="og:description"]').attr('content') ||
    $('.synopsis, .sinopse, .description').first().text().trim() ||
    null;
  const yearM = html.match(/\b((?:19|20)\d{2})\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;
  const tmdbId = extractTmdb(html);
  const isSeries = /\/serie\//i.test(url) || /type=serie/i.test(html);

  let watch = null;
  let seasons;
  if (tmdbId) {
    if (isSeries) {
      seasons = [
        {
          season: 1,
          title: 'Temporada 1',
          episodes: Array.from({ length: 12 }, (_, i) => ({
            episode: i + 1,
            title: `Episódio ${i + 1}`,
            watch: videoLink(`tmdb:${tmdbId}:serie:1:${i + 1}`),
          })),
        },
      ];
      watch = seasons[0].episodes[0].watch;
    } else {
      watch = videoLink(`tmdb:${tmdbId}:filme`);
    }
  }

  return {
    success: true,
    api: API,
    source: 'megafilmeshd',
    type: isSeries ? 'series' : 'movie',
    title,
    year,
    poster: poster ? abs(BASE, poster) : null,
    overview,
    tmdbId,
    sourceUrl: url,
    watch,
    seasons,
    totalSeasons: seasons ? seasons.length : undefined,
  };
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v3/play/' });
    return res.json(await getDetail(raw));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha MegaFilmes play' });
  }
}

module.exports = { handler, getDetail, API, source: 'megafilmeshd' };
