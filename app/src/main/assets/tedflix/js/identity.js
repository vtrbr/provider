/**
 * Identidade estável de conteúdo — regra de ouro do cruzamento entre APIs.
 *
 * Prioriza: source + type + category + slug (+ episode quando existir).
 * NUNCA usar título ou índice de array como identificador.
 */

/**
 * @param {object} item
 * @returns {string} chave estável, ex: "content:filme:acao:filme-x" ou "tedtop:filme:o-fim-da-rua"
 */
export function getContentKey(item) {
  if (!item || typeof item !== "object") return "";

  const source = String(item.source || item.origem || "content").toLowerCase();
  const type = normalizarTipo(item.tipo || item.type || item.contentType || "filme");
  const category = String(item.categoria || item.category || "").trim().toLowerCase();
  const slug = String(item.slug || "").trim().toLowerCase();
  const episode =
    item.episodeId ||
    item.episodioId ||
    (item.serieSlug && item.numero != null ? `s${item.temporada || ""}e${item.numero}` : "") ||
    "";

  if (source === "tedtop" && slug) {
    return `tedtop:${type}:${slug}`;
  }

  if (category && slug) {
    const base = `content:${type}:${category}:${slug}`;
    return episode ? `${base}:${String(episode).toLowerCase()}` : base;
  }

  // Fallback: contentId / filmeId quando existir
  const id = String(item.contentId || item.filmeId || item.id || item._id || "").trim();
  if (id) return `id:${type}:${id}`;

  return "";
}

export function normalizarTipo(t) {
  const s = String(t || "").toLowerCase();
  if (s.includes("séri") || s.includes("serie") || s === "series") return "serie";
  if (s.includes("epis") || s === "episode") return "episodio";
  if (s.includes("anim")) return "filme";
  return "filme";
}

/**
 * Compara dois itens pelo identificador estável.
 */
export function mesmoConteudo(a, b) {
  const ka = getContentKey(a);
  const kb = getContentKey(b);
  if (ka && kb && ka === kb) return true;

  // Fallback por slug+categoria
  const sa = String(a?.slug || "").toLowerCase();
  const sb = String(b?.slug || "").toLowerCase();
  const ca = String(a?.categoria || "").toLowerCase();
  const cb = String(b?.categoria || "").toLowerCase();
  if (sa && sb && sa === sb && ca && cb && ca === cb) return true;

  return false;
}

/**
 * Mescla dados de CONTENT + USER + TEDTOP sem sobrescrever com valores vazios.
 * USER vence para favorite/progress/history.
 * CONTENT vence para dados de catálogo.
 * TEDTOP vence para trailer e recursos TEDTOP.
 */
export function mergeConteudo({ content, user, tedtop } = {}) {
  const base = { ...(content || {}) };
  if (tedtop) {
    if (tedtop.trailer) base.trailer = tedtop.trailer;
    if (tedtop.sinopse && !base.descricao && !base.sinopse) base.descricao = tedtop.sinopse;
    if (tedtop.nota != null && base.nota == null) base.nota = tedtop.nota;
    if (tedtop.imagem && !base.imagem) base.imagem = tedtop.imagem;
    base.tedtop = true;
  }
  if (user) {
    if (typeof user.favorite === "boolean") base.favorite = user.favorite;
    if (user.progress != null) base.progress = user.progress;
    if (user.positionSeconds != null) base.positionSeconds = user.positionSeconds;
    if (user.durationSeconds != null) base.durationSeconds = user.durationSeconds;
    if (user.history) base.history = user.history;
  }
  base.contentKey = getContentKey(base);
  return base;
}
