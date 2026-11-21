import { el, limpar } from "../dom.js";
import { cardTitulo, skeletonCard } from "../components/card.js";
import {
  getTedtopPorAno,
  getTedtopPorLetra,
  getTedtopPorGenero,
  getTedtopTelao,
  getTedtopBilheteria,
} from "../api.js";

const ANOS = Array.from({ length: 12 }, (_, i) => String(2026 - i));
const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const GENEROS_TEDTOP = [
  { slug: "acao", label: "Ação" },
  { slug: "aventura", label: "Aventura" },
  { slug: "comedia", label: "Comédia" },
  { slug: "drama", label: "Drama" },
  { slug: "terror", label: "Terror" },
  { slug: "romance", label: "Romance" },
  { slug: "ficcao", label: "Ficção" },
  { slug: "suspense", label: "Suspense" },
  { slug: "animacao", label: "Animação" },
  { slug: "documentario", label: "Documentário" },
];

function skeletonGrid(n = 8) {
  const g = el("div", { class: "grid pad" });
  for (let i = 0; i < n; i++) g.append(skeletonCard());
  return g;
}

function renderItens(grid, itens, append = false) {
  if (!append) limpar(grid);
  if (!Array.isArray(itens) || !itens.length) {
    if (!append || !grid.querySelector(".card")) {
      grid.append(el("p", { class: "sub pad" }, "Nenhum título encontrado."));
    }
    return;
  }
  const existentes = new Set(
    [...grid.querySelectorAll("[data-tedtop-slug]")].map((node) => node.dataset.tedtopSlug),
  );
  const frag = document.createDocumentFragment();
  itens.forEach((item, i) => {
    const slug = String(item.slug || "").trim();
    if (!slug || existentes.has(slug)) return;
    existentes.add(slug);
    const card = cardTitulo(item, { size: "sm", eager: !append && i < 8 });
    card.dataset.tedtopSlug = slug;
    frag.append(card);
  });
  grid.append(frag);
}

function criarBotaoMais(onClick) {
  return el("button", {
    class: "btn ghost tedtop-load-more",
    type: "button",
    style: "display:none;width:calc(100% - 32px);margin:16px",
    onclick: onClick,
  }, "Carregar mais");
}

function atualizarBotaoMais(botao, mostrar, ocupado = false) {
  botao.style.display = mostrar ? "block" : "none";
  botao.disabled = ocupado;
  botao.textContent = ocupado ? "Carregando…" : "Carregar mais";
}

/** Telão paginado — GET /telao?pagina=N */
export async function paginaTedtopTelao(raiz) {
  const page = el("div", { class: "page" });
  page.append(el("h1", { class: "page-title" }, "Em cartaz"));
  const grid = skeletonGrid();
  const mais = criarBotaoMais(() => carregar(true));
  page.append(grid, mais);
  raiz.append(page);
  let pagina = 1;
  let temMais = false;
  let ocupado = false;

  async function carregar(proxima = false) {
    if (ocupado || (proxima && !temMais)) return;
    ocupado = true;
    atualizarBotaoMais(mais, true, true);
    const alvo = proxima ? pagina : 1;
    if (!proxima) {
      limpar(grid);
      for (let i = 0; i < 8; i++) grid.append(skeletonCard());
    }
    try {
      const d = await getTedtopTelao(alvo);
      if (!page.isConnected) return;
      renderItens(grid, d.itens || [], proxima);
      pagina = (Number(d.pagina) || alvo) + 1;
      temMais = Boolean(d.temMais);
    } catch (_) {
      if (!proxima) {
        erroComRetry(grid, "Não foi possível carregar Em cartaz.", () => carregar(false));
        temMais = false;
      } else {
        mais.textContent = "Falha ao carregar. Tentar novamente";
        temMais = true;
      }
    } finally {
      ocupado = false;
      atualizarBotaoMais(mais, temMais, false);
    }
  }
  await carregar(false);
  return page;
}

/** Bilheteria — GET /bilheteria (carrossel de destaques na Home). */
export async function paginaTedtopBilheteria(raiz) {
  return paginaLista(raiz, "Bilheteria", async () => getTedtopBilheteria());
}

async function paginaLista(raiz, titulo, carregar) {
  const page = el("div", { class: "page" });
  page.append(el("h1", { class: "page-title" }, titulo));
  const grid = skeletonGrid();
  page.append(grid);
  raiz.append(page);
  try {
    renderItens(grid, (await carregar()) || []);
  } catch (_) {
    erroComRetry(grid, "Falha ao carregar.", async () => {
      limpar(grid);
      grid.append(...Array.from({ length: 6 }, () => skeletonCard()));
      try {
        renderItens(grid, (await carregar()) || []);
      } catch (_) {
        erroComRetry(grid, "Ainda sem dados.", () => location.reload());
      }
    });
  }
  return page;
}

