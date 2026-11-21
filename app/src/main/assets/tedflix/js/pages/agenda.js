import { el } from "../dom.js";
import { getAgenda } from "../server-api.js";
import { backdrop, poster } from "../img.js";

function dataLegivel(value, label) {
  if (!value) return label || "Data a confirmar";
  const raw = String(value);
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return label || String(value);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(date);
}

function rotaItem(item) {
  const sourceId = String(item.sourceId || item.id || item.sourceSlug || "").trim();
  if (!sourceId) return "#/agenda";
  if (item.type === "series" && Number(item.season) > 0 && Number(item.episode) > 0) {
    const season = Number(item.season);
    const episode = Number(item.episode);
    const slug = `serie-${sourceId}-${season}-${episode}`;
    const params = new URLSearchParams({
      t: String(season), e: String(episode),
      serieCategoria: "v3", serieSlug: sourceId,
      filmeId: `v3:${sourceId}:s${season}e${episode}`,
      titulo: item.title || "",
      thumb: item.episodeStill || item.poster || "",
    });
    return `#/episodio/v3/${encodeURIComponent(slug)}?${params.toString()}`;
  }
  return `#/titulo/${item.type === "series" ? "serie" : "filme"}/v3/${encodeURIComponent(sourceId)}`;
}

function cardAgenda(item) {
  const a = el("a", { class: "agenda-card", href: rotaItem(item) });
  const image = item.episodeStill || item.poster || item.backdrop || "";
  if (image) a.append(el("img", { class: "agenda-card-image", src: backdrop(image, 420) || poster(image, "md") || image, alt: "", loading: "lazy" }));
  else a.append(el("div", { class: "agenda-card-image agenda-card-placeholder" }, "TEDFLIX"));
  const body = el("div", { class: "agenda-card-body" });
  body.append(el("span", { class: "agenda-card-kicker" }, item.timeLabel || item.time || "Lançamento"));
  body.append(el("strong", { class: "agenda-card-title" }, item.title || "Série"));
  const episode = item.episodeTitle || item.episodeLabel;
  if (episode) body.append(el("span", { class: "agenda-card-episode" }, episode));
  if (item.rating != null) body.append(el("span", { class: "agenda-card-rating" }, `★ ${item.rating}`));
  a.append(body);
  return a;
}

export default async function paginaAgenda(raiz) {
  const page = el("div", { class: "page agenda-page" });
  page.append(el("div", { class: "agenda-heading" }, [
    el("p", { class: "agenda-eyebrow" }, "TEDFLIX · ESTREIAS"),
    el("h1", {}, "Agenda de episódios"),
    el("p", { class: "sub" }, "Acompanhe os próximos lançamentos de séries."),
  ]));
  const content = el("div", { class: "agenda-content" });
  content.append(el("div", { class: "center pad" }, [el("div", { class: "spinner" })]));
  page.append(content);
  raiz.append(page);

  const carregar = async (force = false) => {
  content.innerHTML = "";
  content.append(el("div", { class: "center pad" }, [el("div", { class: "spinner" })]));
  try {
    const data = await getAgenda(14, force);
    content.innerHTML = "";
    const days = Array.isArray(data.days) ? data.days : [];
    if (!days.length) {
      content.append(el("div", { class: "agenda-empty" }, [
        el("strong", {}, "Nenhum lançamento encontrado"),
        el("p", { class: "sub" }, "A agenda do MegaCine não retornou episódios neste período. Tente novamente mais tarde."),
      ]));
      return;
    }
    for (const day of days) {
      const section = el("section", { class: "agenda-day" });
      section.append(el("h2", {}, dataLegivel(day.date, day.label)));
      const grid = el("div", { class: "agenda-grid" });
      for (const item of day.items || []) grid.append(cardAgenda(item));
      section.append(grid);
      content.append(section);
    }
    content.append(el("p", { class: "agenda-footnote" }, `Agenda fornecida pelo MegaCine e enriquecida com informações do TMDB · Atualizada ${data.updatedAt ? new Date(data.updatedAt).toLocaleString("pt-BR") : "recentemente"}.`));
  } catch (error) {
    content.innerHTML = "";
    content.append(el("div", { class: "agenda-empty" }, [
      el("strong", {}, "Não foi possível carregar a agenda"),
      el("p", { class: "sub" }, error?.message || "Verifique a conexão com o servidor e tente novamente."),
      el("button", { class: "btn primary", type: "button" }, "Tentar novamente"),
    ]));
    content.querySelector("button")?.addEventListener("click", () => carregar(true));
  }
  };
  await carregar(false);
  return page;
}
