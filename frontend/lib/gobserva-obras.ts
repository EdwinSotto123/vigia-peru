import { API_BASE } from "@/lib/api-client";
import { oracion } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { nombreRegion } from "@/lib/licitaciones";

/**
 * Gobserva Obras (obras.gobserva.cloud): los tipos de GET /proyectos/* (backend/api/src/routes/proyectos.ts), cómo se
 * piden (la caché de datos de Next encima de la de la API) y cómo se nombran las cosas para quien construye: la fase de un
 * proyecto, su sector, su modalidad, su lugar. Sin JSX: lo usan las páginas y los componentes (de servidor y de cliente).
 */

export type Fase = "viable" | "expediente" | "licitacion" | "ejecucion" | "paralizada" | "terminada" | "sin_movimiento" | "cerrada";
export type Pestana = "se_vienen" | "en_marcha" | "paralizadas" | "todos";

/** Un proyecto en una lista (gobserva_proyecto, migración 232). De quien ejecuta, sólo una empresa (RUC 20). */
export interface Proyecto {
  cui: string;
  nombre: string;
  fase: Fase;
  seViene: boolean;
  tipo: "obra" | "equipamiento";
  nivel: string | null;
  sector: string;
  funcion: string | null;
  modalidad: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  region: string | null;
  provincia: string | null;
  distrito: string | null;
  costo: number | null;
  viable: number | null;
  porEjecutar: number | null;
  devengado: number;
  pimAnio: number;
  conExpediente: boolean;
  fechaViable: string | null;
  ultimoGasto: string | null;
  avanceMef: number | null;
  obras: number;
  obraCodigo: number | null;
  obraEstado: string | null;
  obraFisico: number | null;
  obraProgramado: number | null;
  obraAvanceAl: string | null;
  obraInicio: string | null;
  obraFin: string | null;
  paralizadaDesde: string | null;
  causal: string | null;
  ejecutorRuc: string | null;
  ejecutor: string | null;
  /** La obra principal es el proyecto (no una parte chica de uno grande): su avance y su contratista son los del proyecto. */
  obraRepresenta: boolean;
  convocatoriaOcid: string | null;
  convocatoriaTipo: string | null;
  convocatoriaFecha: string | null;
  convocatoriaValor: number | null;
  procesos: number;
}

export interface Conteo {
  clave: string;
  n: number;
}

export interface FilaZona {
  clave: string;
  seVienen: number;
  seVienenMonto: number;
  enMarcha: number;
  enMarchaMonto: number;
  paralizadas?: number;
  porEjecutar?: number;
}

export interface ResumenObras {
  activas: number;
  seVienen: number;
  seVienenMonto: number;
  viables: number;
  viablesMonto: number;
  expediente: number;
  expedienteMonto: number;
  licitando: number;
  licitandoMonto: number;
  enMarcha: number;
  enMarchaMonto: number;
  enMarchaInfobras: number;
  paralizadas: number;
  paralizadasMonto: number;
  porEjecutar: number;
  pimAnio: number;
  devengadoAnio: number;
  nuevos30: number;
  seVienen10m: number;
  seVienenEquipamiento: number;
  seVienenContrata: number;
  porRegion: FilaZona[];
  porSector: FilaZona[];
  /** Los que se vienen más grandes con expediente técnico (viables en los últimos 2 años). */
  seVienenTop: Proyecto[];
  /** Los que se están licitando, los más recientes. */
  licitandoTop: Proyecto[];
  /** Las obras más grandes en ejecución (INFOBRAS). */
  enMarchaTop: Proyecto[];
  /** Los recién declarados viables, de S/ 1 M o más. */
  nuevos: Proyecto[];
  estado: { refrescado: string | null; inversionesAl: string | null; infobrasAl: string | null } | null;
}

export interface FiltrosObras {
  pestana?: Pestana;
  q?: string;
  region?: string;
  sector?: string;
  nivel?: string;
  fase?: Fase;
  modalidad?: string;
  tipo?: "obra" | "equipamiento";
  min?: string;
  max?: string;
  entidad?: string;
  orden?: "monto" | "reciente";
  page?: number;
}

export interface PaginaObras {
  pestana: Pestana;
  page: number;
  size: number;
  total: number;
  resumen: { monto: number; porEjecutar: number; entidades: number };
  facetas: { region: Conteo[]; sector: Conteo[]; nivel: Conteo[]; fase: Conteo[]; modalidad: Conteo[]; tipo: Conteo[] };
  data: Proyecto[];
}

