'use strict';
/** GET /v1/play/* — MegaCine ficha (dados + link assistir). Sem resolver stream. */
const axios = require('axios');
const cheerio = require('cheerio');

const API = 1;
const BASE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');
const VIEWPLAYER = 'https://viewplayer.online';
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
    const m = String(req.originalUrl).match(/\/v1\/play\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function videoLink(raw) {
  return `${PUBLIC_API}/v1/video/${encodeURIComponent(String(raw))}`;
}

function parseSeasons(html) {
  const $ = cheerio.load(html || '');
  const seasons = [];
  $('.seasons .se-c, .se-c, #seasons .se-c').each((_, el) => {
    const $se = $(el);
    const num = parseInt($se.find('.se-q .se-t, .se-t').first().text().replace(/\D/g, ''), 10) || seasons.length + 1;
    const episodes = [];
    $se.find('.se-a ul li, .episodios li, li').each((i, li) => {
      const $li = $(li);
      const epNum = parseInt($li.find('.numerando, .num').first().text().replace(/\D/g, ''), 10) || i + 1;
      const title = ($li.find('.ep-title, .title, a').first().text() || `Episódio ${epNum}`).trim();
      const href = $li.find('a').first().attr('href') || null;
      const dataId = $li.attr('data-id') || $li.find('[data-id]').attr('data-id') || null;
      const target = href ? abs(VIEWPLAYER, href) : dataId ? `${VIEWPLAYER}/embed/${dataId}` : null;
      episodes.push({
        episode: epNum,
        title,
        watch: target ? videoLink(target) : null,
      });
    });
    if (episodes.length) seasons.push({ season: num, title: `Temporada ${num}`, episodes });
  });
  return seasons;
}

async function getDetail(sourceUrl) {
  const url = sourceUrl.startsWith('http') ? sourceUrl : abs(BASE, sourceUrl);
  const { data: html, status } = await http.get(url, { headers: { Referer: BASE + '/' } });
  if (status >= 400 || !html) {
    const e = new Error(`Página indisponível (HTTP ${status})`);
    e.status = status || 502;
    throw e;
  }
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
  const overview = $('.wp-content p').first().text().trim() || $('meta[property="og:description"]').attr('content') || null;
  const poster = $('meta[property="og:image"]').attr('content') || $('.poster img').attr('src') || null;
  const yearM = html.match(/\b((?:19|20)\d{2})\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;
  const imdbM = html.match(/\b(tt\d{7,})\b/);
  const imdbId = imdbM ? imdbM[1] : null;
  const embedM =
    html.match(/viewplayer\.online\/(?:embed|filme)\/([a-zA-Z0-9_-]+)/i) ||
    html.match(/data-id=["'](\d+)["']/i);
  const embedId = embedM ? embedM[1] : null;
  const isSeries = /\/series?\//i.test(url);

  let seasons = [];
  if (isSeries && embedId) {
    try {
      const emb = await http.get(`${VIEWPLAYER}/embed/${embedId}/`, { headers: { Referer: BASE + '/' } });
      if (emb.status < 400 && emb.data) seasons = parseSeasons(emb.data);
    } catch (_) {}
  }

  let watch = null;
  if (!isSeries) {
    if (imdbId) watch = videoLink(`${VIEWPLAYER}/filme/${imdbId}`);
    else if (embedId) watch = videoLink(`${VIEWPLAYER}/embed/${embedId}/`);
    else watch = videoLink(url);
  } else if (seasons[0]?.episodes?.[0]?.watch) {
    watch = seasons[0].episodes[0].watch;
  }

  return {
    success: true,
    api: API,
    source: 'megacine',
    type: isSeries ? 'series' : 'movie',
    title,
    year,
    poster: poster ? abs(BASE, poster) : null,
    overview,
    imdbId,
    embedId,
    sourceUrl: url,
    watch,
    seasons: isSeries ? seasons : undefined,
    totalSeasons: isSeries ? seasons.length : undefined,
  };
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v1/play/' });
    return res.json(await getDetail(raw));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha MegaCine play' });
  }
}

module.exports = { handler, getDetail, API, source: 'megacine' };
