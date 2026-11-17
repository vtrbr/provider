/**
 * MegaCine (mesma lógica do app / central/mega)
 * Filme: TMDB → imdb → viewplayer.online/filme/{imdb} → bysebuho AES → m3u8
 * Série: busca megacine.yachts → viewplayer embed → episódio → byse
 */
const crypto = require('crypto');
const { request, probe } = require('./http');

const MEGACINE = process.env.MEGACINE_URL || 'https://megacine.yachts';
const VIEWPLAYER = 'https://viewplayer.online';

function b64urlDecode(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 === 0 ? 0 : 4 - (t.length % 4);
  if (pad) t += '='.repeat(pad);
  return Buffer.from(t, 'base64');
}

function selectKeyParts(version, parts) {
  const list = Array.isArray(parts) ? parts : [];
  let indexes = [];
  const v = typeof version === 'string' ? version.trim() : '';
  if (v) {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 20) {
      const a = n;
      const b = 31 - n;
      if (a >= 1 && a <= list.length && b >= 1 && b <= list.length) {
        indexes = [a, b];
      }
    }
  }
  if (!indexes.length) return list;
  const selected = indexes.map((i) => list[i - 1]).filter(Boolean);
  return selected.length ? selected : list;
}

function decryptBysePlayback(playback) {
  const parts = selectKeyParts(playback.version, playback.key_parts);
  const key = Buffer.concat(parts.map((p) => b64urlDecode(p))).slice(0, 32);
  const iv = b64urlDecode(playback.iv);
  const payload = b64urlDecode(playback.payload);
  const tag = payload.slice(payload.length - 16);
  const data = payload.slice(0, payload.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

async function resolveByse(embedUrl) {
  const m = embedUrl.match(/\/e\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  const r = await request('https://bysebuho.com/api/videos/' + m[1], {
    headers: {
      Referer: 'https://bysebuho.com/',
      Origin: 'https://bysebuho.com',
      Accept: 'application/json'
    },
    timeout: 20000,
    maxBytes: 256 * 1024
  });
  if (r.status >= 400) return null;
  let data;
  try {
    data = JSON.parse(r.text);
  } catch {
    return null;
  }
  if (!data.playback) return null;
  const decrypted = decryptBysePlayback(data.playback);
  const src =
    (decrypted.sources || []).find(
      (s) => /m3u8/i.test(s.mime_type || '') || /\.m3u8/i.test(s.url || '')
    ) || (decrypted.sources || [])[0];
  if (!src || !src.url) return null;
  return {
    stream: src.url,
    stream_type: /m3u8/i.test(src.url) || /mpegurl/i.test(src.mime_type || '')
      ? 'hls'
      : 'mp4',
    quality: src.label || src.quality || null
  };
}

function extractSources(html) {
  const sources = [];
  const re = /data-source=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    sources.push(m[1].replace(/&amp;/g, '&'));
  }
  sources.sort((a, b) => {
    const score = (s) =>
      /byse/i.test(s) ? 40 : /tgp\.|playlist/i.test(s) ? 25 : /abyss/i.test(s) ? 10 : 0;
    return score(b) - score(a);
  });
  return sources;
}

async function trySources(sources) {
  for (const src of sources) {
    if (/byse/i.test(src)) {
      try {
        const hit = await resolveByse(src);
        if (hit && hit.stream) {
          const headers = {
            Referer: 'https://bysebuho.com/'
          };
          const p = await probe(hit.stream, 'ExoPlayer', headers);
          if (p.ok || p.status === 200 || p.status === 206) {
            return { ...hit, headers };
          }
          // signed HLS often still works even if HEAD fails
          return { ...hit, headers };
        }
      } catch (_) {}
    }
  }
  // generic m3u8 on page
  for (const src of sources) {
    try {
      const page = await request(src, {
        headers: { Referer: VIEWPLAYER + '/' },
        timeout: 20000,
        maxBytes: 512 * 1024
      });
      if ((page.text || '').trim().startsWith('#EXTM3U')) {
        return {
          stream: src,
          stream_type: 'hls',
          headers: { Referer: VIEWPLAYER + '/' },
          quality: null
        };
      }
      const m3u = (page.text || '').match(
        /https?:\/\/[^"'\\\s<>]+\.m3u8[^"'\\\s<>]*/i
      );
      if (m3u) {
        return {
          stream: m3u[0],
          stream_type: 'hls',
          headers: { Referer: VIEWPLAYER + '/' },
          quality: null
        };
      }
    } catch (_) {}
  }
  return null;
}

async function sourcesFromViewplayer(url) {
  const page = await request(url, {
    headers: { Referer: MEGACINE + '/' },
    timeout: 20000,
    maxBytes: 2 * 1024 * 1024
  });
  if (page.status >= 400) return null;
  const sources = extractSources(page.text);
  if (!sources.length) return null;
  return trySources(sources);
}

async function resolveMovie({ imdb_id, tmdb_id, title }) {
  const triedUrls = [];
  if (imdb_id) triedUrls.push(VIEWPLAYER + '/filme/' + String(imdb_id));

  // fallback: busca no megacine e pega viewplayer/imdb da ficha
  if (title) {
    try {
      const search = await request(
        MEGACINE + '/?s=' + encodeURIComponent(String(title).trim()),
        {
          headers: { Referer: MEGACINE + '/' },
          timeout: 20000,
          maxBytes: 2 * 1024 * 1024
        }
      );
      const links = [
        ...search.text.matchAll(
          /href="(https?:\/\/megacine\.[^"]+\/filmes\/assistir-[^"]+)"/gi
        )
      ].map((m) => m[1]);
      for (const pageUrl of [...new Set(links)].slice(0, 4)) {
        try {
          const page = await request(pageUrl, {
            headers: { Referer: MEGACINE + '/' },
            timeout: 20000,
            maxBytes: 2 * 1024 * 1024
          });
          const vp = page.text.match(
            /https?:\/\/viewplayer\.online\/(filme|embed)\/([^"'\s]+)/i
          );
          if (vp) {
            triedUrls.push(
              VIEWPLAYER + '/' + vp[1] + '/' + vp[2].replace(/\/+$/, '')
            );
          }
          const im = page.text.match(/\b(tt\d{7,})\b/);
          if (im) triedUrls.push(VIEWPLAYER + '/filme/' + im[1]);
        } catch (_) {}
      }
    } catch (_) {}
  }

  const uniq = [...new Set(triedUrls)];
  for (const url of uniq) {
    try {
      const hit = await sourcesFromViewplayer(url);
      if (hit) {
        return {
          ok: true,
          provider: 'megacine',
          stream: hit.stream,
          stream_type: hit.stream_type || 'hls',
          headers: hit.headers || {},
          quality: hit.quality || null
        };
      }
    } catch (_) {}
  }
  return { ok: false, provider: 'megacine', erro: 'filme sem stream no viewplayer' };
}

async function findSerieEmbed(title) {
  const q = encodeURIComponent(String(title || '').trim());
  if (!q) return null;
  const search = await request(MEGACINE + '/?s=' + q, {
    headers: { Referer: MEGACINE + '/' },
    timeout: 20000,
    maxBytes: 2 * 1024 * 1024
  });
  if (search.status >= 400) return null;
  const links = [
    ...search.text.matchAll(
      /href="(https?:\/\/megacine\.[^"]+\/series\/assistir-[^"]+)"/gi
    )
  ].map((m) => m[1]);
  const uniq = [...new Set(links)];
  for (const pageUrl of uniq.slice(0, 5)) {
    try {
      const page = await request(pageUrl, {
        headers: { Referer: MEGACINE + '/' },
        timeout: 20000,
        maxBytes: 2 * 1024 * 1024
      });
      const vp = page.text.match(
        /https?:\/\/viewplayer\.online\/embed\/([a-zA-Z0-9_-]+)/i
      );
      if (vp) return VIEWPLAYER + '/embed/' + vp[1] + '/';
    } catch (_) {}
  }
  return null;
}

async function resolveSerie({ title, season, episode }) {
  const embed = await findSerieEmbed(title);
  if (!embed) {
    return { ok: false, provider: 'megacine', erro: 'série não encontrada no megacine' };
  }
  const page = await request(embed, {
    headers: { Referer: MEGACINE + '/' },
    timeout: 25000,
    maxBytes: 3 * 1024 * 1024
  });
  if (page.status >= 400) {
    return { ok: false, provider: 'megacine', erro: 'embed HTTP ' + page.status };
  }

  const s = Number(season || 1);
  const e = Number(episode || 1);

  // data-season-number → data-season-id
  const seasonMap = new Map();
  for (const m of page.text.matchAll(
    /data-season-id=["'](\d+)["'][^>]*data-season-number=["'](\d+)["']/gi
  )) {
    seasonMap.set(parseInt(m[2], 10), m[1]);
  }
  for (const m of page.text.matchAll(
    /data-season-number=["'](\d+)["'][^>]*data-season-id=["'](\d+)["']/gi
  )) {
    seasonMap.set(parseInt(m[1], 10), m[2]);
  }

  const seasonId = seasonMap.get(s);
  let episodeId = null;
  if (seasonId) {
    // ordered episode ids for that season
    const epIds = [];
    for (const m of page.text.matchAll(
      /data-season-id=["'](\d+)["']\s*[\s\S]{0,60}?data-episode-id=["'](\d+)["']/gi
    )) {
      if (m[1] === seasonId) epIds.push(m[2]);
    }
    // unique keep order
    const seen = new Set();
    const ordered = [];
    for (const id of epIds) {
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    if (e >= 1 && e <= ordered.length) episodeId = ordered[e - 1];
  }

  if (!episodeId) {
    return {
      ok: false,
      provider: 'megacine',
      erro: 'episódio não mapeado no viewplayer'
    };
  }

  const epPage = await request(VIEWPLAYER + '/episodio/' + episodeId, {
    headers: {
      Referer: embed,
      'X-Requested-With': 'XMLHttpRequest'
    },
    timeout: 20000,
    maxBytes: 2 * 1024 * 1024
  });
  const sources = extractSources(epPage.text || '');
  if (!sources.length) {
    return { ok: false, provider: 'megacine', erro: 'sem sources no episódio' };
  }
  const hit = await trySources(sources);
  if (!hit) {
    return { ok: false, provider: 'megacine', erro: 'sources falharam' };
  }
  return {
    ok: true,
    provider: 'megacine',
    stream: hit.stream,
    stream_type: hit.stream_type || 'hls',
    headers: hit.headers || {},
    quality: hit.quality || null
  };
}

async function resolve(ctx) {
  try {
    if (ctx.media === 'tv') {
      return await resolveSerie(ctx);
    }
    // ensure imdb
    let imdb = ctx.imdb_id;
    if (!imdb && ctx.tmdb_id) {
      // external ids via tmdb helper if available
      try {
        const tmdb = require('../tmdb');
        const d = await tmdb.get(
          '/movie/' + ctx.tmdb_id + '/external_ids'
        );
        imdb = d.imdb_id || null;
      } catch (_) {}
    }
    if (!imdb) {
      return { ok: false, provider: 'megacine', erro: 'sem imdb_id' };
    }
    return await resolveMovie({ imdb_id: imdb, tmdb_id: ctx.tmdb_id, title: ctx.title });
  } catch (e) {
    return { ok: false, provider: 'megacine', erro: e.message || String(e) };
  }
}

module.exports = { resolve };
