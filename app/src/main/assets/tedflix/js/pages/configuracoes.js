import { confirmDialog, noticeDialog, errorDialog } from "../ui/dialogs.js";
import { el, svgIcone , limpar} from "../dom.js";
import { lerPrefs, salvarPrefs, OPCOES_BUFFER, OPCOES_PLAYER } from "../prefs.js";
import { medir, lerCache, nivel, ROTULO } from "../net.js";

const AVATAR_SEEDS = Array.from({ length: 15 }, (_, index) => `tedflix-avatar-${String(index + 1).padStart(2, "0")}`);
const DEFAULT_SEED = AVATAR_SEEDS[0];
const APP_VERSION = "1.54.0";
const APP_COMMIT_COUNT = 123;

let downloadRefreshTimer = null;
let downloadVisibilityHandler = null;

function formatarBytes(valor) {
  const bytes = Number(valor) || 0;
  if (bytes <= 0) return "0 B";
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  const nivel = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);
  return `${(bytes / Math.pow(1024, nivel)).toFixed(nivel === 0 ? 0 : 1)} ${unidades[nivel]}`;
}


function hashSeed(seed) {
  const s = String(seed || DEFAULT_SEED);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const AVATAR_PALETTE = [
  ["#7c3aed", "#4c1d95"],
  ["#e50914", "#7f1d1d"],
  ["#0ea5e9", "#0c4a6e"],
  ["#10b981", "#064e3b"],
  ["#f59e0b", "#78350f"],
  ["#ec4899", "#831843"],
  ["#8b5cf6", "#4c1d95"],
  ["#14b8a6", "#134e4a"],
];

/** Avatar local (SVG) — funciona offline e não depende do Dicebear */
function avatarLocalSvg(seed, size = 256, nameHint = "") {
  const h = hashSeed(seed);
  const [c1, c2] = AVATAR_PALETTE[h % AVATAR_PALETTE.length];
  // Preferir iniciais do nome; seed só se for legível (não só dígitos)
  const fromName = String(nameHint || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .replace(/[^a-zA-ZÀ-ÿ0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();
  const fromSeed = String(seed || "")
    .replace(/^tedflix-avatar-0?/i, "")
    .replace(/[^a-zA-Z]/g, "") // só letras — evita "03" de seed numérico
    .slice(0, 2)
    .toUpperCase();
  const letters = fromName || fromSeed || "TF";
  const fontSize = Math.round(size * 0.36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="url(#g)"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
    fill="#fff" font-family="system-ui,sans-serif" font-weight="800" font-size="${fontSize}">${letters}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function avatarUrl(seed, size = 256, style = "fun-emoji") {
  const st = String(style || "fun-emoji").trim() || "fun-emoji";
  const s = seed || DEFAULT_SEED;
  // Dicebear (quando a rede permite) + seed estável
  return `https://api.dicebear.com/9.x/${encodeURIComponent(st)}/png?seed=${encodeURIComponent(s)}&size=${size}`;
}

function respostaAndroid(nome, ...args) {
  try {
    const bridge = window.AndroidPlayer;
    const fn = bridge && bridge[nome];
    if (typeof fn !== "function") return { success: false, error: "Função indisponível." };
    // A API JavaScript do WebView precisa ser chamada como método do objeto
    // injetado. Se a função for destacada para uma variável e chamada solta,
    // o Android pode rejeitá-la como método de objeto não injetado.
    const raw = bridge[nome](...args);
    if (typeof raw === "object") return raw;
    return JSON.parse(raw || "{}");
  } catch (error) {
    const mensagem = String(error?.message || "");
    if (mensagem.toLowerCase().includes("bridge") || mensagem.toLowerCase().includes("injected")) {
      return { success: false, error: "Não foi possível acessar os dados da conta agora." };
    }
    return { success: false, error: mensagem || "Não foi possível concluir a operação." };
  }
}

function icon(nome, classe = "") {
  return el("span", { class: `cfg-icon ${classe}`, html: svgIcone(nome) });
}

function imgAvatar(profile, classe = "cfg-avatar-img", size = 256) {
  const style = profile?.avatarStyle || "fun-emoji";
  const seed = profile?.avatarSeed || DEFAULT_SEED;
  const local = avatarLocalSvg(seed, size, profile?.name || "");
  const image = el("img", {
    class: classe,
    src: local, // local primeiro = sempre sincroniza, mesmo offline
    alt: profile?.name || "Avatar",
    loading: "eager",
    decoding: "async",
  });
  // Tenta Dicebear por cima; se falhar, mantém o local
  const remote = avatarUrl(seed, size, style);
  const probe = new Image();
  probe.onload = () => {
    try { image.src = remote; } catch (_) {}
  };
  probe.onerror = () => {};
  try { probe.src = remote; } catch (_) {}
  image.addEventListener("error", () => {
    if (image.src !== local) image.src = local;
  });
  return image;
}

function button(label, classe = "btn ghost", onClick) {
  const node = el("button", { class: classe, type: "button" }, label);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function perfilAtual(perfis, ativo) {
  return perfis.find((profile) => profile.id === ativo) || perfis[0] || {
    id: "",
    name: "Meu perfil",
    avatarSeed: DEFAULT_SEED,
    avatarStyle: "fun-emoji",
    email: "",
  };
}

function lerPerfis() {
  const resposta = respostaAndroid("getProfiles");
  const perfis = Array.isArray(resposta.profiles) ? resposta.profiles : [];
  const ativo = resposta.activeId || perfis[0]?.id || "";
  return { perfis, ativo };
}

function diasRestantesDe(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000)));
}

function lerConta() {
  const resposta = respostaAndroid("getAccountProfile");
  const statusResposta = respostaAndroid("getAccountStatus");
  const status = (statusResposta.success && statusResposta.status) || {};
  const base = (resposta.success && resposta.user) || {};

  if (!resposta.success && !statusResposta.success) {
    return { success: false, error: "Não foi possível carregar os dados da conta agora." };
  }

  const accountExpiresAt =
    base.accountExpiresAt || base.expiresAt || status.accountExpiresAt || status.expiresAt || "";
  const createdAt = base.createdAt || status.createdAt || "";
  const lastUsedAt = base.lastUsedAt || status.lastUsedAt || "";
  let daysRemaining = base.daysRemaining ?? status.daysRemaining ?? status.diasRestantes;
  if (daysRemaining === undefined || daysRemaining === null || daysRemaining < 0) {
    daysRemaining = diasRestantesDe(accountExpiresAt);
  }

  return {
    success: true,
    user: {
      id: base.id || "",
      email: base.email || "",
      username: base.username || base.name || "",
      name: base.name || base.username || "",
      accountStatus: base.accountStatus || status.accountStatus || status.status || "active",
      accountExpiresAt,
      daysRemaining,
      createdAt,
      lastUsedAt,
      warning: base.warning || status.warning || null,
    },
  };
}

function tituloStatus(conta) {
  if (!conta?.success) return conta?.error || "Status indisponível no momento.";
  const user = conta.user || {};
  const situacao = statusContaLabel(user.accountStatus || "active");
  const validade = user.accountExpiresAt
    ? formatarData(user.accountExpiresAt, false)
    : "não informada";
  const dias = user.daysRemaining;
  const diasTxt =
    dias === undefined || dias === null ? "" : ` · ${Math.max(0, Number(dias) || 0)} dias restantes`;
  return `${situacao} · Expira: ${validade}${diasTxt}`;
}

function formatarData(valor, incluirHora = false) {
  if (!valor) return "Não informado";
  try {
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return valor;
    return new Intl.DateTimeFormat("pt-BR", incluirHora
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "long" }).format(data);
  } catch (_) {
    return valor;
  }
}

function statusContaLabel(status) {
  const valor = String(status || "").toLowerCase();
  if (valor === "active" || valor === "ativa") return "Conta ativa";
  if (valor === "expired" || valor === "expirada") return "Conta expirada";
  if (valor === "blocked" || valor === "bloqueada") return "Conta bloqueada";
  return status || "Status não informado";
}

function cabecalho(titulo, onBack, acao, textoAcao = "") {
  if (downloadRefreshTimer) {
    clearInterval(downloadRefreshTimer);
    downloadRefreshTimer = null;
  }
  if (downloadVisibilityHandler) {
    document.removeEventListener("visibilitychange", downloadVisibilityHandler);
    downloadVisibilityHandler = null;
  }
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.documentElement.scrollLeft = 0;
  const header = el("div", { class: "cfg-screen-head" });
  const left = el("div", { class: "cfg-screen-head-left" });
  if (onBack) {
    const back = el("button", { class: "cfg-back", type: "button", "aria-label": "Voltar", title: "Voltar" }, [
      icon("back", "cfg-back-glyph"),
    ]);
    back.addEventListener("click", onBack);
    left.append(back);
  }
  left.append(el("h1", {}, titulo));
  header.append(left);
  if (acao) header.append(button(textoAcao, "cfg-head-action", acao));
  return header;
}

function linhaOpcao(nomeIcone, titulo, descricao, onClick, complemento = null, mostrarChevron = true) {
  const row = el("button", { class: "cfg-row", type: "button" });
  row.append(icon(nomeIcone, "cfg-row-icon"));
  row.append(el("span", { class: "cfg-row-copy" }, [
    el("strong", {}, titulo),
    el("small", {}, descricao),
  ]));
  if (complemento) row.append(complemento);
  if (mostrarChevron) row.append(icon("chevron", "cfg-chevron"));
  if (onClick) row.addEventListener("click", onClick);
  return row;
}

function grupoOpcoes(titulo, descricao, opcoes, atual, aoEscolher) {
  const lista = el("div", { class: "cfg-choice-list" });
  opcoes.forEach((opcao) => {
    const item = el("button", { class: `cfg-choice${opcao.valor === atual ? " selected" : ""}`, type: "button" }, [
      el("span", { class: "cfg-radio" }),
      el("span", { class: "cfg-choice-copy" }, [
        el("strong", {}, opcao.titulo),
        el("small", {}, opcao.desc),
      ]),
    ]);
    item.addEventListener("click", () => {
      [...lista.children].forEach((child) => child.classList.remove("selected"));
      item.classList.add("selected");
      aoEscolher(opcao.valor);
    });
    lista.append(item);
  });
  return el("section", { class: "cfg-settings-section" }, [
    el("h2", {}, titulo),
    el("p", { class: "cfg-section-sub" }, descricao),
    lista,
  ]);
}

function perfilCard(perfil, ativo, onClick) {
  const card = el("button", { class: `cfg-profile-mini${perfil.id === ativo ? " selected" : ""}`, type: "button" });
  card.append(imgAvatar(perfil, "cfg-profile-mini-avatar", 160));
  card.append(el("span", {}, perfil.name || "Meu perfil"));
  if (perfil.id === ativo) card.append(el("i", { class: "cfg-profile-check" }, "✓"));
  card.addEventListener("click", onClick);
  return card;
}

function toast(text, tipo = "") {
  if (tipo === "error") {
    return errorDialog(text, { title: "Não foi possível concluir" });
  }
  return noticeDialog({
    tone: "success",
    icon: "success",
    title: "Operação concluída",
    message: String(text || "Tudo certo."),
  });
}

export default async function paginaConfiguracoes(raiz) {
  const page = el("div", { class: "page cfg cfg-shell" });
  const state = {
    screen: "home",
    perfis: [],
    ativo: "",
    perfilEditando: null,
    draftNome: "",
    draftAvatar: "",
  };

  function atualizarPerfis() {
    const dados = lerPerfis();
    state.perfis = dados.perfis;
    state.ativo = dados.ativo;
  }

  function renderHome() {
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    const prefs = lerPrefs();
    const perfil = perfilAtual(state.perfis, state.ativo);
    const conta = lerConta();
    const contaStatus = tituloStatus(conta);
    const header = cabecalho("Configurações", null, null);
    page.append(header, el("p", { class: "cfg-lead" }, "Gerencie sua conta, perfil e preferências."));

    const profileHero = el("section", { class: "cfg-account-hero" });
    const profileButton = el("button", { class: "cfg-account-profile", type: "button" });
    const avatarWrap = el("span", { class: "cfg-account-avatar-wrap" }, [
      imgAvatar(perfil, "cfg-account-avatar", 256),
      el("span", { class: "cfg-camera" }, [icon("camera")]),
    ]);
    profileButton.append(avatarWrap, el("span", { class: "cfg-account-copy" }, [
      el("strong", {}, perfil.name || "Meu perfil"),
      el("small", { class: "cfg-pill" }, state.perfis.length > 1 ? "Perfil selecionado" : "Perfil principal"),
      el("small", {}, "Toque para ver os dados do seu perfil"),
    ]), icon("chevron", "cfg-chevron"));
    profileButton.addEventListener("click", () => renderAccount(perfil));
    profileHero.append(profileButton);
    profileHero.append(el("div", { class: "cfg-account-status" }, [
      el("div", { class: "cfg-account-status-title" }, [el("span", { class: "cfg-status-dot" }), "Minha conta"]),
      el("p", {}, contaStatus),
    ]));
    page.append(profileHero);

    const contaSection = el("section", { class: "cfg-card cfg-card-group" });
    contaSection.append(el("div", { class: "cfg-group-label" }, "Minha conta"));
    contaSection.append(linhaOpcao("user", "Perfil", "Editar nome, avatar e gerenciar perfis.", () => renderProfiles()));
    page.append(contaSection);

    const downloadsSection = el("section", { class: "cfg-card cfg-card-group" });
    downloadsSection.append(linhaOpcao("download", "Meus downloads", "Acompanhe, pause, retome e assista aos conteúdos baixados.", () => renderDownloads()));
    page.append(downloadsSection);

    const favoritosSection = el("section", { class: "cfg-card cfg-card-group" });
    favoritosSection.append(linhaOpcao("heart", "Favoritos", "Acesse filmes e séries salvos.", () => window.AndroidPlayer?.openFavorites?.()));
    favoritosSection.append(button("Abrir favoritos  ›", "cfg-wide-button", () => window.AndroidPlayer?.openFavorites?.()));
    
    const continuarSection = el("section", { class: "cfg-card cfg-card-group" });
    continuarSection.append(
      linhaOpcao("play", "Continuar assistindo", "Remove itens que não abrem mais ou limpa a lista."),
    );
    continuarSection.append(
      button("Limpar Continuar assistindo  ›", "cfg-wide-button", async () => {
        if (!(await confirmDialog({ title: "Limpar histórico?", message: "Deseja apagar todo o histórico de Continuar assistindo neste aparelho?", icon: "trash", confirmText: "Limpar", cancelText: "Cancelar" }))) return;
        try {
          const raw = window.AndroidPlayer?.clearContinueWatching?.();
          const r = raw ? JSON.parse(raw) : { success: false };
          if (r.success === false) throw new Error(r.error || "Falha");
          // limpa cache da home
          try { sessionStorage.removeItem("tedflix:cw-covers:v1"); } catch (_) {}
          noticeDialog({ tone: "success", icon: "success", title: "Histórico limpo", message: "Sua lista de Continuar assistindo foi apagada." });
        } catch (e) {
          errorDialog(e.message || "Não foi possível limpar.", { title: "Não foi possível limpar o histórico" });
        }
      }),
    );
    page.append(continuarSection);

page.append(favoritosSection);

    const buscaSection = el("section", { class: "cfg-card cfg-card-group" });
    buscaSection.append(el("div", { class: "cfg-group-label" }, "Privacidade"));
    buscaSection.append(linhaOpcao("search", "Histórico de pesquisas", "Ver, apagar uma a uma ou limpar tudo.", () => renderSearchHistory()));
    page.append(buscaSection);

    const networkCard = el("section", { class: "cfg-card cfg-network-card" });
    const networkValue = el("strong", { class: "cfg-network-value" }, "medindo...");
    const networkTag = el("span", { class: "vel-tag" }, "");
    const networkDescription = el("p", { class: "cfg-section-sub" }, "Testando a sua conexão agora.");
    networkCard.append(el("div", { class: "cfg-card-title-line" }, [icon("globe", "cfg-colored green"), el("div", {}, [el("h2", {}, "Conexão"), el("p", { class: "cfg-section-sub" }, "Sua velocidade de rede e qualidade.")]), el("span", { class: "cfg-network-badge" }, [networkValue, networkTag])]));
    networkCard.append(networkDescription, button("Medir novamente", "cfg-wide-button", async () => {
      networkValue.textContent = "medindo...";
      pintarRede(await medir({ forcar: true }), networkValue, networkTag, networkDescription);
    }));
    page.append(networkCard);

    const playback = el("section", { class: "cfg-card cfg-card-group" });
    playback.append(linhaOpcao("play", "Reprodução", `Player ${prefs.player === "auto" ? "automático" : prefs.player} · buffer ${prefs.buffer}.`, () => renderPlayback()));
    page.append(playback);

    const versionCard = el("section", { class: "cfg-card cfg-version-card" }, [
      icon("info", "cfg-colored purple"),
      el("div", { class: "cfg-version-copy" }, [
        el("strong", {}, `Tedflix ${APP_VERSION}`),
        el("small", {}, `${APP_COMMIT_COUNT} commits consolidados nesta versão.`),
      ]),
      el("span", { class: "cfg-version-badge" }, "Atual"),
    ]);
    page.append(versionCard);

    const developerCard = el("section", { class: "cfg-card cfg-developer-card" }, [
      el("span", { class: "cfg-developer-mark" }, [icon("developer")]),
      el("div", { class: "cfg-developer-copy" }, [
        el("span", {}, "Desenvolvido por "),
        el("strong", {}, "Vtrbr"),
      ]),
    ]);
    page.append(developerCard);

    const system = el("section", { class: "cfg-card cfg-card-group" });
    system.append(linhaOpcao("logout", "Sair da conta", "Encerrar sessão neste dispositivo.", () => sair()));
    page.append(system);

    const cache = lerCache();
    if (cache && !cache.expirado) pintarRede(cache, networkValue, networkTag, networkDescription);
    medir().then((dados) => pintarRede(dados, networkValue, networkTag, networkDescription)).catch(() => pintarRede(null, networkValue, networkTag, networkDescription));
  }

  /** Anel circular estilo Netflix — preenche conforme o % do download */
  function circularProgress(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const size = 40;
    const stroke = 3.5;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c - (p / 100) * c;
    const wrap = el("div", { class: "nf-dl-ring", "aria-label": `${p}%` });
    wrap.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="nf-dl-ring-bg" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
        <circle class="nf-dl-ring-fg" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 ${size/2} ${size/2})"/>
      </svg>
      <span class="nf-dl-ring-pct">${p}<small>%</small></span>
    `;
    return wrap;
  }

  function renderDownloads() {
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.classList.add("nf-downloads-page");
    page.append(cabecalho("Downloads", renderHome));
    page.append(el("p", { class: "cfg-lead cfg-download-lead" }, "Seus filmes e episódios ficam disponíveis neste aparelho, inclusive sem internet."));

    const profileRow = el("div", { class: "nf-download-profile" });
    try {
      const profileState = lerPerfis();
      const profile = perfilAtual(profileState.perfis, profileState.ativo);
      profileRow.append(imgAvatar(profile, "nf-download-avatar", 96));
      profileRow.append(el("strong", {}, profile.name || "Meu perfil"));
    } catch (_) {
      profileRow.append(el("strong", {}, "Meus conteúdos"));
    }
    page.append(profileRow);

    const summary = el("p", { class: "cfg-download-summary nf-download-summary" }, "Carregando downloads…");
    page.append(summary);
    const queueTools = el("div", { class: "nf-download-queue-tools" });
    const resumeQueueButton = button("Retomar fila", "nf-download-text-action", () => {
      const r = respostaAndroid("resumePendingDownloadQueue");
      if (!r.success) errorDialog(r.error || "Não foi possível retomar a fila.", { title: "Não foi possível retomar" });
      refreshList();
    });
    const cancelQueueButton = button("Cancelar fila", "nf-download-text-action danger", async () => {
      if (!(await confirmDialog({ title: "Cancelar fila?", message: "Deseja cancelar os episódios que ainda aguardam preparação?", icon: "warning", confirmText: "Cancelar downloads", cancelText: "Continuar" }))) return;
      const r = respostaAndroid("cancelPendingDownloadQueue");
      if (!r.success) errorDialog(r.error || "Não foi possível cancelar.", { title: "Não foi possível cancelar" });
      refreshList();
    });
    resumeQueueButton.hidden = true;
    cancelQueueButton.hidden = true;
    queueTools.append(resumeQueueButton, cancelQueueButton);
    page.append(queueTools);

    const list = el("div", { class: "cfg-download-list nf-dl-list" });
    page.append(list);
    let downloadErrorDialogShown = false;

    function refreshList() {
      if (!page.isConnected) return;
      const response = respostaAndroid("getDownloads");
      list.innerHTML = "";
      if (!response.success) {
        const message = response.error || "Não foi possível carregar os downloads.";
        list.append(el("p", { class: "nf-download-message" }, message));
        if (!downloadErrorDialogShown) {
          downloadErrorDialogShown = true;
          errorDialog(message, { title: "Não foi possível carregar os downloads", icon: "download" });
        }
        return;
      }
      downloadErrorDialogShown = false;
      let items = response.items;
      if (typeof items === "string") {
        try { items = JSON.parse(items); } catch (_) { items = []; }
      }
      if (!Array.isArray(items)) items = [];
      const pendingQueue = Math.max(0, Number(response.pendingQueue) || 0);
      const completedCount = items.filter((item) => Number(item.state) === 3).length;
      const totalBytes = items.reduce((sum, item) => sum + (Number(item.contentLength) > 0 ? Number(item.contentLength) : Number(item.bytesDownloaded) || 0), 0);
      summary.textContent = items.length
        ? `${items.length} conteúdo${items.length === 1 ? "" : "s"} · ${formatarBytes(totalBytes)} ocupados · ${completedCount} concluído${completedCount === 1 ? "" : "s"}`
        : (pendingQueue ? `Preparando ${pendingQueue} episódio(s)…` : "0 conteúdo(s) · 0 B ocupados");
      resumeQueueButton.hidden = pendingQueue <= 0;
      cancelQueueButton.hidden = pendingQueue <= 0;

      if (!items.length) {
        list.append(el("section", { class: "nf-dl-empty" }, [
          el("div", { class: "nf-dl-empty-icon", html: svgIcone("download") }),
          el("strong", {}, pendingQueue ? "Preparando seus episódios" : "Nenhum download ainda"),
          el("p", {}, pendingQueue
            ? "Os episódios estão sendo preparados e entrarão na fila em instantes."
            : "Encontre filmes e séries e toque no ícone de download para assistir offline."),
          button("Encontrar títulos para baixar", "nf-download-find", () => { location.hash = "#/"; }),
        ]));
        return;
      }

      const labels = { 0: "Na fila", 1: "Pausado", 2: "Baixando", 3: "Concluído", 4: "Falhou", 5: "Removendo", 6: "Retomando", 7: "Reiniciando" };
      const grouped = new Map();
      items.forEach((item) => {
        const series = String(item.seriesTitle || "").trim();
        const seriesKey = String(item.seriesKey || "").trim();
        const key = series ? `series:${seriesKey || series}` : `item:${item.id}`;
        if (!grouped.has(key)) grouped.set(key, { title: series, items: [] });
        grouped.get(key).items.push(item);
      });

      grouped.forEach((group) => {
        if (group.title) list.append(el("h2", { class: "nf-download-group-title" }, group.title));
        group.items.forEach((item) => {
          const state = Number(item.state);
          const progress = Math.max(0, Math.min(100, Number(item.percent) || 0));
          const epLabel = Number(item.season) > 0 && Number(item.episode) > 0
            ? `Temporada ${item.season} · Episódio ${item.episode}` : "Filme";
          const card = el("article", { class: `nf-dl-item${state === 3 ? " is-complete" : ""}` });
          const posterWrap = el("div", { class: "nf-dl-poster" });
          const cover = el("img", { src: item.poster || "", alt: item.title || "", loading: "lazy", decoding: "async" });
          cover.addEventListener("error", () => { cover.style.opacity = "0"; });
          posterWrap.append(cover);
          if (state === 3) {
            const play = el("button", { type: "button", class: "nf-dl-play", "aria-label": "Assistir offline" }, "▶");
            play.onclick = () => {
              const r = respostaAndroid("playDownloaded", item.id);
              if (!r.success) errorDialog(r.error || "Não foi possível abrir o vídeo.", { title: "Não foi possível abrir" });
            };
            posterWrap.append(play);
          }

          const body = el("div", { class: "nf-dl-body" });
          const visibleTitle = item.episodeTitle || item.title || "Conteúdo";
          body.append(el("h3", {}, visibleTitle));
          body.append(el("p", { class: "nf-dl-meta" }, `${epLabel} · ${labels[state] || "Preparando"}`));
          const sizeLine = Number(item.contentLength) > 0
            ? `${formatarBytes(item.bytesDownloaded)} de ${formatarBytes(item.contentLength)}`
            : formatarBytes(item.bytesDownloaded);
          body.append(el("p", { class: "nf-dl-size" }, sizeLine));
          if (state !== 3 && state !== 4) {
            body.append(el("div", { class: "nf-dl-bar" }, [el("span", { style: `width:${progress}%` })]));
          }
          if (state === 4) body.append(el("p", { class: "nf-dl-error" }, item.failureReason ? `Erro ${item.failureReason}` : "Não foi possível concluir o download"));

          const status = el("div", { class: `nf-dl-status${state === 3 ? " is-complete" : ""}` });
          if (state === 3) status.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;
          else if (state === 2 || state === 0 || state === 6 || state === 7) status.append(circularProgress(progress));
          else if (state === 1) status.textContent = "Ⅱ";
          else if (state === 4) status.textContent = "!";
          card.append(posterWrap, body, status);

          const actions = el("div", { class: "nf-dl-actions" });
          if (state === 3) {
            actions.append(button("Assistir", "nf-dl-btn primary", () => {
              const r = respostaAndroid("playDownloaded", item.id);
              if (!r.success) errorDialog(r.error || "Não foi possível abrir o vídeo.", { title: "Não foi possível abrir" });
            }));
          } else if (state === 1) {
            actions.append(button("Retomar", "nf-dl-btn", () => { respostaAndroid("resumeDownload", item.id); refreshList(); }));
          } else if (state === 4) {
            actions.append(button("Tentar novamente", "nf-dl-btn", () => { respostaAndroid("retryDownload", item.id); refreshList(); }));
          } else {
            actions.append(button("Pausar", "nf-dl-btn", () => { respostaAndroid("pauseDownload", item.id); refreshList(); }));
          }
          actions.append(button("Excluir", "nf-dl-btn danger", async () => {
            if (!(await confirmDialog({ tone: "danger", icon: "trash", title: "Excluir download?", message: `Deseja excluir “${visibleTitle}” dos seus downloads?`, confirmText: "Excluir", cancelText: "Cancelar" }))) return;
            const r = respostaAndroid("removeDownload", item.id);
            if (!r.success) errorDialog(r.error || "Não foi possível excluir.", { title: "Não foi possível excluir" });
            else noticeDialog({ tone: "success", icon: "success", title: "Download removido", message: `“${visibleTitle}” foi removido dos seus downloads.` });
            refreshList();
          }));
          card.append(actions);
          list.append(card);
        });
      });
    }

    let lastDownloadFingerprint = "";
    const originalRefreshList = refreshList;
    refreshList = function softRefreshList() {
      if (!page.isConnected) return;
      const response = respostaAndroid("getDownloads");
      if (!response.success) {
        originalRefreshList();
        return;
      }
      let items = response.items;
      if (typeof items === "string") {
        try { items = JSON.parse(items); } catch (_) { items = []; }
      }
      if (!Array.isArray(items)) items = [];
      // Fingerprint estrutural: só reconstrói a lista quando mudam IDs ou estados “duros”.
      // Progresso (%) é atualizado no lugar para evitar piscada da tela.
      const fingerprint = items.map((it) => `${it.id}:${Number(it.state)}`).join("|") + `|pq:${Number(response.pendingQueue) || 0}`;
      if (fingerprint === lastDownloadFingerprint && list.querySelectorAll(".nf-dl-item").length === items.length) {
        const byId = new Map(items.map((it) => [String(it.id), it]));
        list.querySelectorAll(".nf-dl-item").forEach((card) => {
          const id = card.dataset.downloadId;
          const item = byId.get(id);
          if (!item) return;
          const progress = Math.max(0, Math.min(100, Number(item.percent) || 0));
          const bar = card.querySelector(".nf-dl-bar > span");
          if (bar) bar.style.width = `${progress}%`;
          const sizeEl = card.querySelector(".nf-dl-size");
          if (sizeEl) {
            const sizeLine = Number(item.contentLength) > 0
              ? `${formatarBytes(item.bytesDownloaded)} de ${formatarBytes(item.contentLength)}`
              : formatarBytes(item.bytesDownloaded);
            sizeEl.textContent = sizeLine;
          }
        });
        const completedCount = items.filter((item) => Number(item.state) === 3).length;
        const totalBytes = items.reduce((sum, item) => sum + (Number(item.contentLength) > 0 ? Number(item.contentLength) : Number(item.bytesDownloaded) || 0), 0);
        summary.textContent = items.length
          ? `${items.length} conteúdo${items.length === 1 ? "" : "s"} · ${formatarBytes(totalBytes)} ocupados · ${completedCount} concluído${completedCount === 1 ? "" : "s"}`
          : summary.textContent;
        return;
      }
      lastDownloadFingerprint = fingerprint;
      originalRefreshList();
      // Marca IDs nos cards recém-criados para o soft update.
      const cards = list.querySelectorAll(".nf-dl-item");
      let idx = 0;
      items.forEach((item) => {
        const card = cards[idx++];
        if (card) card.dataset.downloadId = String(item.id);
      });
    };
    refreshList();
    const iniciarAtualizacao = () => {
      if (downloadRefreshTimer || document.hidden) return;
      // 5s é suficiente para progresso e reduz trabalho na UI (menos piscadas/CPU).
      downloadRefreshTimer = setInterval(refreshList, 5000);
    };
    const pararAtualizacao = () => {
      if (downloadRefreshTimer) clearInterval(downloadRefreshTimer);
      downloadRefreshTimer = null;
    };
    downloadVisibilityHandler = () => {
      if (document.hidden) pararAtualizacao();
      else { refreshList(); iniciarAtualizacao(); }
    };
    document.addEventListener("visibilitychange", downloadVisibilityHandler);
    iniciarAtualizacao();
  }

  function renderAccount(perfil) {
    // Sempre relê perfis do bridge — evita avatar vazio/desatualizado
    try {
      const dados = lerPerfis();
      perfil = perfilAtual(dados.perfis, dados.ativo) || perfil;
    } catch (_) {}
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Minha conta", renderHome));
    page.append(el("p", { class: "cfg-lead" }, "Veja os dados da sua conta e o status da sua assinatura."));

    const resposta = lerConta();
    if (!resposta.success) {
      page.append(el("section", { class: "cfg-card cfg-account-error" }, [
        icon("user", "cfg-colored red"),
        el("div", {}, [
          el("strong", {}, "Não foi possível carregar os dados"),
          el("p", {}, resposta.error || "Tente novamente em alguns instantes."),
        ]),
        button("Tentar novamente", "cfg-wide-button", () => renderAccount(perfil)),
      ]));
      return;
    }

    const user = resposta.user || {};
    const status = String(user.accountStatus || "").toLowerCase();
    const ativo = status === "active" || status === "ativa";
    const dias = Number.isFinite(Number(user.daysRemaining)) ? Number(user.daysRemaining) : null;
    const warning = user.warning && typeof user.warning === "object" ? user.warning : null;
    const nome = user.username || perfil?.name || "Minha conta";
    const avatar = el("div", { class: "cfg-account-detail-avatar" }, [imgAvatar(perfil, "cfg-account-detail-avatar-img", 320)]);
    const identity = el("div", { class: "cfg-account-detail-identity" }, [
      el("h2", {}, nome),
      el("p", {}, user.email || perfil?.email || "E-mail não informado"),
      el("span", { class: `cfg-account-status-badge${ativo ? " active" : " inactive"}` }, [
        el("span", { class: "cfg-status-dot" }), statusContaLabel(user.accountStatus),
      ]),
      user.id ? el("small", {}, `ID da conta: ${user.id}`) : null,
    ].filter(Boolean));
    page.append(el("section", { class: "cfg-account-detail-hero" }, [avatar, identity]));

    const subscription = el("section", { class: "cfg-card cfg-subscription-card" });
    const daysLabel = dias === null ? "—" : String(Math.max(0, dias));
    subscription.append(el("div", { class: "cfg-subscription-heading" }, [
      el("div", {}, [el("span", { class: "cfg-eyebrow" }, "Sua assinatura"), el("strong", {}, daysLabel), el("span", { class: "cfg-days-label" }, dias === 1 ? "dia restante" : "dias restantes")]),
      el("div", { class: `cfg-days-ring${ativo ? " active" : ""}` }, [el("strong", {}, daysLabel), el("small", {}, "dias")]),
    ]));
    if (dias !== null) {
      const progress = el("div", { class: "cfg-days-progress" });
      const percent = Math.max(4, Math.min(100, Math.round((dias / Math.max(dias, 30)) * 100)));
      progress.append(el("span", { style: `width:${percent}%` }));
      subscription.append(progress);
    }
    subscription.append(el("p", { class: "cfg-subscription-expiry" }, `Expira em ${formatarData(user.accountExpiresAt)}`));
    page.append(subscription);

    if (warning) {
      page.append(el("section", { class: "cfg-account-warning" }, [
        icon("alert", "cfg-colored red"),
        el("div", {}, [el("strong", {}, "Sua assinatura está perto de expirar"), el("p", {}, warning.message || `Sua assinatura expira em ${warning.daysLeft ?? dias ?? "poucos"} dias.`)]),
      ]));
    }

    const info = el("section", { class: "cfg-card cfg-account-info" });
    info.append(el("div", { class: "cfg-group-label" }, "Informações da conta"));
    info.append(linhaOpcao("shield", "Status da conta", statusContaLabel(user.accountStatus), null, el("strong", { class: `cfg-info-value${ativo ? " active" : ""}` }, ativo ? "Ativa" : (user.accountStatus || "Não informado")), false));
    info.append(linhaOpcao("calendar", "Membro desde", formatarData(user.createdAt), null, null, false));
    info.append(linhaOpcao("clock", "Último acesso", formatarData(user.lastUsedAt, true), null, null, false));
    info.append(linhaOpcao("calendar", "Expiração da conta", formatarData(user.accountExpiresAt), null, null, false));
    page.append(info);
  }

  function pintarRede(dados, valor, tag, detalhe) {
    const nivelRede = nivel(dados?.mbps);
    valor.textContent = dados?.mbps ? `${dados.mbps.toFixed(2)} Mbps` : "indisponível";
    tag.textContent = ROTULO[nivelRede] || "";
    tag.className = `vel-tag ${nivelRede}`;
    detalhe.textContent = nivelRede === "lenta"
      ? "Conexão fraca: as capas vêm menores e o player começa em qualidade baixa."
      : nivelRede === "media"
        ? "Dá para assistir bem em qualidade média."
        : nivelRede === "desconhecida"
          ? "Não deu para medir agora."
          : "Conexão boa: qualidade alta liberada.";
  }

  function renderProfiles() {
    atualizarPerfis();
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Perfis", renderHome));
    page.append(el("p", { class: "cfg-lead" }, "Escolha quem está assistindo ou adicione um novo perfil."));
    const grid = el("div", { class: "cfg-profiles-grid" });
    state.perfis.forEach((perfil) => grid.append(perfilCard(perfil, state.ativo, () => selecionarPerfil(perfil))));
    const add = el("button", { class: "cfg-profile-add", type: "button" }, [el("span", { class: "cfg-add-circle" }, [icon("plus")]), el("strong", {}, "Adicionar perfil")]);
    add.addEventListener("click", () => renderAddProfile());
    grid.append(add);
    page.append(grid);
    page.append(el("section", { class: "cfg-card cfg-profile-manage" }, [
      linhaOpcao("people", "Gerenciar perfis", "Editar, excluir e organizar os perfis criados.", () => renderManageProfiles()),
    ]));
  }

  function selecionarPerfil(perfil) {
    const resposta = respostaAndroid("activateProfileFromSettings", perfil.id);
    if (!resposta.success) {
      toast(resposta.error || "Não foi possível selecionar o perfil.", "error");
      return;
    }
    atualizarPerfis();
    toast(`Perfil ${perfil.name} selecionado.`);
    renderProfiles();
  }

  function renderManageProfiles() {
    atualizarPerfis();
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Gerenciar perfis", renderProfiles));
    const list = el("section", { class: "cfg-card cfg-manage-list" });
    state.perfis.forEach((perfil) => {
      const row = el("div", { class: "cfg-manage-row" }, [
        imgAvatar(perfil, "cfg-manage-avatar", 128),
        el("div", { class: "cfg-manage-copy" }, [el("strong", {}, perfil.name), el("small", {}, perfil.id === state.ativo ? "Perfil principal" : "Perfil adicional")]),
        (() => {
          const edit = button("", "cfg-icon-button", () => renderProfileEdit(perfil, perfil.name, perfil.avatarSeed, renderManageProfiles));
          edit.append(icon("pencil"));
          return edit;
        })(),
      ]);
      list.append(row);
    });
    const addRow = el("button", { class: "cfg-manage-add", type: "button" }, [el("span", { class: "cfg-add-circle small" }, [icon("plus")]), el("strong", {}, "Adicionar perfil")]);
    addRow.addEventListener("click", () => renderAddProfile());
    list.append(addRow);
    page.append(list);
  }

  function renderAvatarPicker(currentSeed, onPick, onBack) {
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Escolher avatar", onBack || (() => renderProfileEdit(state.perfilEditando))));
    page.append(el("p", { class: "cfg-lead" }, "Escolha um avatar para este perfil."));
    const grid = el("div", { class: "cfg-avatar-grid" });
    AVATAR_SEEDS.forEach((seed) => {
      const item = el("button", { class: `cfg-avatar-option${seed === currentSeed ? " selected" : ""}`, type: "button" }, [
        imgAvatar({ avatarSeed: seed, name: "Avatar" }, "cfg-picker-avatar", 256),
        seed === currentSeed ? el("span", { class: "cfg-avatar-check" }, "✓") : null,
      ]);
      item.addEventListener("click", () => onPick(seed));
      grid.append(item);
    });
    page.append(grid, button("Cancelar", "cfg-cancel-button", onBack || (() => renderProfileEdit(state.perfilEditando))));
  }

  function renderProfileEdit(perfil, draftNome = perfil?.name || "", draftAvatar = perfil?.avatarSeed || DEFAULT_SEED, onBack = renderProfiles) {
    state.perfilEditando = perfil;
    state.editBack = onBack;
    state.draftNome = draftNome;
    state.draftAvatar = draftAvatar;
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Editar perfil", onBack));
    const editor = el("section", { class: "cfg-profile-editor" });
    const preview = el("div", { class: "cfg-editor-preview" }, [
      imgAvatar({ avatarSeed: state.draftAvatar, avatarStyle: perfil?.avatarStyle || "fun-emoji", name: perfil?.name || "Avatar" }, "cfg-editor-avatar", 320),
      el("span", { class: "cfg-editor-camera" }, [icon("camera")]),
    ]);
    preview.addEventListener("click", () => renderAvatarPicker(state.draftAvatar, (seed) => renderProfileEdit(perfil, nameInput.value, seed, onBack), () => renderProfileEdit(perfil, nameInput.value, state.draftAvatar, onBack)));
    editor.append(preview, el("label", { class: "cfg-field-label" }, "Nome do perfil"));
    const nameInput = el("input", { class: "input cfg-field", type: "text", value: draftNome, maxlength: "40", autocomplete: "nickname" });
    editor.append(nameInput, el("label", { class: "cfg-field-label" }, "Escolher avatar"));
    const strip = el("div", { class: "cfg-avatar-strip" });
    AVATAR_SEEDS.slice(0, 6).forEach((seed) => {
      const mini = el("button", { class: `cfg-strip-option${seed === state.draftAvatar ? " selected" : ""}`, type: "button" }, imgAvatar({ avatarSeed: seed, avatarStyle: perfil?.avatarStyle || "fun-emoji", name: "Avatar" }, "cfg-strip-avatar", 128));
      mini.addEventListener("click", () => {
        state.draftAvatar = seed;
        [...strip.children].forEach((child) => child.classList.remove("selected"));
        mini.classList.add("selected");
        preview.querySelector("img").src = avatarUrl(seed, 320, perfil?.avatarStyle || "fun-emoji");
      });
      strip.append(mini);
    });
    const choose = button("Escolher outro avatar", "cfg-wide-button", () => renderAvatarPicker(state.draftAvatar, (seed) => renderProfileEdit(perfil, nameInput.value, seed, onBack), () => renderProfileEdit(perfil, nameInput.value, state.draftAvatar, onBack)));
    editor.append(strip, choose, button("Salvar alterações", "cfg-save-button", () => salvarPerfil(perfil, nameInput.value, state.draftAvatar)));
    if (perfil && state.perfis.length > 1) editor.append(button("Excluir perfil", "cfg-delete-link", () => confirmarExclusao(perfil)));
    page.append(editor);
  }

  function salvarPerfil(perfil, nome, avatarSeed) {
    const valor = String(nome || "").trim();
    if (valor.length < 2) {
      toast("Digite um nome de perfil válido.", "error");
      return;
    }

    // O perfil pode ter sido carregado antes da ponte concluir a sincronização.
    // Atualizar aqui evita rejeitar uma referência visual com ID legado/vazio.
    atualizarPerfis();
    const requestedId = String(perfil?.id || "").trim();
    const resolved = state.perfis.find((item) => item.id === requestedId)
      || state.perfis.find((item) => item.id === state.ativo)
      || state.perfis[0];
    const profileId = String(resolved?.id || "").trim();
    if (!profileId) {
      toast("Sessão de perfil indisponível. Volte à tela de perfis e selecione o perfil novamente.", "error");
      return;
    }

    const resposta = respostaAndroid("updateStoredProfile", profileId, valor, String(avatarSeed || resolved.avatarSeed || DEFAULT_SEED));
    if (!resposta.success) {
      toast(resposta.error || "Não foi possível salvar o perfil.", "error");
      return;
    }
    atualizarPerfis();
    const atualizado = state.perfis.find((item) => item.id === profileId) || { ...resolved, id: profileId, name: valor, avatarSeed };
    toast("Perfil atualizado.");
    renderProfileEdit(atualizado, valor, avatarSeed, state.editBack || renderProfiles);
  }

  function renderAddProfile(draft = {}) {
    state.perfilEditando = null;
    state.draftAvatar = draft.avatar || state.draftAvatar || AVATAR_SEEDS[Math.min(state.perfis.length, AVATAR_SEEDS.length - 1)];
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Adicionar perfil", renderProfiles));
    const editor = el("section", { class: "cfg-profile-editor cfg-add-editor" });
    const preview = el("div", { class: "cfg-editor-preview" }, [imgAvatar({ avatarSeed: state.draftAvatar, name: "Novo perfil" }, "cfg-editor-avatar", 320), el("span", { class: "cfg-editor-camera" }, [icon("camera")])]);
    const nameInput = el("input", { class: "input cfg-field", type: "text", placeholder: "Nome do perfil", maxlength: "40", value: draft.name || "" });
    const draftAtual = () => ({ name: nameInput.value, avatar: state.draftAvatar });
    const abrirAvatar = () => renderAvatarPicker(state.draftAvatar, (seed) => renderAddProfile({ ...draftAtual(), avatar: seed }), () => renderAddProfile(draftAtual()));
    const avatarButton = button("Escolher avatar", "cfg-wide-button", abrirAvatar);
    preview.addEventListener("click", abrirAvatar);
    editor.append(preview, el("label", { class: "cfg-field-label" }, "Nome do perfil"), nameInput, avatarButton, button("Criar perfil", "cfg-save-button", () => {
      if (!nameInput.value.trim()) {
        toast("Preencha o nome do perfil.", "error");
        return;
      }
      const resposta = respostaAndroid("createProfileFromSettings", "", "", "", nameInput.value.trim(), state.draftAvatar);
      if (!resposta.success) {
        toast(resposta.error || "Não foi possível adicionar o perfil.", "error");
        return;
      }
      atualizarPerfis();
      toast("Perfil adicionado.");
      renderProfiles();
    }));
    page.append(editor);
  }

  async function confirmarExclusao(perfil) {
    const confirmado = await confirmDialog({
      tone: "danger",
      icon: "trash",
      title: "Excluir perfil?",
      message: `Deseja excluir o perfil “${perfil.name || "este perfil"}”? Esta ação não pode ser desfeita.`,
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!confirmado) return;
    const resposta = respostaAndroid("deleteProfileFromSettings", perfil.id);
    if (!resposta.success) {
      errorDialog(resposta.error || "Não foi possível excluir o perfil.", { title: "Falha ao excluir perfil" });
      return;
    }
    atualizarPerfis();
    renderManageProfiles();
    noticeDialog({ tone: "success", icon: "success", title: "Perfil excluído", message: `O perfil “${perfil.name || "selecionado"}” foi removido.` });
  }

  let historicoBuscaAlteradoLocalmente = false;
  let historicoBuscaKey = null;

  function chaveHistoricoBuscaLocal() {
    if (historicoBuscaKey) return historicoBuscaKey;
    try {
      const dados = JSON.parse(window.AndroidPlayer?.getProfiles?.() || "{}");
      historicoBuscaKey = `tedflix:search-history:${dados.activeId || "guest"}`;
    } catch (_) {
      historicoBuscaKey = "tedflix:search-history:guest";
    }
    return historicoBuscaKey;
  }

  function lerHistoricoBuscaLocal() {
    try {
      const itens = JSON.parse(localStorage.getItem(chaveHistoricoBuscaLocal()) || "[]");
      return Array.isArray(itens)
        ? itens.map((item) => typeof item === "string"
          ? { query: item, id: encodeURIComponent(item.toLowerCase()) }
          : { ...item, query: String(item.query || "").trim() })
          .filter((item) => item.query)
          .slice(0, 20)
        : [];
    } catch (_) {
      return [];
    }
  }

  function salvarHistoricoBuscaLocal(itens) {
    try {
      localStorage.setItem(chaveHistoricoBuscaLocal(), JSON.stringify(itens.slice(0, 20)));
    } catch (_) {}
  }

  function renderSearchHistory(buscarRemoto = true) {
    if (buscarRemoto) historicoBuscaAlteradoLocalmente = false;
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    page.append(cabecalho("Histórico de pesquisas", renderHome));
    page.append(el("p", { class: "cfg-lead" }, "Pesquisas salvas neste perfil. Apague uma a uma ou limpe tudo."));
    const lista = el("div", { class: "cfg-card cfg-card-group" });
    page.append(lista);

    const renderLista = (itens) => {
      if (!page.isConnected) return;
      lista.innerHTML = "";
      if (!itens.length) {
        lista.append(el("p", { class: "cfg-section-sub", style: "padding:12px 4px" }, "Nenhuma pesquisa salva."));
        return;
      }
      itens.forEach((item) => {
        const query = String(item.query || "").trim();
        if (!query) return;
        const row = el("div", { class: "cfg-search-row" });
        row.append(el("span", { class: "cfg-search-query" }, query));
        const del = button("Apagar", "cfg-icon-button cfg-search-del", async () => {
          const confirmado = await confirmDialog({
            tone: "danger", icon: "trash", title: "Excluir pesquisa?",
            message: `Deseja remover “${query}” do histórico?`,
            confirmText: "Excluir", cancelText: "Cancelar",
          });
          if (!confirmado) return;
          const id = String(item.id || encodeURIComponent(query.toLowerCase()));
          const atualizados = lerHistoricoBuscaLocal().filter((x) =>
            String(x.id || "") !== id && String(x.query || "").toLowerCase() !== query.toLowerCase(),
          );
          historicoBuscaAlteradoLocalmente = true;
          salvarHistoricoBuscaLocal(atualizados);
          respostaAndroid("deleteSearchHistoryItem", id);
          toast("Pesquisa removida.");
          renderSearchHistory(false);
        });
        row.append(del);
        lista.append(row);
      });
    };

    // Conteúdo local aparece imediatamente; nunca espera a consulta remota.
    renderLista(lerHistoricoBuscaLocal());

    page.append(button("Limpar todo o histórico", "cfg-delete-link", async () => {
      const confirmado = await confirmDialog({
        tone: "danger", icon: "trash", title: "Limpar histórico?",
        message: "Todas as pesquisas recentes deste perfil serão apagadas.",
        confirmText: "Limpar tudo", cancelText: "Cancelar",
      });
      if (!confirmado) return;
      historicoBuscaAlteradoLocalmente = true;
      salvarHistoricoBuscaLocal([]);
      respostaAndroid("clearSearchHistory");
      noticeDialog({ tone: "success", icon: "success", title: "Histórico limpo", message: "Todas as pesquisas recentes foram removidas." });
      renderSearchHistory(false);
    }));

    if (buscarRemoto) {
      window.__tedflixSearchHistoryReady = (payload) => {
        if (!page.isConnected) return;
        let resposta = payload;
        try {
          if (typeof resposta === "string") resposta = JSON.parse(resposta || "null");
        } catch (_) { return; }
        if (!resposta || resposta.success !== true || !Array.isArray(resposta.history)) return;
        const remoto = resposta.history
          .map((item) => ({
            id: String(item?.id || encodeURIComponent(String(item?.query || "").toLowerCase())),
            query: String(item?.query || "").trim(),
          }))
          .filter((item) => item.query.length >= 2)
          .slice(0, 20);
        if (remoto.length && !historicoBuscaAlteradoLocalmente) {
          salvarHistoricoBuscaLocal(remoto);
          renderLista(remoto);
        }
      };
      try {
        window.AndroidPlayer?.requestSearchHistoryAsync?.();
      } catch (_) {}
    }
  }

  function renderPlayback() {
    page.innerHTML = "";
    page.classList.remove("nf-downloads-page");
    const prefs = lerPrefs();
    page.append(cabecalho("Reprodução", renderHome));
    page.append(el("p", { class: "cfg-lead" }, "Escolha como o Tedflix deve preparar e reproduzir seus vídeos."));
    page.append(grupoOpcoes("Player", "A interface atual mantém o player nativo HLS para filmes e séries.", OPCOES_PLAYER, prefs.player, (valor) => salvarPrefs({ player: valor })));
    page.append(grupoOpcoes("Buffer", "Quanto vídeo é carregado à frente. Mais buffer reduz travamentos em rede instável.", OPCOES_BUFFER, prefs.buffer, (valor) => {
      salvarPrefs({ buffer: valor });
      window.AndroidPlayer?.setBuffer?.(valor);
    }));
    page.append(el("section", { class: "cfg-card cfg-info-card" }, [icon("play", "cfg-colored purple"), el("p", {}, "O player Android continua sendo o responsável pela reprodução HLS em tela cheia horizontal." )]));
  }

  async function sair() {
    const confirmado = await confirmDialog({
      tone: "danger",
      icon: "logout",
      title: "Sair da conta?",
      message: "Deseja encerrar sua sessão neste dispositivo?",
      confirmText: "Sair",
      cancelText: "Continuar conectado",
    });
    if (!confirmado) return;
    const resposta = respostaAndroid("logoutFromSettings");
    if (!resposta.success) errorDialog(resposta.error || "Não foi possível sair da conta.", { title: "Falha ao sair" });
    else noticeDialog({ tone: "success", icon: "success", title: "Sessão encerrada", message: "Você saiu da sua conta neste dispositivo." });
  }

  atualizarPerfis();
  raiz.append(page);

  // Deep-link: #/config?secao=historico-busca (botão "Ver todas" da busca)
  try {
    const params = new URLSearchParams((location.hash.split("?")[1] || ""));
    if (params.get("secao") === "historico-busca") {
      renderSearchHistory();
    } else if (params.get("secao") === "downloads") {
      renderDownloads();
    } else {
      renderHome();
    }
  } catch (_) {
    renderHome();
  }

  return page;
}

try {
  const _orig = window.syncTopbarAvatar;
  // re-sync when leaving settings
  window.addEventListener("hashchange", () => {
    try { window.syncTopbarAvatar?.(); } catch (_) {}
  });
} catch (_) {}
