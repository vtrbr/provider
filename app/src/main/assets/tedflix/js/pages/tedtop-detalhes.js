import { errorDialog } from "../ui/dialogs.js";
import { el, limpar, anoCurto } from "../dom.js";
import { getTedtopFilme, getTedtopIngresso } from "../api.js";
import { abrirPlayerNativo, lerFavorito, toggleFavoritoComConfirmacao } from "../playback.js";
import { montarPlayer, limparPlayer } from "../components/player.js";
import { backdrop, poster } from "../img.js";

export default async function paginaTedtopDetalhe(raiz, slug) {
  const id = String(slug || "").trim();
  const page = el("div", { class: "page page-ficha" });
  raiz.append(page);
  page.append(el("div", { class: "center detail-loading" }, [el("div", { class: "spinner" })]));

  const data = await getTedtopFilme(id);
  if (!data) {
    limpar(page);
    page.append(el("p", { class: "center" }, "Não foi possível carregar os detalhes deste título."));
    return page;
  }

  limpar(page);
  const image = data.banner || data.backdrop || data.imagem || data.poster || "";
  const hero = el("div", { class: "detail-hero" });
  if (image) hero.append(el("img", { src: backdrop(image, 900) || image, alt: data.titulo || "", loading: "eager" }));
  hero.append(el("div", { class: "detail-hero-fade" }));
  page.append(hero);

  const body = el("div", { class: "pad" });
  const title = el("h1", {}, data.titulo || "Título TEDTOP");
  const meta = [data.tipo || "Filme", anoCurto(data.ano), data.nota ? `★ ${data.nota}` : ""].filter(Boolean).join(" · ");
  body.append(title, el("p", { class: "sub" }, meta));
  if (data.sinopse) body.append(el("p", { class: "sub", style: "line-height:1.5;margin-top:12px" }, data.sinopse));
  const actions = el("div", { class: "detail-actions", style: "display:flex;gap:10px;flex-wrap:wrap;margin-top:18px" });
  const play = el("button", { class: "btn primary", type: "button" }, "▶ Assistir");
  const fid = `tedtop:${id}`;
  let favorite = lerFavorito(fid, id, "destaque");
  const fav = el("button", { class: `btn ghost${favorite ? " ativo" : ""}`, type: "button" }, favorite ? "♥ Favorito" : "♡ Favoritar");
  fav.addEventListener("click", async () => {
    fav.disabled = true;
    try {
      const result = await toggleFavoritoComConfirmacao({ filmeId: fid, slug: id, categoria: "destaque", titulo: data.titulo, thumb: data.imagem || "", tipo: "filme" });
      if (result?.success !== false && !result?.cancelled) {
        favorite = typeof result?.favorito === "boolean" ? result.favorito : !favorite;
        fav.textContent = favorite ? "♥ Favorito" : "♡ Favoritar";
        fav.classList.toggle("ativo", favorite);
      }
    } finally { fav.disabled = false; }
  });
  play.addEventListener("click", async () => {
    play.disabled = true;
    play.textContent = "Abrindo…";
    try {
      if (abrirPlayerNativo({ categoria: "destaque", slug: id, titulo: data.titulo || "Filme", thumb: data.imagem || "", tipo: "tedtop", filmeId: fid })) return;
      const ingresso = await getTedtopIngresso(id);
      if (!ingresso?.direct_url) throw new Error("TEDTOP não retornou um endereço de reprodução válido.");
      const stage = el("div", { class: "player-wrap" });
      limpar(page);
      page.append(stage);
      montarPlayer(stage, { m3u8: ingresso.direct_url, formato: "mp4", titulo: data.titulo || "Filme", aoStatus: () => {}, aoVoltar: () => { limparPlayer(); location.hash = `#/titulo/filme/destaque/${encodeURIComponent(id)}`; } });
    } catch (error) {
      errorDialog(error?.message || "Não foi possível iniciar a reprodução.", { title: "TEDTOP indisponível" });
    } finally {
      play.disabled = false;
      play.textContent = "▶ Assistir";
    }
  });
  actions.append(play, fav);
  body.append(actions);
  page.append(body);
  return page;
}
