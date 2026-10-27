/**
 * De qué tipo es una entidad del Estado.
 *
 * El backend devuelve `tipo: null` para casi todas las 3,162 entidades reales, y el frontend hacía
 * `e.tipo || "organismo_autonomo"`. El resultado verificado en producción: la MUNICIPALIDAD DISTRITAL DE YARABAMBA
 * aparecía etiquetada como "Organismo Autónomo". Un valor por defecto elegido por comodidad se convirtió en una
 * afirmación falsa sobre una entidad pública real, publicada por una plataforma cuyo argumento entero es la exactitud.
 *
 * Los nombres oficiales peruanos son muy regulares, así que el tipo se infiere del nombre con alta confianza. Y cuando
 * no se puede inferir, no se inventa una categoría: la fila no dice el tipo (`etiquetaTipoVisible`).
 *
 * 2026-10-27 (auditoría de UX): 7 de 14 fichas decían «Tipo no declarado» y Petroperú, «Organismo Autónomo». El tipo
 * declarado iba primero y lo había puesto una semilla (Petroperú, el Ejército, EMAPE, cuatro universidades: todos
 * «organismo autónomo»), y todo «instituto», «autoridad» o «registro» era un organismo autónomo (el Instituto Vial
 * Provincial de Chupaca). Ahora manda el nombre, con tipos para universidades, salud, educación, programas,
 * beneficencias, Fuerzas Armadas y Policía, empresas del Estado y organismos públicos; «Organismo Autónomo», sólo los que
 * lo son. Las reglas son las MISMAS, en el mismo orden, que `REGLAS_TIPO_ENTIDAD` de backend/api/src/routes/entidades.ts
 * (con ellas filtra y cuenta la lista): backend/api/test/entidades_tipo.test.ts compara las dos.
 */

export type TipoEntidad =
  | "municipal_distrital"
  | "municipal_provincial"
  | "gobierno_regional"
  | "ministerio"
  | "empresa_publica"
  | "organismo_autonomo"
  | "universidad"
  | "salud"
  | "educacion"
  | "programa"
  | "beneficencia"
  | "fuerzas_armadas"
  | "organismo_publico";

/**
 * Sobre el nombre sin tildes y en minúsculas; la primera que calce. `\m` y `\M` son los bordes de palabra de Postgres (la
 * misma cadena va a la SQL del backend) y aquí se vuelven `\b`. Un tipo `null` corta: esa entidad no se clasifica.
 */
const REGLAS: [TipoEntidad | null, string][] = [
  // Primero las municipalidades: son seis de cada diez y ningún nombre de municipalidad calza con las reglas de abajo
  // (así seis de cada diez filas salen con la primera o la segunda expresión: la faceta de tipos recorre las 3,162).
  ["municipal_distrital", String.raw`\m(municipalidad\s+(distrital|de\s+centro\s+poblado)|concejo\s+distrital|gobierno\s+local\s+distrital)\M`],
  // "MUNICIPALIDAD METROPOLITANA DE LIMA" y cualquier municipalidad sin calificativo: provincial.
  ["municipal_provincial", String.raw`\mmunicipalidad\M`],
  ["organismo_autonomo", String.raw`\m(jurado nacional de elecciones|oficina nacional de procesos electorales|registro nacional de identificacion|reniec|contraloria general|defensoria del pueblo|banco central de reserva|superintendencia de banca|tribunal constitucional|junta nacional de justicia|consejo nacional de la magistratura|academia de la magistratura|ministerio publico|poder judicial|corte superior de justicia)\M`],
  // Una mancomunidad junta municipalidades: no es ninguna de ellas (ni la región que nombra).
  [null, String.raw`^mancomunidad\M`],
  ["universidad", String.raw`\muniversidad\M`],
  ["beneficencia", String.raw`\mbeneficencia\M`],
  ["salud", String.raw`\m(hospital|clinica|diris|diresa|geresa|essalud|utes|micro\s?red(es)?|enfermedades\s+neoplasicas)\M|\mred(es)?\s+(integradas\s+)?de\s+(servicios\s+de\s+)?salud\M|\mdireccion\s+(regional\s+)?de\s+salud\M|\minstituto\s+(nacional\s+(de\s+salud|materno|de\s+oftalmologia|de\s+rehabilitacion|de\s+ciencias\s+neurologicas)|regional\s+de\s+oftalmologia)|\m(establecimiento|seguro\s+social|seguro\s+integral|servicios\s+basicos)\s+de\s+salud\M|\munidad\s+ejecutora:?\s+(\d+\s+)?(de\s+)?salud\M`],
  ["educacion", String.raw`\m(ugel|colegio|unidad\s+de\s+gestion\s+educativa|(direccion|gerencia)\s+regional\s+de\s+educacion)\M|\munidad\s+ejecutora:?\s+(\d+\s+)?educacion\M`],
  ["ministerio", String.raw`\mministerio\M|^mef\M`],
  ["empresa_publica", String.raw`\m(empresa|e\.?p\.?s|entidad\s+prestadora|sedapal|petroleos\s+del\s+peru|petroperu|perupetro|electro\w*|egemsa|egasa|egesur|san\s+gaban|enapu|serpost|servicios\s+postales|corpac|banco\s+de\s+la\s+nacion|corporacion\s+financiera\s+de\s+desarrollo|fondo\s+mivivienda|fonafe|fondo\s+nacional\s+de\s+financiamiento\s+de\s+la\s+actividad\s+empresarial|activos\s+mineros|sociedad\s+electrica|servicio\s+industrial\s+de\s+la\s+marina|sociedad\s+anonima)\M|^servicio\s+(municipal\s+)?de\s+agua\s+potable\M|(^|[^a-z])(s\.?\s?a\.?\s?[ac]?\.?|s\.?\s?r\.?\s?l(tda)?\.?|sac|saa)\s*$`],
  ["fuerzas_armadas", String.raw`\m(ejercito|marina\s+de\s+guerra|fuerza\s+aerea|fuerzas\s+armadas|policia\s+nacional|policial|pnp|rpnp|dirtepol|comando\s+conjunto|militar|iafas)\M|\mdireccion\s+territorial\s+de\s+policia\M`],
  ["programa", String.raw`\m(programa|proyectos?\s+especial(es)?|provias|plan\s+copesco|foncodes|fondo\s+de\s+cooperacion\s+para\s+el\s+desarrollo\s+social|fondo\s+sierra\s+azul)\M`],
  ["salud", String.raw`\msalud\M`],
  ["educacion", String.raw`\m(educacion|educativ[ao]s?|escuela|pedagogico|conservatorio)\M`],
  ["gobierno_regional", String.raw`\mgobierno\s+rer?gional\M|\mregion\s+[a-z]|\mgerencia\s+sub-?\s?regional\M`],
  ["organismo_publico", String.raw`\m(organismo|superintendencia|instituto|institucion\s+vial|autoridad|servicio\s+nacional|servicio\s+de\s+administracion\s+tributaria|agencia|comision|consejo\s+nacional|centro\s+nacional|oficina\s+nacional|oficina\s+de\s+normalizacion\s+previsional|archivo\s+general|biblioteca\s+nacional|procuraduria|zona\s+registral|inpe|sunat|sunarp)\M|^onp\M`],
  ["gobierno_regional", String.raw`\mdireccion\s+regional\M`],
];
const REGEX = REGLAS.map(([tipo, p]) => [tipo, new RegExp(p.replace(/\\[mM]/g, "\\b"))] as const);

