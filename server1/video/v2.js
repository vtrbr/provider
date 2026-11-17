'use strict';
/** GET /v2/video/* — Megaflix resolve stream a partir do link vindo do /v2/play */
const axios = require('axios');

const API = 2;
const BASE = (process.env.MEGAFLIX_URL || 'https://megaflix.live').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json,text/html,*/*;q=0.8',
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
    const m = String(req.originalUrl).match(/\/v2\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

async function fetchJson(id, season = 1, episode = 1) {
  const url = `${BASE}/json?id=${encodeURIComponent(id)}&version=0&season=${season}&series=${episode}&a=false&android=0`;
  const { data, status } = await http.get(url, { headers: { Referer: BASE + '/', Accept: 'application/json' } });
  if (status >= 400 || !data) return null;
  return data;
}

async function getStream(raw) {
  if (/\.(m3u8|mp4|mkv)(\?|$)/i.test(raw)) {
    let format = 'mp4';
    if (/\.m3u8/i.test(raw)) format = 'hls';
    else if (/\.mkv/i.test(raw)) format = 'mkv';
    return { url: abs(BASE, raw), format, headers: { Referer: BASE + '/' } };
  }

  const idM = raw.match(/[?&]id=(\d+)/);
  const seasonM = raw.match(/[?&]season=(\d+)/);
  const seriesM = raw.match(/[?&]series=(\d+)/);
  if (idM) {
    const j = await fetchJson(idM[1], seasonM ? Number(seasonM[1]) : 1, seriesM ? Number(seriesM[1]) : 1);
    if (j && j.video_url) {
      const url = abs(BASE, j.video_url);
      let format = 'mp4';
      if (j.video_format === 'application/x-mpegURL' || /\.m3u8/i.test(url)) format = 'hls';
      else if (/\.mkv/i.test(url)) format = 'mkv';
      return {
        url,
        format,
        headers: { Referer: BASE + '/' },
        subtitles: j.video_subs ? [abs(BASE, j.video_subs)] : [],
      };
    }
  }

  // página megaflix → itemId → json
  if (/megaflix\.live/i.test(raw) && !/\.(m3u8|mp4|mkv)/i.test(raw)) {
    const { data: html, status } = await http.get(raw, { headers: { Referer: BASE + '/' } });
    if (status < 400 && html) {
      const itemId = (String(html).match(/var\s+itemId\s*=\s*["'](\d+)["']/) || [])[1];
      if (itemId) {
        const j = await fetchJson(itemId, 1, 1);
        if (j && j.video_url) return getStream(abs(BASE, j.video_url));
      }
    }
  }

  return null;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v2/video/' });
    const stream = await getStream(raw);
    if (!stream || !stream.url) return res.status(404).json({ success: false, error: 'Stream Megaflix não resolvido' });
    return res.json({
      success: true,
      api: API,
      source: 'megaflix',
      format: stream.format || 'mp4',
      url: stream.url,
      headers: stream.headers || { Referer: BASE + '/' },
      subtitles: stream.subtitles || [],
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha Megaflix video' });
  }
}

module.exports = { handler, getStream, API, source: 'megaflix' };
