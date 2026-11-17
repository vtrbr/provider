/**
 * Pobreflix — busca por nome e extrai MP4 direto (R2 / embed.php?src=)
 * Headers: nenhum necessário no CDN R2.
 */
const { request, probe } = require('./http');

const BASE = 'https://pobreflixtv.business';

function decodeSrc(src) {
  try {
    return decodeURIComponent(String(src || ''));
  } catch {
    return String(src || '');
  }
}

function extractMp4FromHtml(html) {
  const out = [];
  const reEmbed = /embed\.php\?src=([^"'&\s]+)/gi;
  let m;
  while ((m = reEmbed.exec(html))) {
    const u = decodeSrc(m[1]);
    if (/^https?:\/\//i.test(u) && /\.mp4/i.test(u)) out.push(u);
  }
  const reMp4 = /https?:\/\/[^"'>\s]+\.mp4[^"'>\s]*/gi;
  while ((m = reMp4.exec(html))) {
    out.push(m[0].replace(/&amp;/g, '&'));
  }
  return [...new Set(out)];
}

function scoreTitle(a, b) {
  const na = String(a || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const nb = String(b || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const ta = new Set(na.split(' '));
  const tb = nb.split(' ');
  let hit = 0;
  for (const w of tb) if (ta.has(w)) hit++;
  return Math.round((hit / Math.max(tb.length, 1)) * 60);
}

async function searchFilmPath(title) {
  const q = encodeURIComponent(String(title || '').slice(0, 80));
  const r = await request(BASE + '/?s=' + q, {
    accept: 'text/html',
    timeout: 20000,
    maxBytes: 2 * 1024 * 1024
  });
  if (r.status >= 400) throw new Error('pobreflix search HTTP ' + r.status);
  const paths = [];
  const re = /href="(\/filmes\/[^"]+)"/gi;
  let m;
  while ((m = re.exec(r.text))) paths.push(m[1]);
  return [...new Set(paths)];
}

async function resolve({ title, tmdb_id, media }) {
  if (media === 'tv') {
    // Séries: tenta página com tmdb no embed se achar via search
    // (muitos títulos de série usam /series/ — busca genérica)
    const q = encodeURIComponent(String(title || '').slice(0, 80));
    const r = await request(BASE + '/?s=' + q, {
      accept: 'text/html',
      timeout: 20000
    });
    const paths = [];
    const re = /href="(\/(?:filmes|series|serie)\/[^"]+)"/gi;
    let m;
    while ((m = re.exec(r.text))) paths.push(m[1]);
    const uniq = [...new Set(paths)].slice(0, 8);
    for (const path of uniq) {
      try {
        const page = await request(BASE + path, { accept: 'text/html', timeout: 20000 });
        // match tmdb in page
        if (tmdb_id && !page.text.includes(String(tmdb_id)) && scoreTitle(title, path) < 50) {
          continue;
        }
        const mp4s = extractMp4FromHtml(page.text);
        for (const url of mp4s) {
          if (tmdb_id && url.includes(String(tmdb_id))) {
            const p = await probe(url);
            if (p.ok) {
              return {
                ok: true,
                provider: 'pobreflix',
                stream: url,
                stream_type: 'mp4',
                headers: {},
                quality: null
              };
            }
          }
        }
        for (const url of mp4s) {
          const p = await probe(url);
          if (p.ok) {
            return {
              ok: true,
              provider: 'pobreflix',
              stream: url,
              stream_type: 'mp4',
              headers: {},
              quality: null
            };
          }
        }
      } catch (_) {}
    }
    return { ok: false, provider: 'pobreflix', erro: 'série não encontrada' };
  }

  const paths = await searchFilmPath(title);
  if (!paths.length) return { ok: false, provider: 'pobreflix', erro: 'sem resultados' };

  // prioriza path com tmdb / nome parecido
  const ranked = paths
    .map((path) => {
      let s = scoreTitle(title, path);
      if (tmdb_id && path.includes(String(tmdb_id))) s += 50;
      return { path, s };
    })
    .sort((a, b) => b.s - a.s);

  // só tenta paths com score mínimo (evita filme errado)
  const candidates = ranked.filter((x) => x.s >= 55).slice(0, 8);
  const pool = candidates.length ? candidates : ranked.slice(0, 3);

  for (const { path, s } of pool) {
    try {
      const page = await request(BASE + path, { accept: 'text/html', timeout: 20000 });
      const mp4s = extractMp4FromHtml(page.text);
      if (!mp4s.length) continue;

      // 1) URL com tmdb id
      const withTmdb = tmdb_id
        ? mp4s.filter((u) => u.includes(String(tmdb_id)))
        : [];
      // 2) página menciona tmdb
      const pageHasTmdb = tmdb_id && page.text.includes(String(tmdb_id));
      // 3) score alto no path
      const allow =
        withTmdb.length > 0 || pageHasTmdb || s >= 70;

      if (!allow) continue;

      const ordered = withTmdb.length
        ? withTmdb
        : mp4s;

      for (const url of ordered) {
        const pr = await probe(url);
        if (pr.ok) {
          return {
            ok: true,
            provider: 'pobreflix',
            stream: url,
            stream_type: 'mp4',
            headers: {},
            quality: null,
            page: path,
            match_score: s
          };
        }
      }
    } catch (_) {}
  }
  return { ok: false, provider: 'pobreflix', erro: 'mp4 não encontrado / match fraco' };
}

module.exports = { resolve };
