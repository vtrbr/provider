'use strict';

/**
 * GET /v5/video/* — SeriesflixHit / Plenoflu resolve stream (m3u8/mp4/embed)
 *
 * Prioridade: opção 1 do player (mais rápida e sem bloqueio).
 * Só tenta as demais se a 1 falhar.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const API = 5;
const PLENO = 'https://plenoflu.com';

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json,*/*;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
  maxRedirects: 5,
});

function rawFromReq(req) {
  let raw =
    (req.params && (req.params[0] || req.params.url)) ||
    (req.query && (req.query.url || req.query.u)) ||
    '';
  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/v5\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function b64decode(s) {
  try {
    return Buffer.from(String(s), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

async function fetchPlayerApi(pageUrl, video_id) {
  const { data } = await http.post(
    `${PLENO}/api`,
    new URLSearchParams({ action: 'getPlayer', video_id }).toString(),
    {
      headers: {
        Referer: pageUrl,
        Origin: PLENO,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    }
  );
  const encoded = data?.data?.video_url;
  if (!encoded) return null;
  const decoded = b64decode(encoded) || encoded;
  return {
    id: video_id,
    provider: (String(video_id).split(':').pop() || '').toLowerCase(),
    url: decoded,
    caption: data?.data?.video_caption_url || null,
  };
}

/** Tenta extrair m3u8/mp4 de URL direta ou página de embed */
async function tryDirectStream(embedUrl, allProviders) {
  if (/\.m3u8(\?|$)/i.test(embedUrl) || /\/hls\//i.test(embedUrl)) {
    return {
      url: embedUrl,
      format: 'hls',
      headers: { Referer: PLENO + '/' },
      providers: allProviders,
    };
  }
  if (/\.mp4(\?|$)/i.test(embedUrl)) {
    return {
      url: embedUrl,
      format: 'mp4',
      headers: { Referer: PLENO + '/' },
      providers: allProviders,
    };
  }

  try {
    const { data: embHtml, status: st } = await http.get(embedUrl, {
      headers: { Referer: PLENO + '/' },
    });
    if (st >= 400 || !embHtml) return null;

    const m3u8 = String(embHtml).match(/https?:\/\/[^"'\\s]+\.m3u8[^"'\\s]*/i);
    if (m3u8) {
      return {
        url: m3u8[0],
        format: 'hls',
        headers: { Referer: embedUrl },
        providers: allProviders,
      };
    }
    const mp4 = String(embHtml).match(/https?:\/\/[^"'\\s]+\.mp4[^"'\\s]*/i);
    if (mp4) {
      return {
        url: mp4[0],
        format: 'mp4',
        headers: { Referer: embedUrl },
        providers: allProviders,
      };
    }
    const file = String(embHtml).match(/file["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i);
    if (file) {
      const u = file[1];
      return {
        url: u,
        format: /\.m3u8|\/hls\//i.test(u) ? 'hls' : 'mp4',
        headers: { Referer: embedUrl },
        providers: allProviders,
      };
    }
  } catch (_) {}

  return null;
}

/**
 * Plenoflu: opção 1 (primeiro .player_select_item) = mais rápida / sem bloqueio.
 * Resolve só ela primeiro e retorna na hora. Demais opções = fallback.
 */
async function resolvePlenoflu(pageUrl) {
  const { data: html, status } = await http.get(pageUrl, {
    headers: { Referer: PLENO + '/' },
  });
  if (status >= 400 || !html) return null;

  const $ = cheerio.load(html);
  const videoIds = [];
  $('.player_select_item').each((_, el) => {
    const id = $(el).attr('data-id');
    if (id) videoIds.push(id);
  });
  if (!videoIds.length) {
    const found = String(html).match(/dyn:(?:movie|serie|tv):\d+:[a-z0-9_]+/gi) || [];
    videoIds.push(...found);
  }
  if (!videoIds.length) return null;

  const embeds = [];

  // ——— OPÇÃO 1 (prioridade) ———
  const primaryId = videoIds[0];
  try {
    const primary = await fetchPlayerApi(pageUrl, primaryId);
    if (primary) {
      embeds.push(primary);

      const direct = await tryDirectStream(primary.url, embeds);
      if (direct) {
        return {
          ...direct,
          option: 1,
          provider: primary.provider,
        };
      }

      // Sem m3u8/mp4 extraído: devolve embed da opção 1 mesmo assim
      return {
        url: primary.url,
        format: 'iframe',
        headers: { Referer: PLENO + '/' },
        providers: embeds,
        option: 1,
        provider: primary.provider,
      };
    }
  } catch (_) {
    /* fallback abaixo */
  }

  // ——— demais opções só se a 1 falhar ———
  for (let i = 1; i < videoIds.length; i++) {
    const video_id = videoIds[i];
    try {
      const emb = await fetchPlayerApi(pageUrl, video_id);
      if (!emb) continue;
      embeds.push(emb);

      const direct = await tryDirectStream(emb.url, embeds);
      if (direct) {
        return {
          ...direct,
          option: i + 1,
          provider: emb.provider,
        };
      }
    } catch (_) {}
  }

  if (!embeds.length) return null;

  return {
    url: embeds[0].url,
    format: 'iframe',
    headers: { Referer: PLENO + '/' },
    providers: embeds,
    option: 1,
    provider: embeds[0].provider,
  };
}

async function getStream(raw) {
  if (/\.m3u8(\?|$)/i.test(raw)) {
    return { url: raw, format: 'hls', headers: {} };
  }
  if (/\.mp4(\?|$)/i.test(raw)) {
    return { url: raw, format: 'mp4', headers: {} };
  }

  if (/plenoflu\.com/i.test(raw)) {
    return resolvePlenoflu(raw);
  }

  if (/vidsrc|embed|player/i.test(raw)) {
    try {
      const { data: html, status } = await http.get(raw, {
        headers: { Referer: 'https://www.seriesflixhit.com/' },
      });
      if (status < 400 && html) {
        const m3u8 = String(html).match(/https?:\/\/[^"'\\s]+\.m3u8[^"'\\s]*/i);
        if (m3u8) return { url: m3u8[0], format: 'hls', headers: { Referer: raw } };
      }
    } catch (_) {}
    return {
      url: raw,
      format: 'iframe',
      headers: { Referer: 'https://www.seriesflixhit.com/' },
    };
  }

  if (/seriesflixhit\.com/i.test(raw)) {
    const { data: html, status } = await http.get(raw);
    if (status < 400 && html) {
      const $ = cheerio.load(html);
      // Canal 1 dublado primeiro
      const first =
        $('#canais-dublado .btn-canal').first().attr('data-url') ||
        $('[data-url]').first().attr('data-url');
      if (first) return getStream(first);
    }
  }

  return null;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) {
      return res.status(400).json({ success: false, error: 'URL ausente após /v5/video/' });
    }
    const stream = await getStream(raw);
    if (!stream || !stream.url) {
      return res.status(404).json({ success: false, error: 'Stream Seriesflix não resolvido' });
    }
    return res.json({
      success: true,
      api: API,
      source: 'seriesflix',
      format: stream.format || 'iframe',
      url: stream.url,
      headers: stream.headers || {},
      option: stream.option || 1,
      provider: stream.provider || null,
      providers: stream.providers || undefined,
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Falha Seriesflix video',
    });
  }
}

module.exports = { handler, getStream, API, source: 'seriesflix' };
