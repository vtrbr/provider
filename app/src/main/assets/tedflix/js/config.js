/** APIs oficiais do aplicativo. */
export const CONTENT_API_BASE = "https://api.tedflix.site";
export const PLUTO_API_BASE = "https://pluto.tedflix.site";
export const LOGIN_API_BASE = "https://login.tedflix.site";
// Serviços auxiliares independentes.
export const TEDTOP_API_BASE = "https://v6-tedtop.onrender.com";

/** Categorias disponíveis no provider (server1/categorias). */
export const CATEGORIAS = [
  { slug: "acao", label: "Ação" },
  { slug: "animacao", label: "Animação" },
  { slug: "aventura", label: "Aventura" },
  { slug: "comedia", label: "Comédia" },
  { slug: "crime", label: "Crime" },
  { slug: "documentario", label: "Documentário" },
  { slug: "drama", label: "Drama" },
  { slug: "familia", label: "Família" },
  { slug: "fantasia", label: "Fantasia" },
  { slug: "faroeste", label: "Faroeste" },
  { slug: "ficcao-cientifica", label: "Ficção científica" },
  { slug: "guerra", label: "Guerra" },
  { slug: "historia", label: "História" },
  { slug: "kids", label: "Kids" },
  { slug: "misterio", label: "Mistério" },
  { slug: "musica", label: "Música" },
  { slug: "nacionais", label: "Nacionais" },
  { slug: "policial", label: "Policial" },
  { slug: "reality", label: "Reality" },
  { slug: "romance", label: "Romance" },
  { slug: "suspense", label: "Suspense" },
  { slug: "terror", label: "Terror" },
];

export const NAV = [
  { href: "#/", label: "Início", icon: "home" },
  { href: "#/series", label: "Séries", icon: "tv" },
  { href: "#/filmes", label: "Filmes", icon: "film" },
  { href: "#/categorias", label: "Categorias", icon: "grid" },
  { href: "#/config", label: "Configurações", icon: "gear" },
];
