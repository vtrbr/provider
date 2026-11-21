import { errorDialog } from "../ui/dialogs.js";
import { el, svgIcone, limpar } from "../dom.js";
import { getPlutoHome, getPlutoStream, getPlutoVod, getPlutoVodStream } from "../api.js";

function img(src, alt) {
  const i = el("img", { alt: alt || "", loading: "lazy", decoding: "async" });
  if (src) {
    i.src = src;
    i.addEventListener("error", () => { i.style.opacity = "0.2"; }, { once: true });
  }
  return i;
}

function restanteTxt(agora) {
  if (!agora) return "Ao vivo";
  if (agora.restante_min != null) {
    const m = agora.restante_min;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const r = m % 60;
      return r ? `${h}h ${r}m restante` : `${h}h restante`;
    }
    return `${m}m restante`;
  }
  return agora.titulo || "Ao vivo";
}

function abrirPlutoLive(canal, categoriaNome) {
  const stream = canal.stream;
  if (!stream) return false;
  const servers = JSON.stringify([
    {
      provider: "Pluto TV",
      quality: "HD",
      embed_url: stream,
      headers: {
        Referer: "https://pluto.tv/",
        Origin: "https://pluto.tv",
      },
    },
  ]);
  const programa = canal.agora
    ? `${canal.agora.titulo || ""} · ${restanteTxt(canal.agora)}`.trim()
    : "Transmissão ao vivo";
  if (window.AndroidPlayer?.openLivePlayer) {
    window.AndroidPlayer.openLivePlayer(
      canal.id || canal.slug,
      canal.nome || "Canal Pluto",
      canal.logo || "",
      servers,
      programa,
      categoriaNome || "Pluto TV",
    );
    return true;
  }
  // fallback web: tenta player VOD se existir
  if (window.AndroidPlayer?.openPlayer) {
    window.AndroidPlayer.openPlayer(
      "pluto",
      canal.id || canal.slug,
      canal.nome || "Canal Pluto",
      canal.logo || "",
      "live",
    );
    return true;
  }
  return false;
}

async function abrirStreamApi(id, nome, logo, categoria) {
  try {
    const d = await getPlutoStream(id);
    if (!d?.ok || !d.stream) return false;
    return abrirPlutoLive(
      {
        id: d.id || id,
        slug: d.slug,
        nome: d.nome || nome,
        logo: logo,
        stream: d.stream,
        agora: d.agora,
      },
      categoria,
    );
  } catch (_) {
    return false;
  }
}

function cardCanal(canal, categoriaNome) {
  const a = el("button", {
    type: "button",
    class: "pluto-card",
    "aria-label": `Assistir ${canal.nome}`,
  });
  const prog = canal.agora?.titulo || "Ao vivo";
  const meta = restanteTxt(canal.agora);
  a.append(
    el("div", { class: "pluto-thumb" }, [
      img(canal.logo, canal.nome),
      el("span", { class: "pluto-live-dot" }, "AO VIVO"),
    ]),
    el("div", { class: "pluto-card-body" }, [
      el("strong", {}, canal.nome || "Canal"),
      el("span", { class: "pluto-prog" }, prog),
      el("span", { class: "pluto-meta" }, meta),
    ]),
  );
  a.addEventListener("click", async () => {
    a.disabled = true;
    const ok = canal.stream
      ? abrirPlutoLive(canal, categoriaNome)
      : await abrirStreamApi(canal.id || canal.slug, canal.nome, canal.logo, categoriaNome);
    if (!ok) {
      a.disabled = false;
      errorDialog("Não foi possível abrir este canal agora.", { title: "Canal indisponível" });
    } else {
      setTimeout(() => { a.disabled = false; }, 800);
    }
  });
  return a;
}

function fileiraCategoria(cat) {
  const wrap = el("section", { class: "pluto-row" });
  wrap.append(
    el("div", { class: "pluto-row-head" }, [
      el("h2", {}, cat.nome || "Categoria"),
      el("span", { class: "pluto-count" }, `${cat.total || (cat.canais || []).length} canais`),
    ]),
  );
  const scroller = el("div", { class: "pluto-scroller" });
  for (const c of cat.canais || []) {
    scroller.append(cardCanal(c, cat.nome));
  }
  wrap.append(scroller);
  return wrap;
}

export default async function paginaPluto(raiz) {
  const page = el("div", { class: "page pluto-page" });
  const head = el("div", { class: "pluto-hero" }, [
    el("div", { class: "pluto-hero-text" }, [
      el("span", { class: "pluto-kicker" }, "TV ao vivo"),
      el("h1", {}, "Pluto TV"),
      el("p", {}, "Canais grátis · categorias · o que está passando agora"),
    ]),
  ]);
  const slot = el("div", { class: "pluto-body" }, [
    el("div", { class: "skel", style: "height:120px;margin:12px 0;border-radius:12px" }),
    el("div", { class: "skel", style: "height:120px;margin:12px 0;border-radius:12px" }),
  ]);
  page.append(head, slot);
  raiz.append(page);

  try {
    const data = await getPlutoHome();
    if (!page.isConnected) return;
    limpar(slot);
    if (!data?.ok || !Array.isArray(data.categorias) || !data.categorias.length) {
      slot.append(el("p", { class: "empty" }, "Nenhum canal Pluto disponível no momento."));
      return;
    }
    const chips = el("div", { class: "pluto-chips" });
    for (const cat of data.categorias) {
      const chip = el("button", { type: "button", class: "pluto-chip" }, cat.nome);
      chip.addEventListener("click", () => {
        const elRow = page.querySelector(`[data-cat="${cat.slug || cat.id}"]`);
        if (elRow) elRow.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      chips.append(chip);
    }
    slot.append(chips);
    for (const cat of data.categorias) {
      if (!(cat.canais || []).length) continue;
      const row = fileiraCategoria(cat);
      row.dataset.cat = cat.slug || cat.id;
      slot.append(row);
    }
  } catch (e) {
    if (!page.isConnected) return;
    errorDialog(e?.message || "Falha ao carregar Pluto TV. Tente de novo em instantes.", { title: "Pluto TV indisponível" });
    limpar(slot);
    slot.append(
      el("p", { class: "empty" }, "Falha ao carregar Pluto TV. Tente de novo em instantes."),
      el("p", { class: "muted", style: "font-size:12px" }, String(e.message || e)),
    );
  }
}