/** Quién ejecuta o supervisa una obra de INFOBRAS: el nombre, sólo de una empresa. */
export interface QuienObra {
  tipo: "empresa" | "consorcio" | "persona" | "entidad";
  ruc?: string;
  nombre?: string | null;
}

export interface ObraInfobras {
  codigo: number;
  nombre: string;
  estado: string | null;
  modalidad: string | null;
  esSaldo: boolean;
  avance: { fisico: number | null; programado: number | null; financiero: number | null; al: string | null };
  fechas: { inicio: string | null; finProgramada: string | null; finReprogramada: string | null; finReal: string | null; recepcion: string | null; expediente: string | null };
  plazo: { dias: number | null; ampliacion: number | null };
  montos: { contrato: number | null; contratoDudoso: boolean | null; expediente: number | null; supervision: number | null; adicionales: number | null; deductivos: number | null };
  adicionalesN: number | null;
  paralizacion: { hoy: boolean; desde: string | null; dias: number | null; causal: string | null } | null;
  ejecutor: QuienObra | null;
  supervisor: QuienObra | null;
  controversias: number | null;
  informesControl: number | null;
  alDia: string | null;
}

export interface GanadorEmpresa {
  ruc: string;
  nombre: string | null;
  consorcio: boolean;
  monto: number | null;
}

export interface ProcesoSeace {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  tipo: string | null;
  etapa: string | null;
  procedimiento: string | null;
  fecha: string | null;
  valor: number | null;
  adjudicado: number | null;
  ganadores: { empresas: GanadorEmpresa[]; otros: number; monto: number | null };
  via: string;
}

export interface FichaObras {
  cui: string;
  nombre: string;
  estado: "activa" | "cerrada";
  fase: Fase | null;
  seViene: boolean;
  tipo: "obra" | "equipamiento";
  situacion: string | null;
  nivel: string | null;
  sector: string;
  funcion: string | null;
  programa: string | null;
  tipologia: string | null;
  tipoInversion: string | null;
  marco: string | null;
  modalidad: string | null;
  modalidadTexto: string | null;
  entidad: { ruc: string | null; nombre: string | null };
  unidadEjecutora: string | null;
  lugar: { region: string | null; departamento: string | null; provincia: string | null; distrito: string | null; ubigeo: string | null };
  montos: {
    viable: number | null;
    actualizado: number | null;
    expediente: number | null;
    devengado: number;
    devengadoAnio: number;
    pimAnio: number;
    porEjecutar: number | null;
    liquidacion: number | null;
    controlConcurrente: number | null;
  };
  costoDudoso: boolean;
  avanceMef: number | null;
  conExpediente: boolean;
  fechas: {
    registro: string | null;
    viabilidad: string | null;
    inicioPrevisto: string | null;
    finPrevisto: string | null;
    primerGasto: string | null;
    ultimoGasto: string | null;
    cierre: string | null;
  };
  beneficiarios: number | null;
  alDia: { inversiones: string | null; infobras: string | null };
  obras: ObraInfobras[];
  /** La primera obra (la principal) es el proyecto y no una parte chica de uno grande. */
  obraRepresenta: boolean;
  procesosTotal: number;
  procesos: ProcesoSeace[];
  parecidos: { cui: string; nombre: string; fase: Fase; region: string | null; provincia: string | null; costo: number | null; entidad: string | null; obraFisico: number | null }[];
}

export interface Ranking {
  ruc: string;
  nombre: string | null;
  monto: number;
  procesos: number;
  enConsorcio: number;
}

export interface MercadoObras {
  region: string | null;
  sector: string | null;
  activas: number;
  costo: number;
  porEjecutar: number;
  pimAnio: number;
  devengadoAnio: number;
  seVienen: { n: number; monto: number; conExpediente: number; montoConExpediente: number; licitando: number; mediana: number | null };
  enMarcha: { n: number; monto: number; porEjecutar: number; mediana: number | null; conEmpresa: number };
  paralizadas: { n: number; monto: number; porEjecutar: number };
  porZona: (FilaZona & { paralizadas: number; porEjecutar: number })[];
  porSector: (FilaZona & { paralizadas: number })[];
  tamanos: { rango: string; orden: number; seVienen: number; enMarcha: number }[];
  causales: { causal: string; n: number }[];
  mayoresParalizadas: { cui: string; nombre: string; costo: number | null; region: string | null; provincia: string | null; desde: string | null; causal: string | null; fisico: number | null }[];
  adjudicadoObras: { procesos: number; monto: number; empresas: number; mediana: number | null } | null;
  quienConstruye: Ranking[];
  quienSupervisa: Ranking[];
  alDia: { refrescado: string | null; inversiones: string | null; infobras: string | null } | null;
  conosceHasta: string | null;
}

