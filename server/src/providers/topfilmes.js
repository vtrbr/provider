'use strict';

const cheerio = require('cheerio');
const { request, probe } = require('../lib/http');
const { cached } = require('../lib/cache');
const { card, detail, playback, pagination, error } = require('../lib/normalize');

const API = 'v5';
const BASE = process.env.TOPFILMES_URL || 'https://topfilmes.biz';

const GENRES = [
  'acao','animacao','comedia','drama','documentario','fantasia','faroeste',
  'ficcao-cientifica','misterio','romance','suspense','terror','thriller'
].map((s) => ({ id: s, name: s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), sourceSlug: s }));

function parseCards(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('a[href*="/assistir/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/assistir\/([^/?#]+)/);
    if (!m) return;
    const slug = m[1];
    let title =
      $(a).attr('title') ||
      $(a).find('img').attr('alt') ||
      $(a).text().trim() ||
      slug.replace(/-/g, ' ');
    title = String(title || '').replace(/^capa\s+/i, '').trim();
    if (!title || /^capa$/i.test(title)) title = slug.replace(/-/g, ' ');
    // Title-case simples para slugs
    if (title === slug.replace(/-/g, ' ')) {
      title = title.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    let poster = $(a).find('img').attr('data-src') || $(a).find('img').attr('src') || null;
    if (poster && /_filter\(blur\)/.test(poster)) {
      poster = poster.replace(/_filter\(blur\)/g, '');
    }
    if (items.some((i) => i.id === slug)) return;
    items.push(
      card(
        {
          id: slug,
          sourceId: slug,
          sourceSlug: slug,
          type: 'movie', // not formally separated in docs
          title,
          poster: poster && poster.startsWith('//') ? 'https:' + poster : poster,
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
    const r = await request(`${BASE}/busca?q=${encodeURIComponent(q)}`, { timeout: 15000 });
    if (r.status >= 400) throw new Error(`TopFilmes search HTTP ${r.status}`);
    return {
      api: API,
      query: q,
      pagination: pagination({ currentPage: 1 }),
      results: parseCards(r.text),
    };
  });
}

async function catalog(page = 1, category = null) {
  return cached(API, `catalog:${category || 'home'}:${page}`, 300, async () => {
    const path = category
      ? `/genero/${category}${page > 1 ? '?p=' + page : ''}`
      : page <= 1
        ? '/home'
        : `/home?p=${page}`;
    const r = await request(BASE + path, { timeout: 15000 });
    if (r.status >= 400) throw new Error(`TopFilmes catalog HTTP ${r.status}`);
    const results = parseCards(r.text);
    const pageNums = [...r.text.matchAll(/[?&]p=(\d+)/gi)].map((m) => parseInt(m[1], 10)).filter(Boolean);
    const totalPages = pageNums.length ? Math.max(...pageNums, page) : null;
    const hasNext = totalPages != null ? page < totalPages : results.length >= 20;
    return {
      api: API,
      category,
      pagination: pagination({ currentPage: page, totalPages, hasNext, hasPrevious: page > 1 }),
      results,
    };
  });
}

async function getContent(slug) {
  return cached(API, `content:${slug}`, 600, async () => {
    const r = await request(`${BASE}/assistir/${slug}`, { timeout: 15000 });
    if (r.status >= 400) return error(API, 'NOT_FOUND', 'Detail not found');
    const $ = cheerio.load(r.text);
    // Título a partir do slug (HTML do site costuma vir com branding)
    const title = String(slug || '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    const poster =
      $('meta[property="og:image"]').attr('content') ||
      $('img').first().attr('src') ||
      null;
    const yearM = r.text.match(/\b((?:19|20)\d{2})\b/);
    return detail(
      {
        id: slug,
        sourceId: slug,
        sourceSlug: slug,
        type: 'movie',
        title,
        year: yearM ? parseInt(yearM[1], 10) : null,
        poster: poster && poster.startsWith('//') ? 'https:' + poster : poster,
        playable: true,
      },
      API
    );
  });
}

async function play(slug, player = 1) {
  return cached(API, `play:${slug}:${player}`, 60, async () => {
    const r = await request(`${BASE}/player/${slug}?player=${player}`, {
      headers: { Referer: `${BASE}/assistir/${slug}` },
      timeout: 15000,
    });
    if (r.status >= 400) return error(API, 'PLAYBACK_UNAVAILABLE', 'Player page failed');
    const $ = cheerio.load(r.text);
    let src = $('video source').attr('src') || $('source').attr('src');
    if (!src) {
      const m = r.text.match(/src=["']([^"']*direct[^"']*)["']/i);
      if (m) src = m[1];
    }
    if (!src) return error(API, 'PLAYBACK_UNAVAILABLE', 'No <source> found');
    if (src.startsWith('//')) src = 'https:' + src;
    if (src.startsWith('/')) src = BASE + src;

    // Valida somente uma pequena faixa do arquivo; a URL original é mantida
    // para que o player do app siga redirecionamentos HTTP normalmente.
    const headers = { Referer: BASE + '/' };
    const checked = await probe(src, { headers, timeout: 15000 });
    if (!checked.ok) return error(API, 'PLAYBACK_UNAVAILABLE', checked.error || 'O endereço retornado não é um arquivo de vídeo válido.');
    return playback(
      {
        contentId: slug,
        type: 'movie',
        format: checked.stream_type === 'unknown' ? 'mp4' : checked.stream_type,
        url: src,
        headers,
      },
      API
    );
  });
}

function categories() {
  return { api: API, categories: GENRES.map((g) => ({ ...g, availableIn: [API] })) };
}

function capabilities() {
  return {
    api: API,
    capabilities: {
      movies: true,
      series: false,
      categories: true,
      search: true,
      details: true,
      seasons: false,
      episodes: false,
      playback: true,
      formats: ['mp4'],
    },
  };
}

module.exports = { API, BASE, search, catalog, getContent, play, categories, capabilities };