/** Por ano — GET /sessao/ano/:ano?pagina=N */
export default function paginaTedtopPorAno(raiz, { ano: anoInicial } = {}) {
  const page = el("div", { class: "page" });
  page.append(el("h1", { class: "page-title" }, "Filmes por ano"));
  page.append(el("p", { class: "sub pad", style: "padding-top:0" }, "Catálogo TEDTOP · selecione um ano"));
  const chips = el("div", { class: "pad tedtop-chips tedtop-chips--wide" });
  const grid = skeletonGrid();
  let atual = String(anoInicial || ANOS[0]);
  let reqId = 0;
  let pagina = 1;
  let temMais = false;
  let ocupado = false;
  const mais = criarBotaoMais(() => carregar(atual, true));

  async function carregar(ano, proxima = false) {
    if (ocupado || (proxima && !temMais)) return;
    if (!proxima) {
      atual = String(ano);
      pagina = 1;
      temMais = false;
    }
    const my = proxima ? reqId : ++reqId;
    ocupado = true;
    [...chips.children].forEach((b) => b.classList.toggle("active", b.dataset.ano === atual));
    atualizarBotaoMais(mais, true, true);
    if (!proxima) {
      limpar(grid);
      for (let i = 0; i < 8; i++) grid.append(skeletonCard());
    }
    try {
      const alvo = proxima ? pagina : 1;
      const d = await getTedtopPorAno(atual, alvo);
      if (my !== reqId || !page.isConnected) return;
      renderItens(grid, d.itens || [], proxima);
      pagina = (Number(d.pagina) || alvo) + 1;
      temMais = Boolean(d.temMais);
    } catch (_) {
      if (my !== reqId) return;
      if (!proxima) {
        erroComRetry(grid, `Erro ao carregar ${atual}.`, () => carregar(atual));
        temMais = false;
      } else {
        mais.textContent = "Falha ao carregar. Tentar novamente";
        temMais = true;
      }
    } finally {
      if (my === reqId) {
        ocupado = false;
        atualizarBotaoMais(mais, temMais, false);
      }
    }
  }

  ANOS.forEach((ano) => {
    const btn = el("button", { class: `chip${ano === atual ? " active" : ""}`, type: "button", "data-ano": ano }, ano);
    btn.addEventListener("click", () => {
      location.hash = `#/tedtop/ano/${ano}`;
      carregar(ano);
    });
    chips.append(btn);
  });
  page.append(chips, grid, mais);
  raiz.append(page);
  carregar(atual);
  return page;
}

/** Por letra — GET /alfabeto/:letra?pagina=N */
export function paginaTedtopPorLetra(raiz, { letra: letraInicial } = {}) {
  const page = el("div", { class: "page" });
  page.append(el("h1", { class: "page-title" }, "Por letra"));
  page.append(el("p", { class: "sub pad", style: "padding-top:0" }, "Navegação alfabética TEDTOP"));
  const chips = el("div", { class: "pad tedtop-chips" });
  const grid = skeletonGrid();
  let atual = String(letraInicial || "A").toUpperCase().slice(0, 1);
  let reqId = 0;
  let pagina = 1;
  let temMais = false;
  let ocupado = false;
  const mais = criarBotaoMais(() => carregar(atual, true));

  async function carregar(letra, proxima = false) {
    if (ocupado || (proxima && !temMais)) return;
    if (!proxima) {
      atual = String(letra).toUpperCase().slice(0, 1);
      pagina = 1;
      temMais = false;
    }
    const my = proxima ? reqId : ++reqId;
    ocupado = true;
    [...chips.children].forEach((b) => b.classList.toggle("active", b.dataset.letra === atual));
    atualizarBotaoMais(mais, true, true);
    if (!proxima) {
      limpar(grid);
      for (let i = 0; i < 8; i++) grid.append(skeletonCard());
    }
    try {
      const alvo = proxima ? pagina : 1;
      const d = await getTedtopPorLetra(atual, alvo);
      if (my !== reqId || !page.isConnected) return;
      renderItens(grid, d.itens || [], proxima);
      pagina = (Number(d.pagina) || alvo) + 1;
      temMais = Boolean(d.temMais);
    } catch (_) {
      if (my !== reqId) return;
      if (!proxima) {
        erroComRetry(grid, `Erro na letra ${atual}.`, () => carregar(atual));
        temMais = false;
      } else {
        mais.textContent = "Falha ao carregar. Tentar novamente";
        temMais = true;
      }
    } finally {
      if (my === reqId) {
        ocupado = false;
        atualizarBotaoMais(mais, temMais, false);
      }
    }
  }

  LETRAS.forEach((L) => {
    const btn = el("button", { class: `chip${L === atual ? " active" : ""}`, type: "button", "data-letra": L }, L);
    btn.addEventListener("click", () => {
      location.hash = `#/tedtop/letra/${L}`;
      carregar(L);
    });
    chips.append(btn);
  });
  page.append(chips, grid, mais);
  raiz.append(page);
  carregar(atual);
  return page;
}

