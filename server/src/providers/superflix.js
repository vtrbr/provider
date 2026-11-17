'use strict';

const cheerio = require('cheerio');
const { request, getJson } = require('../lib/http');
const { cached } = require('../lib/cache');
const { card, detail, playback, pagination, error } = require('../lib/normalize');

const API = 'v2';
const BASE = (process.env.SUPERFLIX_URL || process.env.TOPFLIX_URL || 'https://topflix.actor').replace(/\/+$/, '');

const GENRES = [
  { id: 'drama', name: 'Drama', sourceSlug: 'drama' },
  { id: 'suspense', name: 'Suspense', sourceSlug: 'suspense' },
  { id: 'aventura', name: 'Aventura', sourceSlug: 'aventura' },
  { id: 'acao', name: 'Ação', sourceSlug: 'acao' },
  { id: 'ficcao', name: 'Ficção', sourceSlug: 'ficcao' },
  { id: 'comedia', name: 'Comédia', sourceSlug: 'comedia' },
  { id: 'terror', name: 'Terror', sourceSlug: 'terror' },
  { id: 'animacao', name: 'Animação', sourceSlug: 'animacao' },
  { id: 'romance', name: 'Romance', sourceSlug: 'romance' },
  { id: 'ficcao-cientifica', name: 'Ficção Científica', sourceSlug: 'ficcao-cientifica' },
];

function abs(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return BASE + (path.startsWith('/') ? path : '/' + path);
}

function parseCards(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.default.poster.grid-item, .poster.grid-item, .grid-item').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.poster__title a, h3 a').first();
    const href = $a.attr('href') || '';
    const title = ($el.find('.poster__title span').first().text() || $a.text() || '').trim();
    const year = parseInt($el.find('.bslide__meta span').first().text().trim(), 10) || null;
    const rating = parseFloat($el.find('.rating.roundnum, .rating').first().text()) || null;
    const poster = $el.find('.poster__img img, img').first().attr('src') || null;
    // Formatos: /filmes/123-slug/  OU  /filmes/assistir-online-slug/  OU  /series/assistir-online-slug/
    let id = null;
    let slug = null;
    let type = 'movie';
    let m = href.match(/\/(?:filmes|series|genero)\/(\d+)-([^/]+)\/?$/i);
    if (m) {
      id = m[1];
      slug = m[2].replace(/\.html?$/i, '');
    } else {
      m = href.match(/\/(filmes|series)\/assistir-online-([^/]+)\/?$/i);
      if (m) {
        slug = m[2].replace(/\.html?$/i, '');
        id = slug; // id textual até a ficha resolver o news_id
        type = m[1].toLowerCase() === 'series' ? 'series' : 'movie';
      }
    }
    if (!id || !title) return;
    const typeId = $el.find('a[data-catid]').last().attr('data-catid');
    if (typeId === '14') type = 'series';
    if (/\/series\//i.test(href)) type = 'series';
    items.push(
      card(
        {
          id: String(id),
          sourceId: String(id),
          sourceSlug: slug || String(id),
          type,
          title,
          year,
          rating,
          poster: abs(poster),
          playable: true,
        },
        API
      )
    );
  });
  return items;
}

function extractLastPage(html) {
  const $ = cheerio.load(html);
  let last = 1;
  $('#pagination a, .pagination a, .pagination__pages a').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/page\/(\d+)/);
    if (m) last = Math.max(last, parseInt(m[1], 10));
  });
  return last;
}

