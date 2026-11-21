/* Pesquisa unificada: um único endpoint no TEDFLIX Content Server. */
import { errorDialog } from "../ui/dialogs.js";
import { el, debounce, limpar } from "../dom.js";
import { buscarUnificada } from "../server-api.js";
import { cardTitulo, skeletonCard } from "../components/card.js";

/**
 * Histórico de busca otimizado:
 * - UI sempre local (instantâneo)
 * - API só salva o termo FINAL (quando a digitação para por ~1.2s)
 * - Não grava prefixos intermediários (Ori, Orige…) se o termo final os cobre
 * - save na API é fire-and-forget (bridge assíncrono no Android)
 */

function bridge(nome, ...args) {
  try {
    const b = window.AndroidPlayer;
    if (!b || typeof b[nome] !== "function") return null;
    const raw = b[nome](...args);
    if (typeof raw === "object") return raw;
    return JSON.parse(raw || "null");
  } catch (_) {
    return null;
  }
}

function chaveHistoricoLocal() {
  try {
    const dados = JSON.parse(window.AndroidPlayer?.getProfiles?.() || "{}");
    return `tedflix:search-history:${dados.activeId || "guest"}`;
  } catch (_) {
    return "tedflix:search-history:guest";
  }
}

function lerLocal(chave = null) {
  try {
    const key = chave || chaveHistoricoLocal();
    const itens = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(itens)
      ? itens
          .map((x) =>
            typeof x === "string"
              ? { id: encodeURIComponent(x.toLowerCase()), query: x }
              : {
                  id: String(x.id || encodeURIComponent(String(x.query || "").toLowerCase())),
                  query: String(x.query || ""),
                },
          )
          .filter((x) => x.query && x.query.length >= 2)
          .slice(0, 20)
      : [];
  } catch (_) {
    return [];
  }
}

function salvarLocal(lista, chave = null) {
  try {
    const key = chave || chaveHistoricoLocal();
    localStorage.setItem(key, JSON.stringify(lista.slice(0, 20)));
  } catch (_) {}
}

/** Remove prefixos do mesmo termo (Ori + Orige quando grava Origem). */
function dedupePrefixos(lista, termoFinal) {
  const t = termoFinal.toLowerCase();
  return lista.filter((item) => {
    const q = item.query.toLowerCase();
    if (q === t) return true;
    // remove se for prefixo próprio do termo final
    if (t.startsWith(q) && q.length < t.length) return false;
    return true;
  });
}

let historicoCache = null;

function normalizarHistorico(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map((x) => ({
      id: String(x?.id || encodeURIComponent(String(x?.query || "").toLowerCase())),
      query: String(x?.query || "").trim(),
    }))
    .filter((x) => x.query && x.query.length >= 2)
    .slice(0, 20);
}

/** Só grava termo "final" — chamado com debounce longo. */
function gravarTermoFinal(valor, chaveLocal) {
  const termo = String(valor || "").trim();
  if (termo.length < 2) return;

  let atuais = dedupePrefixos(lerLocal(chaveLocal), termo);
  atuais = atuais.filter((item) => item.query.toLowerCase() !== termo.toLowerCase());
  const novo = [{ id: encodeURIComponent(termo.toLowerCase()), query: termo }, ...atuais].slice(0, 20);
  salvarLocal(novo, chaveLocal);
  historicoCache = novo;

  // API em background (bridge já é Thread no Android)
  try {
    bridge("saveSearchHistory", termo);
  } catch (_) {}
}

async function apagarUma(item, chaveLocal) {
  const id = item?.id || encodeURIComponent(String(item?.query || "").toLowerCase());
  const query = String(item?.query || "");
  const resto = lerLocal(chaveLocal).filter(
    (x) => x.id !== id && x.query.toLowerCase() !== query.toLowerCase(),
  );
  salvarLocal(resto, chaveLocal);
  historicoCache = resto;
  try {
    bridge("deleteSearchHistoryItem", id);
  } catch (_) {}
}

