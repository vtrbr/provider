'use strict';

/**
 * v3 — MegaCine (megacine.yachts)
 * Catálogo, gêneros, agenda, detalhe, temporadas/eps, play filme/série
 */

const crypto = require('crypto');
const cheerio = require('cheerio');
const { request } = require('../lib/http');
const { cached } = require('../lib/cache');
const { card, detail, playback, pagination, error } = require('../lib/normalize');

const API = 'v3';
const BASE = process.env.MEGACINE_URL || 'https://megacine.yachts';
const VIEWPLAYER = 'https://viewplayer.online';

const GENRES = [
  { id: 'acao', name: 'Ação', sourceSlug: 'acao' },
  { id: 'animacao', name: 'Animação', sourceSlug: 'animacao' },
  { id: 'aventura', name: 'Aventura', sourceSlug: 'aventura' },
  { id: 'comedia', name: 'Comédia', sourceSlug: 'comedia' },
  { id: 'crime', name: 'Crime', sourceSlug: 'crime' },
  { id: 'documentario', name: 'Documentário', sourceSlug: 'documentario' },
  { id: 'drama', name: 'Drama', sourceSlug: 'drama' },
  { id: 'familia', name: 'Família', sourceSlug: 'familia' },
  { id: 'fantasia', name: 'Fantasia', sourceSlug: 'fantasia' },
  { id: 'faroeste', name: 'Faroeste', sourceSlug: 'faroeste' },
  { id: 'ficcao-cientifica', name: 'Ficção científica', sourceSlug: 'ficcao-cientifica' },
  { id: 'guerra', name: 'Guerra', sourceSlug: 'guerra' },
  { id: 'historia', name: 'História', sourceSlug: 'historia' },
  { id: 'kids', name: 'Kids', sourceSlug: 'kids' },
  { id: 'misterio', name: 'Mistério', sourceSlug: 'misterio' },
  { id: 'musica', name: 'Música', sourceSlug: 'musica' },
  { id: 'reality', name: 'Reality', sourceSlug: 'reality' },
  { id: 'romance', name: 'Romance', sourceSlug: 'romance' },
  { id: 'suspense', name: 'Suspense', sourceSlug: 'suspense' },
  { id: 'terror', name: 'Terror', sourceSlug: 'terror' },
  { id: 'thriller', name: 'Thriller', sourceSlug: 'thriller' },
];

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
      if (a >= 1 && a <= list.length && b >= 1 && b <= list.length) indexes = [a, b];
    }
  }
  if (!indexes.length) return list;
  const selected = indexes.map((i) => list[i - 1]).filter(Boolean);
  return selected.length ? selected : list;
}

