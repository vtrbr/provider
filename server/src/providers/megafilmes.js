'use strict';

const { request, getJson, probe } = require('../lib/http');
const { cached } = require('../lib/cache');
const { card, detail, playback, pagination, error } = require('../lib/normalize');

const API = 'v4';
const BASE = process.env.MEGAFILMES_URL || 'https://megafilmeshd1.com';

function absUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  // poster-cache relative
  return BASE + (path.startsWith('/') ? path : '/' + path);
}

/**
 * Real search endpoint is /search?q= (NOT /?s=).
 * Cards: article.browse-card
 */
function parseBrowseCards(html) {
  const results = [];
  const seen = new Set();
  // Aceita article.browse-card e div.browse-card (layout novo)
  const blocks =
    html.match(/<(?:article|div)[^>]*class="[^"]*browse-card[^"]*"[^>]*>[\s\S]*?<\/(?:article|div)>/gi) ||
    [];
  // Fallback: links /filme|serie/
  const linkRe = /href="(\/(?:filme|serie)\/([^"?#]+))"/gi;
  let m;
  const fromLinks = [];
  while ((m = linkRe.exec(html)) !== null) {
    fromLinks.push({ path: m[1], slug: m[2], index: m.index });
  }

  function pushItem({ path, slug, title, poster, year }) {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const type = /\/serie\//i.test(path) ? 'series' : 'movie';
    results.push(
      card(
        {
          id: slug,
          sourceId: slug,
          sourceSlug: slug,
          type,
          title: title || slug.replace(/-/g, ' '),
          year: year || null,
          poster: poster ? absUrl(String(poster).replace(/&amp;/g, '&')) : null,
          playable: true,
        },
        API
      )
    );
  }

  for (const block of blocks) {
    const hrefM = block.match(/href="(\/(?:filme|serie)\/([^"]+))"/i);
    if (!hrefM) continue;
    const titleM =
      block.match(/browse-card-title[^"]*"[^>]*>\s*([^<]+)/i) ||
      block.match(/browse-card-title">\s*([^<]+)/i) ||
      block.match(/<img[^>]+alt="([^"]+)"/i);
    const imgM =
      block.match(/<img[^>]+data-src="([^"]+)"/i) ||
      block.match(/<img[^>]+src="([^"]+)"/i);
    const yearM = block.match(/\b((?:19|20)\d{2})\b/);
    pushItem({
      path: hrefM[1],
      slug: hrefM[2],
      title: titleM ? titleM[1].trim() : null,
      poster: imgM ? imgM[1] : null,
      year: yearM ? parseInt(yearM[1], 10) : null,
    });
  }

  // Se o regex de blocos falhar, monta pelos hrefs
  if (!results.length && fromLinks.length) {
    for (const item of fromLinks) {
      const window = html.slice(Math.max(0, item.index - 80), item.index + 280);
      const titleM = window.match(/title="([^"]+)"/i) || window.match(/alt="([^"]+)"/i);
      const imgM = window.match(/(?:data-src|src)="([^"]+)"/i);
      pushItem({
        path: item.path,
        slug: item.slug,
        title: titleM ? titleM[1].trim() : null,
        poster: imgM ? imgM[1] : null,
        year: null,
      });
    }
  }
  return results;
}

async function search(q) {
  return cached(API, `search:${q}`, 180, async () => {
    // Correct endpoint (/?s= returns homepage and breaks pairing)
    const r = await request(`${BASE}/search?q=${encodeURIComponent(q)}`, { timeout: 20000 });
    if (r.status >= 400) throw new Error(`MegaFilmes search HTTP ${r.status}`);
    const results = parseBrowseCards(r.text);
    return {
      api: API,
      query: q,
      pagination: pagination({ currentPage: 1, totalResults: results.length }),
      results,
    };
  });
}

/**
 * Detail page holds TMDB id in player.php?type=filme&tmdb=603
 */
