import { el, limpar, debounce } from "../dom.js";
import { gradeVirtual } from "../components/virtual-grid.js";

/**
 * Catálogo com filtro, grade virtual e botão "Carregar mais"
 * (paginação em todas as fontes do Content Server).
 *
 * carregar(page) deve aceitar número da página e devolver array de itens.
 * Se a função ignorar o argumento, só a página 1 é usada.
 */
export function paginaCatalogo(raiz, { titulo, carregar, placeholder = "Filtrar títulos..." }) {
  const page = el("div", { class: "page" });
  const area = el("div", { class: "pad", style: "margin-top:12px" });
  const busca = el("input", { class: "input", type: "search", placeholder, "aria-label": placeholder });
  const info = el("p", { class: "sub", style: "padding:10px 16px 0" }, "Carregando catálogo...");
  const moreWrap = el("div", {
    class: "catalog-load-more",
    style: "padding:20px 16px 32px;display:flex;justify-content:center;",
  });
  const moreBtn = el(
    "button",
    {
      class: "btn primary catalog-more-btn",
      type: "button",
      style:
        "min-width:220px;padding:14px 22px;border-radius:999px;font-weight:600;letter-spacing:.02em;",
    },
    "Carregar mais títulos",
  );
  moreWrap.append(moreBtn);

  page.append(
    el("h1", { class: "page-title" }, titulo),
    el("div", { class: "pad", style: "margin-top:8px" }, [busca]),
    info,
    area,
    moreWrap,
  );
  raiz.append(page);

  let todos = [];
  let grade = null;
  let pageNum = 1;
  let loading = false;
  let esgotado = false;

  function render(itens) {
    if (grade) {
      grade.destruir?.();
      limpar(area);
    }
    info.textContent = `${itens.length} título${itens.length === 1 ? "" : "s"}`;
    grade = gradeVirtual(itens);
    area.append(grade);
    moreBtn.style.display = esgotado ? "none" : "inline-flex";
    moreBtn.disabled = false;
    moreBtn.textContent = "Carregar mais títulos";
  }

  const filtrar = debounce((q) => {
    const t = q.trim().toLowerCase();
    if (t) {
      moreBtn.style.display = "none";
      const filtered = todos.filter((i) => (i.titulo || "").toLowerCase().includes(t));
      if (grade) {
        grade.destruir?.();
        limpar(area);
      }
      info.textContent = `${filtered.length} título${filtered.length === 1 ? "" : "s"}`;
      grade = gradeVirtual(filtered);
      area.append(grade);
    } else {
      render(todos);
    }
  }, 250);

  busca.addEventListener("input", () => filtrar(busca.value));

  async function carregarPagina(p, append) {
    if (loading) return;
    loading = true;
    if (append) {
      moreBtn.disabled = true;
      moreBtn.textContent = "Carregando…";
    }
    try {
      const itens = await carregar(p);
      const lista = Array.isArray(itens) ? itens : [];
      if (!lista.length) {
        esgotado = true;
        if (!append) {
          info.textContent = "Nenhum título encontrado.";
        } else {
          moreBtn.style.display = "none";
          info.textContent = `${todos.length} título${todos.length === 1 ? "" : "s"} · fim do catálogo`;
        }
        return;
      }
      if (append) {
        const seen = new Set(todos.map((x) => `${x.api}:${x.sourceId || x.slug || x.titulo}`));
        for (const item of lista) {
          const key = `${item.api}:${item.sourceId || item.slug || item.titulo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          todos.push(item);
        }
        // Se veio muito pouco conteúdo novo, considera esgotado
        if (lista.length < 8) esgotado = true;
      } else {
        todos = lista;
      }
      pageNum = p;
      if (!busca.value.trim()) render(todos);
      else filtrar(busca.value);
    } catch (_) {
      if (!append) info.textContent = "Não foi possível carregar o catálogo.";
      moreBtn.textContent = "Tentar novamente";
      moreBtn.disabled = false;
    } finally {
      loading = false;
    }
  }

  moreBtn.addEventListener("click", () => {
    if (esgotado || loading) return;
    carregarPagina(pageNum + 1, true);
  });

  carregarPagina(1, false);
  page.destruir = () => grade?.destruir?.();
  return page;
}
