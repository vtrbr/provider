/**
 * Cineveo / Vizer-family player
 * GET /player/?id={tmdb}&audio=dub → sourcesToken → /player/sources.php?token=
 * Devolve MP4 (CDN workers ou proxy vod-resolve)
 */
const { request, probe } = require('./http');

const SITES = [
  'https://cineveo.cfd'
];

async function resolveOnSite(base, { tmdb_id, media, season, episode, title, audio }) {
  const isTv = media === 'tv';
  const params = new URLSearchParams({
    id: String(tmdb_id),
    t: String(title || tmdb_id),
    audio: audio || 'dub'
  });
  if (isTv) {
    params.set('s', String(season || 1));
    params.set('e', String(episode || 1));
  }

  // paths usados pelos sites da família
  const playerPaths = isTv
    ? [
        `/player/index.php?id=${tmdb_id}&s=${season || 1}&e=${episode || 1}&audio=${audio || 'dub'}`,
        `/player/?id=${tmdb_id}&s=${season || 1}&e=${episode || 1}&audio=${audio || 'dub'}`,
        `/player/?${params.toString()}`
      ]
    : [
        `/player/?${params.toString()}`,
        `/player/index.php?id=${tmdb_id}&t=${encodeURIComponent(title || '')}&audio=${audio || 'dub'}`
      ];

  let html = '';
  let playerUrl = '';
  for (const path of playerPaths) {
    try {
      const r = await request(base + path, {
        headers: { Referer: base + '/' },
        accept: 'text/html',
        timeout: 20000,
        maxBytes: 2 * 1024 * 1024
      });
      if (r.status < 400 && r.text.includes('sourcesToken')) {
        html = r.text;
        playerUrl = base + path;
        break;
      }
    } catch (_) {}
  }
  if (!html) return { ok: false, erro: 'player sem sourcesToken' };

  const tokM = html.match(/sourcesToken:\s*"([^"]+)"/);
  if (!tokM) return { ok: false, erro: 'sourcesToken ausente' };
  const token = tokM[1];

  const sourcesRes = await request(
    base + '/player/sources.php?token=' + encodeURIComponent(token),
    {
      headers: {
        Referer: playerUrl || base + '/player/',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 20000,
      maxBytes: 256 * 1024
    }
  );
  if (sourcesRes.status >= 400) {
    return { ok: false, erro: 'sources HTTP ' + sourcesRes.status };
  }
  let data;
  try {
    data = JSON.parse(sourcesRes.text);
  } catch {
    return { ok: false, erro: 'sources JSON inválido' };
  }
  const list = Array.isArray(data.sources) ? data.sources : [];
  if (!list.length) return { ok: false, erro: 'sources vazio' };

  // preferir CDN direto (mp4) em vez de proxy vod-resolve
  const ordered = [
    ...list.filter((s) => s.file && /\.mp4/i.test(s.file) && !/vod-resolve/i.test(s.file)),
    ...list.filter((s) => s.file && /\.mp4/i.test(s.file)),
    ...list.filter((s) => s.file && /\.m3u8/i.test(s.file)),
    ...list.filter((s) => s.file)
  ];

  // legendas vindas das sources (vtt/srt) se existirem
  const captions = [];
  for (const s of list) {
    const sub = s.subtitle || s.subtitles || s.captions || null;
    if (typeof sub === 'string' && /^https?:\/\//i.test(sub)) {
      captions.push({ language: s.label || 'pt', url: sub, type: /\.vtt/i.test(sub) ? 'vtt' : 'srt' });
    } else if (Array.isArray(sub)) {
      for (const c of sub) {
        const u = c.url || c.file || c;
        if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
          captions.push({
            language: c.language || c.lang || s.label || 'pt',
            url: u,
            type: /\.vtt/i.test(u) ? 'vtt' : 'srt'
          });
        }
      }
    }
  }

  for (const s of ordered) {
    const url = s.file;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const type = /\.m3u8/i.test(url) || (s.type || '').includes('mpegurl') ? 'hls' : 'mp4';
    const headers = {};
    if (/vod-resolve|cineveo\.|vizer\./i.test(url)) {
      headers.Referer = base + '/';
    }
    const pr = await probe(url, 'ExoPlayer', headers);
    if (pr.ok || pr.status === 200 || pr.status === 206) {
      return {
        ok: true,
        provider: base.includes('vizer') ? 'vizer' : 'cineveo',
        stream: url,
        stream_type: type,
        headers,
        quality: s.label || null,
        captions
      };
    }
  }
  return { ok: false, erro: 'nenhuma source tocável' };
}

async function resolve(ctx) {
  const tried = [];
  for (const base of SITES) {
    try {
      const r = await resolveOnSite(base, ctx);
      if (r.ok) return r;
      tried.push(base + ': ' + (r.erro || 'fail'));
    } catch (e) {
      tried.push(base + ': ' + (e.message || e));
    }
  }
  return { ok: false, provider: 'cineveo', erro: tried.join(' | ') || 'falhou' };
}

module.exports = { resolve };
