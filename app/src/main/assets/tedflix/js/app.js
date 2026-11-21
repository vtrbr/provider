import { errorDialog } from "./ui/dialogs.js";

function dicebearUrl(seed, style = "fun-emoji") {
  const s = encodeURIComponent(String(seed || "tedflix-avatar-01"));
  const st = encodeURIComponent(String(style || "fun-emoji"));
  return `https://api.dicebear.com/9.x/${st}/png?seed=${s}&size=${128}`;
}

const DEFAULT_SEED = "tedflix-avatar-01";
function hashSeed(seed) {
  const s = String(seed || DEFAULT_SEED);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const AVATAR_PALETTE = [
  ["#7c3aed", "#4c1d95"],
  ["#e50914", "#7f1d1d"],
  ["#0ea5e9", "#0c4a6e"],
  ["#10b981", "#064e3b"],
  ["#f59e0b", "#78350f"],
  ["#ec4899", "#831843"],
  ["#8b5cf6", "#4c1d95"],
  ["#14b8a6", "#134e4a"],
];

/** Avatar local (SVG) — funciona offline e não depende do Dicebear */
function avatarLocalSvgTopCfg(seed, size = 256, nameHint = "") {
  const h = hashSeed(seed);
  const [c1, c2] = AVATAR_PALETTE[h % AVATAR_PALETTE.length];
  // Preferir iniciais do nome; seed só se for legível (não só dígitos)
  const fromName = String(nameHint || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .replace(/[^a-zA-ZÀ-ÿ0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();
  const fromSeed = String(seed || "")
    .replace(/^tedflix-avatar-0?/i, "")
    .replace(/[^a-zA-Z]/g, "") // só letras — evita "03" de seed numérico
    .slice(0, 2)
    .toUpperCase();
  const letters = fromName || fromSeed || "TF";
  const fontSize = Math.round(size * 0.36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="url(#g)"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
    fill="#fff" font-family="system-ui,sans-serif" font-weight="800" font-size="${fontSize}">${letters}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}



function avatarLocalSvgTop(seed, size = 128, nameHint = "") {
  const s = String(seed || "tedflix-avatar-01");
  const n = (s.match(/(\d+)/) || ["1", "1"])[1];
  const hues = [12, 28, 40, 160, 200, 260, 300, 330, 15, 55, 180, 220, 280, 10, 45];
  const h = hues[(Number(n) - 1) % hues.length] || 28;
  const label = String(nameHint || n).slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${h} 70% 55%)"/><stop offset="100%" stop-color="hsl(${(h+40)%360} 65% 40%)"/>
    </linearGradient></defs>
    <circle cx="64" cy="64" r="64" fill="url(#g)"/>
    <circle cx="64" cy="52" r="28" fill="hsl(${h} 40% 92%)"/>
    <ellipse cx="64" cy="110" rx="40" ry="28" fill="hsl(${h} 40% 92%)"/>
    <text x="64" y="60" text-anchor="middle" font-size="28" font-family="system-ui" fill="hsl(${h} 50% 25%)">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
function syncTopbarAvatar() {
  try {
    const img = document.getElementById("topbar-avatar-img");
    if (!img) return;
    let seed = "tedflix-avatar-01";
    let style = "fun-emoji";
    let nameHint = "";
    try {
      const raw = window.AndroidPlayer?.getActiveProfile?.();
      if (raw) {
        const p = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (p && p.success !== false) {
          if (p.avatarSeed) seed = p.avatarSeed;
          if (p.avatarStyle) style = p.avatarStyle || style;
          if (p.name) nameHint = p.name;
        }
      }
    } catch (_) {}
    try {
      const ls =
        localStorage.getItem("tedflix:active-profile") ||
        localStorage.getItem("tedflix_active_profile");
      if (ls) {
        const p = JSON.parse(ls);
        if (p?.avatarSeed) seed = p.avatarSeed;
        if (p?.avatarStyle) style = p.avatarStyle;
        if (p?.name) nameHint = p.name;
      }
    } catch (_) {}
    // 1) SVG local imediato (sempre aparece, mesmo offline)
    const local = (typeof avatarLocalSvgTopCfg === "function" ? avatarLocalSvgTopCfg(seed, 128, nameHint) : avatarLocalSvgTop(seed, 128, nameHint));
    img.src = local;
    // 2) tenta DiceBear e troca se carregar
    const remote = dicebearUrl(seed, style);
    const probe = new Image();
    probe.onload = () => {
      try {
        if (document.getElementById("topbar-avatar-img") === img) img.src = remote;
      } catch (_) {}
    };
    probe.onerror = () => {};
    probe.src = remote;
  } catch (_) {}
}

import { el, svgIcone, limpar } from "./dom.js";
import { resolveTituloParaRota, resolveEpisodioPorTitulo } from "./resolve.js";
import { NAV, CATEGORIAS } from "./config.js";
import { getFilmes, getSeries, getGeneroUnificado, getLancamentos, limparCacheCatalogo } from "./server-api.js";
import paginaInicio from "./pages/home.js";
import { paginaCatalogo } from "./pages/catalogo.js";
import paginaCategorias, { GENEROS_UNIFICADOS } from "./pages/categorias.js?v=20261118-recovery";
import paginaPluto from "./pages/pluto.js";
import paginaBusca from "./pages/busca.js";
import paginaDetalhe from "./pages/detalhes.js";
import paginaAssistir from "./pages/assistir.js";
import paginaConfiguracoes from "./pages/configuracoes.js";
import paginaFavoritos from "./pages/favoritos.js";
import paginaEpisodioInfo from "./pages/episodio-info.js";
import paginaTedtopPorAno, {
  paginaTedtopPorLetra,
  paginaTedtopPorGenero,
  paginaTedtopRadar,
  paginaTedtopTelao,
  paginaTedtopBilheteria,
} from "./pages/tedtop-explorar.js";
import { limparPlayer } from "./components/player.js";
import paginaTedtopDetalhe from "./pages/tedtop-detalhes.js";
import paginaAgenda from "./pages/agenda.js";


function getAppRoot() {
  return document.getElementById("app");
}
function getTabbar() {
  return document.getElementById("tabbar");
}
let atual = null;

/* ---------- navegação inferior ---------- */
let _tabIndicator = null;
let _tabLinks = [];

(function initTabbar() {
  const tabbar = getTabbar();
  if (!tabbar) return;
  try {
    // Indicador vermelho deslizante
    _tabIndicator = document.createElement("div");
    _tabIndicator.className = "tabbar-indicator";
    _tabIndicator.setAttribute("aria-hidden", "true");
    tabbar.appendChild(_tabIndicator);

    NAV.forEach((n) => {
      const a = el("a", { href: n.href, "data-href": n.href });
      a.innerHTML = `${svgIcone(n.icon)}<span>${n.label}</span>`;
      tabbar.append(a);
      _tabLinks.push(a);
    });

    // Posição inicial do indicador
    requestAnimationFrame(() => {
      const active = _tabLinks.find((a) => a.classList.contains("active")) || _tabLinks[0];
      if (active) moverIndicador(active, false);
    });
  } catch (e) {
    console.error("tabbar", e);
  }
})();

function moverIndicador(elAtivo, animar = true) {
  if (!_tabIndicator || !elAtivo) return;
  const tabbar = getTabbar();
  if (!tabbar) return;
  const idx = _tabLinks.indexOf(elAtivo);
  if (idx < 0) return;
  const n = Math.max(_tabLinks.length, 1);
  // width já é 20% via CSS; translateX em % relativo ao próprio indicador
  const x = idx * 100;
  if (!animar) {
    const prev = _tabIndicator.style.transition;
    _tabIndicator.style.transition = "none";
    _tabIndicator.style.transform = `translateX(${x}%)`;
    // força reflow e restaura transição
    void _tabIndicator.offsetWidth;
    _tabIndicator.style.transition = prev || "";
  } else {
    _tabIndicator.style.transform = `translateX(${x}%)`;
  }
}

function setTabbarVisible(visivel) {
  const tabbar = getTabbar();
  if (!tabbar) return;
  tabbar.classList.toggle("is-hidden", !visivel);
  document.body.classList.toggle("tabbar-gone", !visivel);
}

function marcarNav(rota) {
  const tabbar = getTabbar();
  if (!tabbar) return;

  // Esconde a barra exclusivamente na tela de Configurações
  const path = String(rota || "").replace(/^#/, "").split("?")[0];
  const isConfig = path === "/config" || path.startsWith("/config/");
  setTabbarVisible(!isConfig);

  if (isConfig) return;

  const semQuery = String(rota || "").split("?")[0];
  const base = "#/" + (semQuery.split("/")[1] || "");
  const alvo = base === "#/" ? "#/" : base;

  let ativo = null;
  const links = _tabLinks.length ? _tabLinks : [...tabbar.querySelectorAll("a")];
  links.forEach((a) => {
    const on = a.dataset.href === alvo;
    a.classList.toggle("active", on);
    if (on) ativo = a;
  });

  if (ativo) moverIndicador(ativo, true);
  else if (links[0]) moverIndicador(links[0], true);
}

/* ---------- rotas ---------- */
function telaFonteIndisponivel(raiz, fonte = ""){ 
  const page = el("div", { class: "page pad center" }, [
    el("h2", {}, "Origem não disponível"),
    el("p", { class: "sub" }, `Este registro pertence a uma fonte antiga${fonte ? ` (${fonte})` : ""} que não faz parte do Content Server atual. Procure o título no catálogo atualizado.`),
    el("a", { class: "btn primary", href: "#/" }, "Voltar ao início"),
    el("a", { class: "btn ghost", href: "#/busca" }, "Buscar título"),
  ]);
  raiz.append(page);
  return page;
}

function resolver(hash) {
  const rota = (hash || "#/").replace(/^#/, "") || "/";
  const [caminho, queryString = ""] = rota.split("?");
  const p = caminho.split("/").filter(Boolean);
  if (!p.length || p[0] === "_ptr" || p[0] === "_refresh") return (r) => paginaInicio(r);
  if (p[0] === "filmes") return (r) => paginaCatalogo(r, { titulo: "Filmes", carregar: (page = 1) => getFilmes(page) });
  if (p[0] === "lancamentos") return (r) => paginaCatalogo(r, { titulo: "Lançamentos", carregar: (page = 1) => getFilmes(page) });
  if (p[0] === "series") return (r) => paginaCatalogo(r, { titulo: "Séries", carregar: (page = 1) => getSeries(page) });
  if (p[0] === "categorias") return (r) => paginaCategorias(r);
  if (p[0] === "agenda") return (r) => paginaAgenda(r);
  if (p[0] === "categoria" && p[1]) {
    if (p[1] === "lancamentos") return (r) => paginaCatalogo(r, { titulo: "Lançamentos", carregar: getLancamentos });
    const slug = decodeURIComponent(p[1]);
    const genre = (typeof GENEROS_UNIFICADOS !== "undefined" ? GENEROS_UNIFICADOS : []).find((x) => x.slug === slug);
    const cat = CATEGORIAS.find((x) => x.slug === slug);
    return (r) => paginaCatalogo(r, { titulo: genre?.label || cat?.label || slug, carregar: (page = 1) => getGeneroUnificado(slug, page) });
  }
  if (p[0] === "busca") return (r) => paginaBusca(r);
  if (p[0] === "favoritos") return (r) => paginaFavoritos(r);
  if (p[0] === "favorito" && (p[1] === "resolve" || !p[1])) {
    const titulo = new URLSearchParams(queryString).get("titulo") || "";
    return async (r) => {
      if (!titulo) { r.append(el("p", { class: "center" }, "Favorito sem título disponível.")); return null; }
      r.append(el("div", { class: "center" }, [el("div", { class: "spinner" })]));
      try {
        const dest = await resolveTituloParaRota({ titulo });
        if (dest) { location.replace(dest); return null; }
        limpar(r);
        r.append(el("div", { class: "pad center" }, [
          el("p", { class: "sub" }, "Não foi possível localizar este título no catálogo atual."),
          el("a", { class: "btn ghost", href: "#/favoritos" }, "Voltar à lista"),
        ]));
      } catch (_) { limpar(r); r.append(el("p", { class: "center" }, "Não foi possível abrir este favorito agora.")); }
      return null;
    };
  }
  if (p[0] === "episodio" && p[1] === "resolve") {
    const params = new URLSearchParams(queryString);
    const titulo = params.get("titulo") || "";
    const temp = params.get("t") || "1";
    const ep = params.get("e") || "1";
    return async (r) => {
      r.append(el("div", { class: "center" }, [el("div", { class: "spinner" })]));
      try {
        const dest = await resolveEpisodioPorTitulo({ titulo, temp, ep });
        if (dest) { location.replace(dest); return null; }
        limpar(r);
        r.append(el("div", { class: "pad center" }, [
          el("p", { class: "sub" }, `Não encontramos "${titulo}" para abrir o episódio T${temp}E${ep}.`),
          el("a", { class: "btn ghost", href: "#/favoritos" }, "Voltar à lista"),
          el("a", { class: "btn primary", href: `#/busca?q=${encodeURIComponent(titulo)}` }, "Buscar no catálogo"),
        ]));
      } catch (_) { limpar(r); r.append(el("p", { class: "center" }, "Falha ao resolver este episódio.")); }
      return null;
    };
  }
  if (p[0] === "titulo" && p.length >= 4) {
    const tipo = p[1];
    const category = decodeURIComponent(p[2] || "").toLowerCase();
    const id = decodeURIComponent(p[3] || "");
    const params = new URLSearchParams(queryString);
    if (["destaque", "tedtop", "v6"].includes(category)) return (r) => paginaTedtopDetalhe(r, params.get("sourceSlug") || id);
    const map = { megacine: "v3", cine: "v3", megafilmes: "v4", megaflix: "v1", novelasflix: "v1", content: "v1" };
    const api = map[category] || category;
    if (/^v[1-5]$/.test(api)) return (r) => paginaDetalhe(r, { tipo, categoria: api, slug: id, sourceSlug: params.get("sourceSlug") || "" });
    return (r) => telaFonteIndisponivel(r, category);
  }
  if (p[0] === "episodio" && p.length >= 3) {
    const params = new URLSearchParams(queryString);
    const categoryRaw = decodeURIComponent(p[1] || "").toLowerCase();
    const map = { megacine: "v3", cine: "v3", megafilmes: "v4", megaflix: "v1", novelasflix: "v1", content: "v1" };
    const category = map[categoryRaw] || categoryRaw;
    return (r) => {
      if (!/^v[1-5]$/.test(category)) return telaFonteIndisponivel(r, categoryRaw);
      return paginaEpisodioInfo(r, {
        fonte: "content", categoria, slug: decodeURIComponent(p[2]),
        temporada: params.get("t") || params.get("temporada") || 1,
        episodio: params.get("e") || params.get("episodio") || 1,
        serieCategoria: params.get("serieCategoria") ? (map[params.get("serieCategoria")] || params.get("serieCategoria")) : category,
        serieSlug: params.get("serieSlug") || "", serieTitulo: params.get("titulo") || "",
        filmeId: params.get("filmeId") || "", thumb: params.get("thumb") || "",
      });
    };
  }
  if (p[0] === "assistir" && p.length >= 3) {
    const params = new URLSearchParams(queryString);
    const parseList = (name) => { try { const value = params.get(name); const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } };
    const map = { megacine: "v3", cine: "v3", megafilmes: "v4", megaflix: "v1", novelasflix: "v1", content: "v1" };
    const category = map[p[1].toLowerCase()] || p[1].toLowerCase();
    return (r) => {
      if (!/^v[1-5]$/.test(category) && category !== "destaque" && category !== "tedtop") return telaFonteIndisponivel(r, p[1]);
      return paginaAssistir(r, {
        categoria: category, slug: decodeURIComponent(p[2]), fila: parseList("fila"),
        filmeId: params.get("filmeId") || "", thumb: params.get("thumb") || "", tipo: params.get("tipo") || "",
        serieCategoria: map[params.get("serieCategoria")] || params.get("serieCategoria") || "",
        serieSlug: params.get("serieSlug") || "", episodios: parseList("episodios"), recomendados: parseList("recomendados"),
        titulo: params.get("titulo") || params.get("title") || "",
      });
    };
  }
  if (p[0] === "tedtop" && p[1] === "telao") return (r) => paginaTedtopTelao(r);
  if (p[0] === "tedtop" && p[1] === "bilheteria") return (r) => paginaTedtopBilheteria(r);
  if (p[0] === "tedtop" && p[1] === "ano") return (r) => paginaTedtopPorAno(r, { ano: p[2] || "2026" });
  if (p[0] === "tedtop" && p[1] === "letra") return (r) => paginaTedtopPorLetra(r, { letra: p[2] || "A" });
  if (p[0] === "tedtop" && p[1] === "genero") return (r) => paginaTedtopPorGenero(r, { genero: p[2] || "acao" });
  if (p[0] === "tedtop" && p[1] === "radar") return (r) => paginaTedtopRadar(r);
  if (["pluto", "ao-vivo", "canais"].includes(p[0])) return (r) => paginaPluto(r);
  if (p[0] === "canal") return () => { location.hash = "#/pluto"; };
  if (p[0] === "config") return (r) => paginaConfiguracoes(r);
  // Rotas antigas são encerradas explicitamente; nunca redirecionar Donflix para V2,
  // pois V2 agora é o provider Superflix e possui outro contrato/identificadores.
  if (["noflix", "donflix", "tedv2", "v2", "cine", "megacine", "megafilmes", "streaming", "filmes-ted", "series-ted", "fonte-indisponivel"].includes(p[0])) {
    return (r) => telaFonteIndisponivel(r, p[0]);
  }
  return (r) => { r.append(el("p", { class: "center" }, "Página não encontrada.")); return null; };
}

let _buscaPageCache = null;
let _homePageCache = null;
let _homePageCacheAt = 0;
const HOME_PAGE_TTL = 30 * 1000 * 1000; // 90s — evita home “congelada” com capas quebradas

/** Barra superior contextual: transparente com banner, sólida sem. */

function ensureTopbarBack() {
  let back = document.getElementById("topbar-back");
  if (back) return back;
  const bar = document.getElementById("topbar");
  if (!bar) return null;
  back = document.createElement("button");
  back.type = "button";
  back.className = "icon-btn topbar-back";
  back.id = "topbar-back";
  back.setAttribute("aria-label", "Voltar");
  back.hidden = true;
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  back.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.history.length > 1) history.back();
    else location.hash = "#/";
  });
  const brand = document.getElementById("topbar-brand") || bar.querySelector(".brand");
  if (brand && brand.nextSibling) bar.insertBefore(back, brand.nextSibling);
  else if (brand) brand.after(back);
  else bar.prepend(back);
  return back;
}

function rotaEhDetalhe(rota) {
  const r = rota || location.hash || "#/";
  return r.startsWith("#/titulo/") || r.startsWith("#/episodio/") || r.startsWith("#/assistir/") || r.startsWith("#/fonte-indisponivel/");
}

function rotaTemBanner(rota) {
  const r = rota || location.hash || "#/";
  return r === "#/" || r === "#" || r.startsWith("#/_") || r.startsWith("#/busca") || r.startsWith("#/titulo/") || r.startsWith("#/episodio/");
}

function atualizarTopbar(rota) {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  const clear = typeof rotaTemBanner === "function" ? rotaTemBanner(rota) : false;
  const detalhe = typeof rotaEhDetalhe === "function" ? rotaEhDetalhe(rota) : false;
  document.body.classList.toggle("ficha-mode", !!detalhe);
  bar.classList.toggle("topbar-clear", clear);
  bar.classList.toggle("topbar-solid", !clear);
  bar.classList.toggle("topbar-detail", detalhe);
  document.body.classList.toggle("topbar-over-banner", clear);
  if (!clear) bar.classList.remove("topbar-scrolled");
  const back = ensureTopbarBack() || document.getElementById("topbar-back");
  const brand = document.getElementById("topbar-brand") || bar.querySelector(".brand");
  if (back) {
    if (detalhe) back.removeAttribute("hidden");
    else back.setAttribute("hidden", "");
  }
  if (brand) {
    brand.style.display = detalhe ? "none" : "";
  }
}

function onAppScroll() {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  bar.classList.toggle("topbar-scrolled", y > 18);
}

let _navToken = 0;
async function navegar() {
  const root = getAppRoot();
  if (!root) {
    console.error("Tedflix: #app não encontrado");
    return;
  }
  const token = ++_navToken;

  const rota = location.hash || "#/";
  try {
    atualizarTopbar(rota);
  } catch (e) {
    console.warn("topbar", e);
  }

  const isHome = !rota || rota === "#" || rota === "#/" || rota === "#/_ptr" || rota === "#/_refresh";

  // Home em cache
  if (isHome && _homePageCache && Date.now() - _homePageCacheAt < HOME_PAGE_TTL) {
    try { limparPlayer(); } catch (_) {}
    if (atual && atual !== _homePageCache && atual.destruir) {
      try { atual.destruir(); } catch (_) {}
    }
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(_homePageCache);
    atual = _homePageCache;
    document.title = tituloDaRota("#/");
    marcarNav("/");
    return;
  }

  try { limparPlayer(); } catch (_) {}
  if (atual && atual !== _homePageCache && atual !== _buscaPageCache && atual.destruir) {
    try { atual.destruir(); } catch (_) {}
  }
  if (atual === _homePageCache || atual === _buscaPageCache) {
    if (atual && atual.parentNode) {
      try { atual.parentNode.removeChild(atual); } catch (_) {}
    }
  }

  marcarNav(rota.replace(/^#/, ""));
  document.title = tituloDaRota(rota);

  // Limpa boot / tela anterior NA HORA
  const rotaLeveUi = /^#\/(busca|config|favoritos)(\/|\?|$)/.test(rota);
  if (!rotaLeveUi) root.classList.add("page-switching");
  root.innerHTML = "";
  root.setAttribute("data-ready", "1");
  try { window.scrollTo(0, 0); } catch (_) {}
  try { syncTopbarAvatar(); } catch (_) {}

  // Rotas leves (busca, config, favoritos): abre no mesmo frame — sem esperar rAF
  const rotaLeve = /^#\/(busca|config|favoritos)(\/|\?|$)/.test(rota);
  if (!rotaLeve) {
    await new Promise((r) => requestAnimationFrame(() => r()));
  }

  // Cache da busca: reabre instantâneo (sem remontar DOM)
  if (/^#\/busca(\/|\?|$)/.test(rota) && _buscaPageCache) {
    try {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(_buscaPageCache);
      atual = _buscaPageCache;
      root.classList.remove("page-switching");
      return;
    } catch (_) {
      _buscaPageCache = null;
    }
  }

  try {
    const pageFn = resolver(rota);
    atual = (await pageFn(root)) || null;
    if (/^#\/busca(\/|\?|$)/.test(rota) && atual) {
      _buscaPageCache = atual;
    }
    if (isHome && atual) {
      _homePageCache = atual;
      _homePageCacheAt = Date.now();
    } else if (isHome && !atual) {
      _homePageCache = null;
      _homePageCacheAt = 0;
    }
    if (!atual && root && !root.firstChild) {
      root.appendChild(el("div", { class: "center pad" }, "Não foi possível carregar esta tela."));
    }
  } catch (err) {
    console.error("Tedflix navegar", rota, err);
    _homePageCache = null;
    _homePageCacheAt = 0;
    try {
      root.innerHTML = "";
      const msg = String((err && err.message) || err || "erro desconhecido");
      root.appendChild(
        el("div", { class: "center pad", style: "padding:24px;color:#fff" }, [
          el("p", { style: "font-weight:700;margin-bottom:8px" }, "Erro ao abrir a tela"),
          el("p", { class: "sub", style: "word-break:break-word" }, msg),
          el(
            "button",
            {
              type: "button",
              class: "btn primary",
              style: "margin-top:16px",
            },
            "Recarregar",
          ),
        ]),
      );
      const btn = root.querySelector("button");
      if (btn) btn.addEventListener("click", () => location.reload());
    } catch (e2) {
      root.textContent = "Erro: " + String(err);
    }
  } finally {
    requestAnimationFrame(() => {
      try { root.classList.remove("page-switching"); } catch (_) {}
    });
  }
}

function tituloDaRota(hash) {
  const caminho = hash.replace(/^#\//, "").split("?")[0];
  const p = caminho.split("/").filter(Boolean);
  if (!p.length) return "TEDFLIX — Filmes e séries online";
  const mapa = {
    filmes: "Filmes",
    series: "Séries",
    categorias: "Categorias",
    canais: "Pluto TV",
    pluto: "Pluto TV",
    "ao-vivo": "TV ao vivo",
    tedtop: "Explorar TEDTOP",
    canal: "Canal ao vivo",
    busca: "Buscar",
    favoritos: "Minha lista",
    favorito: "Favorito",
    titulo: "Detalhes",
    assistir: "Assistir",
  };
  return `${mapa[p[0]] || "TEDFLIX"} — TEDFLIX`;
}

window.addEventListener("scroll", onAppScroll, { passive: true });

/* Seta de voltar na topbar (detalhes) — no lugar da logo */
(function bindTopbarBack() {
  const back = document.getElementById("topbar-back");
  if (!back || back.dataset.bound) return;
  back.dataset.bound = "1";
  back.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.history.length > 1) history.back();
    else location.hash = "#/";
  });
})();

window.addEventListener("hashchange", () => {
  navegar().catch((e) => console.error("hashchange navegar", e));
});
navegar().catch((e) => {
  console.error("boot navegar", e);
  const root = getAppRoot();
  if (root) {
    root.innerHTML = "";
    const d = document.createElement("div");
    d.style.cssText = "color:#fff;padding:24px;text-align:center";
    d.innerHTML = "<p><b>Falha ao iniciar</b></p><p style=\"opacity:.7;word-break:break-word\">" +
      String((e && e.message) || e) +
      "</p><p style=\"margin-top:12px;opacity:.5;font-size:12px\">Reinicie o app</p>";
    root.appendChild(d);
  }
});


/* ---------- puxar para atualizar o catálogo ---------- */
(function setupPullToRefresh() {
  let startY = 0;
  let pulling = false;
  let refreshing = false;
  const limiar = 70;

  function rotaCatalogo() {
    const h = (location.hash || "#/").replace(/^#/, "") || "/";
    const base = h.split("?")[0].split("/").filter(Boolean)[0] || "";
    // Home e listas de catálogo
    return !base || ["", "filmes", "series", "lancamentos", "categorias", "categoria", "pluto", "ao-vivo", "canais"].includes(base);
  }

  function mostrarToast(msg) {
    let t = document.getElementById("ptr-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "ptr-toast";
      t.className = "ptr-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove("on"), 1800);
  }

  async function atualizarCatalogo() {
    if (refreshing) return;
    refreshing = true;
    mostrarToast("Atualizando catálogo…");
    try {
      limparCacheCatalogo();
      _homePageCache = null;
      _homePageCacheAt = 0;
      // Re-dispara a rota atual (ou home) para buscar dados novos
      const atual = location.hash || "#/";
      const alvo = (!atual || atual === "#" || atual === "#/_refresh") ? "#/" : atual;
      if (location.hash === "#/_ptr") {
        location.hash = alvo;
      } else {
        location.hash = "#/_ptr";
        await new Promise((r) => requestAnimationFrame(r));
        location.hash = alvo === "#/_ptr" ? "#/" : alvo;
      }
      mostrarToast("Catálogo atualizado");
    } catch (error) {
      errorDialog(error?.message || "Não foi possível atualizar o catálogo. Tente novamente em instantes.", { title: "Falha ao atualizar o catálogo" });
    } finally {
      setTimeout(() => { refreshing = false; }, 800);
    }
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (refreshing) return;
      if (window.scrollY > 4) return;
      if (!rotaCatalogo()) return;
      startY = e.touches[0].clientY;
      pulling = true;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 24 && window.scrollY <= 4) {
        document.body.classList.add("ptr-pulling");
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    (e) => {
      if (!pulling) return;
      pulling = false;
      document.body.classList.remove("ptr-pulling");
      const dy = (e.changedTouches[0]?.clientY || 0) - startY;
      if (dy > limiar && window.scrollY <= 4 && rotaCatalogo()) {
        atualizarCatalogo();
      }
    },
    { passive: true },
  );
})();


window.syncTopbarAvatar = syncTopbarAvatar;
try { syncTopbarAvatar(); setTimeout(syncTopbarAvatar, 400); setTimeout(syncTopbarAvatar, 1500); } catch (_) {}
