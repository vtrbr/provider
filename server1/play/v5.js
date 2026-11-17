'use strict';

/**
 * GET /v5/play/* — SeriesflixHit ficha (dados + canais + watch)
 * Fonte: https://www.seriesflixhit.com/
 */

const axios = require('axios');
const cheerio = require('cheerio');

const API = 5;
const BASE = (process.env.SERIESFLIX_URL || 'https://www.seriesflixhit.com').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('http')) return href;
  return BASE + (href.startsWith('/') ? href : '/' + href);
}

function rawFromReq(req) {
  let raw =
    (req.params && (req.params[0] || req.params.url)) ||
    (req.query && (req.query.url || req.query.u)) ||
    '';
  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/v5\/play\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function videoLink(raw) {
  return `${PUBLIC_API}/v5/video/${encodeURIComponent(String(raw))}`;
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/^Assistir\s+/i, '')
    .replace(/\s*\(\d{4}\).*$/, '')
    .replace(/\s+Online.*$/i, '')
    .replace(/\s+Dublado.*$/i, '')
    .replace(/\s+Legendado.*$/i, '')
    .trim();
}

async function getDetail(sourceUrl) {
  const url = sourceUrl.startsWith('http') ? sourceUrl : absUrl(sourceUrl);
  const { data: html, status } = await http.get(url, { headers: { Referer: BASE + '/' } });
  if (status >= 400 || !html) {
    const e = new Error(`Página Seriesflix indisponível (HTTP ${status})`);
    e.status = status || 502;
    throw e;
  }

  const $ = cheerio.load(html);
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const title =
    cleanTitle(ogTitle) ||
    cleanTitle($('h1').first().text()) ||
    null;

  const poster =
    $('meta[property="og:image"]').attr('content') ||
    $('.poster img, .filme-capa img, img').first().attr('src') ||
    null;

  // Sinopse
  let overview = null;
  $('p, li, div').each((_, el) => {
    const t = $(el).text().trim();
    if (/^Sinopse:\s*/i.test(t) && t.length > 20) {
      overview = t.replace(/^Sinopse:\s*/i, '').trim();
      return false;
    }
  });
  if (!overview) {
    overview = $('meta[property="og:description"]').attr('content') || null;
  }

  const yearM =
    ogTitle.match(/\((\d{4})\)/) ||
    html.match(/Estreia:\s*[^\d]*(\d{2}\/\d{2}\/)?((?:19|20)\d{2})/i) ||
    html.match(/\b((?:19|20)\d{2})\b/);
  let year = null;
  if (yearM) {
    year = parseInt(yearM[yearM.length - 1], 10);
  }

  const imdb = (html.match(/\b(tt\d{7,})\b/) || [])[1] || null;
  const isSeries = /\/serie\//i.test(url);

  // Canais dublado / legendado
  const channels = { dublado: [], legendado: [] };
  $('#canais-dublado .btn-canal, .canal-opcoes#canais-dublado .btn-canal').each((i, el) => {
    const u = $(el).attr('data-url');
    const label = $(el).text().trim() || `Canal ${i + 1}`;
    if (u) {
      channels.dublado.push({
        label,
        embed: u,
        watch: videoLink(u),
      });
    }
  });
  $('#canais-legendado .btn-canal, .canal-opcoes#canais-legendado .btn-canal').each((i, el) => {
    const u = $(el).attr('data-url');
    const label = $(el).text().trim() || `Canal ${i + 1}`;
    if (u) {
      channels.legendado.push({
        label,
        embed: u,
        watch: videoLink(u),
      });
    }
  });

  // fallback: qualquer data-url de player
  if (!channels.dublado.length && !channels.legendado.length) {
    $('[data-url]').each((i, el) => {
      const u = $(el).attr('data-url');
      if (u && /plenoflu|vidsrc|embed|player/i.test(u)) {
        channels.dublado.push({
          label: `Canal ${channels.dublado.length + 1}`,
          embed: u,
          watch: videoLink(u),
        });
      }
    });
  }

  const watch =
    channels.dublado[0]?.watch ||
    channels.legendado[0]?.watch ||
    (imdb ? videoLink(`https://plenoflu.com/movie/${imdb}`) : null);

  return {
    success: true,
    api: API,
    source: 'seriesflix',
    type: isSeries ? 'series' : 'movie',
    title,
    year,
    poster: poster ? absUrl(poster) : null,
    overview,
    imdbId: imdb,
    sourceUrl: url,
    channels,
    watch,
  };
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v5/play/' });
    res.json(await getDetail(raw));
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Falha Seriesflix play' });
  }
}

module.exports = { handler, getDetail, API, source: 'seriesflix' };
