'use strict';
/** GET /v2/play/* — Megaflix ficha (dados + link assistir). Sem resolver stream. */
const axios = require('axios');
const cheerio = require('cheerio');

const API = 2;
const BASE = (process.env.MEGAFLIX_URL || 'https://megaflix.live').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
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
    const m = String(req.originalUrl).match(/\/v2\/play\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function videoLink(raw) {
  return `${PUBLIC_API}/v2/video/${encodeURIComponent(String(raw))}`;
}

function seasonsFromJsonTree(node) {
  if (!node || typeof node !== 'object') return [];
  const map = new Map();
  function walk(n, path = []) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, path.concat(i + 1)));
    if (n.video_url || n.file || n.src) {
      const s = Number(path[0]) || 1;
      const e = Number(path[1]) || 1;
      if (!map.has(s)) map.set(s, []);
      map.get(s).push({
        episode: e,
        title: n.title || n.name || `Episódio ${e}`,
        video_url: n.video_url || n.file || n.src,
      });
      return;
    }
    const keys = Object.keys(n).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    if (keys.length) return keys.forEach((k) => walk(n[k], path.concat(Number(k))));
    Object.keys(n).forEach((k) => walk(n[k], path));
  }
  walk(node);
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, episodes]) => ({
      season,
      title: `Temporada ${season}`,
      episodes: episodes.sort((a, b) => a.episode - b.episode),
    }));
}

async function fetchJson(id, season = 1, episode = 1) {
  const url = `${BASE}/json?id=${encodeURIComponent(id)}&version=0&season=${season}&series=${episode}&a=false&android=0`;
  const { data, status } = await http.get(url, { headers: { Referer: BASE + '/', Accept: 'application/json' } });
  if (status >= 400 || !data) return null;
  return data;
}

async function getDetail(sourceUrl) {
  const url = sourceUrl.startsWith('http') ? sourceUrl : abs(BASE, sourceUrl);
  const { data: html, status } = await http.get(url, { headers: { Referer: BASE + '/' } });
  if (status >= 400 || !html) {
    const e = new Error(`Página Megaflix indisponível (HTTP ${status})`);
    e.status = status || 502;
    throw e;
  }
  const $ = cheerio.load(html);
  const itemId =
    (html.match(/var\s+itemId\s*=\s*["'](\d+)["']/) || [])[1] ||
    (url.match(/\/(\d{3,})(?:-|\/)/) || [])[1] ||
    null;
  if (!itemId) {
    const e = new Error('itemId não encontrado');
    e.status = 404;
    throw e;
  }

  const json = await fetchJson(itemId, 1, 1);
  let isSeries = json && String(json.video_type).toLowerCase() === 'series';
  if (json && json.video_url && String(json.video_type).toLowerCase() === 'movie') isSeries = false;
  if (!isSeries && !json?.video_type && /\/series?\//i.test(url)) isSeries = true;

  let title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    null;
  if (title) {
    title = title.replace(/\s*[|\-–]\s*Megaflix.*$/i, '').replace(/^Assistir\s+/i, '').replace(/\s+Online\s*$/i, '').trim();
  }

  const poster =
    (json && json.background_url ? abs(BASE, json.background_url) : null) ||
    $('meta[property="og:image"]').attr('content') ||
    null;
  const overview =
    $('.full-text p, .fdesc').first().text().trim() ||
    $('meta[property="og:description"]').attr('content') ||
    null;
  const yearM = (title || '').match(/\b((?:19|20)\d{2})\b/) || html.match(/\b((?:19|20)\d{2})\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  let seasons = [];
  if (isSeries) {
    seasons = seasonsFromJsonTree((json && json.json) || json).map((s) => ({
      season: s.season,
      title: s.title,
      episodes: s.episodes.map((ep) => {
        const file = ep.video_url ? abs(BASE, ep.video_url) : null;
        return {
          episode: ep.episode,
          title: ep.title,
          watch: file
            ? videoLink(file)
            : videoLink(`${BASE}/json?id=${itemId}&season=${s.season}&series=${ep.episode}`),
        };
      }),
    }));
  }

  let watch = null;
  if (!isSeries && json && json.video_url) watch = videoLink(abs(BASE, json.video_url));
  else if (isSeries && seasons[0]?.episodes?.[0]?.watch) watch = seasons[0].episodes[0].watch;

  return {
    success: true,
    api: API,
    source: 'megaflix',
    type: isSeries ? 'series' : 'movie',
    id: itemId,
    title,
    year,
    poster: poster ? abs(BASE, poster) : null,
    overview,
    sourceUrl: url,
    watch,
    seasons: isSeries ? seasons : undefined,
    totalSeasons: isSeries ? seasons.length : undefined,
  };
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v2/play/' });
    return res.json(await getDetail(raw));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha Megaflix play' });
  }
}

module.exports = { handler, getDetail, API, source: 'megaflix' };
