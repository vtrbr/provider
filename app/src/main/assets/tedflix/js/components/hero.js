import { el, anoCurto } from "../dom.js";
import { backdrop, poster } from "../img.js";
import { rotaDetalhe, parseLink, ehSerie } from "../server-api.js";
import { lerFavorito, toggleFavoritoComConfirmacao, abrirPlayerNativo } from "../playback.js";

function absHero(u) {
  const s = String(u || "").trim();
  if (s.startsWith("//")) return "https:" + s;
  return s;
}

/** Monta rota de play direto (filme) ou detalhe (série → usuário escolhe ep). */
function rotaPlay(it) {
  const detalhe = rotaDetalhe(it);
  // Séries: play abre detalhe (precisa escolher episódio)
  if (ehSerie(it) || /serie|séri|tv/i.test(String(it.tipo || ""))) {
    return detalhe;
  }
  // CONTENT filme → /assistir/
  const p = parseLink(it.link_assistir);
  const cat = it.categoria || p.categoria;
  const slug = it.slug || p.slug;
  if (cat && slug && (/^v[1-5]$/.test(String(cat).toLowerCase()) || ["destaque", "tedtop"].includes(String(cat).toLowerCase()))) {
    const filmeId = String(it.filmeId || it.id || it.tmdb_id || slug);
    const thumb = String(it.imagem || it.thumb || it.capa || "");
    const params = new URLSearchParams({
      filmeId,
      thumb,
      tipo: it.tipo || "filme",
    });
    return `#/assistir/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}?${params}`;
  }
  return detalhe;
}

function idFavorito(it) {
  return String(it.filmeId || it.sourceId || it.id || it.tmdb_id || it.slug || "").trim();
}

/**
 * Hero estilo banner grande (tipo Netflix / apps de streaming):
 * capa full + título + gêneros + [Favorito | Reproduzir | Informações]
 */