async function pedir<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}/proyectos${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getResumenObras = () => pedir<ResumenObras>("/resumen");
export const getProyectos = (params: URLSearchParams) => pedir<PaginaObras>(`/lista?${params.toString()}`);
export const getFichaObras = (cui: string) => (/^\d{7}$/.test(cui) ? pedir<FichaObras>(`/ficha/${cui}`, 3600) : Promise.resolve(null));
export const getMercadoObras = (region?: string, sector?: string) => {
  const p = new URLSearchParams();
  if (region) p.set("region", region);
  if (sector) p.set("sector", sector);
  const s = p.toString();
  return pedir<MercadoObras>(`/mercado${s ? `?${s}` : ""}`, 3600);
};

// ─── Cómo se nombra cada cosa ────────────────────────────────────────────────────────────────────────────────────────

/** Las fases, de la idea a la obra: el nombre, el corto (insignia) y qué significa para quien construye. */
export const FASES: Record<Fase, { nombre: string; corto: string; detalle: string }> = {
  viable: { nombre: "Viable, sin expediente", corto: "Viable", detalle: "Declarada viable o aprobada; todavía falta el expediente técnico (una consultoría que se contrata)." },
  expediente: { nombre: "Con expediente técnico", corto: "Con expediente", detalle: "Tiene expediente técnico: lo siguiente es licitar la obra." },
  licitacion: { nombre: "Licitándose", corto: "Licitándose", detalle: "Hay un proceso de obra con su CUI en etapa de convocatoria en el SEACE." },
  ejecucion: { nombre: "En ejecución", corto: "En ejecución", detalle: "La obra está en ejecución (INFOBRAS), contratada (SEACE) o con avance y gasto recientes (MEF)." },
  paralizada: { nombre: "Paralizada", corto: "Paralizada", detalle: "INFOBRAS registra su obra como paralizada hoy." },
  terminada: { nombre: "Obra terminada", corto: "Terminada", detalle: "La obra terminó; falta liquidar y cerrar la inversión." },
  sin_movimiento: { nombre: "Sin movimiento", corto: "Sin movimiento", detalle: "Tuvo gasto o avance, pero nada en los últimos 2 años y sin obra en INFOBRAS." },
  cerrada: { nombre: "Inversión cerrada", corto: "Cerrada", detalle: "El MEF registra la inversión como cerrada." },
};
/** El orden de las fases en los filtros y en el camino de una obra. */
export const ORDEN_FASES: Fase[] = ["viable", "expediente", "licitacion", "ejecucion", "paralizada", "terminada", "sin_movimiento"];

export const PESTANAS: { clave: Pestana; nombre: string; bajada: string }[] = [
  { clave: "se_vienen", nombre: "Se vienen", bajada: "Viables, con expediente o licitándose: todavía sin contrato de obra." },
  { clave: "en_marcha", nombre: "En marcha", bajada: "Obras en ejecución o ya contratadas." },
  { clave: "paralizadas", nombre: "Paralizadas", bajada: "Obras que INFOBRAS registra paralizadas hoy." },
  { clave: "todos", nombre: "Todos", bajada: "Todas las inversiones activas de Invierte.pe." },
];

/** Los sectores (la función del MEF agrupada, gobserva_obras_sector en la migración 232). */
export const SECTORES: { clave: string; nombre: string }[] = [
  { clave: "transporte", nombre: "Transporte" },
  { clave: "saneamiento", nombre: "Agua y saneamiento" },
  { clave: "educacion", nombre: "Educación" },
  { clave: "salud", nombre: "Salud" },
  { clave: "agro", nombre: "Agro, riego y pesca" },
  { clave: "urbano", nombre: "Vivienda y desarrollo urbano" },
  { clave: "deporte", nombre: "Cultura y deporte" },
  { clave: "energia", nombre: "Energía" },
  { clave: "ambiente", nombre: "Ambiente" },
  { clave: "seguridad", nombre: "Orden público y seguridad" },
  { clave: "gestion", nombre: "Gestión pública" },
  { clave: "social", nombre: "Protección social" },
  { clave: "comercio", nombre: "Comercio, turismo e industria" },
  { clave: "justicia", nombre: "Justicia" },
  { clave: "comunicaciones", nombre: "Comunicaciones" },
  { clave: "otros", nombre: "Otros" },
];
const NOMBRE_SECTOR = Object.fromEntries(SECTORES.map((s) => [s.clave, s.nombre]));
export const nombreSector = (s: string | null | undefined) => (s ? NOMBRE_SECTOR[s] ?? oracion(s) : "Sin sector");

export const NIVELES: { clave: string; nombre: string }[] = [
  { clave: "gl", nombre: "Municipalidades" },
  { clave: "gr", nombre: "Gobiernos regionales" },
  { clave: "gn", nombre: "Gobierno nacional" },
];
export const nombreNivel = (n: string | null | undefined) =>
  n ? ({ gl: "Municipalidad", gr: "Gobierno regional", gn: "Gobierno nacional" } as Record<string, string>)[n.toLowerCase()] ?? n : "Sin nivel";

export const MODALIDADES: { clave: string; nombre: string; detalle: string }[] = [
  { clave: "contrata", nombre: "Por contrata", detalle: "Se licita: la construye una empresa." },
  { clave: "mixta", nombre: "Contrata y administración directa", detalle: "Una parte se licita y otra la hace la entidad." },
  { clave: "directa", nombre: "Administración directa", detalle: "La hace la entidad: compra materiales, equipos y servicios." },
  { clave: "oxi", nombre: "Obras por impuestos", detalle: "La financia y ejecuta una empresa a cuenta de su impuesto." },
  { clave: "app", nombre: "Asociación público privada", detalle: "Concesión o APP." },
  { clave: "nucleo", nombre: "Núcleo ejecutor", detalle: "La ejecuta la comunidad organizada." },
  { clave: "otra", nombre: "Otra modalidad", detalle: "" },
];
const NOMBRE_MODALIDAD = Object.fromEntries(MODALIDADES.map((m) => [m.clave, m.nombre]));
export const nombreModalidad = (m: string | null | undefined) => (m ? NOMBRE_MODALIDAD[m] ?? m : "Sin modalidad registrada");

export const TIPOS_PROYECTO = [
  { clave: "obra", nombre: "Obras" },
  { clave: "equipamiento", nombre: "Compra de equipos" },
] as const;

/** Los rangos de costo de la gráfica de tamaños (gobserva_obras_mercado). */
export const TAMANOS: Record<string, string> = {
  hasta_1m: "Hasta S/ 1 M",
  "1m_5m": "S/ 1 M a 5 M",
  "5m_20m": "S/ 5 M a 20 M",
  "20m_100m": "S/ 20 M a 100 M",
  mas_100m: "Más de S/ 100 M",
};

/** El tipo de un proceso del SEACE, como lo diría quien construye. */
export const TIPO_PROCESO: Record<string, string> = {
  obras: "Obra",
  consultoria: "Consultoría",
  bienes: "Bienes",
  servicios: "Servicios",
  convenio: "Convenio",
};
export const ETAPA_PROCESO: Record<string, string> = {
  convocada: "En convocatoria",
  adjudicada: "Adjudicado",
  contratada: "Contratado",
  en_ejecucion: "En ejecución",
  desierta: "Desierto",
  nula: "Nulo",
  cancelada: "Cancelado",
};

// ─── Textos de la fuente, para leerlos ───────────────────────────────────────────────────────────────────────────────

/** Los departamentos como se escriben (para reconocerlos dentro de un nombre). */
const DEPARTAMENTOS = [
  "Amazonas", "Áncash", "Apurímac", "Arequipa", "Ayacucho", "Cajamarca", "Callao", "Cusco", "Huancavelica", "Huánuco", "Ica", "Junín",
  "La Libertad", "Lambayeque", "Lima", "Loreto", "Madre de Dios", "Moquegua", "Pasco", "Piura", "Puno", "San Martín", "Tacna", "Tumbes", "Ucayali",
];
const sinTilde = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
/** Dentro de un nombre van en minúscula («San Juan de la Virgen», «Datem del Marañón»); «El» no («Villa El Salvador»). */
const CONECTOR = new Set(["de", "del", "la", "las", "los"]);
const ARTICULO = new Set(["la", "las", "los", "el"]);
/** Lo que corta un nombre propio después de «distrito de» (lo que sigue ya no es el nombre). */
const CORTE = new Set([
  "provincia", "provincias", "departamento", "departamentos", "distrito", "distritos", "region", "regional", "en", "para", "con", "mediante",
  "nivel", "sector", "sectores", "ambito", "zona", "zonas", "a", "al", "hacia", "desde", "hasta", "entre", "por", "que", "su", "sus", "km", "tramo",
  "tramos", "margen", "cuenca", "jurisdiccion", "y", "e", "localidad", "localidades", "centro", "centros", "caserio", "caserios", "anexo", "anexos",
  "comunidad", "comunidades", "ciudad", "pueblo", "barrio", "barrios", "asociacion", "urbanizacion", "institucion", "educativa", "cuadra", "ante",
  "vulnerables", "ubicado", "ubicada", "ubicados", "situado", "cercado", "parcialidad", "segunda", "primera", "tercera", "etapa", "the",
]);
/** Lo que anuncia un nombre propio («distrito de», «centro poblado», «Av.», «CC.NN.»): lo que sigue va con mayúscula. */
const DISPARADOR =
  /^(distritos?|provincias?|departamentos?|localidad(?:es)?|ciudad|caserios?|anexos?|centros? poblados?|comunidad(?:es)? (?:campesinas?|nativas?)|hospital|institucion educativa|asociacion de vivienda|avenida|jiron|calle|pasaje|urbanizacion)$/;
/** Los que sólo anuncian un nombre con «de» detrás («comunidad de Antapallpa», «sector de Parcco»). */
const DISPARADOR_DE = /^(comunidad|sector|parcialidad|barrio)$/;
/** Las abreviaturas que anuncian un nombre, y cómo se escriben. */
const ABREVIATURA: [RegExp, string][] = [
  [/^cc\.?\s?nn\.?$/, "CC.NN."],
  [/^cc\.?\s?pp\.?$/, "CC.PP."],
  [/^c\.\s?p\.?$|^cp\.?$/, "C.P."],
  [/^a\.\s?h\.?$/, "A.H."],
  [/^aa\.?\s?hh\.?$/, "AA.HH."],
  [/^c\.\s?c\.?$|^cc\.?$/, "C.C."],
  [/^p\.\s?j\.?$/, "P.J."],
  [/^i\.\s?e\.?\s?p\.?$/, "I.E.P."],
  [/^i\.\s?e\.?$|^ie$/, "I.E."],
  [/^jr\.?$/, "Jr."],
  [/^av\.?$/, "Av."],
  [/^urb\.?$/, "Urb."],
  [/^psje\.?$/, "Psje."],
];
const abreviatura = (w: string) => ABREVIATURA.find(([re]) => re.test(w))?.[1] ?? null;
const ROMANO = /^(ii|iii|iv|vi|vii|viii|ix)$/;

/** «chimbote» → «Chimbote», «faucett-gambetta» → «Faucett-Gambetta»; «ii» → «II». */
const mayuscula = (w: string) =>
  ROMANO.test(sinTilde(w)) ? w.toUpperCase() : w.split("-").map((x) => x.charAt(0).toLocaleUpperCase("es") + x.slice(1)).join("-");
const SEPARADOR = /^(\s+|,|;|:|\(|\)|–|\s-\s|\/)$/;

/**
 * Pone mayúscula a los nombres de lugar de un nombre ya escrito como oración: lo que sigue a «distrito de», «provincias
 * de», «localidad de», «centro poblado», «caserío», «comunidad de», «Av.», «CC.NN.»… (con sus listas: «distritos de
 * Chimbote, Nuevo Chimbote y Santa»), los departamentos y los lugares del propio proyecto. También «I.E.», los números
 * romanos de una etapa o un nivel y los códigos de ruta («PE-3N», «CA-1650»). Es una regla, no un diccionario: lo que no
 * reconoce queda como oración.
 */
function lugaresConMayuscula(texto: string, propios: string[]): string {
  const partes = texto.split(/(\s+|,|;|:|\(|\)|–|\s-\s|\/)/);
  const palabras: { i: number; w: string }[] = [];
  partes.forEach((x, i) => {
    if (x && !SEPARADOR.test(x)) palabras.push({ i, w: x });
  });
  const entre = (a: number, b: number) => partes.slice(a + 1, b).join("");
  let k = 0;
  while (k < palabras.length) {
    // ¿Empieza aquí un disparador de una a tres palabras («distritos», «centro poblado», «comunidad campesina», «aa.hh.»)?
    let largo = 0;
    let plural = false;
    let conDe = false;
    const abrev = abreviatura(sinTilde(palabras[k].w));
    if (abrev) {
      partes[palabras[k].i] = abrev;
      largo = 1;
    } else {
      for (const n of [3, 2, 1]) {
        if (!palabras[k + n - 1]) continue;
        const frase = palabras.slice(k, k + n).map((x) => sinTilde(x.w)).join(" ");
        if (DISPARADOR.test(frase)) {
          largo = n;
          plural = /(s|es)$/.test(frase.split(" ")[0]);
          break;
        }
        if (n === 1 && DISPARADOR_DE.test(frase) && palabras[k + 1] && sinTilde(palabras[k + 1].w) === "de") {
          largo = 1;
          conDe = true;
        }
      }
    }
    if (!largo) {
      k += 1;
      continue;
    }
    let j = k + largo;
    if (palabras[j] && sinTilde(palabras[j].w) === "de") j += 1;
    else if (conDe) {
      k += 1;
      continue;
    }
    // El nombre: palabras hasta un corte. Un artículo al empezar («La Unión», «El Paraíso») y un conector dentro («San Juan
    // de la Virgen») sólo si les sigue una palabra del nombre.
    let dentro = false;
    while (j < palabras.length) {
      const w = sinTilde(palabras[j].w);
      const antes = entre(palabras[j - 1].i, palabras[j].i);
      if (dentro && /[;:()–/]|\s-\s/.test(antes)) break;
      if (dentro && antes.includes(",") && !plural) break;
      const sig = palabras[j + 1] ? sinTilde(palabras[j + 1].w) : "";
      const sigPegado = palabras[j + 1] ? !/[,;:()–/]|\s-\s/.test(entre(palabras[j].i, palabras[j + 1].i)) : false;
      const sigEsNombre = !!sig && sigPegado && !CORTE.has(sig) && !CONECTOR.has(sig) && !DISPARADOR.test(sig) && !abreviatura(sig) && !/^\d/.test(sig);
      if (!dentro && ARTICULO.has(w)) {
        if (!sigEsNombre) break;
        partes[palabras[j].i] = mayuscula(palabras[j].w);
        j += 1;
        continue;
      }
      if (CONECTOR.has(w)) {
        if (!dentro || !(sigEsNombre || (ARTICULO.has(sig) && sigPegado))) break;
        j += 1;
        continue;
      }
      if ((w === "y" || w === "e") && plural && dentro) {
        if (!sigEsNombre) break;
        j += 1;
        continue;
      }
      if (/^\d/.test(w)) {
        // Un número dentro del nombre de un colegio («I.E. 7213 Peruano Japonés»).
        if (!abrev || !sig) break;
        j += 1;
        continue;
      }
      if (CORTE.has(w) || DISPARADOR.test(w) || abreviatura(w)) break;
      partes[palabras[j].i] = mayuscula(palabras[j].w);
      dentro = true;
      j += 1;
    }
    k = Math.max(j, k + 1);
  }
  let r = partes.join("");
  // Los lugares del proyecto y los departamentos, donde estén (palabras enteras, con o sin tildes).
  for (const lugar of [...propios, ...DEPARTAMENTOS]) {
    const l = sinTilde(lugar.trim());
    if (l.length < 3) continue;
    const patron = l
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/[aeiou]/g, (v) => `[${v}${"áéíóú"["aeiou".indexOf(v)]}]`)
      .replace(/n/g, "[nñ]");
    r = r.replace(new RegExp(`(?<![\\p{L}])${patron}(?![\\p{L}])`, "giu"), (m) =>
      m
        .split(" ")
        .map((x, i) => (i > 0 && CONECTOR.has(sinTilde(x)) ? x.toLocaleLowerCase("es") : mayuscula(x.toLocaleLowerCase("es"))))
        .join(" "),
    );
  }
  return r
    .replace(/(?<![\p{L}])i\.\s?e\.?(?:\s?p\.)?(?=\s)/giu, (m) => m.toUpperCase().replace(/\s/g, ""))
    .replace(/(?<![\p{L}])ii\.\s?ee\.?/giu, "II.EE.")
    .replace(/(?<![\p{L}\d])([a-z]{2})-(\d{1,4}[a-z]?)(?![\p{L}\d])/gu, (_m, a: string, b: string) => `${a.toUpperCase()}-${b.toUpperCase()}`)
    .replace(/(?<![\p{L}])(etapa|nivel|fase)\s+(i{1,3}|iv|vi{0,3})(?![\p{L}])/giu, (_m, a: string, b: string) => `${a} ${b.toUpperCase()}`)
    .replace(/(?<![\p{L}])(ii|iii|iv)\s+(etapa|fase)/giu, (_m, a: string, b: string) => `${a.toUpperCase()} ${b}`);
}

