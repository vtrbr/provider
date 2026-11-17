'use strict';
/** GET /v3/video/* — MegaFilmesHD1 resolve stream (token → clickhost/comprarebom) */
const axios = require('axios');

const API = 3;
const BASE = (process.env.MEGAFILMES_URL || 'https://megafilmeshd1.com').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json,text/html,*/*;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

function rawFromReq(req) {
  let raw = (req.params && (req.params[0] || req.params.url)) || (req.query && (req.query.url || req.query.u)) || '';
  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/v3\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

async function resolveFromToken(tmdbId, type = 'filme', season = '', episode = '') {
  const qs = new URLSearchParams({
    type,
    id: '',
    tmdb: String(tmdbId),
    season: String(season || ''),
    episode: String(episode || ''),
    _: String(Date.now()),
  });
  const tokenRes = await http.get(`${BASE}/generate_token.php?${qs}`, {
    headers: { Referer: BASE + '/', Accept: 'application/json' },
  });
  const tokenData = tokenRes.data;
  if (!tokenData || !tokenData.ok || !tokenData.url) return null;

  const emb = await http.get(tokenData.url, { headers: { Referer: BASE + '/' } });
  const embHtml = emb.data || '';

  const clickMatch = String(embHtml).match(/https?:\/\/embed-api\.clickhost\.xyz\/embed\/(?:filme|serie)\/[0-9]+/i);
  if (clickMatch) {
    const clickUrl = clickMatch[0];
    const clickPage = await http.get(clickUrl, { headers: { Referer: 'https://embedyplayer.xyz/' } });
    const serversMatch = String(clickPage.data || '').match(/servers\s*[:=]\s*(\[[\s\S]*?\])\s*[,;]/);
    let servers = [];
    if (serversMatch) {
      try { servers = JSON.parse(serversMatch[1]); } catch (_) {}
    }
    for (const s of servers) {
      if (!s || s.down) continue;
      try {
        const init = await http.post(
          `https://embed-api.clickhost.xyz/embed/stream/${s.id}/init`,
          '',
          {
            headers: {
              Referer: clickUrl,
              Origin: 'https://embed-api.clickhost.xyz',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
          }
        );
        const j = init.data;
        if (j && j.ok && j.url) {
          const streamUrl = String(j.url).startsWith('http') ? j.url : 'https://embed-api.clickhost.xyz' + j.url;
          return {
            url: streamUrl,
            format: j.is_hls ? 'hls' : 'mp4',
            headers: { Referer: 'https://embed-api.clickhost.xyz/' },
          };
        }
      } catch (_) {}
    }
  }

  const compr = String(embHtml).match(/https?:\/\/comprarebom\.xyz\/e\/[a-z0-9]+/i);
  if (compr) {
    const page = await http.get(compr[0], { headers: { Referer: 'https://embedyplayer.xyz/' } });
    const m3u8 = String(page.data || '').match(/https?:\/\/[^"'\\s]+\.m3u8[^"'\\s]*/i);
    if (m3u8) return { url: m3u8[0], format: 'hls', headers: { Referer: 'https://comprarebom.xyz/' } };
  }

  if (tokenData.mode === 'iframe' && tokenData.url) {
    return { url: tokenData.url, format: 'iframe', headers: { Referer: BASE + '/' } };
  }
  return null;
}

async function getStream(raw) {
  const m = String(raw).match(/^tmdb:(\d+):(filme|serie)(?::(\d+):(\d+))?$/i);
  if (m) return resolveFromToken(m[1], m[2].toLowerCase(), m[3] || '', m[4] || '');

  if (/\.m3u8|\.mp4/i.test(raw)) {
    return { url: raw, format: /\.m3u8/i.test(raw) ? 'hls' : 'mp4', headers: { Referer: BASE + '/' } };
  }

  if (/megafilmeshd1\.com/i.test(raw)) {
    const { data: html, status } = await http.get(raw, { headers: { Referer: BASE + '/' } });
    if (status < 400 && html) {
      const tmdb =
        (String(html).match(/player\.php\?[^"']*tmdb=(\d+)/i) ||
          String(html).match(/tmdb[=:\/](\d+)/i) ||
          [])[1];
      if (tmdb) {
        const type = /\/serie\//i.test(raw) ? 'serie' : 'filme';
        return resolveFromToken(tmdb, type, '1', '1');
      }
    }
  }
  return null;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v3/video/' });
    const stream = await getStream(raw);
    if (!stream || !stream.url) return res.status(404).json({ success: false, error: 'Stream MegaFilmes não resolvido' });
    return res.json({ success: true, api: API, source: 'megafilmeshd', format: stream.format || 'hls', url: stream.url, headers: stream.headers || {} });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha MegaFilmes video' });
  }
}

module.exports = { handler, getStream, API, source: 'megafilmeshd' };