/** Por gênero TEDTOP */
export function paginaTedtopPorGenero(raiz, { genero: genInicial } = {}) {
  const page = el("div", { class: "page" });
  page.append(el("h1", { class: "page-title" }, "Gêneros TEDTOP"));
  const chips = el("div", { class: "pad tedtop-chips tedtop-chips--wide" });
  const grid = skeletonGrid();
  let atual = genInicial || GENEROS_TEDTOP[0].slug;
  let reqId = 0;

  async function carregar(g) {
    atual = g;
    const my = ++reqId;
    [...chips.children].forEach((b) => b.classList.toggle("active", b.dataset.g === atual));
    limpar(grid);
    for (let i = 0; i < 8; i++) grid.append(skeletonCard());
    try {
      const d = await getTedtopPorGenero(atual);
      if (my !== reqId) return;
      renderItens(grid, d.itens || []);
    } catch (e) {
      if (my !== reqId) return;
      erroComRetry(grid, "Erro ao carregar gênero.", () => carregar(atual));
    }
  }

  GENEROS_TEDTOP.forEach((g) => {
    const btn = el("button", {
      class: `chip${g.slug === atual ? " active" : ""}`,
      type: "button",
      "data-g": g.slug,
    }, g.label);
    btn.addEventListener("click", () => {
      location.hash = `#/tedtop/genero/${g.slug}`;
      carregar(g.slug);
    });
    chips.append(btn);
  });

  page.append(chips, grid);
  raiz.append(page);
  carregar(atual);
  return page;
}

/** Radar live */
export function paginaTedtopRadar(raiz) {
  const page = el("div", { class: "page" });
  page.append(el("h1", { class: "page-title" }, "Radar TEDTOP"));
  page.append(el("p", { class: "sub pad", style: "padding-top:0" }, "Pesquisa unificada nas três fontes oficiais do TEDFLIX."));
  // Busca manual: digita + lupa (ou Enter). Evita spam na API / anti-leechers.
  const campo = el("input", {
    class: "input",
    type: "search",
    placeholder: "Digite um termo…",
    enterkeyhint: "search",
    autocomplete: "off",
    style: "flex:1;min-width:0;margin:0",
  });
  const btnBuscar = el(
    "button",
    {
      class: "btn primary radar-search-btn",
      type: "submit",
      "aria-label": "Buscar",
      title: "Buscar",
      style: "flex:0 0 auto;min-width:48px;padding:10px 14px",
    },
    [
      el("span", {
        html: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
        style: "display:flex;align-items:center;justify-content:center",
      }),
    ],
  );
  const form = el(
    "form",
    {
      class: "radar-search-form",
      style: "display:flex;gap:8px;align-items:center;margin:0 16px;width:calc(100% - 32px)",
    },
    [campo, btnBuscar],
  );
  const aviso = el("p", { class: "sub pad" }, "Digite o termo e toque na lupa para buscar.");
  const grid = el("div", { class: "grid pad" });
  page.append(form, aviso, grid);
  raiz.append(page);

  let reqId = 0;
  let busy = false;

  async function buscar() {
    const q = String(campo.value || "").trim();
    if (q.length < 2) {
      aviso.textContent = "Digite ao menos 2 letras.";
      limpar(grid);
      return;
    }
    if (busy) return;
    busy = true;
    btnBuscar.disabled = true;
    const my = ++reqId;
    aviso.textContent = "Buscando…";
    limpar(grid);
    for (let i = 0; i < 4; i++) grid.append(skeletonCard());
    try {
      const d = await buscar(q);
      if (my !== reqId) return;
      limpar(grid);
      const itens = Array.isArray(d?.resultados) ? d.resultados : [];
      aviso.textContent = itens.length ? `${itens.length} resultado(s)` : "Nenhum resultado.";
      if (!itens.length) {
        grid.append(el("p", { class: "sub pad" }, "Nenhum título encontrado."));
        return;
      }
      const frag = document.createDocumentFragment();
      itens.forEach((item, i) => frag.append(cardTitulo(item, { size: "sm", eager: i < 6 })));
      grid.append(frag);
    } catch (e) {
      if (my !== reqId) return;
      aviso.textContent = "Falha na pesquisa. Verifique a conexão e tente de novo.";
      limpar(grid);
    } finally {
      busy = false;
      btnBuscar.disabled = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    buscar();
  });
  setTimeout(() => campo.focus(), 50);
  return page;
}