/** Los lugares del proyecto, limpios, para reconocerlos dentro de un texto. */
const lugaresPropios = (lugar?: { distrito?: string | null; provincia?: string | null; departamento?: string | null }) =>
  [lugar?.distrito, lugar?.provincia, lugar?.departamento]
    .map((x) => (x ?? "").replace(/^PROVINCIA CONSTITUCIONAL DEL\s+/i, "").replace(/^-+\s*|\s*-+$/g, "").trim())
    .filter((x) => x.length >= 3 && !/todos/i.test(x));

/**
 * Un texto ya escrito como oración (el objeto de un proceso del SEACE, pasado por `limpiar`) con sus nombres de lugar con
 * mayúscula, como `nombreProyecto`.
 */
export const conLugares = (texto: string, lugar?: { distrito?: string | null; provincia?: string | null; departamento?: string | null }) =>
  texto ? lugaresConMayuscula(texto, lugaresPropios(lugar)) : texto;

/**
 * El nombre de una inversión del MEF (todo en mayúsculas) como oración, con sus tildes y sus nombres de lugar con
 * mayúscula. El MEF escribe «¿» por una raya entre dos tramos («SAN JUAN DE MARCONA ¿ ANDAHUAYLAS»): vuelve a ser raya.
 * `lugar`: el distrito, la provincia y el departamento del proyecto, para reconocerlos dentro del nombre.
 */
