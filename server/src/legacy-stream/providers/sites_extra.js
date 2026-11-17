/**
 * Sites extras (seriesflixpop, pobreflixtvfree, megafilmehdonline, hypeflixhit)
 * Fluxo: busca HTML → extrai IMDB tt → viewplayer.online/filme|embed → byse (via megacine helpers)
 */
const { request, probe } = require('./http');
const megacine = require('./megacine');

const SITES = [
  {
    name: 'seriesflixpop',
    search: (q) =>
      'https://www.seriesflixpop.com/buscar?q=' + encodeURIComponent(q),
  },
  {
    name: 'pobreflixtvfree',
    search: (q) =>
      'https://www.pobreflixtvfree.quest/buscar?q=' + encodeURIComponent(q),
  },
  {
    name: 'megafilmehdonline',
    search: (q) =>
      'https://megafilmehdonline.blog/?s=' + encodeURIComponent(q),
  },
  {
    name: 'hypeflixhit',
    search: (q) =>
      'https://www.hypeflixhit.com/?s=' + encodeURIComponent(q),
  },
];

function extractImdb(html) {
  const m =
    String(html || '').match(/\b(tt\d{7,9})\b/) ||
    String(html || '').match(/imdb\.com\/title\/(tt\d+)/i);
  return m ? m[1] : null;
}

function firstContentLink(html, base) {
  const re =
    /href="((?:https?:\/\/[^"]+)?\/(?:filmes?|series?|filme|serie|assistir)[^"]+)"/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    let u = m[1].replace(/&amp;/g, '&');
    if (u.startsWith('/')) u = base + u;
    if (/buscar|search|genero|categoria|login|wp-/i.test(u)) continue;
    out.push(u);
  }
  return [...new Set(out)].slice(0, 6);
}

async function resolve(opts) {
  const title = String(opts.title || '').trim();
  if (!title) return { ok: false, provider: 'sites_extra', erro: 'sem título' };

  // se já tem imdb, pula direto
  let imdb = opts.imdb_id || null;
  let sourceSite = null;

  if (!imdb) {
    for (const site of SITES) {
      try {
        const base = site.search('').replace(/\/[^/]*$/, '').replace(/\?.*$/, '');
        const searchUrl = site.search(title);
        const page = await request(searchUrl, {
          headers: { Referer: base + '/' },
          timeout: 18000,
          maxBytes: 2 * 1024 * 1024,
        });
        if (page.status >= 400) continue;
        const links = firstContentLink(page.text, base.replace(/\/$/, ''));
        // tenta achar imdb já na listagem
        imdb = extractImdb(page.text);
        if (!imdb) {
          for (const link of links.slice(0, 3)) {
            try {
              const det = await request(link, {
                headers: { Referer: searchUrl },
                timeout: 18000,
                maxBytes: 2 * 1024 * 1024,
              });
              imdb = extractImdb(det.text);
              if (imdb) {
                sourceSite = site.name;
                break;
              }
            } catch (_) {}
          }
        } else {
          sourceSite = site.name;
        }
        if (imdb) break;
      } catch (_) {}
    }
  }

  if (!imdb) {
    return { ok: false, provider: 'sites_extra', erro: 'imdb não encontrado' };
  }

  // Reusa resolução MegaCine/viewplayer (já estável + byse)
  const r = await megacine.resolve({
    ...opts,
    imdb_id: imdb,
  });
  if (r && r.ok) {
    return {
      ...r,
      provider: 'sites_extra:' + (sourceSite || 'imdb') + '+viewplayer',
    };
  }
  return {
    ok: false,
    provider: 'sites_extra',
    erro: (r && r.erro) || 'viewplayer falhou',
    imdb_id: imdb,
  };
}

module.exports = { resolve };