/** Los tipos declarados por la API que valen cuando el nombre no dice nada («organismo autónomo» no: vino de una semilla). */
const DECLARADOS_CONFIABLES = new Set<string>(["municipal_distrital", "municipal_provincial", "gobierno_regional", "ministerio", "empresa_publica"]);

/** El nombre de cada tipo: largo (la cabecera de la ficha) y corto (la meta de una fila). */
export const ETIQUETA_TIPO: Record<TipoEntidad, { largo: string; corto: string }> = {
  municipal_distrital: { largo: "Municipalidad Distrital", corto: "Mun. Distrital" },
  municipal_provincial: { largo: "Municipalidad Provincial", corto: "Mun. Provincial" },
  gobierno_regional: { largo: "Gobierno Regional", corto: "Gob. Regional" },
  ministerio: { largo: "Ministerio", corto: "Ministerio" },
  empresa_publica: { largo: "Empresa Pública", corto: "Empresa Pública" },
  organismo_autonomo: { largo: "Organismo Autónomo", corto: "Org. Autónomo" },
  universidad: { largo: "Universidad Pública", corto: "Universidad" },
  salud: { largo: "Salud", corto: "Salud" },
  educacion: { largo: "Educación", corto: "Educación" },
  programa: { largo: "Programa o Proyecto Especial", corto: "Programa" },
  beneficencia: { largo: "Sociedad de Beneficencia", corto: "Beneficencia" },
  fuerzas_armadas: { largo: "Fuerzas Armadas o Policía", corto: "FF. AA. o Policía" },
  organismo_publico: { largo: "Organismo Público", corto: "Org. Público" },
};

/** Sin tildes y en minúsculas, como lo compara la base (`immutable_unaccent(lower(nombre))`). */
const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** El tipo que dice el nombre; `undefined` si ninguna regla calza (y `null` si calza una que no clasifica). */
function porNombre(nombre: string | null | undefined): TipoEntidad | null | undefined {
  if (!nombre) return undefined;
  const n = normal(nombre);
  for (const [tipo, re] of REGEX) if (re.test(n)) return tipo;
  return undefined;
}

/** Devuelve el tipo inferido del nombre oficial, o null si no se puede determinar. */
export function inferirTipoEntidad(nombre: string | null | undefined): TipoEntidad | null {
  return porNombre(nombre) ?? null;
}

/**
 * El tipo que corresponde mostrar: el que dice el nombre oficial y, si no dice nada, el que declara la API (salvo
 * «organismo autónomo»), y si ninguno, null — que la interfaz no muestra, nunca como una categoría concreta.
 */
export function tipoEntidad(tipoApi: string | null | undefined, nombre: string | null | undefined): TipoEntidad | null {
  const t = porNombre(nombre);
  if (t !== undefined) return t;
  return tipoApi && DECLARADOS_CONFIABLES.has(tipoApi) ? (tipoApi as TipoEntidad) : null;
}

/** El nombre del tipo, o null si no se sabe: entonces no se muestra (ni «Sin clasificar» ni «Tipo no declarado»). */
export function etiquetaTipoVisible(
  tipoApi: string | null | undefined,
  nombre: string | null | undefined,
  formato: "largo" | "corto" = "largo",
): string | null {
  const t = tipoEntidad(tipoApi, nombre);
  return t ? ETIQUETA_TIPO[t][formato] : null;
}

/**
 * Para quien tiene que poner algo (una línea con su ícono): el tipo, o «Entidad del Estado» si no se sabe, que es lo que
 * es toda entidad que compra por el SEACE. Donde se puede, mejor `etiquetaTipoVisible` y no mostrar nada.
 */
export function etiquetaTipoEntidad(
  tipoApi: string | null | undefined,
  nombre: string | null | undefined,
  formato: "largo" | "corto" = "largo",
): string {
  return etiquetaTipoVisible(tipoApi, nombre, formato) ?? "Entidad del Estado";
}