export function nombreProyecto(
  t: string | null | undefined,
  lugar?: { distrito?: string | null; provincia?: string | null; departamento?: string | null },
): string {
  if (!t) return "Proyecto sin nombre registrado";
  const base = oracion(t.replace(/\s+¿\s+/g, " – ").replace(/¿/g, "").replace(/\s+/g, " ").trim());
  return lugaresConMayuscula(base, lugaresPropios(lugar));
}

/** El nombre de una empresa: «S amp E» (el «&» que perdió INFOBRAS) vuelve a ser «S & E». */
export function nombreEmpresa(t: string | null | undefined): string {
  if (!t) return "Empresa sin nombre registrado";
  return tituloNatural(t.replace(/\s+amp\s+/gi, " & ").replace(/\s+/g, " ").trim());
}

export const nombreEntidad = (t: string | null | undefined) =>
  t
    ? tituloNatural(t.replace(/\s+/g, " ").trim())
        .replace(/(?<![\p{L}])Uei(?![\p{L}])/gu, "UEI")
        .replace(/(?<![\p{L}])Uep(?![\p{L}])/gu, "UEP")
    : "Entidad sin nombre registrado";

/** Un nombre de lugar del MEF o INFOBRAS («PROVINCIA CONSTITUCIONAL DEL CALLAO», «- TODOS -») para leer, o null. */
export function nombreLugar(t: string | null | undefined): string | null {
  const s = (t ?? "").replace(/^-+\s*|\s*-+$/g, "").trim();
  if (!s || /^todos$/i.test(s) || /^-?mul\.?dep-?$/i.test(s)) return null;
  return tituloNatural(s.replace(/^PROVINCIA CONSTITUCIONAL DEL\s+/i, ""));
}