async function search(q, page = 1) {
  return cached(API, `search:${q}:${page}`, 180, async () => {
    // Documented quirks: page1 start=0, page2 start=2, page3 start=3...
    const search_start = page === 1 ? 0 : page;
    const result_from = (page - 1) * 10 + 1;
    const body = new URLSearchParams({
      do: 'search',
      subaction: 'search',
      search_start: String(search_start),
      full_search: '0',
      result_from: String(result_from),
      story: q,
    }).toString();

    const r = await request(`${BASE}/index.php?do=search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: BASE,
        Referer: BASE + '/',
      },
      body,
      timeout: 25000,
    });
    if (r.status >= 400) throw new Error(`Topflix search HTTP ${r.status}`);
    const results = parseCards(r.text);
    return {
      api: API,
      query: q,
      pagination: pagination({ currentPage: page, limit: 10 }),
      results,
    };
  });
}

async function catalog(type = 'movies', page = 1, category = null) {
  return cached(API, `catalog:${type}:${category || 'all'}:${page}`, 300, async () => {
    let path;
    if (category) {
      path = page <= 1 ? `/genero/${category}/` : `/genero/${category}/page/${page}/`;
    } else if (type === 'series') {
      path = page <= 1 ? '/series/' : `/series/page/${page}/`;
    } else if (type === 'new') {
      path = '/new.html';
    } else if (type === 'top100') {
      path = '/top100.html';
    } else {
      path = page <= 1 ? '/filmes/' : `/filmes/page/${page}/`;
    }
    const r = await request(BASE + path, { timeout: 25000 });
    if (r.status >= 400) throw new Error(`Topflix catalog HTTP ${r.status}`);
    const results = parseCards(r.text);
    const totalPages = extractLastPage(r.text);
    return {
      api: API,
      type,
      category,
      pagination: pagination({
        currentPage: page,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      }),
      results,
    };
  });
}


function titleFromVideoUrl(videoUrl) {
  if (!videoUrl) return { title: null, year: null, slug: null };
  const base = String(videoUrl).split('/').pop() || '';
  let name = base.replace(/^[0-9]+_/, '').replace(/\.(m3u8|mp4|mkv).*$/i, '');
  // strip episode markers like s01e01
  name = name.replace(/s\d{1,2}e\d{1,3}/gi, ' ');
  const yearM = name.match(/(19|20)\d{2}/);
  const year = yearM ? parseInt(yearM[0], 10) : null;
  if (yearM) name = name.replace(yearM[0], ' ');
  name = name.replace(/\./g, ' ').replace(/[-_]+/g, ' ');
  name = name.replace(/\b(720p|1080p|2160p|web-?dl|webrip|bluray|x264|x265|dual|dublado|legendado|aac|5\.1|www|bludv|com|dub|leg|hdrip|brrip)\b/gi, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name || /^e\d+$/i.test(name)) return { title: null, year, slug: null };
  const title = name.replace(/\b([a-zà-ú])/gi, (c) => c.toUpperCase());
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { title, year, slug };
}

/** Parse Topflix /json nested folder structure into seasons[] */
function seasonsFromJsonTree(jsonNode) {
  const seasons = [];
  function walk(node, path = []) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, path));
      return;
    }
    if (node.folder && Array.isArray(node.folder)) {
      const title = String(node.title || '').toLowerCase();
      const seasonM = title.match(/^s(\d+)$/i) || title.match(/temporada\s*(\d+)/i);
      if (seasonM) {
        const seasonNumber = parseInt(seasonM[1], 10);
        const episodes = [];
        for (const ep of node.folder) {
          const et = String(ep.title || '').toLowerCase();
          const em = et.match(/^e(\d+)$/i) || et.match(/epis[oó]dio\s*(\d+)/i);
          if (em) {
            episodes.push({
              id: `s${seasonNumber}e${em[1]}`,
              episodeNumber: parseInt(em[1], 10),
              title: `Episódio ${em[1]}`,
            });
          } else if (ep.folder) {
            walk(ep, path.concat(node.title));
          }
        }
        if (episodes.length) {
          seasons.push({
            seasonNumber,
            episodes: episodes.sort((a, b) => a.episodeNumber - b.episodeNumber),
          });
        }
        return;
      }
      node.folder.forEach((n) => walk(n, path.concat(node.title || '')));
    }
  }
  walk(jsonNode);
  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return seasons;
}

async function findDetailPathById(id, hintTitle) {
  const stories = [];
  if (hintTitle) stories.push(String(hintTitle).slice(0, 80));
  stories.push(String(id));
  for (const story of stories) {
    try {
      const body = new URLSearchParams({
        do: 'search',
        subaction: 'search',
        search_start: '0',
        full_search: '0',
        result_from: '1',
        story,
      }).toString();
      const r = await request(`${BASE}/index.php?do=search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        timeout: 20000,
      });
      if (r.status >= 400) continue;
      const re = new RegExp(
        `href=["']((?:https?:\\/\\/[^"']+)?\\/([a-z0-9-]+)\\/${id}-([^"']+))["']`,
        'i'
      );
      const m = r.text.match(re);
      if (m) {
        const path = m[1].replace(/^https?:\/\/[^/]+/, '');
        return {
          path,
          genero: m[2],
          slug: m[3].replace(/\\.html?$/i, ''),
        };
      }
    } catch (_) {}
  }
  return null;
}

