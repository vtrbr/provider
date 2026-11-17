/**
 * MegaFilmes HD (megafilmeshd1.com)
 * Mesma entrada do app: generate_token.php?type=filme|serie&tmdb=
 * → embedyplayer → clickhost (mp4) ou comprarebom (hls)
 */
const { request, probe } = require('./http');

async function resolve({ tmdb_id, media, season, episode }) {
  const type = media === 'tv' ? 'serie' : 'filme';
  const tokenUrl =
    type === 'filme'
      ? `https://megafilmeshd1.com/generate_token.php?type=filme&id=&tmdb=${encodeURIComponent(
          tmdb_id
        )}&season=&episode=&_=${Date.now()}`
      : `https://megafilmeshd1.com/generate_token.php?type=serie&id=&tmdb=${encodeURIComponent(
          tmdb_id
        )}&season=${encodeURIComponent(season || 1)}&episode=${encodeURIComponent(
          episode || 1
        )}&_=${Date.now()}`;

  const tok = await request(tokenUrl, {
    headers: {
      Referer: 'https://megafilmeshd1.com/',
      Accept: 'application/json'
    },
    timeout: 20000,
    maxBytes: 64 * 1024
  });
  if (tok.status >= 400) {
    return { ok: false, provider: 'megafilmes', erro: 'generate_token HTTP ' + tok.status };
  }
  let data;
  try {
    data = JSON.parse(tok.text);
  } catch {
    return { ok: false, provider: 'megafilmes', erro: 'generate_token JSON inválido' };
  }
  if (!data.ok || !data.url) {
    return { ok: false, provider: 'megafilmes', erro: data.error || 'sem embed url' };
  }

  const emb = await request(data.url, {
    headers: { Referer: 'https://megafilmeshd1.com/' },
    timeout: 25000,
    maxBytes: 2 * 1024 * 1024
  });
  if (emb.status >= 400) {
    return { ok: false, provider: 'megafilmes', erro: 'embedy HTTP ' + emb.status };
  }

  const links = [];
  const re =
    /https?:\/\/(?:comprarebom\.xyz|superflixapi\.fun|embed-api\.clickhost\.xyz)[^"'>\s]*/gi;
  let m;
  while ((m = re.exec(emb.text))) {
    links.push(m[0].replace(/&amp;/g, '&').split('#')[0]);
  }
  const uniq = [...new Set(links)];

  // 1) clickhost (mp4 token) — mesma lógica do player 2 do app
  for (const link of uniq.filter((u) => u.includes('clickhost.xyz'))) {
    try {
      const page = await request(link, {
        headers: { Referer: 'https://embedyplayer.xyz/' },
        timeout: 25000,
        maxBytes: 3 * 1024 * 1024
      });
      const sm = page.text.match(/servers:\s*(\[[^\]]+\])/);
      if (!sm) continue;
      let servers;
      try {
        servers = JSON.parse(
          sm[1]
            .replace(/'/g, '"')
            .replace(/\bFalse\b/g, 'false')
            .replace(/\bTrue\b/g, 'true')
            .replace(/\bNone\b/g, 'null')
        );
      } catch {
        continue;
      }
      for (const s of servers) {
        if (!s || !s.id || s.down) continue;
        const init = await request(
          `https://embed-api.clickhost.xyz/embed/stream/${s.id}/init`,
          {
            method: 'POST',
            headers: {
              Referer: link,
              Origin: 'https://embed-api.clickhost.xyz',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: '',
            timeout: 20000,
            maxBytes: 64 * 1024
          }
        );
        if (init.status >= 400) continue;
        let j;
        try {
          j = JSON.parse(init.text);
        } catch {
          continue;
        }
        if (!j.ok || !j.url) continue;
        const streamUrl = j.url.startsWith('http')
          ? j.url
          : 'https://embed-api.clickhost.xyz' + j.url;
        const hdrs = { Referer: 'https://embed-api.clickhost.xyz/' };
        const p = await probe(streamUrl, 'ExoPlayer', hdrs);
        if (p.ok || p.status === 200 || p.status === 206) {
          return {
            ok: true,
            provider: 'megafilmes',
            stream: streamUrl,
            stream_type: j.is_hls ? 'hls' : p.stream_type || 'mp4',
            headers: hdrs,
            quality: s.label || null
          };
        }
      }
    } catch (_) {}
  }

  // 2) comprarebom HLS
  for (const link of uniq.filter((u) => u.includes('comprarebom.xyz'))) {
    try {
      const page = await request(link, {
        headers: { Referer: 'https://embedyplayer.xyz/' },
        timeout: 20000
      });
      const m3u = page.text.match(/https?:\/\/[^"'>\s]+\.m3u8[^"'>\s]*/i);
      if (m3u) {
        const stream = m3u[0].replace(/&amp;/g, '&');
        const hdrs = { Referer: 'https://comprarebom.xyz/' };
        const p = await probe(stream, 'ExoPlayer', hdrs);
        if (p.ok) {
          return {
            ok: true,
            provider: 'megafilmes',
            stream,
            stream_type: 'hls',
            headers: hdrs,
            quality: null
          };
        }
      }
    } catch (_) {}
  }

  return { ok: false, provider: 'megafilmes', erro: 'sem stream nos embeds' };
}

module.exports = { resolve };
