import { el, anoCurto } from "../dom.js";
import { poster } from "../img.js";
import { rotaDetalhe } from "../server-api.js";

const ESTRELA =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9L12 2.5z"/></svg>';

/**
 * Carrega capa com resiliência em rede fraca:
 * - começa no menor tamanho útil
 * - se falhar, tenta tamanho ainda menor / URL crua (não sobe de qualidade)
 * - loading eager nos primeiros cards visíveis
 */
function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return "https:" + s;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return s;
}

/** Variantes menores para imagens de origem que aceitam parâmetros /resize/. */
function variantesResize(raw) {
  if (!raw || !raw.includes("/resize/")) return [];
  try {
    const out = [];
    for (const [w, h] of [
      [120, 180],
      [154, 231],
      [185, 278],
      [100, 150],
    ]) {
      const u = new URL(raw);
      u.searchParams.set("w", String(w));
      u.searchParams.set("h", String(h));
      out.push(u.toString());
    }
    out.push(raw.split("?")[0]);
    return out;
  } catch (_) {
    return [];
  }
}

function montarCapa(item, size, eager) {
  const raw = absUrl(item.imagem || item.capa || item.thumb || item.poster || item.banner || "");
  if (!raw) return null;

  // Rede fraca/desconhecida: começa em xs; boa: size pedido
  const inicial = poster(raw, size || "sm") || poster(raw, "xs", { respeitarRede: false }) || raw;
  const img = el("img", {
    src: inicial,
    alt: item.titulo || "",
    width: "342",
    height: "513",
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    fetchpriority: eager ? "high" : "auto",
  });

  const pronto = () => img.classList.add("on");
  img.addEventListener("load", pronto, { once: true });

  const filaRetry = [
    poster(raw, "xs", { respeitarRede: false }),
    poster(raw, "sm", { respeitarRede: false }),
    ...variantesResize(raw),
    raw.includes("image.tmdb.org") ? raw.replace(/\/t\/p\/(w\d+|original)\//, "/t/p/w154/") : null,
    raw.includes("image.tmdb.org") ? raw.replace(/\/t\/p\/(w\d+|original)\//, "/t/p/w185/") : null,
    raw.includes("image.tmdb.org") ? raw : null,
    raw,
  ].filter(Boolean);

  let idx = 0;
  img.addEventListener("error", () => {
    while (idx < filaRetry.length) {
      const next = filaRetry[idx++];
      if (next && next !== img.getAttribute("src")) {
        img.src = next;
        return;
      }
    }
    // As capas e metadados são responsabilidade dos serviços de origem.
    pronto();
  });

  if (img.complete && img.naturalWidth > 0) pronto();

  // WebView: lazy em rail horizontal às vezes não dispara — força ao entrar na tela
  if (!eager && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!img.classList.contains("on") && img.dataset.retry !== "1") {
            img.dataset.retry = "1";
            const s = img.getAttribute("src");
            if (s) {
              img.removeAttribute("src");
              img.src = s;
            }
          }
          io.disconnect();
        }
      },
      { rootMargin: "200px", threshold: 0.01 },
    );
    requestAnimationFrame(() => {
      try {
        io.observe(img);
      } catch (_) {}
    });
  }

  return img;
}

