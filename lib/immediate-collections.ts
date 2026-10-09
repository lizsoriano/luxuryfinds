type ImmediateCollection = { id: string; label: string; terms: string[]; categorySlugs?: string[]; brandTerms?: string[] };

export const IMMEDIATE_COLLECTIONS: ImmediateCollection[] = [
  { id: "snoopy", label: "Snoopy", terms: ["snoopy", "peanuts"] },
  { id: "bolsas", label: "Bolsas", terms: ["bolsa", "tote", "handbag", "shoulder bag", "crossbody"], categorySlugs: ["bolsas", "bolsas-y-cosmetiqueras"] },
  { id: "carteras", label: "Carteras", terms: ["cartera", "monedero", "wallet"] },
  { id: "rosita-fresita", label: "Rosita Fresita", terms: ["rosita fresita", "strawberry shortcake"], categorySlugs: ["strawberry-shortcake"] },
  { id: "zapatos", label: "Zapatos", terms: ["zapato", "tenis", "chancla", "sandalia", "pantufla", "sneaker", "slipper"], categorySlugs: ["zapatos", "calzado"] },
  { id: "maquillaje", label: "Maquillaje", terms: ["maquillaje", "makeup", "lip ", "lipstick", "lipgloss", "gloss", "labial", "blush", "rubor", "mascara", "máscara", "foundation", "concealer", "corrector", "sombras", "cheek", "bronzer", "delineador"], categorySlugs: ["makeup", "maquillaje-burligton-ross", "blushes", "cejas", "concealers", "contornos-y-bronzers", "delineador-labios", "delineador-ojos", "foundations", "highlight", "kits-minis-labios", "labios", "mascaras", "ojos", "polvos", "primers-y-fijadores"] },
  { id: "cobijas", label: "Cobijas", terms: ["cobija", "frazada", "edredón", "edredon", "blanket", "throw"] },
  { id: "tazas", label: "Tazas", terms: ["taza", "mug"] },
  { id: "loncheras", label: "Loncheras", terms: ["lonchera", "lunch bag", "lunchbox", "lunch box"] },
  { id: "calcetines", label: "Calcetines", terms: ["calcetín", "calcetin", "calcetines", "sock"] },
  { id: "bath-and-body", label: "Bath and Body", terms: ["bath and body", "bath & body", "b&bw", "bbw"], categorySlugs: ["bath-and-body"], brandTerms: ["bath", "b&bw", "bbw"] },
  { id: "victoria-secret", label: "Victoria Secret", terms: ["victoria secret", "victoria's secret", "victorias secret"], brandTerms: ["victoria secret", "victoria's secret", "victorias secret"] },
  { id: "hombre", label: "Hombre", terms: ["hombre", "caballero", "men's", "mens", "for men"], categorySlugs: ["hombre", "caballero"] },
  { id: "termos", label: "Termos", terms: ["termo", "botella", "tumbler", "bottle", "owala", "stanley"], categorySlugs: ["termos-y-botellas"], brandTerms: ["owala", "stanley"] },
  { id: "sephora", label: "Sephora", terms: ["sephora"], categorySlugs: ["sephora"], brandTerms: ["sephora"] },
];

export function getImmediateCollection(id?: string) {
  return IMMEDIATE_COLLECTIONS.find((collection) => collection.id === id);
}

export function immediateCollectionHref(id?: string, page = 1) {
  const params = new URLSearchParams();
  if (getImmediateCollection(id)) params.set("coleccion", id!);
  if (page > 1) params.set("pagina", String(page));
  return `/entrega-inmediata${params.size ? `?${params}` : ""}`;
}
