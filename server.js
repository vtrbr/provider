'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

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
    service: 'tedflix-provider-topfilmes',
    version: '4.2.1',
    port: PORT,
    uptime: process.uptime(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'TEDFLIX Provider API — TopFilmes only',
    version: '4.2.1',
    port: PORT,
    routes: {
      detalheFilme: '/detalhe/v2/*',
      playTopfilmes: '/play/v2/*',
    },
  });
});

// ───────────── detalhes TopFilmes (fonte / lista de players) ─────────────
try {
  const detalheFilme = require('./detalhes/detalhe-filme');
  mountWildcard('/detalhe/v2', detalheFilme.handler);
  console.log('[boot] /detalhe/v2 → filme topfilmes (fonte/players)');
} catch (e) {
  console.warn('[boot] detalhe-filme:', e.message);
}

// ───────────── player / fonte TopFilmes (resolve MP4) ─────────────
try {
  const playV2 = require('./video/video-top');
  mountWildcard('/play/v2', playV2.handler);
  console.log('[boot] /play/v2 → stream topfilmes (player/fonte)');
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
  console.log(`[boot] TEDFLIX TopFilmes (fonte+player) listening on http://${HOST}:${PORT}`);
});
