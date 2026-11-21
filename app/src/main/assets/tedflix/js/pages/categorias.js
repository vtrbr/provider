import { el } from "../dom.js";
import { CATEGORIAS } from "../config.js";
import { getCategoriasServidor } from "../server-api.js";

// Mantém o contrato importado pelo roteador principal.
export const GENEROS_UNIFICADOS = CATEGORIAS.map((categoria) => ({
  slug: categoria.slug,
  label: categoria.label,
}));

/** Gêneros com ícone e cor — visual tipo chips do app de referência. */
const GENRE_META = {
  acao: { ico: "⚡", tom: "#c0392b" },
  animacao: { ico: "✨", tom: "#8e44ad" },
  aventura: { ico: "🧭", tom: "#d35400" },
  comedia: { ico: "😄", tom: "#f39c12" },
  crime: { ico: "🔒", tom: "#2c3e50" },
  documentario: { ico: "🎬", tom: "#16a085" },
  drama: { ico: "🎭", tom: "#2980b9" },
  familia: { ico: "👨‍👩‍👧‍👦", tom: "#27ae60" },
  fantasia: { ico: "🪄", tom: "#9b59b6" },
  faroeste: { ico: "🤠", tom: "#a04000" },
  "ficcao-cientifica": { ico: "🚀", tom: "#1abc9c" },
  guerra: { ico: "🪖", tom: "#7f8c8d" },
  historia: { ico: "📜", tom: "#b7950b" },
  kids: { ico: "🧸", tom: "#e67e22" },
  misterio: { ico: "🕵️", tom: "#34495e" },
  musica: { ico: "🎵", tom: "#e91e63" },
  nacionais: { ico: "🇧🇷", tom: "#229954" },
  policial: { ico: "🚓", tom: "#1a5276" },
  reality: { ico: "📺", tom: "#6c3483" },
  romance: { ico: "💖", tom: "#c2185b" },
  suspense: { ico: "👁️", tom: "#4a235a" },
  terror: { ico: "👻", tom: "#922b21" },
};

function metaFor(slug, label) {
  const key = String(slug || "").toLowerCase();
  if (GENRE_META[key]) return GENRE_META[key];
  const l = String(label || "").toLowerCase();
  if (/ação|acao/.test(l)) return GENRE_META.acao;
  if (/aventura/.test(l)) return GENRE_META.aventura;
  if (/com[eé]dia/.test(l)) return GENRE_META.comedia;
  if (/drama/.test(l)) return GENRE_META.drama;
  if (/terror|horror/.test(l)) return GENRE_META.terror;
  if (/suspense/.test(l)) return GENRE_META.suspense;
  if (/crime/.test(l)) return GENRE_META.crime;
  if (/romance/.test(l)) return GENRE_META.romance;
  if (/anima/.test(l)) return GENRE_META.animacao;
  return { ico: "🎞️", tom: "#444" };
}

export default async function paginaCategorias(raiz) {
  const page = el("div", { class: "page page-categorias" });
  page.append(
    el("div", { class: "cat-hero" }, [
      el("div", { class: "cat-hero-icon" }, "▣"),
      el("div", {}, [
        el("h1", {}, "Categorias"),
        el("p", {}, "Explore filmes e séries por gênero"),
      ]),
    ])
  );

  const section = el("div", { class: "cat-section" });
  section.append(
    el("div", { class: "cat-section-head" }, [
      el("h2", {}, "Gêneros"),
      el("span", { class: "cat-section-tag" }, "Filmes e séries"),
    ])
  );

  const chips = el("div", { class: "cat-chips" });
  section.append(chips);
  page.append(section);
  raiz.append(page);

  let list = [];
  try {
    list = await getCategoriasServidor();
  } catch (_) {
    list = [];
  }
  if (!Array.isArray(list) || !list.length) {
    list = CATEGORIAS.map((c) => ({ slug: c.slug, label: c.label, id: c.slug }));
  }

  const seen = new Set();
  for (const category of list) {
    const slug = String(category.slug || category.id || "").trim();
    if (!slug || seen.has(slug.toLowerCase())) continue;
    seen.add(slug.toLowerCase());
    const label = category.label || category.name || slug;
    const meta = metaFor(slug, label);
    const a = el("a", {
      class: "cat-chip",
      href: `#/categoria/${encodeURIComponent(slug)}`,
      style: `--chip-color:${meta.tom}`,
    });
    a.append(
      el("span", { class: "cat-chip-ico", "aria-hidden": "true" }, meta.ico),
      el("span", { class: "cat-chip-label" }, label)
    );
    chips.append(a);
  }

  if (!chips.childNodes.length) {
    chips.append(el("p", { class: "sub" }, "Nenhuma categoria disponível no momento."));
  }

  return page;
}
