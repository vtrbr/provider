/**
 * Tabela canônica de gêneros — Home + Categorias.
 * fontes: catálogo agregado pelo Content Server atual
 */
export const GENEROS_CANONICOS = [
  { slug: "acao", label: "Ação", fontes: ["v1", "v3"], tom: "#c45c4a", ico: "trend" },
  { slug: "aventura", label: "Aventura", fontes: ["v3"], tom: "#b8733a", ico: "nav" },
  { slug: "animacao", label: "Animação", fontes: ["v1", "v3"], tom: "#4a7ab5", ico: "smile" },
  { slug: "comedia", label: "Comédia", fontes: ["v1", "v3"], tom: "#b89a3a", ico: "smile" },
  { slug: "crime", label: "Crime", fontes: ["v3"], tom: "#6b4a5a", ico: "shield" },
  { slug: "documentario", label: "Documentário", fontes: ["v1", "v3"], tom: "#3a7a7a", ico: "play" },
  { slug: "drama", label: "Drama", fontes: ["v1", "v3"], tom: "#4a5a8a", ico: "film" },
  { slug: "familia", label: "Família", fontes: ["v3"], tom: "#3a7a55", ico: "home" },
  { slug: "fantasia", label: "Fantasia", fontes: ["v1", "v3"], tom: "#6a4a9a", ico: "star" },
  { slug: "faroeste", label: "Faroeste", fontes: ["v1", "v3"], tom: "#7a6a4a", ico: "pin" },
  { slug: "ficcao-cientifica", label: "Ficção Científica", fontes: ["v1", "v3"], tom: "#3a6a9a", ico: "rocket" },
  { slug: "guerra", label: "Guerra", fontes: ["v3"], tom: "#6a4a3a", ico: "alert" },
  { slug: "historia", label: "História", fontes: ["v3"], tom: "#5a6a4a", ico: "book" },
  { slug: "kids", label: "Kids", fontes: ["v3"], tom: "#4a8a6a", ico: "smile" },
  { slug: "misterio", label: "Mistério", fontes: ["v1", "v3"], tom: "#3a4a6a", ico: "search" },
  { slug: "musica", label: "Música", fontes: ["v3"], tom: "#7a4a8a", ico: "music" },
  { slug: "reality", label: "Reality", fontes: ["v3"], tom: "#7a5a4a", ico: "tv" },
  { slug: "romance", label: "Romance", fontes: ["v1", "v3"], tom: "#8a4a6a", ico: "heart" },
  { slug: "suspense", label: "Suspense", fontes: ["v1", "v3"], tom: "#5a4a6a", ico: "alert" },
  { slug: "terror", label: "Terror", fontes: ["v1", "v3"], tom: "#8a3a3a", ico: "alert" },
];

/** Subconjunto para fileiras da Home (ordem de exibição). */
export const GENEROS_HOME = [
  "acao",
  "animacao",
  "aventura",
  "comedia",
  "drama",
  "ficcao-cientifica",
  "romance",
  "suspense",
  "terror",
  "fantasia",
  "misterio",
  "familia",
];
