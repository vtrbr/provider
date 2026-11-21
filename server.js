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
    service: 'TEDFLIX Provider API — TopFilmes',
    version: '4.2.1',
    port: PORT,
    routes: {
      filmes: '/filmes?page=&limit=',
      'filmes-novos': '/filmes-novos?page=&limit=',
      categorias: GENRES.map((g) => `/${g.slug}`),
      categoriasLista: '/categorias',
      detalheFilme: '/detalhe/v2/*',
      playTopfilmes: '/play/v2/*',
    },
  });
});

// ───────────── catálogos TopFilmes ─────────────
try {
  app.get('/filmes', require('./filmes').handler);
  console.log('[boot] /filmes');
} catch (e) {
  console.warn('[boot] filmes:', e.message);
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

// ───────────── detalhe filme TopFilmes (fonte / players) ─────────────
try {
  const detalheFilme = require('./detalhes/detalhe-filme');
  mountWildcard('/detalhe/v2', detalheFilme.handler);
  console.log('[boot] /detalhe/v2 → filme topfilmes');
} catch (e) {
  console.warn('[boot] detalhe-filme:', e.message);
}

// ───────────── player / fonte TopFilmes ─────────────
try {
  const playV2 = require('./video/video-top');
  mountWildcard('/play/v2', playV2.handler);
  console.log('[boot] /play/v2 → stream topfilmes');
} catch (e) {
  console.warn('[boot] play-v2:', e.message);
}

// ───────────── 404 ─────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl || req.url,
  });
});

// ───────────── start ─────────────
app.listen(PORT, HOST, () => {
  console.log(`[boot] TEDFLIX Provider API (TopFilmes) listening on http://${HOST}:${PORT}`);
  console.log(`[boot] ${mounted.length} categorias carregadas`);
});