/** «Distrito, Provincia, Región»: lo que se sabe, sin repetir (en Lima el distrito y la provincia suelen llamarse igual). */
export function lugarProyecto(p: { region?: string | null; provincia?: string | null; distrito?: string | null }): string {
  const partes = [nombreLugar(p.distrito), nombreLugar(p.provincia), p.region ? nombreRegion(p.region) : null].filter((x): x is string => !!x);
  const unicas = partes.filter((x, i) => partes.findIndex((y) => y.toLocaleLowerCase("es") === x.toLocaleLowerCase("es")) === i);
  return unicas.length ? unicas.join(", ") : "Varias regiones";
}

/** «2026-03» → «marzo de 2026». */
export function mesAnio(ym: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym ?? "");
  if (!m) return "Sin fecha";
  const nombre = new Intl.DateTimeFormat("es-PE", { month: "long", timeZone: "UTC" }).format(new Date(`${m[1]}-${m[2]}-01T12:00:00Z`));
  return `${nombre} de ${m[1]}`;
}

/** Días desde una fecha (por el día de Lima). */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((hoy.getTime() - d.getTime()) / 86_400_000);
}

/** «hace 3 días», «hace 5 meses», «hace 2 años»: para lo que no es de ayer. */
export function haceTiempo(iso: string | null | undefined): string {
  const d = diasDesde(iso);
  if (d == null) return "Sin fecha";
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 45) return `hace ${d} días`;
  const meses = Math.round(d / 30.4);
  if (meses < 18) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.floor(d / 365.25);
  return `hace ${anios} ${anios === 1 ? "año" : "años"}`;
}

