import { el, limpar, aoAparecer } from "../dom.js";
import { cardTitulo, cardTop10, skeletonCard } from "./card.js";
import { prefetchImagens } from "../img.js";

/**
 * Fileira horizontal preguiçosa estilo Netflix.
 * variante: "continuar" | "tedtop" | default
 */
export function fileira({ titulo, verTudo, carregar, limite = 20, variante = "" }) {
  const rail = el("div", {
    class: `rail${variante ? ` rail--${variante}` : ""}`,
    role: "region",
    "aria-label": titulo,
  });
  for (let i = 0; i < 6; i++) rail.append(skeletonCard());

  const secao = el("section", {
    class: `section${variante ? ` section--${variante}` : ""}`,
  }, [
    el("div", { class: "section-head" }, [
      el("h2", {}, titulo),
      verTudo ? el("a", { href: verTudo }, "Ver tudo ›") : null,
    ]),
    rail,
  ]);

  let carregada = false;
  const carregarRail = async () => {
    if (carregada) return;
    carregada = true;
    try {
      const itens = (await carregar()) || [];
      limpar(rail);
      if (!itens.length) {
        // Seção vazia: remove do layout (não polui a Home)
        secao.remove();
        return;
      }
      const lista = itens.slice(0, limite);
      const tamanhoCard = variante === "continuar" ? "md" : "sm";
      // Primeiro pinta os seis cards iniciais; nenhuma consulta de metadados segura a Home.
      const primeiros = document.createDocumentFragment();
      lista.slice(0, 6).forEach((item, index) => {
        const card = cardTitulo(item, { eager: index < 3, size: tamanhoCard });
        primeiros.append(card);
      });
      rail.append(primeiros);

      const agenda = window.requestIdleCallback
        ? (fn) => window.requestIdleCallback(fn, { timeout: 1000 })
        : (fn) => setTimeout(fn, 60);
      agenda(() => {
        if (!rail.isConnected) return;
        const frag = document.createDocumentFragment();
        lista.slice(6).forEach((item, offset) => {
          const index = offset + 6;
          const card = cardTitulo(item, { size: tamanhoCard });
            frag.append(card);
        });
        rail.append(frag);
        prefetchImagens(
          lista.slice(6, 10).map((i) => i.imagem || i.capa || i.thumb || i.poster).filter(Boolean),
        );
      });

    } catch (e) {
      limpar(rail);
      if (variante === "tedtop" || variante === "continuar") {
        secao.remove();
        return;
      }
      rail.append(
        el("div", { class: "rail-error" }, [
          el("p", { class: "sub" }, "Não foi possível carregar esta fileira."),
          el("button", {
            class: "btn ghost",
            type: "button",
            onclick: () => {
              carregada = false;
              limpar(rail);
              for (let i = 0; i < 6; i++) rail.append(skeletonCard());
              carregarRail();
            },
          }, "Tentar de novo"),
        ]),
      );
    }
  };
  aoAparecer(secao, carregarRail, "600px");
  // Fileiras de destaque carregam cedo; as demais respeitam a proximidade da viewport.
  if (variante === "continuar" || variante === "tedtop") {
    setTimeout(carregarRail, 180);
  }

  return secao;
}


/**
 * Fileira Top 10 com números grandes (estilo Netflix).
 */
export function fileiraTop10({ titulo, carregar, limite = 10 }) {
  const rail = el("div", {
    class: "rail rail--top10",
    role: "region",
    "aria-label": titulo,
  });
  for (let i = 0; i < 5; i++) rail.append(skeletonCard());

  const secao = el("section", { class: "section section--top10" }, [
    el("div", { class: "section-head" }, [el("h2", {}, titulo)]),
    rail,
  ]);

  let carregada = false;
  const carregarRail = async () => {
    if (carregada) return;
    carregada = true;
    try {
      const itens = (await carregar()) || [];
      limpar(rail);
      if (!itens.length) {
        secao.remove();
        return;
      }
      const lista = itens.slice(0, limite);
      const frag = document.createDocumentFragment();
      lista.forEach((item, idx) => {
        frag.append(cardTop10(item, item.rank || idx + 1, { eager: idx < 3 }));
      });
      rail.append(frag);
      prefetchImagens(
        lista.map((i) => i.imagem || i.capa || i.thumb || i.poster).filter(Boolean),
      );
    } catch (e) {
      limpar(rail);
      secao.remove();
    }
  };

  // Só consulta quando a fileira se aproxima da área visível.
  aoAparecer(secao, carregarRail, "500px");
  return secao;
}