async function getContent(slug, typeHint = 'movie') {
  return cached(API, `content:${typeHint}:${slug}`, 600, async () => {
    const pathType = typeHint === 'series' ? 'serie' : 'filme';
    let r = await request(`${BASE}/${pathType}/${slug}`, { timeout: 15000 });
    if (r.status >= 400 && pathType === 'filme') {
      r = await request(`${BASE}/serie/${slug}`, { timeout: 15000 });
    }
    if (r.status >= 400) return error(API, 'NOT_FOUND', `Content ${slug} not found`);

    const titleM = r.text.match(/<h1[^>]*>\s*([^<]+)/i);
    const title = titleM ? titleM[1].trim() : slug;
    const tmdbM =
      r.text.match(/player\.php\?[^"']*tmdb=(\d+)/i) ||
      r.text.match(/tmdb[=:\/](\d+)/i) ||
      r.text.match(/data-tmdb=["']?(\d+)/i);
    const tmdbId = tmdbM ? tmdbM[1] : null;
    const isSeries = /type=serie|\/serie\//i.test(r.text) || pathType === 'serie';
    const yearM = r.text.match(/\b(19|20)\d{2}\b/);
    const posterM = r.text.match(/poster-cache\.php\?[^"']+/i);

    return detail(
      {
        id: slug,
        sourceId: slug,
        sourceSlug: slug,
        type: isSeries ? 'series' : 'movie',
        title,
        year: yearM ? parseInt(yearM[0], 10) : null,
        poster: posterM ? absUrl('/' + posterM[0].replace(/&amp;/g, '&')) : null,
        tmdbId,
        playable: !!tmdbId,
      },
      API
    );
  });
}

/** Resolve stream by slug: detail → tmdb → playByTmdb */
async function playBySlug(slug, season = '', episode = '') {
  const d = await getContent(slug);
  if (!d.success) return d;
  const tmdb = d.identifiers?.tmdbId;
  if (!tmdb) return error(API, 'PLAYBACK_UNAVAILABLE', 'TMDB id not found on detail page');
  const type = d.type === 'series' ? 'serie' : 'filme';
  return playByTmdb(tmdb, type, season, episode);
}

async function playByTmdb(tmdbId, type = 'filme', season = '', episode = '') {
  return cached(API, `play:${type}:${tmdbId}:${season}:${episode}`, 90, async () => {
    const qs = new URLSearchParams({
      type,
      id: '',
      tmdb: String(tmdbId),
      season: String(season || ''),
      episode: String(episode || ''),
      _: String(Date.now()),
    });
    let tokenData;
    try {
      tokenData = await getJson(`${BASE}/generate_token.php?${qs}`, {
        headers: { Referer: BASE + '/' },
        timeout: 15000,
      });
    } catch (e) {
      return error(API, 'UPSTREAM_ERROR', 'generate_token failed: ' + e.message);
    }
    if (!tokenData || !tokenData.ok || !tokenData.url) {
      return error(API, 'PLAYBACK_UNAVAILABLE', 'generate_token did not return embed url');
    }

    // Open embedyplayer
    const emb = await request(tokenData.url, {
      headers: { Referer: BASE + '/' },
      timeout: 15000,
    });
    if (emb.status >= 400) return error(API, 'UPSTREAM_ERROR', 'embedyplayer failed');

    // Prefer clickhost
    const clickMatch = emb.text.match(/https?:\/\/embed-api\.clickhost\.xyz\/embed\/(?:filme|serie)\/[0-9]+/i);
    if (clickMatch) {
      const clickUrl = clickMatch[0];
      const clickPage = await request(clickUrl, {
        headers: { Referer: 'https://embedyplayer.xyz/' },
        timeout: 15000,
      });
      // Try to find servers array
      const serversMatch = clickPage.text.match(/servers\s*[:=]\s*(\[[\s\S]*?\])/i);
      let servers = [];
      if (serversMatch) {
        const raw = serversMatch[1];
        try {
          servers = JSON.parse(raw);
        } catch (_) {
          try {
            servers = JSON.parse(raw
              .replace(/'/g, '\"')
              .replace(/\bFalse\b/g, 'false')
              .replace(/\bTrue\b/g, 'true')
              .replace(/\bNone\b/g, 'null'));
          } catch (_) {}
        }
      }
      for (const s of servers) {
        if (s.down) continue;
        try {
          const init = await request(`https://embed-api.clickhost.xyz/embed/stream/${s.id}/init`, {
            method: 'POST',
            headers: {
              Referer: clickUrl,
              Origin: 'https://embed-api.clickhost.xyz',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: '',
            timeout: 15000,
          });
          if (init.status >= 400) continue;
          const j = JSON.parse(init.text);
          if (j.ok && j.url) {
            const streamUrl = j.url.startsWith('http') ? j.url : 'https://embed-api.clickhost.xyz' + j.url;
            const streamHeaders = { Referer: 'https://embed-api.clickhost.xyz/' };
            const checked = await probe(streamUrl, { headers: streamHeaders, timeout: 12000 });
            if (!checked.ok) continue;
            return playback(
              {
                contentId: String(tmdbId),
                type: type === 'serie' ? 'series' : 'movie',
                format: j.is_hls ? 'hls' : (checked.stream_type === 'unknown' ? 'mp4' : checked.stream_type),
                url: streamUrl,
                headers: streamHeaders,
              },
              API
            );
          }
        } catch (_) {
          /* next server */
        }
      }
    }

    // Fallback comprarebom m3u8
    const compr = emb.text.match(/https?:\/\/comprarebom\.xyz\/e\/[a-z0-9]+/i);
    if (compr) {
      const page = await request(compr[0], {
        headers: { Referer: 'https://embedyplayer.xyz/' },
        timeout: 15000,
      });
      const m3u8 = page.text.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/i);
      if (m3u8) {
        const stream = m3u8[0].replace(/&amp;/g, '&');
        const streamHeaders = { Referer: 'https://comprarebom.xyz/' };
        const checked = await probe(stream, { headers: streamHeaders, timeout: 12000 });
        if (!checked.ok) return error(API, 'PLAYBACK_UNAVAILABLE', 'O link HLS do embed não passou na validação.');
        return playback(
          {
            contentId: String(tmdbId),
            type: type === 'serie' ? 'series' : 'movie',
            format: 'hls',
            url: stream,
            headers: streamHeaders,
          },
          API
        );
      }
    }

    return error(API, 'PLAYBACK_UNAVAILABLE', 'No clickhost/comprarebom stream resolved');
  });
}

function capabilities() {
  return {
    api: API,
    capabilities: {
      movies: true,
      series: true,
      categories: false,
      search: true,
      details: true,
      seasons: false, // discovery not documented
      episodes: false,
      playback: true,
      formats: ['mp4', 'hls'],
    },
  };
}


async function catalog(page = 1, category = null) {
  return cached(API, `catalog:${category || 'filmes'}:${page}`, 300, async () => {
    let path = category
      ? `/categoria/${encodeURIComponent(category)}${page > 1 ? `?page=${page}` : ''}`
      : page <= 1
        ? '/filmes'
        : `/filmes?page=${page}`;
    const r = await request(`${BASE}${path}`, { timeout: 20000 });
    if (r.status >= 400) {
      // fallback homepage cards
      const home = await request(`${BASE}/`, { timeout: 15000 });
      return {
        api: API,
        pagination: pagination({ currentPage: page }),
        results: parseBrowseCards(home.text).filter((x) => x.type === 'movie'),
      };
    }
    const results = parseBrowseCards(r.text);
    const pageNums = [...r.text.matchAll(/[?&]page=(\d+)/gi)].map((m) => parseInt(m[1], 10)).filter(Boolean);
    const totalPages = pageNums.length ? Math.max(...pageNums, page) : null;
    const hasNext = totalPages != null ? page < totalPages : results.length >= 20;
    return {
      api: API,
      pagination: pagination({ currentPage: page, totalPages, hasNext, hasPrevious: page > 1 }),
      results,
    };
  });
}

module.exports = { API, BASE, search, catalog, getContent, playByTmdb, playBySlug, capabilities };
