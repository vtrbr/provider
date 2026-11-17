'use strict';

const megaflix = require('./megaflix');
const superflix = require('./superflix');
const megacine = require('./megacine');
const megafilmes = require('./megafilmes');
const topfilmes = require('./topfilmes');

const providers = {
  v1: megaflix,
  v2: superflix,
  v3: megacine,
  v4: megafilmes,
  v5: topfilmes,
};

function get(api) {
  return providers[api] || null;
}

function list() {
  return Object.keys(providers).map((api) => ({
    api,
    name:
      api === 'v1'
        ? 'Megaflix'
        : api === 'v2'
          ? 'Topflix'
          : api === 'v3'
            ? 'MegaCine'
            : api === 'v4'
              ? 'MegaFilmesHD1'
              : 'TopFilmes',
    base: providers[api].BASE,
    capabilities: providers[api].capabilities().capabilities,
  }));
}

module.exports = { providers, get, list };
