/**
 * Otimização de imagens — o motivo do travamento antigo era baixar capas
 * em tamanho original (PNG/JPG grandes) para slots de ~110px.
 *
 * - TMDB: troca o tamanho no caminho (/t/p/original -> /t/p/w154), via CDN.
 * - NovelasFlix (/resize/...webp): ajusta ?w=&h= (já entrega WebP).
 * - O tamanho pedido ainda cai um degrau quando a rede está lenta.
 */

import { tamanhoCapa, redeGenerosa } from "./net.js";

const TMDB = { xs: "w154", sm: "w185", md: "w342", lg: "w500" };
const LARG = { xs: 154, sm: 185, md: 342, lg: 500 };
const ORDEM = ["xs", "sm", "md", "lg"];

/** Nunca pede mais do que a rede aguenta. */
function ajustar(size) {
  const teto = tamanhoCapa(); // xs | sm | md
  return ORDEM[Math.min(ORDEM.indexOf(size), ORDEM.indexOf(teto))] || size;
}

/** Normaliza URLs relativas de protocolo (//cdn...) e sem scheme. */
function absoluto(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("/")) return u; // path relativo local
  return u;
}

export function poster(url, size = "sm", { respeitarRede = true } = {}) {
  if (!url) return "";
  url = absoluto(url);
  const s = respeitarRede ? ajustar(size) : size;
  try {
    if (url.includes("image.tmdb.org")) {
      return url.replace(/\/t\/p\/(w\d+|original)\//, `/t/p/${TMDB[s]}/`);
    }
    if (url.includes("/resize/")) {
      const u = new URL(url);
      const w = LARG[s];
      u.searchParams.set("w", String(w));
      u.searchParams.set("h", String(Math.round(w * 1.5)));
      return u.toString();
    }
  } catch (e) {
    /* URL estranha: devolve como veio */
  }
  return url;
}

/** Só oferece 2x quando a conexão comporta — em rede fraca isso dobrava o peso. */
export function posterSrcSet(url, size = "sm") {
  if (!redeGenerosa()) return "";
  const base = poster(url, size);
  if (!base) return "";
  const prox = size === "xs" ? "sm" : size === "sm" ? "md" : "lg";
  return `${base} 1x, ${poster(url, prox)} 2x`;
}

/** Imagem larga (hero / backdrop) — sem proporção de pôster. */
export function backdrop(url, largura = 780) {
  if (!url) return "";
  url = absoluto(url);
  const l = redeGenerosa() ? largura : Math.min(largura, 500);
  try {
    if (url.includes("image.tmdb.org")) {
      return url.replace(/\/t\/p\/(w\d+|original)\//, `/t/p/w${l}/`);
    }
    if (url.includes("/resize/")) {
      const u = new URL(url);
      u.searchParams.set("w", String(l));
      u.searchParams.delete("h");
      return u.toString();
    }
  } catch (e) {
    /* ignora */
  }
  return url;
}

/* --------- fila de pré-carregamento ---------
   Baixa capas das próximas fileiras em segundo plano, mas com no máximo
   3 downloads simultâneos para não competir com o que está na tela. */

const fila = [];
let ativos = 0;
const jaVistas = new Set();
const emFila = new Set();
const LIMITE = 3;
const LIMITE_FILA = 24;
const LIMITE_HISTORICO_PREFETCH = 600;

function lembrarPrefetch(src) {
  jaVistas.add(src);
  // Evita que o conjunto de URLs cresça sem limite em sessões longas.
  while (jaVistas.size > LIMITE_HISTORICO_PREFETCH) {
    const primeira = jaVistas.values().next().value;
    jaVistas.delete(primeira);
  }
}

function bombear() {
  while (ativos < LIMITE && fila.length) {
    const src = fila.shift();
    emFila.delete(src);
    ativos++;
    let img;
    let finalizado = false;
    let timeoutId = 0;
    const fim = () => {
      if (finalizado) return;
      finalizado = true;
      if (timeoutId) clearTimeout(timeoutId);
      ativos = Math.max(0, ativos - 1);
      bombear();
    };
    try {
      img = new Image();
      img.onload = fim;
      img.onerror = fim;
      img.decoding = "async";
      img.fetchPriority = "low";
      // Uma requisição de prefetch que nunca termina não pode travar toda a fila.
      timeoutId = setTimeout(() => {
        if (finalizado) return;
        try {
          img.onload = null;
          img.onerror = null;
          img.removeAttribute("src");
        } catch (_) {}
        fim();
      }, 12000);
      img.src = src;
    } catch (_) {
      fim();
    }
  }
}

export function prefetchImagens(urls, size = "sm") {
  const agenda = window.requestIdleCallback || ((f) => setTimeout(f, 400));
  agenda(() => {
    for (const u of urls.slice(0, 10)) {
      const src = poster(u, size);
      if (!src || jaVistas.has(src) || emFila.has(src)) continue;
      if (fila.length >= LIMITE_FILA) break;
      lembrarPrefetch(src);
      emFila.add(src);
      fila.push(src);
    }
    bombear();
  });
}
