'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { GENRES } = require('./lib/topfilmes-genre');

const PORT = Number(process.env.PORT) || 1100;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ───────────── logs ─────────────
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || '-';
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = [
      new Date().toISOString(),
      String(clientIp(req)).padEnd(16),
      req.method.padEnd(6),
      String(res.statusCode).padStart(3),
      `${ms}ms`.padStart(8),
      req.originalUrl || req.url,
    ].join('  ');
    console.log(line);
  });
  next();
});

function mountWildcard(route, handler) {
  app.get(route + '/*', handler);
  app.get(route, handler);
}

// ───────────── health ─────────────
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'tedflix-provider',
    version: '4.2.1',
    port: PORT,
    uptime: process.uptime(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'TEDFLIX Provider API',
    version: '4.2.1',
    port: PORT,
    routes: {
      banner: '/banner',
      filmes: '/filmes?page=&limit=',
      series: '/series?page=&limit=',
      'filmes-novos': '/filmes-novos?page=&limit=',
      categorias: GENRES.map((g) => `/${g.slug}`),
      categoriasLista: '/categorias',
      detalheSerie: '/detalhe/v1/*',
      detalheFilme: '/detalhe/v2/*',
      proxyHls: '/proxy/hls?u=',
      playerAbyss: '/player/abyss/:slug',
      playMegacine: '/play/v1/*',
      playTopfilmes: '/play/v2/*',
    },
  });
});

// ───────────── banner (1h) ─────────────
try {
  app.get('/banner', require('./banner').handler);
  console.log('[boot] /banner');
} catch (e) {
  console.warn('[boot] banner:', e.message);
}

// ───────────── catálogos ─────────────
try {
  app.get('/filmes', require('./filmes').handler);
  console.log('[boot] /filmes');
} catch (e) {
  console.warn('[boot] filmes:', e.message);
}
try {
  app.get('/series', require('./series').handler);
  console.log('[boot] /series');
} catch (e) {
  console.warn('[boot] series:', e.message);
}
try {
  app.get('/filmes-novos', require('./filmes-novos').handler);
  app.get('/lancamentos', require('./filmes-novos').handler);
  console.log('[boot] /filmes-novos');
} catch (e) {
  console.warn('[boot] filmes-novos:', e.message);
}

// ───────────── categorias TopFilmes ─────────────
const catDir = path.join(__dirname, 'categorias');
const mounted = [];

if (fs.existsSync(catDir)) {
  for (const file of fs.readdirSync(catDir).filter((f) => f.endsWith('.js'))) {
    const slug = file.replace(/\.js$/, '');
    try {
      const mod = require(path.join(catDir, file));
      if (!mod.handler) continue;
      app.get(`/${slug}`, mod.handler);
      app.get(`/categoria/${slug}`, mod.handler);
      app.get(`/genero/${slug}`, mod.handler);
      mounted.push(slug);
      console.log(`[boot] /${slug}`);
    } catch (e) {
      console.warn(`[boot] categoria ${slug}:`, e.message);
    }
  }
}

app.get('/categorias', (_req, res) => {
  res.json({
    success: true,
    categories: GENRES.map((g) => ({
      slug: g.slug,
      label: g.label,
      path: `/${g.slug}`,
      paths: [`/${g.slug}`, `/categoria/${g.slug}`, `/genero/${g.slug}`],
      site: g.path,
    })),
  });
});

// ───────────── detalhes ─────────────
try {
  const detalheSerie = require('./detalhes/detalhe-serie');
  mountWildcard('/detalhe/v1', detalheSerie.handler);
  console.log('[boot] /detalhe/v1 → serie megacine');
} catch (e) {
  console.warn('[boot] detalhe-serie:', e.message);
}

try {
  const detalheFilme = require('./detalhes/detalhe-filme');
  mountWildcard('/detalhe/v2', detalheFilme.handler);
  console.log('[boot] /detalhe/v2 → filme topfilmes');
} catch (e) {
  console.warn('[boot] detalhe-filme:', e.message);
}

// ───────────── HLS proxy (Byse ASN lock) ─────────────
try {
  const hlsProxy = require('./lib/hls-proxy');
  app.get('/proxy/hls', hlsProxy.handler);
  console.log('[boot] /proxy/hls');
} catch (e) {
  console.warn('[boot] hls-proxy:', e.message);
}

// ───────────── Abyss player limpo (sem anúncio) ─────────────
try {
  const playV1 = require('./video/mega-video');

  app.get('/player/abyss', (req, res) => playV1.abyssPlayerHandler(req, res));

  app.get('/player/abyss/:slug', (req, res) => {
    req.params = req.params || {};
    req.params[0] = req.params.slug;
    return playV1.abyssPlayerHandler(req, res);
  });

  app.get('/player/abyss/*', (req, res) => {
    const rest = (req.path || '').replace(/^\/player\/abyss\/?/, '');
    req.params = req.params || {};