export function cardTitulo(item, { size = "sm", eager = false } = {}) {
  const _n = Number(item.nota ?? item.nota_tmdb ?? item.rating); const nota = _n > 0 ? _n.toFixed(1) : null;
  const thumb = el("div", { class: "thumb" });
  const img = montarCapa(item, size, eager);
  if (img) {
    thumb.append(img);
    // Se a imagem falhar de vez, mostra placeholder de play
    img.addEventListener("error", () => {
      if (thumb.querySelector(".thumb-placeholder")) return;
      // só após esgotar retries do montarCapa — o último error ainda dispara
      setTimeout(() => {
        if (!img.classList.contains("on") && img.naturalWidth === 0) {
          img.remove();
          if (!thumb.querySelector(".thumb-placeholder")) {
            thumb.prepend(el("div", { class: "thumb-placeholder", "aria-hidden": "true" }));
          }
        }
      }, 50);
    }, { once: false });
  } else {
    thumb.append(el("div", { class: "thumb-placeholder", "aria-hidden": "true" }));
  }

  if (nota) thumb.append(el("span", { class: "badge", html: `${ESTRELA}${nota}` }));
  if (item.badgeExtra) {
    const extra = String(item.badgeExtra);
    const isAudio = /DUB|LEG/i.test(extra);
    const isEp = !isAudio && (/^S?\d/i.test(extra) || item.isEpisode);
    const cls = isAudio ? "badge badge-audio" : isEp ? "badge badge-ep" : "badge badge-trailer";
    thumb.append(el("span", { class: cls }, extra));
  }
  if (Number.isFinite(Number(item.progresso)) && Number(item.progresso) > 0) {
    const percentual = Math.max(0, Math.min(100, Number(item.progresso)));
    thumb.append(
      el(
        "span",
        {
          class: "progress-track",
          role: "progressbar",
          "aria-valuenow": String(percentual),
          "aria-valuemin": "0",
          "aria-valuemax": "100",
        },
        [el("span", { class: "progress-value", style: `width:${percentual}%` })],
      ),
    );
  }

  const link = el("a", { class: "card", href: rotaDetalhe(item), "aria-label": item.titulo }, [
    thumb,
    el("p", { class: "nome" }, item.titulo || ""),
    el(
      "p",
      { class: "meta" },
      item.continuarTexto || [anoCurto(item.ano), item.tipo].filter(Boolean).join(" · "),
    ),
  ]);
  link.addEventListener("click", () => {
    try {
      sessionStorage.setItem(
        "tedflix:lastCard",
        JSON.stringify({
          api: item.api || item.categoria || item.fonte || "",
          sourceId: item.sourceId || item.slug || item.filmeId || "",
          sourceSlug: item.sourceSlug || item.slug || "",
          titulo: item.titulo || item.title || "",
          title: item.titulo || item.title || "",
          poster: item.poster || item.imagem || item.capa || "",
          imagem: item.imagem || item.poster || item.capa || "",
          capa: item.capa || item.poster || item.imagem || "",
          ano: item.ano || item.year || null,
          tipo: item.tipo || item.type || "",
          sinopse: item.sinopse || item.overview || "",
        }),
      );
    } catch (_) {}
  });
  return link;
}

/**
 * Card Top 10 — número grande atrás + pôster (estilo Netflix).
 * rank: 1..10
 */
export function cardTop10(item, rank = 1, { eager = false } = {}) {
  const pos = Number(item.rank || rank) || 1;
  const thumb = el("div", { class: "thumb top10-thumb" });
  const img = montarCapa(item, "md", eager);
  if (img) {
    thumb.append(img);
    img.addEventListener(
      "error",
      () => {
        setTimeout(() => {
          if (!img.classList.contains("on") && img.naturalWidth === 0) {
            img.remove();
            if (!thumb.querySelector(".thumb-placeholder")) {
              thumb.prepend(el("div", { class: "thumb-placeholder", "aria-hidden": "true" }));
            }
          }
        }, 50);
      },
      { once: false },
    );
  } else {
    thumb.append(el("div", { class: "thumb-placeholder", "aria-hidden": "true" }));
  }

  const wrap = el("a", {
    class: "card card--top10",
    href: rotaDetalhe(item),
    "aria-label": `${pos}. ${item.titulo || ""}`,
  }, [
    el("span", { class: "top10-rank", "aria-hidden": "true" }, String(pos)),
    thumb,
  ]);
  return wrap;
}

export function skeletonCard() {
  return el("div", {}, [el("div", { class: "skel skel-card" })]);
}
