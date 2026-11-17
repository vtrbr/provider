'use strict';

const { request: undiciRequest, Agent } = require('undici');

const agent = new Agent({
  connect: { timeout: 15000 },
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
});

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Simple HTTP helper with timeout, redirects and body limit.
 */
async function request(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = 20000,
    maxBytes = 2 * 1024 * 1024,
    redirect = 'follow',
  } = options;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const res = await undiciRequest(url, {
      method,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'text/html,application/json,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        ...headers,
      },
      body,
      signal: ctrl.signal,
      dispatcher: agent,
      maxRedirections: redirect === 'follow' ? 5 : 0,
    });

    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) break;
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const text = buffer.toString('utf8');

    return {
      status: res.statusCode,
      headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v])),
      text,
      buffer,
      url: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, options = {}) {
  const r = await request(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  if (r.status >= 400) {
    const err = new Error(`HTTP ${r.status} for ${url}`);
    err.status = r.status;
    err.body = r.text.slice(0, 300);
    throw err;
  }
  try {
    return JSON.parse(r.text);
  } catch (e) {
    const err = new Error(`Invalid JSON from ${url}`);
    err.cause = e;
    throw err;
  }
}

/**
 * Lightweight stream validation. Reads only a tiny byte range and rejects HTML
 * challenge/error pages that sometimes masquerade as HTTP 200 responses.
 */
async function probe(url, options = {}) {
  const headers = {
    Range: 'bytes=0-2047',
    ...(options.headers || {}),
  };
  try {
    const response = await request(url, {
      method: 'GET',
      headers,
      timeout: options.timeout || 12000,
      maxBytes: 4096,
    });
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const preview = String(response.text || '').slice(0, 500).trim().toLowerCase();
    const looksLikeHtml = /^(<!doctype html|<html|<head|<body)/i.test(preview);
    const isHtml = looksLikeHtml && !preview.startsWith('#extm3u');
    if (response.status >= 400 || isHtml || !response.buffer?.length) {
      return { ok: false, status: response.status, stream_type: null, error: isHtml ? 'HTML response, not a media stream' : `HTTP ${response.status}` };
    }
    if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl') || preview.startsWith('#extm3u') || /\.m3u8(?:[?#]|$)/i.test(url)) {
      if (preview.startsWith('#extm3u') || contentType.includes('mpegurl') || response.status === 200 || response.status === 206) {
        return { ok: true, status: response.status, stream_type: 'hls' };
      }
    }
    if (contentType.includes('video/') || contentType.includes('octet-stream') || /\.(mp4|mkv)(?:[?#]|$)/i.test(url)) {
      return { ok: true, status: response.status, stream_type: /mkv/i.test(contentType + url) ? 'mkv' : 'mp4' };
    }
    return { ok: response.status === 200 || response.status === 206, status: response.status, stream_type: 'unknown' };
  } catch (e) {
    return { ok: false, status: 0, stream_type: null, error: e.message || String(e) };
  }
}

module.exports = { request, getJson, probe, DEFAULT_UA };
