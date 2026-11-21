import { el, limpar } from "../dom.js";
import { hero } from "../components/hero.js";
import { fileira } from "../components/row.js";
import { getCarousel, getUltimosFilmes, getLancamentos, getSeries, getFilmes, getGeneroUnificado, getCategoriasServidor, getBanner, getNovos, getCategoriaFixa, buscar, parseLink } from "../server-api.js";
// Enriquecimento complementar apenas de metadados/capas; o catálogo vem do servidor TEDFLIX.

let _homeContinuarCache = { t: 0, lista: null };
const HOME_CONTINUAR_TTL = 3 * 60 * 1000;

export default async function paginaInicio(raiz) {
  // Evita seções duplicadas se a home for montada duas vezes no mesmo root
  try { limpar(raiz); } catch (_) { try { raiz.innerHTML = ""; } catch (_) {} }
  const page = el("div", { class: "page home-netflix", "data-home-mounted": "1" });
  const topo = el("div", { class: "hero skel" });
  page.append(topo);
  raiz.append(page);

  const slotContinuar = el("div", { class: "home-continuar-slot" });
  page.append(slotContinuar);

  // Pluto TV banner vai ao final da home

  const inserirContinuar = (lista) => {
    if (!Array.isArray(lista) || !lista.length || !page.isConnected) return;
    limpar(slotContinuar);
    slotContinuar.append(fileira({ titulo: "Continuar assistindo", carregar: async () => lista, limite: 20, variante: "continuar" }));
  };
  if (_homeContinuarCache.lista && Date.now() - _homeContinuarCache.t < HOME_CONTINUAR_TTL) {
    inserirContinuar(_homeContinuarCache.lista);
  } else {
    carregarContinuarAssistindo().then((lista) => {
      if (Array.isArray(lista) && lista.length) {
        _homeContinuarCache = { t: Date.now(), lista };
        inserirContinuar(lista);
      }
    }).catch(() => {});
  }

  // Banner hero (MegaCine lançamentos)
  page.append(fileira({ titulo: "Destaques", carregar: getBanner, limite: 12 }));

  page.append(
    fileira({ titulo: "Lançamentos", verTudo: "#/lancamentos", carregar: getLancamentos, limite: 20 }),
    fileira({ titulo: "Novos", verTudo: "#/filmes", carregar: getNovos, limite: 20 }),
    fileira({ titulo: "Ação", verTudo: "#/categoria/acao", carregar: () => getCategoriaFixa("acao"), limite: 18 }),
    fileira({ titulo: "Animação", verTudo: "#/categoria/animacao", carregar: () => getCategoriaFixa("animacao"), limite: 18 }),
    fileira({ titulo: "Terror", verTudo: "#/categoria/terror", carregar: () => getCategoriaFixa("terror"), limite: 18 }),
  );

  // Pluto TV no final
  page.append(el("div", { class: "home-live-banners" }, [
    el("a", { class: "home-pluto-banner", href: "#/pluto", "aria-label": "Abrir Pluto TV ao vivo" }, [
      el("div", { class: "home-pluto-banner-text" }, [
        el("span", { class: "home-pluto-kicker" }, "TV ao vivo"),
        el("strong", {}, "Pluto TV"),
        el("span", {}, "Canais grátis · o que está passando agora"),
      ]),
      el("span", { class: "home-pluto-cta" }, "Assistir →"),
    ]),
  ]));


  // Categorias fixas já listadas acima

  try {
    const destaques = await getBanner().catch(() => getCarousel());
    const h = hero(destaques.length ? destaques : []);
    topo.replaceWith(h);
    page.destruir = () => h.destruir?.();
  } catch (_) {
    topo.classList.remove("skel");
    topo.append(el("div", { class: "center" }, "Não foi possível carregar os destaques."));
  }
  return page;
}

/** Executa tarefas de catálogo com concorrência limitada e mantém a ordem original. */
async function mapComLimite(lista, limite, callback) {
  const entrada = Array.isArray(lista) ? lista : [];
  const saida = new Array(entrada.length);
  let proximo = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limite), entrada.length) }, async () => {
    while (proximo < entrada.length) {
      const indice = proximo++;
      try {
        saida[indice] = await callback(entrada[indice], indice);
      } catch (_) {
        saida[indice] = null;
      }
    }
  });
  await Promise.all(workers);
  return saida;
}