async function resolveNumericId(idOrSlug) {
  const raw = String(idOrSlug || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  // slug → página de detalhe → itemId
  const paths = [
    `/filmes/assistir-online-${raw}/`,
    `/series/assistir-online-${raw}/`,
    `/filmes/${raw}/`,
    `/series/${raw}/`,
  ];
  for (const path of paths) {
    try {
      const r = await request(`${BASE}${path}`, { timeout: 15000 });
      if (r.status >= 400) continue;
      const m = r.text.match(/var\s+itemId\s*=\s*["'](\d+)["']/);
      if (m) return m[1];
    } catch (_) {}
  }
  return null;
}

async function getContent(id) {
  return cached(API, `content:${id}`, 300, async () => {
    const numericId = await resolveNumericId(id);
    if (!numericId) {
      return error(API, 'NOT_FOUND', `Content ${id} not found`);
    }
    const json = await getJson(
      `${BASE}/json?id=${encodeURIComponent(numericId)}&version=0&season=1&series=1&a=false&android=0`,
      { timeout: 15000 }
    );
    if (!json || !json.id) {
      return error(API, 'NOT_FOUND', `Content ${id} not found`);
    }
    id = String(json.id);

    const isSeries = json.video_type === 'series';
    const seasons = isSeries ? seasonsFromJsonTree(json.json) : undefined;
    const inferred = titleFromVideoUrl(json.video_url);
    let title = inferred.title;
    let year = inferred.year;
    let overview = null;
    let rating = null;
    let runtime = null;
    let genres = [];
    let poster = abs(json.background_url);
    let sourceSlug = inferred.slug;

    // Prefer real HTML page (title, synopsis, poster, genres)
    const found = await findDetailPathById(id, inferred.title);
    if (found) {
      try {
        const full = await getContentByPath(found.genero, id, found.slug);
        if (full && full.success !== false) {
          // json.video_type is authoritative — HTML heuristic can false-positive series on movies
          full.type = isSeries ? 'series' : 'movie';
          if (isSeries && seasons && seasons.length) {
            full.seasons = seasons;
          } else if (!isSeries) {
            full.seasons = undefined;
          }
          if (!full.poster && poster) full.poster = poster;
          if (!full.backdrop && poster) full.backdrop = poster;
          full.playable = isSeries ? Boolean(seasons && seasons.length) : true;
          if (!full.title && inferred.title) full.title = inferred.title;
          return full;
        }
      } catch (_) {}
    }

    return detail(
      {
        id: String(json.id),
        sourceId: String(json.id),
        sourceSlug,
        type: isSeries ? 'series' : 'movie',
        title,
        year,
        poster,
        backdrop: poster,
        overview,
        rating,
        runtime,
        genres,
        playable: isSeries ? Boolean(seasons && seasons.length) : true,
        seasons,
      },
      API
    );
  });
}

/**
 * Full detail by scraping a known detail URL if slug is provided, otherwise minimal from /json.
 */
async function getContentByPath(genero, id, slug) {
  return cached(API, `contentpath:${genero}:${id}:${slug}`, 600, async () => {
    const url = `${BASE}/${genero}/${id}-${slug}`;
    const r = await request(url, { timeout: 20000 });
    if (r.status >= 400) return error(API, 'NOT_FOUND', 'Detail page not found');
    const $ = cheerio.load(r.text);
    const title = $('h1').text().replace(/^Assistir\s+/i, '').replace(/\s+Online$/i, '').trim();
    const yearMatch = $('.yearof').text().match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const runtimeMatch = $('.duration .tohr, .duration').text().match(/(\d+)/);
    const runtime = runtimeMatch ? parseInt(runtimeMatch[1], 10) : null;
    const rating = parseFloat($('.rating.roundnum').first().text()) || null;
    const overview = $('.movie-description p').first().text().trim() || null;
    const poster = abs($('.movieposter img').attr('src'));
    const genres = [];
    $('.onslide-cats a').each((_, a) => {
      const name = $(a).text().trim();
      const href = $(a).attr('href') || '';
      const m = href.match(/\/genero\/([^/]+)/);
      if (name) genres.push({ id: m ? m[1] : name.toLowerCase(), name, sourceSlug: m ? m[1] : null });
    });
    const script = $('script').text();
    const itemIdMatch = script.match(/var\s+itemId\s*=\s*["'](\d+)["']/);
    const itemId = itemIdMatch ? itemIdMatch[1] : id;
    const isSeries = /playerCurrSeason|series-selector-block/.test(r.text) || /--s\d/.test(url);

    // seasons/episodes for series
    let seasons = undefined;
    if (isSeries) {
      const seasonMap = new Map();
      $('.seasoncontent-v2 a.epi-link, a.epi-link').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/--s(\d+)e(\d+)/);
        if (!m) return;
        const s = parseInt(m[1], 10);
        const e = parseInt(m[2], 10);
        if (!seasonMap.has(s)) seasonMap.set(s, []);
        seasonMap.get(s).push({
          id: `${itemId}-s${s}e${e}`,
          episodeNumber: e,
          title: $(a).text().trim() || null,
        });
      });
      seasons = Array.from(seasonMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([seasonNumber, episodes]) => ({
          seasonNumber,
          episodes: episodes.sort((a, b) => a.episodeNumber - b.episodeNumber),
        }));
    }

    return detail(
      {
        id: itemId,
        sourceId: itemId,
        sourceSlug: slug,
        type: isSeries ? 'series' : 'movie',
        title,
        year,
        runtime,
        rating,
        overview,
        poster,
        genres,
        seasons,
      },
      API
    );
  });
}

async function play(id, season = 1, episode = 1) {
  return cached(API, `play:${id}:${season}:${episode}`, 120, async () => {
    const numericId = await resolveNumericId(id);
    if (!numericId) return error(API, 'PLAYBACK_UNAVAILABLE', 'ID não resolvido');
    const json = await getJson(
      `${BASE}/json?id=${encodeURIComponent(numericId)}&version=0&season=${season}&series=${episode}&a=false&android=0`,
      { timeout: 15000 }
    );
    if (!json || !json.video_url) {
      return error(API, 'PLAYBACK_UNAVAILABLE', 'video_url empty or content unavailable');
    }
    const url = abs(json.video_url);
    let format = 'mp4';
    if (json.video_format === 'application/x-mpegURL' || /\.m3u8/i.test(url)) format = 'hls';
    else if (/\.mkv/i.test(url)) format = 'mkv';
    else if (/\.mp4/i.test(url)) format = 'mp4';

    return playback(
      {
        contentId: String(json.id || id),
        type: json.video_type === 'series' ? 'series' : 'movie',
        format,
        url,
        headers: { Referer: BASE + '/' },
        subtitles: json.video_subs ? [{ url: abs(json.video_subs), lang: 'pt' }] : [],
      },
      API
    );
  });
}

function categories() {
  return {
    api: API,
    categories: GENRES.map((g) => ({ ...g, availableIn: [API] })),
  };
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
      formats: ['hls', 'mp4', 'mkv'],
    },
  };
}

module.exports = {
  API,
  BASE,
  search,
  catalog,
  getContent,
  getContentByPath,
  play,
  categories,
  capabilities,
  GENRES,
};