export function hero(itens) {
  const raiz = el("div", { class: "hero hero--banner" });
  if (!itens.length) {
    raiz.classList.add("skel");
    return raiz;
  }

  const img = el("img", { alt: "", decoding: "async", fetchpriority: "high" });
  const h1 = el("h1");
  const tags = el("div", { class: "tags" });
  const generos = el("p", { class: "hero-genres" });

  // Ações: Favorito | Reproduzir | Informações
  const btnFav = el("button", {
    type: "button",
    class: "hero-act hero-act--fav",
    "aria-label": "Favorito",
  });
  const favIcon = el("span", { class: "hero-act-icon" }, "♡");
  const favLabel = el("span", { class: "hero-act-label" }, "Favorito");
  btnFav.append(favIcon, favLabel);

  const btnPlay = el("a", {
    class: "hero-act hero-act--play",
    href: "#/",
  });
  btnPlay.append(
    el("span", { class: "hero-act-icon", html: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>' }),
    el("span", { class: "hero-act-label" }, "Reproduzir"),
  );

  const btnInfo = el("a", {
    class: "hero-act hero-act--info",
    href: "#/",
  });
  btnInfo.append(
    el("span", { class: "hero-act-icon" }, "ⓘ"),
    el("span", { class: "hero-act-label" }, "Informações"),
  );

  const actions = el("div", { class: "hero-actions" }, [btnFav, btnPlay, btnInfo]);
  const dots = el("div", { class: "dots" });

  raiz.append(
    img,
    el("div", { class: "veil" }),
    el("div", { class: "info" }, [tags, h1, generos, actions]),
    dots,
  );

  itens.forEach(() => dots.append(el("i")));

  let atual = 0;

  img.addEventListener("error", () => {
    const it = itens[atual];
    if (!it) return;
    const raw = absHero(it.imagem || it.banner || it.capa || "");
    if (!raw) return;
    const fallbacks = [
      backdrop(raw, 500),
      poster(raw, "md"),
      poster(raw, "sm"),
      raw.replace(/\/t\/p\/(w\d+|original)\//, "/t/p/w500/"),
      raw,
    ].filter(Boolean);
    const cur = img.getAttribute("src");
    const next = fallbacks.find((u) => u && u !== cur);
    if (next) img.src = next;
  });

  function atualizarFavoritoUI(it) {
    const fid = idFavorito(it);
    const slug = String(it.slug || "").trim();
    const cat = String(it.categoria || "").trim();
    const on = lerFavorito(fid, slug, cat);
    favIcon.textContent = on ? "♥" : "♡";
    favLabel.textContent = on ? "Na lista" : "Favorito";
    btnFav.classList.toggle("on", on);
    btnFav.dataset.on = on ? "1" : "0";
  }

  function playNativoSePossivel() { return false; }

  function mostrar(i) {
    atual = ((i % itens.length) + itens.length) % itens.length;
    const it = itens[atual];
    const raw = absHero(it.banner || it.imagem || it.capa || "");
    img.src = backdrop(raw, 900) || poster(raw, "lg") || raw;
    img.alt = it.titulo || "";
    h1.textContent = it.titulo || "";

    // tags: nota · tipo · ano
    tags.innerHTML = "";
    const partes = [
      it.nota ? `★ ${Number(it.nota).toFixed(1)}` : null,
      it.tipo || (ehSerie(it) ? "Série" : "Filme"),
      anoCurto(it.ano),
    ].filter(Boolean);
    partes.forEach((p) => tags.append(el("span", {}, p)));

    // gêneros
    const gens = Array.isArray(it.generos)
      ? it.generos
      : String(it.genero || it.categoria_nome || it.categoria || "")
          .split(/[,|/·]/)
          .map((s) => s.trim())
          .filter(Boolean);
    generos.textContent = gens.slice(0, 4).join(" · ");

    // links
    const det = rotaDetalhe(it);
    btnInfo.href = det;
    btnPlay.href = rotaPlay(it);
    btnPlay.onclick = (e) => {
      // a página de reprodução delega ao player nativo quando disponível
      if (playNativoSePossivel(it)) {
        e.preventDefault();
      }
    };

    atualizarFavoritoUI(it);

    [...dots.children].forEach((d, k) => d.classList.toggle("on", k === atual));
    const prox = itens[(atual + 1) % itens.length];
    if (prox) {
      const pr = absHero(prox.banner || prox.imagem || "");
      if (pr) new Image().src = backdrop(pr, 900) || pr;
    }
  }

  btnFav.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const it = itens[atual];
    if (!it) return;
    const fid = idFavorito(it);
    const tipo = ehSerie(it) || /serie|séri/i.test(String(it.tipo || "")) ? "series" : "movie";
    btnFav.disabled = true;
    try {
      const r = await toggleFavoritoComConfirmacao({
        filmeId: fid, slug: it.slug || "", categoria: it.categoria || it.source || "",
        titulo: it.titulo || "Tedflix", thumb: it.imagem || it.capa || "", tipo,
      });
      if (r && r.success !== false && !r.cancelled) {
        const on = typeof r.favorito === "boolean" ? r.favorito : btnFav.dataset.on !== "1";
        favIcon.textContent = on ? "♥" : "♡";
        favLabel.textContent = on ? "Na lista" : "Favorito";
        btnFav.classList.toggle("on", on);
        btnFav.dataset.on = on ? "1" : "0";
      }
    } finally { btnFav.disabled = false; }
  });

  mostrar(0);

  // swipe
  let arrastando = false;
  let pressionado = false;
  let inicioX = 0;
  let suprimirCliqueAte = 0;
  raiz.addEventListener("pointerdown", (evento) => {
    if (evento.target.closest("a, button")) return;
    if (evento.pointerType === "mouse" && evento.button !== 0) return;
    pressionado = true;
    arrastando = false;
    inicioX = evento.clientX;
    parar();
    try {
      raiz.setPointerCapture(evento.pointerId);
    } catch (_) {}
  });
  raiz.addEventListener(
    "pointermove",
    (evento) => {
      if (!pressionado) return;
      if (Math.abs(evento.clientX - inicioX) > 12) {
        arrastando = true;
        evento.preventDefault();
      }
    },
    { passive: false },
  );
  const terminarSwipe = (evento) => {
    if (!pressionado) return;
    const delta = evento.clientX - inicioX;
    if (arrastando && Math.abs(delta) > 34) {
      mostrar(delta < 0 ? atual + 1 : atual - 1 + itens.length);
      suprimirCliqueAte = Date.now() + 420;
    }
    pressionado = false;
    arrastando = false;
    rodar();
  };
  raiz.addEventListener("pointerup", terminarSwipe);
  raiz.addEventListener("pointercancel", terminarSwipe);
  raiz.addEventListener(
    "click",
    (evento) => {
      if (Date.now() < suprimirCliqueAte) {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        suprimirCliqueAte = 0;
      }
    },
    true,
  );

  let timer = null;
  const rodar = () => {
    parar();
    timer = setInterval(() => mostrar(atual + 1), 7000);
  };
  const parar = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const io = new IntersectionObserver((e) => (e[0].isIntersecting ? rodar() : parar()));
  io.observe(raiz);
  raiz.destruir = () => {
    parar();
    io.disconnect();
  };

  return raiz;
}