/** Normaliza itens TEDTOP para o card (slug + imagem https + rota de detalhe). */
function normalizarTedtop(lista) {
  const itens = Array.isArray(lista) ? lista : [];
  return itens
    .map((item) => {
      const slug = String(item.slug || "").trim();
      let imagem = String(item.imagem || item.thumb || item.poster || "").trim();
      if (imagem.startsWith("//")) imagem = `https:${imagem}`;
      return {
        ...item,
        titulo: item.titulo || slug,
        slug,
        categoria,
        imagem,
        tipo: item.tipo || "Filme",
        ano: item.ano || "",
        // O slug TEDTOP abre sempre a ficha interna; nunca navegar ao scraper.
        tedtop_link_assistir: item.link_assistir || "",
        link_assistir: slug ? `#/titulo/filme/destaque/${encodeURIComponent(slug)}` : "#",
        link_detalhe: slug ? `#/titulo/filme/destaque/${encodeURIComponent(slug)}` : "#",
        categoria: "destaque",
        origem: "tedtop",
        fonte: "tedtop",
        api: "v6",
        badgeExtra: item.trailer || item.tem_trailer ? "Trailer" : null,
      };
    })
    .filter((i) => i.slug && i.titulo);
}

async function carregarContinuarAssistindo() {
  try {
    if (!window.AndroidPlayer?.getContinueWatching) return [];

    const CACHE_CAPAS = "tedflix:cw-covers:v2";
    const lerCapas = () => {
      try {
        return JSON.parse(localStorage.getItem(CACHE_CAPAS) || "{}") || {};
      } catch (_) {
        return {};
      }
    };
    const salvarCapas = (map) => {
      try {
        const keys = Object.keys(map);
        // limita a 80 capas
        const slim = {};
        keys.slice(0, 80).forEach((k) => {
          slim[k] = map[k];
        });
        localStorage.setItem(CACHE_CAPAS, JSON.stringify(slim));
      } catch (_) {}
    };
    const capas = lerCapas();
    const buscasEmVoo = new Map();
    const buscarUmaVez = (termo) => {
      const query = String(termo || "").trim();
      const chave = query.toLowerCase();
      if (query.length < 2) return Promise.resolve(null);
      if (buscasEmVoo.has(chave)) return buscasEmVoo.get(chave);
      const tarefa = buscar(query).catch(() => null);
      buscasEmVoo.set(chave, tarefa);
      return tarefa;
    };

    const calcProgresso = (item) => {
      const percent = Number(item.percent ?? item.progresso ?? 0);
      if (Number.isFinite(percent) && percent > 0) return Math.min(99, Math.round(percent));

      let pos = Number(item.positionMs ?? 0);
      let dur = Number(item.durationMs ?? 0);
      // fallback: segundos
      if ((!pos || !dur) && (item.positionSeconds || item.durationSeconds)) {
        pos = Number(item.positionSeconds || 0) * 1000;
        dur = Number(item.durationSeconds || 0) * 1000;
      }
      // fallback: tempo "H:MM:SS" ou "MM:SS" ou segundos puros
      if ((!pos || pos <= 0) && item.tempo) {
        const t = String(item.tempo).trim();
        if (/^\d+$/.test(t)) {
          pos = Number(t) * 1000;
        } else if (t.includes(":")) {
          const p = t.split(":").map((x) => Number(x) || 0);
          if (p.length === 3) pos = (p[0] * 3600 + p[1] * 60 + p[2]) * 1000;
          else if (p.length === 2) pos = (p[0] * 60 + p[1]) * 1000;
        }
      }
      if (pos > 0 && dur > 0) return Math.min(99, Math.max(1, Math.round((pos * 100) / dur)));
      // sem duração conhecida: mostra barra mínima se já assistiu algo
      if (pos >= 10_000) return 5;
      return 0;
    };

    const lerSnapshot = () => {
      try {
        const valor = JSON.parse(window.AndroidPlayer.getContinueWatching() || "[]");
        return Array.isArray(valor) ? valor : [];
      } catch (_) {
        return [];
      }
    };

    const localSnapshot = lerSnapshot();
    let itens = localSnapshot;
    if (window.AndroidPlayer.refreshContinueWatching) {
      await new Promise((resolve) => {
        let finalizado = false;
        let timer = 0;
        const concluir = () => {
          if (finalizado) return;
          finalizado = true;
          if (timer) clearTimeout(timer);
          window.__tedflixHistoryReady = null;
          resolve();
        };
        window.__tedflixHistoryReady = concluir;
        try {
          window.AndroidPlayer.refreshContinueWatching();
        } catch (_) {
          concluir();
        }
        // Havendo cache local, não faz a Home esperar várias consultas remotas de progresso.
        // Sem cache, concede uma janela maior para tentar recuperar o histórico da conta.
        timer = setTimeout(concluir, localSnapshot.length ? 900 : 3500);
      });
      const remotoMesclado = lerSnapshot();
      if (remotoMesclado.length) itens = remotoMesclado;
    }

    if (!itens.length) return [];

    const humanizarSlug = (s) =>
      String(s || "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();

    const extrairEpMeta = (item) => {
      let temporada = Number(item.temporada || 0) || 0;
      let episodio = Number(item.episodio || 0) || 0;
      const titulo = String(item.titulo || "");
      const slug = String(item.slug || "");
      const epLabelReady = String(item.epLabel || "").trim();

      const tryPatterns = (src) => {
        const patterns = [
          /s(\d{1,2})\s*e(\d{1,3})/i,
          /t(\d{1,2})\s*e(\d{1,3})/i,
          /(\d{1,2})[x×](\d{1,3})/,
        ];
        for (const p of patterns) {
          const m = src.match(p);
          if (m) return { t: Number(m[1]) || 0, e: Number(m[2]) || 0 };
        }
        return null;
      };

      if (!temporada || !episodio) {
        const hit = tryPatterns(titulo) || tryPatterns(slug);
        if (hit) {
          if (!temporada) temporada = hit.t;
          if (!episodio) episodio = hit.e;
        }
      }
      if (!episodio) {
        const m = titulo.match(/^(\d{1,3})\.\s+\S/);
        if (m) episodio = Number(m[1]) || 0;
      }

      let epLabel = epLabelReady;
      if (!epLabel) {
        if (temporada > 0 && episodio > 0) epLabel = `S${temporada}E${episodio}`;
        else if (episodio > 0) epLabel = `E${episodio}`;
      }

      const isEpisode =
        item.isEpisode === true ||
        /epis/i.test(String(item.tipo || "")) ||
        Boolean(item.serieSlug || item.serieCategoria) ||
        episodio > 0;

      // Nome limpo do episódio (sem "4. ")
      let epNome = titulo.replace(/^\d{1,3}\.\s+/, "").trim();
      // Título da série
      let serieTitulo =
        String(item.serieTitulo || "").trim() ||
        (item.serieSlug ? humanizarSlug(item.serieSlug) : "");

      return { temporada, episodio, epLabel, isEpisode, epNome, serieTitulo };
    };

    const itensElegiveis = itens
      .filter((item) => item && (item.categoria || item.slug || item.titulo || item.filmeId))
      .slice(0, 20);
    // Alguns registros antigos não têm rota/slug e precisam de busca de resolução.
    // Quatro workers evitam disparar até vinte pesquisas ao mesmo tempo.
    const montados = await mapComLimite(itensElegiveis, 4, async (item) => {
          let categoria = String(item.categoria || "").trim();
          let slug = String(item.slug || "").trim();
          let detalhe = null;
          const partesOriginais = parseLink(item.link_assistir || item.link_detalhe || "");
          categoria = categoria || partesOriginais.categoria;
          slug = slug || partesOriginais.slug;
          const cacheKey = `${categoria}:${slug || item.filmeId || item.titulo || ""}`.toLowerCase();
          const meta = extrairEpMeta(item);

          if ((!categoria || !slug) && (item.titulo || item.filmeId)) {
            try {
              const busca = await buscarUmaVez(item.titulo || item.filmeId);
              const resultados = Array.isArray(busca?.resultados) ? busca.resultados : [];
              const tituloBusca = String(item.titulo || "").trim().toLowerCase();
              const id = String(item.filmeId || "").trim();
              const encontrado =
                resultados.find((candidato) => {
                  const candidatoId = String(
                    candidato.filmeId || candidato.id || candidato._id || "",
                  ).trim();
                  return (
                    (id && candidatoId === id) ||
                    (tituloBusca &&
                      String(candidato.titulo || "").trim().toLowerCase() === tituloBusca)
                  );
                }) || resultados[0];
              if (encontrado) {
                const partes = parseLink(encontrado.link_assistir);
                categoria = categoria || encontrado.categoria || partes.categoria;
                slug = slug || encontrado.slug || partes.slug;
                detalhe = encontrado;
              }
            } catch (_) {}
          }

          const progresso = calcProgresso(item);
          const tipoOrigem = String(item.tipo || detalhe?.tipo || item.contentType || item.categoria || "");
          const tipoRaw = tipoOrigem || "Filme";
          const isEp = meta.isEpisode || /epis/i.test(tipoOrigem);

          let titulo = item.titulo || detalhe?.titulo || slug || "Continuar";
          // Card de série: nome da série em destaque; episódio no meta
          if (isEp) {
            titulo =
              meta.serieTitulo ||
              (item.serieSlug ? humanizarSlug(item.serieSlug) : "") ||
              meta.epNome ||
              titulo;
          }

          let imagem =
            item.thumb || item.imagem || detalhe?.imagem || detalhe?.thumb || capas[cacheKey] || "";
          if (imagem && imagem.startsWith("//")) imagem = "https:" + imagem;
          // Não dispara uma segunda busca por capa: o enriquecimento tipado abaixo
          // trata apenas os itens sem imagem, evitando consultas repetidas por cartão.
          if (imagem && cacheKey) capas[cacheKey] = imagem;

          const serieCategoria = String(item.serieCategoria || "").trim();
          const serieSlug = String(item.serieSlug || "").trim();

          // Usa somente identificadores e rotas do contrato unificado atual.
          const aliases = { megaflix: "v1", novelasflix: "v1", "megaflix.live": "v1", megacine: "v3", cine: "v3", "megacine.yachts": "v3", megafilmes: "v4", megafilmeshd1: "v4", "megafilmeshd1.com": "v4", superflix: "v2", topfilmes: "v5", v1: "v1", v2: "v2", v3: "v3", v4: "v4", v5: "v5" };
          const categoriaOriginal = String(categoria || "").toLowerCase();
          const categoriaAtual = aliases[categoriaOriginal] || categoriaOriginal;
          const serieCategoriaAtual = aliases[String(serieCategoria || "").toLowerCase()] || String(serieCategoria || categoriaAtual).toLowerCase();
          const tipoOrigemSerie = /s[eé]rie|series|tv/i.test(tipoOrigem) || /serie|s[eé]rie|tv/i.test(String(item.tipo || ""));
          let link_assistir = "#/";
          if (isEp && /^v[1-5]$/.test(serieCategoriaAtual) && (serieSlug || slug)) {
            const sourceSeriesId = serieSlug || String(slug).replace(/^serie-/, "").replace(/-\d+-\d+$/, "");
            const q = new URLSearchParams({
              t: String(meta.temporada || 1), e: String(meta.episodio || 1),
              serieCategoria: serieCategoriaAtual, serieSlug: sourceSeriesId,
              filmeId: String(item.filmeId || slug), thumb: imagem || "", titulo: titulo || "",
            });
            link_assistir = `#/episodio/${encodeURIComponent(serieCategoriaAtual)}/${encodeURIComponent(slug || `serie-${sourceSeriesId}-${meta.temporada || 1}-${meta.episodio || 1}`)}?${q}`;
          } else if (/^v[1-5]$/.test(categoriaAtual) && slug) {
            link_assistir = `#/titulo/${tipoOrigemSerie ? "serie" : "filme"}/${categoriaAtual}/${encodeURIComponent(slug)}`;
          } else if (categoriaAtual === "destaque" && slug) {
            link_assistir = `#/titulo/filme/destaque/${encodeURIComponent(slug)}`;
          } else if (isEp && titulo) {
            const serieTitulo = meta.serieTitulo || item.seriesTitle || item.serieTitulo || titulo;
            const q = new URLSearchParams({ titulo: serieTitulo, t: String(meta.temporada || 1), e: String(meta.episodio || 1) });
            link_assistir = `#/episodio/resolve?${q}`;
          } else if (titulo) {
            // Histórico/favoritos de providers removidos: localizar novamente pela busca unificada.
            const q = new URLSearchParams({ titulo, thumb: imagem || "", filmeId: String(item.filmeId || "") });
            link_assistir = `#/favorito/resolve?${q}`;
          } else {
            link_assistir = `#/fonte-indisponivel/${encodeURIComponent(categoriaOriginal || "legacy")}`;
          }
          const link_detalhe = link_assistir;

          // Meta: "S2E4 · 45% assistido" ou só porcentagem
          const partesMeta = [];
          if (isEp && meta.epLabel) partesMeta.push(meta.epLabel);
          if (isEp && meta.epNome && meta.epNome !== titulo) {
            // opcional: nome curto do ep
          }
          if (progresso > 0) partesMeta.push(`${progresso}% assistido`);
          else partesMeta.push("Continuar");

          return {
            titulo,
            imagem,
            categoria: categoria || "filme",
            slug: slug || String(item.filmeId || "").trim(),
            filmeId: item.filmeId || slug,
            tipo: isEp ? "episodio" : tipoRaw,
            progresso,
            continuarTexto: partesMeta.join(" · "),
            badgeExtra: isEp && meta.epLabel ? meta.epLabel : null,
            link_assistir,
            link_detalhe,
            serieCategoria,
            serieSlug,
            temporada: meta.temporada,
            episodio: meta.episodio,
            epLabel: meta.epLabel,
            isEpisode: isEp,
            updatedAt: Number(item.updatedAt || 0),
          };
        });

    // Dedup forte: série por serieSlug/titulo; filme por slug/filmeId/titulo
    const vistos = new Set();
    const cards = [];
    // ordena por updatedAt desc (mais recente primeiro)
    const ordenados = [...montados].sort(
      (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
    );
    for (const c of ordenados) {
      if (!c || !(c.slug || c.filmeId || c.titulo)) continue;
      const tituloNorm = String(c.titulo || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const keys = [];
      if (c.isEpisode || c.tipo === "episodio") {
        if (c.serieSlug) keys.push(`serie:${c.serieSlug}`);
        if (tituloNorm) keys.push(`serie-titulo:${tituloNorm}`);
        if (c.filmeId) keys.push(`serie-fid:${c.filmeId}`);
      } else {
        if (c.categoria && c.slug) keys.push(`item:${c.categoria}:${c.slug}`);
        if (c.filmeId) keys.push(`fid:${c.filmeId}`);
        if (c.slug) keys.push(`slug:${c.slug}`);
        if (tituloNorm) keys.push(`titulo:${tituloNorm}`);
      }
      if (!keys.length) keys.push(`raw:${c.slug || c.filmeId || tituloNorm}`);
      if (keys.some((k) => vistos.has(k.toLowerCase()))) continue;
      keys.forEach((k) => vistos.add(k.toLowerCase()));
      cards.push(c);
    }

    // Ajustes puramente locais de apresentação; TMDB é consultado pelo servidor ao abrir a ficha.
    for (const c of cards) {
      if (c.isEpisode || c.tipo === "episodio" || Number(c.temporada) > 0) {
        const epLabel = c.epLabel || (Number(c.temporada) > 0 && Number(c.episodio) > 0 ? `S${c.temporada}E${c.episodio}` : "");
        const nome = String(c.titulo || "")
          .replace(/\s*[Tt]\s*\d+\s*[Ee]\s*\d+.*$/u, "")
          .replace(/\s*[Ss]\s*\d+\s*[Ee]\s*\d+.*$/u, "")
          .replace(/\s*[-–—:]\s*$/u, "")
          .trim();
        if (epLabel && nome) {
          c.titulo = `${nome} · ${epLabel}`;
          c.badgeExtra = epLabel;
          c.continuarTexto = c.progresso ? `${c.progresso}% · ${epLabel}` : epLabel;
        }
        c.tipo = "serie";
        c.isEpisode = true;
      }
    }

    // Fallback final Continuar: capa da série se o ep ainda estiver sem arte
    for (const c of cards) {
      if (String(c.imagem || "").trim()) continue;
      const serieKey = `${c.serieCategoria || c.categoria || ""}:${c.serieSlug || ""}`.toLowerCase();
      const fromCache =
        (c.serieSlug && capas[serieKey]) ||
        capas[`${c.categoria || ""}:${c.serieSlug || ""}`.toLowerCase()] ||
        "";
      // reutiliza a capa local da série quando o histórico do episódio não tem imagem
      if (fromCache) {
        c.imagem = fromCache;
        c.thumb = fromCache;
      }
    }

    for (const c of cards) {
      if (c.imagem && (c.slug || c.filmeId)) {
        const ck = `${c.categoria || ""}:${c.slug || c.filmeId}`.toLowerCase();
        capas[ck] = c.imagem;
      }
    }

    salvarCapas(capas);
    return cards;
  } catch (_) {
    return [];
  }
}
