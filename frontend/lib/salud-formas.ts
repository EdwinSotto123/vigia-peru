/**
 * Las formas de un medicamento en diez grupos, con su dibujo de píxeles (Gobserva Salud, 2026-11-22; el usuario: «QUE
 * SEA TIPO MARKETPLACE, donde se muestre cuadros en PIXEL ART»). La API agrupa igual (FORMA_GRUPO_SQL en
 * backend/api/src/routes/gobservaSalud.ts) y manda `formaGrupo` en cada producto; aquí se usa el mismo orden para
 * adivinar el dibujo de lo que nombra una alerta (sólo texto). Si cambia uno, el otro. Sin JSX.
 */
import type { NombreSprite } from "@/components/pixel/sprites";

export type FormaGrupo = "tableta" | "capsula" | "jarabe" | "inyectable" | "gotas" | "crema" | "inhalador" | "sobre" | "ovulo" | "otro";

export interface Forma {
  clave: FormaGrupo;
  /** El filtro y la tarjeta: como lo diría cualquiera. */
  etiqueta: string;
  /** Una palabra, para el riel de categorías del celular. */
  corta: string;
  sprite: NombreSprite;
}

/** En el orden del riel: de lo que más hay a lo que menos (medido el 2026-11-22: 5 440 tabletas, 42 otros). */
export const FORMAS: Forma[] = [
  { clave: "tableta", etiqueta: "Tabletas", corta: "Tabletas", sprite: "medTableta" },
  { clave: "capsula", etiqueta: "Cápsulas", corta: "Cápsulas", sprite: "medCapsula" },
  { clave: "jarabe", etiqueta: "Jarabes y suspensiones", corta: "Jarabes", sprite: "medJarabe" },
  { clave: "inyectable", etiqueta: "Inyectables", corta: "Inyectables", sprite: "medInyectable" },
  { clave: "crema", etiqueta: "Cremas y geles", corta: "Cremas", sprite: "medCrema" },
  { clave: "gotas", etiqueta: "Gotas para ojos, oídos y nariz", corta: "Gotas", sprite: "medGotas" },
  { clave: "sobre", etiqueta: "Sobres y polvos", corta: "Sobres", sprite: "medSobre" },
  { clave: "inhalador", etiqueta: "Inhaladores y sprays", corta: "Inhaladores", sprite: "medInhalador" },
  { clave: "ovulo", etiqueta: "Óvulos y supositorios", corta: "Óvulos", sprite: "medOvulo" },
  { clave: "otro", etiqueta: "Otros", corta: "Otros", sprite: "medCaja" },
];

export const formaDe = (clave: string | null | undefined): Forma => FORMAS.find((f) => f.clave === clave) ?? FORMAS[FORMAS.length - 1];

const REGLAS: [FormaGrupo, RegExp][] = [
  ["inyectable", /INYECT|PERFUSI|INFUSI/],
  ["inhalador", /INHAL|AEROSOL|PULVERIZ|SPRAY|NEBULIZ/],
  ["jarabe", /GOTAS ORALES|ORAL.*GOTAS|GOTAS.*ORAL/],
  ["gotas", /OFTALM|OTIC|GOTAS|COLIRIO|NASAL/],
  ["crema", /CREMA|GEL|UNGUENTO|POMADA|LOCION|CHAMPU|TOPIC|CUTANE|PASTA|JABON/],
  ["ovulo", /OVULO|SUPOSITORIO|RECTAL|VAGINAL/],
  ["capsula", /CAPSULA|PERLA/],
  ["tableta", /TABLETA|COMPRIMIDO|GRAGEA|PASTILLA/],
  ["sobre", /GRANULO|SOBRE|POLVO PARA SOLUCION ORAL|EFERVESCENTE/],
  ["jarabe", /JARABE|ORAL|ELIXIR|SUSPENSION|SOLUCION|EMULSION/],
];

/** El grupo de una forma escrita («TABLETA RECUBIERTA», «Solución inyectable x 5 mL»); «otro» si no se reconoce. */
export function grupoDeTexto(texto: string | null | undefined): FormaGrupo {
  const t = (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return REGLAS.find(([, re]) => re.test(t))?.[0] ?? "otro";
}