function decryptBysePlayback(playbackData) {
  const parts = selectKeyParts(playbackData.version, playbackData.key_parts);
  const key = Buffer.concat(parts.map((p) => b64urlDecode(p))).slice(0, 32);
  const iv = b64urlDecode(playbackData.iv);
  const payload = b64urlDecode(playbackData.payload);
  const tag = payload.slice(payload.length - 16);
  const data = payload.slice(0, payload.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

async function resolveByse(embedUrl) {
  const m = String(embedUrl).match(/\/e\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  const r = await request('https://bysebuho.com/api/videos/' + m[1], {
    headers: {
      Referer: 'https://bysebuho.com/',
      Origin: 'https://bysebuho.com',
      Accept: 'application/json',
    },
    timeout: 20000,
    maxBytes: 256 * 1024,
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
  return { url: src.url, format: 'hls', headers: { Referer: 'https://bysebuho.com/' } };
}

function extractSources(html) {
  const sources = [];
  const re = /data-source=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) sources.push(m[1]);
  return [...new Set(sources)];
}

async function trySources(sources) {
  for (const src of sources) {
    if (/byse/i.test(src)) {
      try {
        const hit = await resolveByse(src);
        if (hit && hit.url) return hit;
      } catch (_) {}
    }
  }
  for (const src of sources) {
    try {
      if (/\.m3u8/i.test(src)) {
        return { url: src, format: 'hls', headers: { Referer: VIEWPLAYER + '/' } };
      }
      const page = await request(src, {
        headers: { Referer: VIEWPLAYER + '/' },
        timeout: 15000,
        maxBytes: 512 * 1024,
      });
      if ((page.text || '').trim().startsWith('#EXTM3U')) {
        return { url: src, format: 'hls', headers: { Referer: VIEWPLAYER + '/' } };
      }
      const m3u = (page.text || '').match(/https?:\/\/[^"'\\\s<>]+\.m3u8[^"'\\\s<>]*/i);
      if (m3u) {
        return { url: m3u[0], format: 'hls', headers: { Referer: VIEWPLAYER + '/' } };
      }
    } catch (_) {}
  }
  return null;
}

function parseListing(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();
  $('article.item, .item.movies, .item.tvshows').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('h3 a, .data h3 a').first();
    const href = $a.attr('href') || '';
    const title = ($a.text() || $el.find('img').attr('alt') || '').trim();
    const poster = $el.find('img').attr('src') || null;
    const yearTxt = $el.find('.data span').first().text();
    const yearM = yearTxt.match(/\b(19|20)\d{2}\b/);
    const year = yearM ? parseInt(yearM[0], 10) : null;
    const rating = parseFloat($el.find('.rating').text()) || null;
    if (!href || !title) return;
    const isSeries = /\/series\//.test(href);
    const slugMatch = href.match(/assistir-([a-z0-9-]+)-online/i);
    const slug = slugMatch ? slugMatch[1] : null;
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    items.push(
      card(
        {
          id: slug,
          sourceId: slug,
          sourceSlug: slug,
          type: isSeries ? 'series' : 'movie',
          title,
          year,
          rating,
          poster,
          playable: true,
        },
        API
      )
    );
  });
  return items;
}

async function search(q) {
  return cached(API, `search:${q}`, 180, async () => {
    const r = await request(`${BASE}/?s=${encodeURIComponent(q)}`, { timeout: 20000 });
    if (r.status >= 400) throw new Error(`MegaCine search HTTP ${r.status}`);
    return {
      api: API,
      query: q,
      pagination: pagination({ currentPage: 1 }),
      results: parseListing(r.text),
    };
  });
}

async function catalog(type = 'movies', page = 1, category = null) {
  return cached(API, `catalog:${type}:${category || 'all'}:${page}`, 300, async () => {
    let path;
    if (category) {
      path = page <= 1 ? `/generos/${category}` : `/generos/${category}/page/${page}/`;
    } else if (type === 'series') {
      path = page <= 1 ? '/series/' : `/series/page/${page}/`;
    } else {
      path = page <= 1 ? '/filmes/' : `/filmes/page/${page}/`;
    }
    const r = await request(BASE + path, { timeout: 20000 });
    if (r.status >= 400) throw new Error(`MegaCine catalog HTTP ${r.status}`);
    return {
      api: API,
      type,
      category,
      pagination: pagination({ currentPage: page }),
      results: parseListing(r.text),
    };
  });
}

async function getAgenda() {
  return cached(API, 'agenda:calendar-widget:v2', 300, async () => {
    // O cronograma real do MegaCine é entregue pelo widget AJAX, não pela listagem
    // /series/. Esta é a mesma ação usada pelo servidor original v4-megacine.
    const url = `${BASE}/wp-admin/admin-ajax.php?action=megacine_calendar_widget&widget_number=3&_mc_nocache=${Date.now()}`;
    const response = await request(url, {
      timeout: 20000,
      maxBytes: 3 * 1024 * 1024,
      headers: {
        Referer: `${BASE}/`,
        Origin: BASE,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
    if (response.status >= 400) throw new Error(`MegaCine agenda HTTP ${response.status}`);

    let payload;
    try { payload = JSON.parse(response.text || '{}'); }
    catch { throw new Error('MegaCine agenda retornou JSON inválido'); }
    const html = payload?.data?.html;
    if (!payload?.success || typeof html !== 'string' || !html.trim()) {
      throw new Error('Widget de calendário do MegaCine indisponível ou sem conteúdo');
    }

    const $ = cheerio.load(html);
    const days = [];
    $('.mc-calendar__day').each((_, dayNode) => {
      const day = $(dayNode);
      const heading = day.find('h3').first();
      const date = heading.find('[datetime]').attr('datetime') || day.find('[datetime]').first().attr('datetime') || null;
      const label = heading.text().replace(/\s+/g, ' ').trim();
      const items = [];

      day.find('.mc-calendar__item').each((__, itemNode) => {
        const item = $(itemNode);
        const anchor = item.find('a[href]').first();
        const href = anchor.attr('href') || '';
        const absoluteUrl = href ? new URL(href, `${BASE}/`).toString() : null;
        const path = (() => { try { return new URL(absoluteUrl).pathname; } catch { return ''; } })();
        const slugMatch = path.match(/assistir-([a-z0-9-]+)-online/i);
        const slug = slugMatch ? slugMatch[1] : null;
        if (!slug) return;

        const type = /\/series\//i.test(path) ? 'series' : 'movie';
        const title = item.find('.mc-calendar__series').first().text().replace(/\s+/g, ' ').trim()
          || anchor.text().replace(/\s+/g, ' ').trim()
          || slug.replace(/-/g, ' ');
        const episodeLabel = item.find('.mc-calendar__episode').first().text().replace(/\s+/g, ' ').trim()
          || (item.text().match(/\bT\s*\d+\s*E\s*\d+\b/i) || [])[0]
          || null;
        const episodeMatch = String(episodeLabel || '').match(/T\s*(\d+)\s*E\s*(\d+)/i);
        const timeNode = item.find('.mc-calendar__time').first();
        const time = timeNode.attr('datetime') || null;
        const timeLabel = timeNode.text().replace(/\s+/g, ' ').trim() || null;

        items.push({
          api: API,
          type,
          id: slug,
          sourceId: slug,
          sourceSlug: slug,
          title,
          season: episodeMatch ? Number(episodeMatch[1]) : null,
          episode: episodeMatch ? Number(episodeMatch[2]) : null,
          episodeLabel,
          time,
          timeLabel,
          href: absoluteUrl,
        });
      });
      if (items.length) days.push({ date, label, items });
    });

    return {
      success: true,
      api: API,
      source: 'megacine_calendar_widget',
      title: 'CRONOGRAMA · PRÓXIMOS DIAS',
      days,
      totalItems: days.reduce((total, day) => total + day.items.length, 0),
      updatedAt: new Date().toISOString(),
    };
  });
}

function extractEmbedId(html) {
  const m = html.match(/viewplayer\.online\/(?:filme|embed)\/([^"'?\s/]+)/i);
  return m ? m[1].replace(/\/$/, '') : null;
}

function parseSeasonsFromEmbed(html) {
  const seasonMap = new Map();
  for (const m of html.matchAll(
    /data-season-id=["'](\d+)["'][^>]*data-season-number=["'](\d+)["']/gi
  )) {
    seasonMap.set(parseInt(m[2], 10), m[1]);
  }
  for (const m of html.matchAll(
    /data-season-number=["'](\d+)["'][^>]*data-season-id=["'](\d+)["']/gi
  )) {
    seasonMap.set(parseInt(m[1], 10), m[2]);
  }
  const bySeason = new Map();
  for (const m of html.matchAll(
    /data-season-id=["'](\d+)["']\s*[\s\S]{0,80}?data-episode-id=["'](\d+)["']/gi
  )) {
    const sid = m[1];
    const eid = m[2];
    if (!bySeason.has(sid)) bySeason.set(sid, []);
    const arr = bySeason.get(sid);
    if (!arr.includes(eid)) arr.push(eid);
  }
  const titleByEp = new Map();
  for (const m of html.matchAll(
    /data-episode-id=["'](\d+)["'][\s\S]{0,200}?episode-title">\s*([^<]+)/gi
  )) {
    titleByEp.set(m[1], m[2].trim());
  }
  const seasons = [];
  const sortedSeasonNums = [...seasonMap.keys()].sort((a, b) => a - b);
  for (const seasonNumber of sortedSeasonNums) {
    const seasonId = seasonMap.get(seasonNumber);
    const epIds = bySeason.get(seasonId) || [];
    const episodes = epIds.map((eid, idx) => ({
      id: eid,
      episodeNumber: idx + 1,
      title: titleByEp.get(eid) || null,
      seasonId,
    }));
    seasons.push({ seasonNumber, seasonId, episodes });
  }
  return seasons;
}

async function getContent(slug, typeHint = 'movie') {
  return cached(API, `content:${typeHint}:${slug}`, 600, async () => {
    const basePath = typeHint === 'series' ? 'series' : 'filmes';
    let r = await request(`${BASE}/${basePath}/assistir-${slug}-online`, { timeout: 20000 });
    let type = typeHint === 'series' ? 'series' : 'movie';
    if (r.status >= 400) {
      const alt = typeHint === 'series' ? 'filmes' : 'series';
      r = await request(`${BASE}/${alt}/assistir-${slug}-online`, { timeout: 20000 });
      type = alt === 'series' ? 'series' : 'movie';
    }
    if (r.status >= 400) return error(API, 'NOT_FOUND', `Content ${slug} not found`);

    const html = r.text;
    const $ = cheerio.load(html);
    let title =
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      slug;
    title = title.replace(/^Assistir\s+/i, '').replace(/\s+Online.*$/i, '').trim();
    const overview =
      $('.wp-content p').first().text().trim() ||
      $('meta[property="og:description"]').attr('content') ||
      null;
    const poster =
      $('meta[property="og:image"]').attr('content') ||
      $('.poster img').attr('src') ||
      null;
    const yearM = html.match(/\b(19|20)\d{2}\b/);
    const year = yearM ? parseInt(yearM[0], 10) : null;
    const imdbM = html.match(/\b(tt\d{7,})\b/);
    const imdbId = imdbM ? imdbM[1] : null;
    const embedId = extractEmbedId(html);
    const dataPostM = html.match(/data-post=['"]?(\d+)/i);
    const sourcePostId = dataPostM ? dataPostM[1] : null;

    let seasons = undefined;
    if (type === 'series' && embedId) {
      try {
        const emb = await request(`${VIEWPLAYER}/embed/${embedId}/`, {
          headers: { Referer: BASE + '/' },
          timeout: 25000,
          maxBytes: 3 * 1024 * 1024,
        });
        if (emb.status < 400) seasons = parseSeasonsFromEmbed(emb.text);
      } catch (_) {}
    }

    const d = detail(
      {
        id: slug,
        sourceId: slug,
        sourceSlug: slug,
        sourcePostId,
        type,
        title,
        year,
        overview,
        poster,
        imdbId,
        playable: !!(imdbId || embedId),
        seasons,
      },
      API
    );
    d.identifiers = d.identifiers || {};
    d.identifiers.embedId = embedId || null;
    d.identifiers.imdbId = imdbId || null;
    return d;
  });
}

async function getSeasons(slug) {
  const d = await getContent(slug, 'series');
  if (!d.success) return d;
  return { success: true, api: API, seriesId: slug, seasons: d.seasons || [] };
}

async function playMovieByImdb(imdbId) {
  return cached(API, `play:imdb:${imdbId}`, 120, async () => {
    const r = await request(`${VIEWPLAYER}/filme/${imdbId}`, {
      headers: { Referer: BASE + '/' },
      timeout: 20000,
    });
    if (r.status >= 400) return error(API, 'PLAYBACK_UNAVAILABLE', 'viewplayer failed');
    const sources = extractSources(r.text);
    const hit = await trySources(sources);
    if (!hit) {
      const m3u8 = r.text.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/i);
      if (m3u8) {
        return playback(
          {
            contentId: imdbId,
            type: 'movie',
            format: 'hls',
            url: m3u8[0],
            headers: { Referer: VIEWPLAYER + '/' },
          },
          API
        );
      }
      return error(API, 'PLAYBACK_UNAVAILABLE', 'No playable source on viewplayer');
    }
    return playback(
      {
        contentId: imdbId,
        type: 'movie',
        format: hit.format || 'hls',
        url: hit.url,
        headers: hit.headers || {},
      },
      API
    );
  });
}

async function playMovieBySlug(slug) {
  const d = await getContent(slug, 'movie');
  if (!d.success) return d;
  const imdb = d.identifiers?.imdbId;
  if (imdb) return playMovieByImdb(imdb);
  const embedId = d.identifiers?.embedId;
  if (embedId) {
    const r = await request(`${VIEWPLAYER}/embed/${embedId}/`, {
      headers: { Referer: BASE + '/' },
      timeout: 20000,
    });
    const sources = extractSources(r.text);
    const hit = await trySources(sources);
    if (hit) {
      return playback(
        { contentId: slug, type: 'movie', format: hit.format, url: hit.url, headers: hit.headers },
        API
      );
    }
  }
  return error(API, 'PLAYBACK_UNAVAILABLE', 'No IMDb/embed for movie play');
}

async function playSeriesEpisode(slug, season = 1, episode = 1) {
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  return cached(API, `play:series:${slug}:${s}:${e}`, 90, async () => {
    const page = await request(`${BASE}/series/assistir-${slug}-online`, {
      headers: { Referer: BASE + '/' },
      timeout: 20000,
    });
    if (page.status >= 400) {
      return error(API, 'NOT_FOUND', `Series page not found for ${slug}`);
    }
    const embedId = extractEmbedId(page.text);
    if (!embedId) {
      return error(API, 'PLAYBACK_UNAVAILABLE', 'ViewPlayer embed not found on series page');
    }
    const embedUrl = `${VIEWPLAYER}/embed/${embedId}/`;

    const emb = await request(embedUrl, {
      headers: { Referer: BASE + '/' },
      timeout: 25000,
      maxBytes: 3 * 1024 * 1024,
    });
    if (emb.status >= 400) {
      return error(API, 'UPSTREAM_ERROR', 'ViewPlayer embed HTTP ' + emb.status);
    }

    const seasonMap = new Map();
    for (const m of emb.text.matchAll(
      /data-season-id=["'](\d+)["'][^>]*data-season-number=["'](\d+)["']/gi
    )) {
      seasonMap.set(parseInt(m[2], 10), m[1]);
    }
    for (const m of emb.text.matchAll(
      /data-season-number=["'](\d+)["'][^>]*data-season-id=["'](\d+)["']/gi
    )) {
      seasonMap.set(parseInt(m[1], 10), m[2]);
    }

    const seasonId = seasonMap.get(s);
    if (!seasonId) {
      return error(API, 'NOT_FOUND', `Season ${s} not found in embed`);
    }

    const epIds = [];
    for (const m of emb.text.matchAll(
      /data-season-id=["'](\d+)["']\s*[\s\S]{0,80}?data-episode-id=["'](\d+)["']/gi
    )) {
      if (m[1] === seasonId) epIds.push(m[2]);
    }
    const ordered = [...new Set(epIds)];
    if (e < 1 || e > ordered.length) {
      return error(API, 'NOT_FOUND', `Episode ${e} not in season ${s} (has ${ordered.length})`);
    }
    const episodeId = ordered[e - 1];

    const epPage = await request(`${VIEWPLAYER}/episodio/${episodeId}`, {
      headers: {
        Referer: embedUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 20000,
    });
    if (epPage.status >= 400) {
      return error(API, 'UPSTREAM_ERROR', 'episodio HTTP ' + epPage.status);
    }
    const sources = extractSources(epPage.text);
    if (!sources.length) {
      return error(API, 'PLAYBACK_UNAVAILABLE', 'No sources on episode page');
    }
    const hit = await trySources(sources);
    if (!hit) {
      return error(API, 'PLAYBACK_UNAVAILABLE', 'All episode sources failed');
    }
    return playback(
      {
        contentId: `${slug}-s${s}e${e}`,
        type: 'series',
        format: hit.format || 'hls',
        url: hit.url,
        headers: hit.headers || {},
      },
      API
    );
  });
}

async function play(slugOrImdb) {
  if (/^tt\d+$/i.test(slugOrImdb)) return playMovieByImdb(slugOrImdb);
  return playMovieBySlug(slugOrImdb);
}

function categories() {
  return { api: API, categories: GENRES.map((g) => ({ ...g, availableIn: [API] })) };
}

function capabilities() {
  return {
    api: API,
    capabilities: {
      movies: true,
      series: true,
      categories: true,
      search: true,
      details: true,
      seasons: true,
      episodes: true,
      playback: true,
      calendar: true,
      formats: ['hls'],
    },
  };
}

module.exports = {
  API,
  BASE,
  GENRES,
  search,
  catalog,
  getContent,
  getSeasons,
  getAgenda,
  play,
  playMovieByImdb,
  playMovieBySlug,
  playSeriesEpisode,
  categories,
  capabilities,
  resolveByse,
};
