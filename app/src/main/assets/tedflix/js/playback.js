import { confirmFavoriteRemoval } from "./ui/dialogs.js";
/**
 * playback.js — ponto único para player nativo, progresso e favoritos.
 * Todas as telas devem usar isto em vez de copiar a lógica.
 */

/** Abre o player nativo (Android). Retorna true se abriu. */
export function abrirPlayerNativo(opts = {}) {
  if (!window.AndroidPlayer || typeof window.AndroidPlayer.openPlayer !== "function") {
    return false;
  }
  const fila = JSON.stringify(opts.fila || []);
  const episodios = JSON.stringify(opts.episodios || []);
  const recomendados = JSON.stringify(opts.recomendados || []);
  window.AndroidPlayer.openPlayer(
    opts.categoria || "",
    opts.slug || "",
    opts.titulo || "",
    fila,
    opts.filmeId || opts.slug || "",
    opts.thumb || "",
    opts.tipo || "filme",
    opts.serieCategoria || "",
    opts.serieSlug || "",
    episodios,
    recomendados,
  );
  return true;
}

/** Lista bruta do Continuar assistindo (array). */
export function getContinueList() {
  try {
    const raw = window.AndroidPlayer?.getContinueWatching?.() || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Percentual 0–99 a partir de um item de progresso.
 * Aceita percent/progresso, positionMs/durationMs ou positionSeconds/durationSeconds.
 */
export function percentFromItem(item) {
  if (!item) return 0;
  let p = Number(item.percent ?? item.progresso ?? 0);
  if (p > 0) return Math.min(99, Math.round(p));

  let pos = Number(item.positionMs || 0);
  let dur = Number(item.durationMs || 0);
  if ((!pos || !dur) && (item.positionSeconds || item.durationSeconds)) {
    pos = Number(item.positionSeconds || 0) * 1000;
    dur = Number(item.durationSeconds || 0) * 1000;
  }
  if (pos > 0 && dur > 0) {
    return Math.min(99, Math.max(1, Math.round((pos * 100) / dur)));
  }
  return 0;
}

/**
 * Localiza progresso para um título/episódio.
 * Chaves: categoria+slug, filmeId, slug sozinho, ou id NoFlix (filme-{id}).
 * @returns {{ percent: number, positionMs: number, durationMs: number, item: object|null }}
 */
/**
 * Progresso LOCAL primeiro (instantâneo). Série: SEMPRE por episódio (slug), nunca pela série.
 * filmeId sozinho só casa filme (não episódio).
 */
export function lerProgresso({
  categoria = "",
  slug = "",
  filmeId = "",
  idtmdb = "",
  temporada = 0,
  episodio = 0,
  serieSlug = "",
} = {}) {
  const empty = { percent: 0, positionMs: 0, durationMs: 0, item: null };
  try {
    const list = getContinueList();
    if (!list.length) return empty;
    const cat = String(categoria || "").trim().toLowerCase();
    const s = String(slug || "").trim();
    const id = String(filmeId || "").trim();
    const tid = String(idtmdb || id || "").trim();
    const t = Number(temporada) || 0;
    const e = Number(episodio) || 0;
    const serie = String(serieSlug || "").trim();

    const isEpItem = (i) => {
      const tipo = String(i.tipo || "").toLowerCase();
      return (
        tipo.includes("epis") ||
        String(i.serieSlug || "").trim() !== "" ||
        Number(i.temporada || 0) > 0 ||
        Number(i.episodio || 0) > 0 ||
        /^serie-/i.test(String(i.slug || ""))
      );
    };

    let hit = null;

    // 1) match exato categoria + slug (melhor para ep e filme)
    if (cat && s) {
      hit = list.find(
        (i) =>
          String(i.categoria || "").toLowerCase() === cat &&
          String(i.slug || "") === s,
      );
    }

    // 2) slug sozinho
    if (!hit && s) {
      hit = list.find((i) => String(i.slug || "") === s);
    }

    // 3) série: temporada + episódio + (serieSlug | id)
    if (!hit && t > 0 && e > 0) {
      hit = list.find((i) => {
        if (!isEpItem(i)) return false;
        if (Number(i.temporada || 0) !== t || Number(i.episodio || 0) !== e) return false;
        if (serie && String(i.serieSlug || "") === serie) return true;
        if (tid && String(i.filmeId || "").includes(tid)) return true;
        if (tid && String(i.slug || "").includes(`serie-${tid}-${t}-${e}`)) return true;
        if (tid && String(i.slug || "").includes(`${tid}-${t}-${e}`)) return true;
        return !tid && !serie;
      });
    }

    // 4) filme (NÃO episódio): filmeId / filme-{tid}
    if (!hit && (id || tid)) {
      const key = id || tid;
      hit = list.find((i) => {
        if (isEpItem(i)) return false;
        if (String(i.filmeId || "") === key) return true;
        const islug = String(i.slug || "");
        if (islug === `filme-${key}` || islug.startsWith(`filme-${key}`)) return true;
        return false;
      });
    }

    if (!hit) return empty;
    const percent = percentFromItem(hit);
    return {
      percent,
      positionMs: Number(hit.positionMs || 0),
      durationMs: Number(hit.durationMs || 0),
      item: hit,
    };
  } catch (_) {
    return empty;
  }
}

/** Progresso de todos os eps de uma série (chave "s-e" → percent). Local, síncrono. */
export function mapaProgressoSerie({ categoria = "", serieId = "", serieSlug = "" } = {}) {
  const map = {};
  try {
    const list = getContinueList();
    const cat = String(categoria || "").toLowerCase();
    const sid = String(serieId || "").trim();
    const ss = String(serieSlug || "").trim();
    for (const i of list) {
      const islug = String(i.slug || "");
      const tipo = String(i.tipo || "").toLowerCase();
      const isEp =
        tipo.includes("epis") ||
        String(i.serieSlug || "") ||
        Number(i.temporada || 0) > 0 ||
        /^serie-/i.test(islug);
      if (!isEp) continue;
      if (cat && String(i.categoria || "").toLowerCase() !== cat) {
        // ainda aceita se slug bater
        if (!(sid && islug.includes(`serie-${sid}-`))) continue;
      }
      let t = Number(i.temporada || 0);
      let e = Number(i.episodio || 0);
      if ((!t || !e) && islug) {
        const m = islug.match(/serie-\d+-(\d+)-(\d+)/i) || islug.match(/-(\d+)-(\d+)$/);
        if (m) {
          t = Number(m[1]);
          e = Number(m[2]);
        }
      }
      if (sid && !(islug.includes(sid) || String(i.filmeId || "").includes(sid) || String(i.serieSlug || "").includes(sid))) {
        if (ss && String(i.serieSlug || "") !== ss) continue;
        if (!ss) continue;
      }
      if (t > 0 && e > 0) {
        const p = percentFromItem(i);
        if (p > 0) map[`${t}-${e}`] = p;
      }
    }
  } catch (_) {}
  return map;
}

/** Atalho: só o número 0–99. */
export function lerPercentual(opts) {
  return lerProgresso(opts).percent;
}

/**
 * Mapa de progresso para listas (favoritos, cards).
 * Chaves: "cat:slug", filmeId, slug, titulo (lowercase).
 */
export function mapaProgresso() {
  const map = {};
  try {
    getContinueList().forEach((item) => {
      const percent = percentFromItem(item);
      if (percent <= 0) return;
      const keys = [
        `${item.categoria || ""}:${item.slug || item.filmeId || ""}`.toLowerCase(),
        String(item.filmeId || "").toLowerCase(),
        String(item.slug || "").toLowerCase(),
        String(item.titulo || "").trim().toLowerCase(),
      ];
      keys.forEach((k) => {
        if (k && k !== ":" && !map[k]) map[k] = percent;
      });
    });
  } catch (_) {}
  return map;
}

/** Lista de favoritos (array). */
export function getFavoritosList() {
  try {
    const resposta = JSON.parse(window.AndroidPlayer?.getFavorites?.() || "{}");
    const lista = resposta.favoritos || resposta.favorites || [];
    return Array.isArray(lista) ? lista : [];
  } catch (_) {
    return [];
  }
}

/** true se o item está nos favoritos. */
export function lerFavorito(filmeId, slug = "", categoria = "") {
  try {
    const lista = getFavoritosList();
    const id = String(filmeId || "").trim();
    const s = String(slug || "").trim().toLowerCase();
    const c = String(categoria || "").trim().toLowerCase();
    return lista.some((item) => {
      const iid = String(item.filmeId || item.contentId || item.id || "").trim();
      const is = String(item.slug || "").trim().toLowerCase();
      const ic = String(item.categoria || "").trim().toLowerCase();
      if (id && iid && id === iid) return true;
      if (s && is && s === is && (!c || !ic || c === ic)) return true;
      return false;
    });
  } catch (_) {
    return false;
  }
}

/**
 * Toggle favorito via bridge nativa.
 * @returns {{ success: boolean, favorito?: boolean, error?: string }}
 */
function normalizarArgumentosFavorito(input, titulo, thumb, tipo = "filme") {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      filmeId: input.filmeId || input.contentId || input.id || input.slug || "",
      slug: input.slug || "",
      categoria: input.categoria || input.category || "",
      titulo: input.titulo || input.title || "",
      thumb: input.thumb || input.imagem || input.poster || "",
      tipo: input.tipo || input.contentType || "filme",
    };
  }
  return {
    filmeId: input || "",
    slug: "",
    categoria: "",
    titulo: titulo || "",
    thumb: thumb || "",
    tipo: tipo || "filme",
  };
}

export function toggleFavorito(input, titulo, thumb, tipo = "filme") {
  const item = normalizarArgumentosFavorito(input, titulo, thumb, tipo);
  try {
    if (!window.AndroidPlayer?.toggleFavorite) {
      return { success: false, error: "Favoritos indisponíveis" };
    }
    return JSON.parse(
      window.AndroidPlayer.toggleFavorite(
        String(item.filmeId || ""),
        String(item.titulo || ""),
        String(item.thumb || ""),
        String(item.tipo || "filme"),
      ) || "{}",
    );
  } catch (e) {
    return { success: false, error: e.message || "Erro ao salvar" };
  }
}

/** Solicita confirmação visual antes de remover um conteúdo já favoritado. */
export async function toggleFavoritoComConfirmacao(input, titulo, thumb, tipo = "filme") {
  const item = normalizarArgumentosFavorito(input, titulo, thumb, tipo);
  const jaFavorito = lerFavorito(item.filmeId, item.slug, item.categoria);
  if (jaFavorito) {
    const confirmado = await confirmFavoriteRemoval(item.titulo);
    if (!confirmado) return { success: true, favorito: true, cancelled: true };
  }
  return toggleFavorito(item);
}