export default function paginaBusca(raiz) {
  const page = el("div", { class: "page page-busca" });
  // Resolve o perfil apenas uma vez nesta instância da tela; evita chamadas repetidas à ponte.
  const historicoKey = chaveHistoricoLocal();
  let historicoLocalAlterado = false;

  // Banner cinematográfico (recurso local exclusivo da busca)
  const hero = el("div", { class: "busca-hero", "aria-hidden": "true" }, [
    el("img", {
      class: "busca-hero-img",
      src: "assets/banners/busca-anime.jpg",
      alt: "",
      decoding: "async",
    }),
    el("div", { class: "busca-hero-fade" }),
  ]);

  const campo = el("input", {
    class: "input busca-input",
    type: "search",
    placeholder: "Buscar filmes, séries e animes...",
    "aria-label": "Buscar",
  });
  const clearBtn = el("button", {
    type: "button",
    class: "busca-clear",
    "aria-label": "Limpar",
    hidden: true,
    html: "×",
  });
  clearBtn.addEventListener("click", () => {
    campo.value = "";
    clearBtn.hidden = true;
    campo.focus();
    limpar(grid);
    aviso.textContent = "Digite para buscar.";
    recentes.hidden = false;
  });

  const searchBox = el("div", { class: "busca-field" }, [campo, clearBtn]);

  const grid = el("div", { class: "grid busca-grid" });
  const aviso = el("p", { class: "sub busca-aviso" }, "Digite para buscar.");
  const recentes = el("div", { class: "pad search-recent" });
  const resultadosHead = el("div", { class: "busca-results-head pad", hidden: true });

  // Sem título "BUSCA" — só banner + campo (mais limpo e abre mais leve)
  page.append(
    hero,
    el("div", { class: "busca-content" }, [
      searchBox,
      aviso,
      recentes,
      resultadosHead,
      grid,
    ]),
  );
  raiz.append(page);
  // Foco no próximo frame (não atrasa a pintura)
  try {
    requestAnimationFrame(() => {
      try { campo.focus({ preventScroll: true }); } catch (_) { try { campo.focus(); } catch (_) {} }
    });
  } catch (_) {}

  function renderRecentesFrom(itens) {
    recentes.innerHTML = "";
    recentes.hidden = false;
    if (!itens || !itens.length) return;

    const head = el("div", { class: "search-recent-head" }, [
      el("p", { class: "search-recent-label" }, "Pesquisas recentes"),
      el(
        "a",
        { class: "search-recent-all", href: "#/config?secao=historico-busca" },
        "Ver todas ›",
      ),
    ]);
    recentes.append(head);

    const lista = el("div", { class: "search-recent-list" });
    itens.slice(0, 3).forEach((item) => {
      const row = el("div", { class: "search-recent-row" });
      const botao = el("button", {
        class: "search-recent-term",
        type: "button",
      }, [
        el("span", {
          class: "search-recent-ico",
          "aria-hidden": "true",
          html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        }),
        el("span", { class: "search-recent-text" }, item.query),
      ]);
      botao.addEventListener("click", () => {
        campo.value = item.query;
        clearBtn.hidden = false;
        historicoLocalAlterado = true;
        gravarTermoFinal(item.query, historicoKey);
        buscarAgora(item.query);
      });
      const del = el(
        "button",
        {
          class: "search-recent-del",
          type: "button",
          "aria-label": `Apagar ${item.query}`,
          title: "Apagar",
        },
        "×",
      );
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        historicoLocalAlterado = true;
        await apagarUma(item, historicoKey);
        renderRecentesFrom(historicoCache || lerLocal(historicoKey));
      });
      row.append(botao, del);
      lista.append(row);
    });
    recentes.append(lista);
  }

  // O histórico local é renderizado imediatamente. A rede é solicitada por uma ponte
  // assíncrona nativa e só atualiza esta tela quando a resposta realmente chegar.
  historicoCache = lerLocal(historicoKey);
  renderRecentesFrom(historicoCache);

  const aoReceberHistoricoRemoto = (payload) => {
    if (!page.isConnected) return;
    let resposta = payload;
    try {
      if (typeof resposta === "string") resposta = JSON.parse(resposta || "null");
    } catch (_) {
      return;
    }
    if (!resposta || resposta.success !== true || !Array.isArray(resposta.history)) return;
    const remoto = normalizarHistorico(resposta.history);
    // Não apaga histórico local se o servidor responder vazio ou sem itens válidos.
    if (remoto.length && !historicoLocalAlterado) {
      salvarLocal(remoto, historicoKey);
      historicoCache = remoto;
    }
    renderRecentesFrom(historicoCache || lerLocal(historicoKey));
  };

  window.__tedflixSearchHistoryReady = aoReceberHistoricoRemoto;
  try {
    const android = window.AndroidPlayer;
    if (android && typeof android.requestSearchHistoryAsync === "function") {
      android.requestSearchHistoryAsync();
    }
  } catch (_) {
    // Histórico local continua disponível mesmo sem a ponte nativa.
  }

  const salvarHistoricoFinal = debounce((q) => {
    historicoLocalAlterado = true;
    gravarTermoFinal(q, historicoKey);
    renderRecentesFrom(historicoCache || lerLocal(historicoKey));
  }, 1200);

  let buscaSeq = 0;
  const buscarAgora = debounce(async (q) => {
    const termo = String(q || "").trim();
    clearBtn.hidden = termo.length === 0;
    if (termo.length < 2) {
      limpar(grid);
      resultadosHead.hidden = true;
      recentes.hidden = false;
      aviso.textContent = "Digite ao menos 2 letras.";
      aviso.hidden = false;
      return;
    }
    aviso.hidden = true;
    recentes.hidden = true;
    limpar(grid);
    resultadosHead.hidden = false;
    resultadosHead.innerHTML = "";
    resultadosHead.append(
      el("p", { class: "busca-results-title" }, `Resultados para “${termo}”`),
    );
    for (let i = 0; i < 6; i++) grid.append(skeletonCard());
    const seq = ++buscaSeq;
    try {
      // Consulta somente o endpoint unificado de pesquisa do servidor de conteúdo.
      const resposta = await Promise.race([
        buscarUnificada(termo, 1, 40),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 17000)),
      ]);
      if (seq !== buscaSeq) return;
      const lista = Array.isArray(resposta?.resultados) ? resposta.resultados : [];
      limpar(grid);
      if (!lista.length) {
        aviso.hidden = false;
        aviso.textContent = resposta?.todasIndisponiveis
          ? "As fontes de pesquisa estão indisponíveis no momento. Tente novamente."
          : "Nenhum resultado encontrado.";
        resultadosHead.hidden = true;
        return;
      }
      if (resposta?.parcial) {
        const indisponiveis = Object.entries(resposta.fontes || {})
          .filter(([, status]) => !status.ok)
          .map(([nome]) => nome);
        aviso.hidden = false;
        aviso.textContent = `Resultados combinados. Fonte(s) indisponível(is): ${indisponiveis.join(", ")}.`;
      }
      const filmes = lista.filter((x) => /filme|movie/i.test(String(x.tipo || x.categoria || ""))).length;
      const series = lista.filter((x) => /serie|séri|tv/i.test(String(x.tipo || x.categoria || ""))).length;
      const animes = lista.filter((x) => /anime/i.test(String(x.tipo || x.categoria || ""))).length;
      resultadosHead.innerHTML = "";
      resultadosHead.append(
        el("div", { class: "busca-results-meta" }, [
          el("p", { class: "busca-results-title" }, `Resultados para “${termo}”`),
          el("span", { class: "sub" }, `${lista.length} resultados`),
        ]),
      );
      const frag = document.createDocumentFragment();
      lista.forEach((r) => frag.append(cardTitulo(r, { size: "md" })));
      grid.append(frag);
    } catch (e) {
      if (seq !== buscaSeq) return;
      limpar(grid);
      aviso.hidden = false;
      errorDialog(e?.message || "Falha na busca. Tente novamente.", { title: "Pesquisa indisponível" });
      aviso.textContent = "Falha na busca. Tente novamente.";
      resultadosHead.hidden = true;
    }
  }, 220);

  campo.addEventListener("input", () => {
    const v = campo.value;
    clearBtn.hidden = !String(v || "").trim();
    buscarAgora(v);
    if (String(v || "").trim().length >= 2) salvarHistoricoFinal(v);
  });

  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = campo.value;
      historicoLocalAlterado = true;
      gravarTermoFinal(v, historicoKey);
      renderRecentesFrom(historicoCache || lerLocal(historicoKey));
      buscarAgora(v);
    }
  });

  return page;
}