// ─── Filtros en la URL ───────────────────────────────────────────────────────────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const CLAVES_SECTOR = new Set(SECTORES.map((s) => s.clave));
const CLAVES_MODALIDAD = new Set(MODALIDADES.map((m) => m.clave));

/** Los filtros de /proyectos que valen (lo mal escrito no viaja: la API respondería 400). */
export function filtrosDeUrl(sp: Params | undefined): FiltrosObras {
  const v = (k: string) => uno(sp?.[k]);
  const f: FiltrosObras = {};
  const pestana = v("pestana");
  if (pestana && PESTANAS.some((p) => p.clave === pestana)) f.pestana = pestana as Pestana;
  const q = v("q");
  if (q) f.q = q.slice(0, 120);
  const region = v("region");
  if (region && /^(0[1-9]|1\d|2[0-5])$/.test(region)) f.region = region;
  const sector = v("sector");
  if (sector && CLAVES_SECTOR.has(sector)) f.sector = sector;
  const nivel = v("nivel");
  if (nivel && ["gl", "gr", "gn"].includes(nivel)) f.nivel = nivel;
  const fase = v("fase");
  if (fase && (ORDEN_FASES as string[]).includes(fase)) f.fase = fase as Fase;
  const modalidad = v("modalidad");
  if (modalidad && CLAVES_MODALIDAD.has(modalidad)) f.modalidad = modalidad;
  const tipo = v("tipo");
  if (tipo === "obra" || tipo === "equipamiento") f.tipo = tipo;
  const cifra = (x?: string) => (x ? Number(x.replace(/[^\d.]/g, "")) : NaN);
  const min = cifra(v("min"));
  if (Number.isFinite(min) && min > 0) f.min = String(min);
  const max = cifra(v("max"));
  if (Number.isFinite(max) && max > 0) f.max = String(max);
  const entidad = v("entidad");
  if (entidad && /^\d{11}$/.test(entidad)) f.entidad = entidad;
  if (v("orden") === "reciente") f.orden = "reciente";
  const page = Number(v("page"));
  if (Number.isInteger(page) && page > 1) f.page = Math.min(50, page);
  return f;
}

