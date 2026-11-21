import { el } from "../dom.js";
import { getTedtopIngresso } from "../api.js";
import { montarPlayer, limparPlayer } from "../components/player.js";
import { getPlayback } from "../server-api.js";

/** Entra em tela cheia horizontal (cinema) — precisa de gesto do usuário. */
async function modoCinema(alvo) {
  try {
    if (!document.fullscreenElement) {
      await (alvo.requestFullscreen?.() || alvo.webkitRequestFullscreen?.());
    } else {
      await document.exitFullscreen();
      return;
    }
  } catch (e) {
    /* navegador pode recusar */
  }
  try {
    await screen.orientation?.lock?.("landscape");
  } catch (e) {
    /* desktop / iOS não permitem */
  }
}

export default async function paginaAssistir(raiz, { categoria, slug, fila = [], filmeId = "", thumb = "", tipo = "", serieCategoria = "", serieSlug = "", episodios = [], recomendados = [], titulo = "" }) {
  document.body.classList.add("imersivo");

  const page = el("div", { class: "page assistir" });
  const palco = el("div", { class: "cinema" });
  const caixa = el("div", { class: "player-wrap" });

  palco.append(caixa);
  page.append(palco);
  raiz.append(page);

  const carregando = el("div", { class: "center" }, [
    el("div", { class: "spinner" }),
    el("p", {}, "Preparando transmissão..."),
  ]);
  caixa.append(carregando);

  const voltar = () => history.back();
  let instancia = null;

  // Registra a limpeza antes do handoff nativo. Sem isso, o retorno do
  // PlayerActivity deixava a página Android sem o hook de destruição.
  page.destruir = () => {
    document.body.classList.remove("imersivo");
    try {
      screen.orientation?.unlock?.();
    } catch (err) {}
    instancia?.destruir?.();
    limparPlayer();
  };

  try {
    const nomeFromSlug = decodeURIComponent(slug || "").replace(/^serie-/i, "").replace(/^\d+-/, "").replace(/-/g, " ").trim();
    const nome = String(titulo || "").trim() || nomeFromSlug || "TEDFLIX";

    // No Android, a interface permanece igual, mas a reprodução é delegada
    // ao player nativo para suportar HLS e tela cheia horizontal.
    if (window.AndroidPlayer && typeof window.AndroidPlayer.openPlayer === "function") {
      window.AndroidPlayer.openPlayer(
        categoria,
        slug,
        nome,
        JSON.stringify(Array.isArray(fila) ? fila : []),
        filmeId || slug,
        thumb,
        tipo,
        serieCategoria,
        serieSlug,
        JSON.stringify(Array.isArray(episodios) ? episodios : []),
        JSON.stringify(Array.isArray(recomendados) ? recomendados : []),
      );
      return page;
    }

    let m3u8;
    let formato = "hls";
    const provider = String(categoria || "").toLowerCase();
    if (/^v[1-5]$/.test(provider)) {
      const playback = await getPlayback(provider, slug, tipo);
      m3u8 = playback.url;
      formato = playback.format || "hls";
    } else if (provider === "destaque" || provider === "tedtop") {
      const ingresso = await getTedtopIngresso(slug);
      if (!ingresso?.direct_url) throw new Error("TEDTOP não retornou um endereço de reprodução válido.");
      m3u8 = ingresso.direct_url;
      formato = /\.m3u8(?:$|\?)/i.test(m3u8) ? "hls" : "mp4";
    } else {
      throw new Error("Esta origem não está conectada ao sistema de reprodução atual.");
    }
    caixa.innerHTML = "";
    instancia = montarPlayer(caixa, {
      m3u8,
      formato,
      titulo: nome,
      aoStatus: () => {}, // o player agora mostra seu próprio overlay de status/erro
      aoVoltar: voltar,
      aoGirar: () => modoCinema(palco),
    });
    // primeiro toque na tela já joga em tela cheia horizontal (mobile)
    caixa.addEventListener("click", function once(ev) {
      if (ev.target.closest(".tp-back, .tp-btn, .tp-progresso, .tp-menu-btn")) return;
      caixa.removeEventListener("click", once);
      if (window.matchMedia("(max-width: 900px)").matches) modoCinema(palco);
    });
  } catch (e) {
    caixa.innerHTML = "";
    const msg = e.message || "Não foi possível carregar o vídeo.";
    const is404 = /404|not found|indispon|unavailable|não encontrado|nao encontrado/i.test(msg);
    const retry = el("button", { class: "btn primary", style: "margin-top:12px" }, "Tentar novamente");
    const back = el("button", { class: "btn", style: "margin-top:8px;margin-left:8px" }, "Voltar");
    retry.addEventListener("click", () => {
      raiz.innerHTML = "";
      paginaAssistir(raiz, { categoria, slug, fila, filmeId, thumb, tipo, serieCategoria, serieSlug, episodios, recomendados });
    });
    back.addEventListener("click", voltar);
    caixa.append(
      el("div", {
        class: "center video-error",
        style: "padding:24px;max-width:420px;margin:0 auto;text-align:center",
      }, [
        el("div", {
          style: "width:72px;height:72px;border-radius:50%;background:rgba(255,60,60,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px",
        }, is404 ? "404" : "!"),
        el("h2", { style: "margin:0 0 8px;font-size:20px;font-weight:700" }, is404 ? "Vídeo não encontrado" : "Falha na reprodução"),
        el("p", { style: "opacity:.75;line-height:1.45;margin:0 0 8px" },
          is404
            ? "Este título está indisponível nesta fonte no momento. Tente outra fonte ou volte mais tarde."
            : msg),
        el("div", { style: "display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px" }, [retry, back]),
      ]),
    );
  }

  return page;
}