/** Los filtros como consulta de la URL («?pestana=…&q=…»), sin lo vacío ni lo que es por defecto. */
export function qsObras(f: FiltrosObras): string {
  const p = new URLSearchParams();
  if (f.pestana && f.pestana !== "se_vienen") p.set("pestana", f.pestana);
  if (f.q) p.set("q", f.q);
  if (f.region) p.set("region", f.region);
  if (f.sector) p.set("sector", f.sector);
  if (f.nivel) p.set("nivel", f.nivel);
  if (f.fase) p.set("fase", f.fase);
  if (f.modalidad) p.set("modalidad", f.modalidad);
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.min) p.set("min", f.min);
  if (f.max) p.set("max", f.max);
  if (f.entidad) p.set("entidad", f.entidad);
  if (f.orden === "reciente") p.set("orden", "reciente");
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Los filtros como los pide la API (la pestaña siempre). */
export function paramsApi(f: FiltrosObras, size: number): URLSearchParams {
  const p = new URLSearchParams(qsObras({ ...f, page: undefined }).slice(1));
  p.set("pestana", f.pestana ?? "se_vienen");
  if (f.page && f.page > 1) p.set("page", String(f.page));
  p.set("size", String(size));
  return p;
}

/** Ejemplos para tocar en el buscador (búsquedas que traen proyectos). */
export const BUSQUEDAS_EJEMPLO = ["agua potable", "pistas y veredas", "carretera", "colegio", "hospital", "riego", "puente", "electrificación"];
