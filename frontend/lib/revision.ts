/**
 * La SEÑAL como unidad de primera clase — datos y reglas de negocio.
 *
 * Hasta ahora la señal (`banderas` en la base) no tenía superficie propia: vivía
 * dentro del dossier de un contrato, en la pestaña 1, y la lista de /app/alertas
 * mostraba *contratos* con unas píldoras de slug (`unico_postor_alto`) como
 * decoración. Este módulo la saca de ahí: aplana las 94 alertas publicadas en sus
 * ~220 señales, le pega a cada una la etiqueta en castellano, el agente que la
 * produjo, el cotejo contra fuentes oficiales y las citas con página, y expone
 * facetas reales para filtrarlas.
 *
 * Vive en un módulo propio (y no en lib/api-client.ts, que es compartido) porque
 * también es el único cliente de `GET /alertas/:codigo/revision`, un endpoint que
 * el backend tiene implementado desde la migración de autoevaluación y que el
 * frontend nunca llamó: explica, en lenguaje público, por qué un análisis
 * terminado NO se publicó.
 *
 * ── De dónde sale cada campo (verificado contra el API de producción) ──
 *
 *   GET /alertas?limit=500          94 alertas · 220 banderas con
 *                                   {regla, severidad, evidencia, norma, opinionOece, fuenteUrl}
 *                                   NO trae `agente` ni `verificada`. Ver `enriquecer()`.
 *   GET /contratos/:ocid            .alerta.banderas con {agente, verificada, citas[]} — 14 KB
 *                                   por contrato. Es la ÚNICA fuente pública de esos tres
 *                                   campos. 83 de los 94 contratos responden; 11 dan 404
 *                                   (la convocatoria ya no está en el índice OCDS), y esas
 *                                   señales se marcan "sin agente registrado" en vez de
 *                                   inventarles uno.
 *   …/procesamientos/reglas?perfil= catálogo {id, etiqueta, descripcion} de 35 reglas.
 *                                   Cubre 127 de las 220 señales; el resto son reglas que
 *                                   emiten los agentes de investigación y no están
 *                                   catalogadas. Para esas, `etiquetaRegla` SOLO corrige
 *                                   ortografía y siglas del id — nunca le inventa un
 *                                   significado a una regla que no conocemos.
 *   GET …/procesamientos            los 12 análisis con `alertaEstado = 'revision'`.
 *   GET /alertas/:codigo/revision   los motivos públicos de esa revisión.
 *
 * Coste del enriquecimiento: 94 fetches (concurrencia 8) ≈ 6,5 s en frío, 0 en
 * caliente — cada respuesta se cachea 30 min en el data cache de Next, y la página
 * lo envuelve en <Suspense> para que el encabezado y los filtros pinten de
 * inmediato.
 *
 * ── Fase 2: `GET /senales` (lib/senales.ts) ──
 * El API ya pagina, filtra y cuenta las señales en SQL, con agente, cotejo y citas en
 * cada fila: /app/hallazgos hace UNA llamada por página en vez de 1 + 94. Todo lo de
 * `getUniversoSenales`, `facetasSenales` y `filtrarSenales` queda como respaldo
 * (COMPAT-API-VIEJA) mientras la API de prod responda 404 en `/senales`.
 *
 * "En revisión": `?alerta=revision` en la lista de procesamientos y los motivos en cada
 * fila (o por lote en `/alertas/revision?codigos=`), en vez de una llamada por alerta.
 */

import { API_BASE, type ApiAlerta } from "@/lib/api-client";
import { FASES, canonico, getReglasPerfil, type CitaDocumento } from "@/lib/auditoria";
import { esAlertaReal } from "@/lib/semillas";
import { enParalelo } from "@/lib/concurrencia";

export type NivelBandera = "alta" | "media" | "baja";

/** Re-export: los componentes de esta superficie no deberían tener que saber que vive en auditoria.ts. */
export type { RevisionMotivo, CitaDocumento } from "@/lib/auditoria";

// ─── Una señal ya aplanada ────────────────────────────────────────────────

export interface Senal {
  /** Estable entre renders: código de alerta + regla + ordinal. Sirve de `key` y de ancla. */
  id: string;
  regla: string;
  /** La regla en castellano. Del catálogo del backend cuando existe; si no, el id con ortografía corregida. */
  etiqueta: string;
  /** Qué mira la regla (catálogo). `null` para las no catalogadas: no se rellena a mano. */
  queMira: string | null;
  severidad: NivelBandera;
  evidencia: string | null;
  norma: string | null;
  opinionOece: string | null;
  fuenteUrl: string | null;
  /** `banderas.agente_origen` crudo, p. ej. "market_price_agent". `null` = no consta. */
  agente: string | null;
  /** El mismo agente con el nombre que el producto usa ("Precios de mercado"). */
  agenteLabel: string | null;
  /**
   * `banderas.verificacion->>'ok'`. TRES estados, no dos: `true` = cotejada contra
   * OCDS/SUNAT/documentos; `null` = el análisis es anterior a que se guardara el
   * cotejo, o el contrato ya no responde. Hoy son 69 y 131 respectivamente. Pintar
   * el `null` como "no verificada" sería acusar al dato de algo que no dice.
   */
  verificada: boolean | null;
  citas: CitaDocumento[];

  // ── el contrato al que pertenece ──
  ocid: string;
  alertaCodigo: string | null;
  objeto: string;
  entidad: string;
  rucEntidad: string;
  proveedor: string;
  /** RUC del proveedor. Uno que empieza con 10 es de una persona natural: lleva su DNI adentro. */
  rucProveedor: string | null;
  /**
   * Personas PRIVADAS cuyo apellido hay que tapar en el texto libre de esta señal
   * (evidencia, citas): el proveedor cuando es persona natural, en sus dos órdenes,
   * y cualquier nombre que la evidencia pegue a un DNI. Datos planos, listos para
   * `setRedactNames` del lado cliente. Empresas y funcionarios públicos no van.
   */
  personasPrivadas: PersonaPrivada[];
  montoSoles: number;
  fechaBuenaPro: string | null;
  score: number;
  /**
   * Cuántas señales tiene el mismo contrato (para no leer una señal fuera de su contexto).
   * `null` si el API no lo manda: no se cuenta sobre la página, que es sólo un pedazo.
   */
  senalesDelContrato: number | null;
  /** Región del contrato, si el API la manda. */
  region?: string | null;
}

// ─── Etiquetas ────────────────────────────────────────────────────────────

/**
 * Siglas y palabras sin tilde que aparecen en los ids de regla. Corrige ORTOGRAFÍA,
 * no semántica: "sancion_vigente_oece" → "Sanción vigente OECE". Nunca traduce un id
 * a una frase nueva — si no sabemos qué mira una regla, el usuario ve su nombre tal
 * cual y el campo "qué mira" queda explícitamente vacío.
 */
const ORTOGRAFIA: Record<string, string> = {
  oece: "OECE", rnp: "RNP", ruc: "RUC", ciiu: "CIIU", pep: "PEP", sican: "SICAN",
  dni: "DNI", sunat: "SUNAT", ocds: "OCDS", seace: "SEACE", mef: "MEF",
  sancion: "sanción", sanciones: "sanciones", cuantia: "cuantía", limite: "límite",
  publico: "público", publica: "pública", economico: "económico", credito: "crédito",
  minimo: "mínimo", maximo: "máximo", numero: "número", codigo: "código",
  antiguedad: "antigüedad", direccion: "dirección", informacion: "información",
  participacion: "participación", concentracion: "concentración", observacion: "observación",
  certificacion: "certificación", constituido: "constituido", vinculos: "vínculos",
  politico: "político", politica: "política", tecnica: "técnica", tecnico: "técnico",
  especificacion: "especificación", restrictiva: "restrictiva", comite: "comité",
  relacion: "relación", contratacion: "contratación", adjudicacion: "adjudicación",
  ejecucion: "ejecución", omision: "omisión", revision: "revisión", emision: "emisión",
  historica: "histórica", historicas: "históricas", historico: "histórico",
  region: "región", investigacion: "investigación", corrupcion: "corrupción",
  interes: "interés", recien: "recién", generica: "genérica", contraloria: "Contraloría",
  vinculo: "vínculo", vinculada: "vinculada", valido: "válido", valida: "válida",
  // "spec" es la abreviatura que usa el pipeline para "especificación técnica": se
  // expande, no se traduce. Es la misma clase de corrección que "oece" → "OECE".
  spec: "especificación",
};

/** "sancion_vigente_oece" → "Sanción vigente OECE" */
function humanizarRegla(id: string): string {
  const palabras = id.split(/[_\s]+/).filter(Boolean).map((w) => ORTOGRAFIA[w.toLowerCase()] ?? w);
  const texto = palabras.join(" ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export interface CatalogoRegla { etiqueta: string; descripcion: string | null }
export type CatalogoReglas = Record<string, CatalogoRegla>;

/**
 * Catálogo de reglas de los cuatro perfiles del pipeline (bienes · servicios · obras ·
 * otros) más las "otras señales". Se pide una vez por hora: es un JSON estático que
 * genera `backend/scripts/exportar_reglas.py`.
 */
export async function getCatalogoReglas(): Promise<CatalogoReglas> {
  const perfiles = await Promise.all(
    ["bienes", "servicios", "obras", "otros"].map((p) => getReglasPerfil(p).catch(() => null)),
  );
  const cat: CatalogoReglas = {};
  for (const p of perfiles) {
    if (!p) continue;
    for (const r of p.reglas ?? []) cat[r.id] = { etiqueta: r.etiqueta, descripcion: r.descripcion || null };
    for (const [id, v] of Object.entries(p.otrasSenales ?? {})) cat[id] = { etiqueta: v.etiqueta, descripcion: v.descripcion || null };
  }
  return cat;
}

/**
 * Correcciones al catálogo del backend, cuando su etiqueta promete más de lo que
 * la regla cubre. `red_flag_documental` se publica como "Requisito dirigido en las
 * bases", pero es la señal genérica del análisis legal de los documentos: la
 * emite igual para un requisito a medida que para un comité vacío, un plazo
 * imposible o un único postor. Rotularla toda como "requisito dirigido" le
 * atribuye a cada fila una acusación concreta que su evidencia no siempre hace.
 */
const CATALOGO_CORREGIDO: CatalogoReglas = {
  red_flag_documental: {
    etiqueta: "Hallazgo en el expediente",
    descripcion:
      "El análisis legal de los documentos del expediente encontró algo que merece revisión: un requisito que parece hecho a la medida de un proveedor, un plazo o una penalidad fuera de lo común, una inconsistencia entre documentos. La evidencia de abajo dice cuál de esas cosas es.",
  },
};

export function etiquetaRegla(id: string, cat: CatalogoReglas): string {
  return CATALOGO_CORREGIDO[id]?.etiqueta ?? cat[id]?.etiqueta ?? humanizarRegla(id);
}

/** La etiqueta con la que llega del API (`/senales`), salvo que la corrección de arriba la reemplace. */
export function etiquetaReglaConApi(id: string, cat: CatalogoReglas, delApi: string | null | undefined): string {
  if (CATALOGO_CORREGIDO[id]) return CATALOGO_CORREGIDO[id].etiqueta;
  return cat[id]?.etiqueta ?? (delApi && delApi.trim() ? delApi : humanizarRegla(id));
}

export function descripcionRegla(id: string, cat: CatalogoReglas): string | null {
  return CATALOGO_CORREGIDO[id]?.descripcion ?? cat[id]?.descripcion ?? null;
}

// ─── Personas privadas en el texto libre ──────────────────────────────────

export interface PersonaPrivada {
  nombre: string;
  orden: "sunat" | "nombres-primero";
}

/**
 * Un RUC que empieza con 10 es de una persona natural con negocio. Copia de
 * `esPersonaNatural` de components/Redact.tsx: aquella vive en un módulo
 * "use client" y llamarla desde el servidor revienta en producción.
 */
export const esRucPersonaNatural = (ruc?: string | null) => !!ruc && /^10\d{9}$/.test(ruc.trim());

/**
 * "CARPIO COBOS ABEL" (orden SUNAT: apellidos primero) → "ABEL CARPIO COBOS".
 * La evidencia que redacta un agente suele nombrar al proveedor en el orden
 * hablado, así que se registran las dos formas: en ambas se tapa el mismo
 * apellido materno.
 */
function ordenHablado(sunat: string): string | null {
  const p = sunat.trim().split(/\s+/);
  if (p.length < 3) return null;
  return [...p.slice(2), ...p.slice(0, 2)].join(" ");
}

/**
 * Nombres que el texto pega a un DNI: "PEZO VARGAS DIEGO (DNI 73524824)". El DNI
 * es la marca de que se trata de una persona natural y, con 2 o 3 palabras, del
 * orden RNP/SUNAT (apellidos primero; con 4+, ver `personasPrivadas`). No es
 * adivinar con NER: sin el DNI al lado no se toca nada.
 */
const NOMBRE_CON_DNI = /([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'-]+(?:\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'-]+){1,4}),?\s*\(\s*DNI\s*(?:N[°º.]?\s*)?\d{8}\s*\)/g;

export function personasPrivadas(proveedor: string | null, rucProveedor: string | null, textos: (string | null)[]): PersonaPrivada[] {
  const out: PersonaPrivada[] = [];
  if (proveedor && esRucPersonaNatural(rucProveedor)) {
    out.push({ nombre: proveedor, orden: "sunat" });
    const hablado = ordenHablado(proveedor);
    if (hablado) out.push({ nombre: hablado, orden: "nombres-primero" });
  }
  for (const t of textos) {
    if (!t) continue;
    for (const m of t.matchAll(NOMBRE_CON_DNI)) {
      // Con 4+ palabras el orden es ambiguo ("DIEGO ARMANDO PEZO VARGAS" o "PEZO
      // VARGAS DIEGO ARMANDO"), y forzar SUNAT tapaba el segundo nombre de pila
      // del orden hablado. Además la captura puede arrastrar una palabra de más
      // por delante ("GERENTE JUAN PEREZ LOPEZ"), pero termina siempre pegada al
      // DNI. Va en lectura natural (se tapa la última palabra) y setRedactNames
      // registra también el otro orden, así que en los dos se tapa el mismo
      // segundo apellido. Con 2 o 3 palabras sigue el orden RNP/SUNAT.
      const palabras = m[1].split(/\s+/).length;
      out.push({ nombre: m[1], orden: palabras >= 4 ? "nombres-primero" : "sunat" });
    }
  }
  const vistos = new Set<string>();
  return out.filter((p) => {
    const k = p.nombre.toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** `agente_origen` ("market_price_agent") → el nombre con el que el producto llama a ese agente. */
const POR_NOMBRE_AGENTE = new Map(FASES.map((f) => [f.agente, f.label] as const));
const POR_CLAVE_AGENTE = new Map(FASES.map((f) => [f.key, f.label] as const));

export function agenteLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return POR_NOMBRE_AGENTE.get(raw) ?? POR_CLAVE_AGENTE.get(canonico(raw)) ?? humanizarRegla(raw.replace(/_agent$/, ""));
}

// ─── Query en la URL ──────────────────────────────────────────────────────

export type VistaSenales = "publicadas" | "revision";

export interface SenalesQuery {
  vista: VistaSenales;
  regla?: string;
  severidad?: NivelBandera;
  /** RUC de la entidad: identificador estable, a diferencia del nombre. */
  entidad?: string;
  /** `agente_origen` crudo, o el centinela SIN_AGENTE. */
  agente?: string;
  /** Búsqueda libre (entidad, objeto, código). Sólo con `/senales`. */
  q?: string;
  /** Cotejo: el valor tal como lo devuelve la faceta `cotejo` del API. Sólo con `/senales`. */
  cotejo?: string;
  /** Página por cursor (`/senales`): el token opaco de esta página. */
  cursor?: string;
  /** Los cursores de las páginas anteriores, en orden (el primero es el de la página 2). */
  atras: string[];
  /** Página por número: sólo el respaldo (COMPAT-API-VIEJA), que pagina en memoria. */
  pagina: number;
}

/** Valor del filtro de agente para las señales cuyo agente de origen no consta. */
export const SIN_AGENTE = "sin_registro";

const SEVERIDADES: NivelBandera[] = ["alta", "media", "baja"];

/** Los cursores son base64url opacos: sólo se valida la forma, nunca se decodifican. */
const CURSOR_RX = /^[A-Za-z0-9_-]{1,512}={0,2}$/;
/** Cuántas páginas hacia atrás recuerda la URL (cada cursor pesa ~60–100 caracteres). */
export const MAX_ATRAS = 20;

export function parseSenalesQuery(sp: Record<string, string | string[] | undefined> = {}): SenalesQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const sev = s("severidad");
  const cursor = s("cursor");
  const atras = (s("atras") ?? "").split(",").filter((c) => CURSOR_RX.test(c)).slice(-MAX_ATRAS);
  return {
    vista: s("vista") === "revision" ? "revision" : "publicadas",
    regla: s("regla")?.slice(0, 80) || undefined,
    severidad: sev && (SEVERIDADES as string[]).includes(sev) ? (sev as NivelBandera) : undefined,
    entidad: s("entidad")?.replace(/\D/g, "").slice(0, 11) || undefined,
    agente: s("agente")?.slice(0, 60) || undefined,
    q: s("q")?.trim().slice(0, 120) || undefined,
    cotejo: s("cotejo")?.slice(0, 30) || undefined,
    cursor: cursor && CURSOR_RX.test(cursor) ? cursor : undefined,
    atras: cursor && CURSOR_RX.test(cursor) ? atras : [],
    pagina: Math.max(1, Number.parseInt(s("pagina") ?? "1", 10) || 1),
  };
}

/** Datos planos (nunca una función) para que `<Paginacion>` arme sus links desde un server component. */
export function senalesQueryParams(q: SenalesQuery): Record<string, string | undefined> {
  return {
    vista: q.vista === "revision" ? "revision" : undefined,
    regla: q.regla,
    severidad: q.severidad,
    entidad: q.entidad,
    agente: q.agente,
    q: q.q,
    cotejo: q.cotejo,
  };
}

export function senalesQueryString(q: Partial<SenalesQuery> & { pagina?: number }): string {
  const p = new URLSearchParams();
  if (q.vista === "revision") p.set("vista", "revision");
  if (q.regla) p.set("regla", q.regla);
  if (q.severidad) p.set("severidad", q.severidad);
  if (q.entidad) p.set("entidad", q.entidad);
  if (q.agente) p.set("agente", q.agente);
  if (q.q) p.set("q", q.q);
  if (q.cotejo) p.set("cotejo", q.cotejo);
  if (q.pagina && q.pagina > 1) p.set("pagina", String(q.pagina));
  return p.toString();
}

export const hayFiltrosSenales = (q: SenalesQuery) => !!(q.regla || q.severidad || q.entidad || q.agente || q.q || q.cotejo);

// ─── Carga y enriquecimiento ──────────────────────────────────────────────

interface BanderaLista {
  regla: string;
  severidad: NivelBandera;
  evidencia: string | null;
  norma: string | null;
  opinionOece: string | null;
  fuenteUrl: string | null;
}

/** Lo que `GET /contratos/:ocid` sí sabe y la lista no. */
interface BanderaRica { regla: string; agente: string | null; verificada: boolean | null; citas: CitaDocumento[] }

async function banderasRicas(ocid: string): Promise<BanderaRica[]> {
  try {
    const res = await fetch(`${API_BASE}/contratos/${encodeURIComponent(ocid)}`, { next: { revalidate: 1800 } } as RequestInit);
    if (!res.ok) return [];
    const body = (await res.json()) as { alerta?: { banderas?: unknown } | null };
    const bs = body.alerta?.banderas;
    if (!Array.isArray(bs)) return [];
    return bs.map((b: Record<string, unknown>) => ({
      regla: String(b.regla ?? ""),
      agente: typeof b.agente === "string" && b.agente ? b.agente : null,
      verificada: typeof b.verificada === "boolean" ? b.verificada : null,
      citas: Array.isArray(b.citas) ? (b.citas as CitaDocumento[]) : [],
    }));
  } catch {
    return [];
  }
}

/**
 * La misma señal guardada dos veces: el pipeline a veces persiste la misma bandera
 * (misma regla, misma evidencia palabra por palabra) en dos pasadas. En producción
 * son 12 filas repetidas, casi todas en OECE-1211887 y OECE-1216608. Contarlas dos
 * veces infla el índice y hace que un contrato parezca tener el doble de indicios.
 */
const claveSenal = (regla: string, evidencia: string | null | undefined) =>
  `${regla}\u0000${(evidencia ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;

/** Cuántas señales DISTINTAS trae una alerta (sin las repetidas). */
function contarDistintas(a: ApiAlerta): number {
  const banderas = (Array.isArray(a.banderas) ? a.banderas : []) as unknown as BanderaLista[];
  return new Set(banderas.map((b) => claveSenal(b.regla, b.evidencia))).size;
}

const claveCita = (c: CitaDocumento) => `${c.documentoUrl ?? ""}|${c.pagina ?? ""}|${c.cita ?? ""}`;

/** Aplana una alerta en sus señales y le pega lo que sabe `/contratos/:ocid`. */
function aplanar(a: ApiAlerta, ricas: BanderaRica[], cat: CatalogoReglas): Senal[] {
  const banderas = (Array.isArray(a.banderas) ? a.banderas : []) as unknown as BanderaLista[];
  const distintas = contarDistintas(a);
  const rucProveedor = a.rucProveedor ? String(a.rucProveedor) : null;
  // Las dos fuentes ordenan por severidad pero sin el mismo desempate, así que se
  // emparejan por regla y, dentro de la misma regla, por orden de aparición. El
  // emparejamiento corre sobre la lista COMPLETA (repetidas incluidas), porque
  // `/contratos/:ocid` también las trae repetidas; recién después se deduplica.
  const usadas = new Map<string, number>();
  const porClave = new Map<string, Senal>();
  for (const b of banderas) {
    const n = usadas.get(b.regla) ?? 0;
    usadas.set(b.regla, n + 1);
    const rica = ricas.filter((r) => r.regla === b.regla)[n] ?? null;
    const citas = (rica?.citas ?? []).filter((c) => c && (c.pagina != null || c.documentoUrl));
    const clave = claveSenal(b.regla, b.evidencia);
    const previa = porClave.get(clave);
    if (previa) {
      // Repetida: no es una señal más. Lo único que puede aportar es el agente, el
      // cotejo o una cita que a la primera copia le faltaban.
      if (!previa.agente && rica?.agente) {
        previa.agente = rica.agente;
        previa.agenteLabel = agenteLabel(rica.agente);
      }
      if (previa.verificada == null && rica?.verificada != null) previa.verificada = rica.verificada;
      const ya = new Set(previa.citas.map(claveCita));
      previa.citas.push(...citas.filter((c) => !ya.has(claveCita(c))));
      continue;
    }
    const sev: NivelBandera = SEVERIDADES.includes(b.severidad) ? b.severidad : "baja";
    porClave.set(clave, {
      id: `${a.codigo ?? a.codigoconvocatoria}-${b.regla}-${n}`,
      regla: b.regla,
      etiqueta: etiquetaRegla(b.regla, cat),
      queMira: descripcionRegla(b.regla, cat),
      severidad: sev,
      evidencia: b.evidencia || null,
      norma: b.norma || null,
      opinionOece: b.opinionOece || null,
      fuenteUrl: b.fuenteUrl || null,
      agente: rica?.agente ?? null,
      agenteLabel: agenteLabel(rica?.agente),
      verificada: rica?.verificada ?? null,
      citas,
      ocid: String(a.codigoconvocatoria),
      alertaCodigo: a.codigo ?? null,
      objeto: a.objeto ?? "—",
      entidad: a.entidad ?? "—",
      rucEntidad: a.rucEntidad ?? "",
      proveedor: a.proveedor ?? "—",
      rucProveedor,
      personasPrivadas: [],
      montoSoles: Number(a.montoSoles ?? 0),
      fechaBuenaPro: a.fechaBuenaPro ?? null,
      score: Number(a.score ?? 0),
      senalesDelContrato: distintas,
    });
  }
  const senales = [...porClave.values()];
  for (const s of senales) {
    s.personasPrivadas = personasPrivadas(a.proveedor ?? null, rucProveedor, [s.evidencia, ...s.citas.map((c) => c.cita ?? null)]);
  }
  return senales;
}

const PESO: Record<NivelBandera, number> = { alta: 0, media: 1, baja: 2 };

/**
 * Las 94 alertas publicadas, crudas. Separado del enriquecimiento porque hay dos
 * consumidores con necesidades distintas: la vista "en revisión" sólo necesita
 * CONTAR las señales publicadas para ponerlas al lado de las bloqueadas, y no tiene
 * por qué pagar los 94 fetches del enriquecimiento para mostrar un número.
 */
async function getAlertasPublicadas(): Promise<{ alertas: ApiAlerta[]; fallo: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/alertas?limit=500`, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) throw new Error(String(res.status));
    const data = ((await res.json()) as { data: ApiAlerta[] }).data ?? [];
    // Nunca las 10 alertas de demo `ALT-2026-00xx` que siguen sembradas en la base
    // (ver lib/semillas.ts): traían RUC y montos inventados sobre municipalidades reales.
    return { alertas: data.filter(esAlertaReal), fallo: false };
  } catch {
    return { alertas: [], fallo: true };
  }
}

/** Cuántas señales hay publicadas, sin enriquecer nada (un solo fetch, ya cacheado). Sin repetidas. */
export async function contarSenalesPublicadas(): Promise<number> {
  const { alertas } = await getAlertasPublicadas();
  return alertas.reduce((n, a) => n + contarDistintas(a), 0);
}

export interface UltimoAnalisis {
  entidad: string;
  ocid: string;
  analizadoEn: string;
}

/**
 * El análisis más reciente que terminó en señales PUBLICADAS. Sale de
 * `GET /alertas/analizadas`, el único listado que trae `analizado_en` (la fecha
 * de buena pro es la del contrato, no la del análisis). Ese listado incluye los
 * análisis que quedaron en revisión humana, así que se cruza contra los códigos
 * que sí están publicados antes de elegir uno. Si no responde, `null`: la línea
 * no se muestra, no se inventa una fecha.
 */
export async function getUltimoAnalisisPublicado(publicados: ReadonlySet<string>): Promise<UltimoAnalisis | null> {
  if (publicados.size === 0) return null;
  try {
    const res = await fetch(`${API_BASE}/alertas/analizadas?limit=60`, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      items?: { codigo?: string; ocid?: string; codigo_convocatoria?: string; entidad?: string; analizado_en?: string; n_banderas?: number | string }[];
    };
    const items = (j.items ?? [])
      .filter((it) => it.codigo && publicados.has(it.codigo) && it.analizado_en && Number(it.n_banderas ?? 0) > 0)
      .sort((x, y) => String(y.analizado_en).localeCompare(String(x.analizado_en)));
    const it = items[0];
    if (!it || !it.entidad || Number.isNaN(new Date(String(it.analizado_en)).getTime())) return null;
    return { entidad: it.entidad, ocid: String(it.codigo_convocatoria ?? it.ocid ?? ""), analizadoEn: String(it.analizado_en) };
  } catch {
    return null;
  }
}

/**
 * Como `getUltimoAnalisisPublicado`, sin necesitar la lista de publicados: `/alertas/analizadas`
 * ya sólo trae alertas publicadas, así que basta el más reciente que tenga alguna señal.
 */
export async function getUltimoAnalisisConSenales(): Promise<UltimoAnalisis | null> {
  try {
    const res = await fetch(`${API_BASE}/alertas/analizadas?limit=30`, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      items?: { codigo?: string; ocid?: string; codigo_convocatoria?: string; entidad?: string; analizado_en?: string; n_banderas?: number | string }[];
    };
    const it = (j.items ?? [])
      .filter((x) => x.codigo && esAlertaReal({ codigo: x.codigo }) && x.analizado_en && Number(x.n_banderas ?? 0) > 0)
      .sort((x, y) => String(y.analizado_en).localeCompare(String(x.analizado_en)))[0];
    if (!it || !it.entidad || Number.isNaN(new Date(String(it.analizado_en)).getTime())) return null;
    return { entidad: it.entidad, ocid: String(it.codigo_convocatoria ?? it.ocid ?? ""), analizadoEn: String(it.analizado_en) };
  } catch {
    return null;
  }
}

/** Cuántos contratos tienen dictamen publicado (el `total` de `/alertas`, contado en SQL). */
export async function contarContratosConDictamen(): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/alertas?limit=1`, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as { total?: unknown };
    return typeof j.total === "number" ? j.total : null;
  } catch {
    return null;
  }
}

export interface UniversoSenales {
  senales: Senal[];
  /** Contratos publicados de los que salen esas señales. */
  contratos: number;
  /** Contratos cuyo detalle no respondió: sus señales quedan sin agente ni cotejo. */
  contratosSinDetalle: number;
  /** El API de alertas no respondió: la página lo dice en vez de mostrar 0. */
  fallo: boolean;
}

/**
 * Todo el universo de señales publicadas, enriquecido. Una sola llamada a
 * `/alertas?limit=500` (94 filas, 163 KB) + un fetch por contrato. Se filtra y
 * pagina en memoria porque el API no sabe filtrar por regla ni por agente, y
 * porque 220 filas caben de sobra: lo que viaja al navegador es solo la página
 * renderizada, no el JSON.
 */
export async function getUniversoSenales(): Promise<UniversoSenales> {
  const { alertas, fallo } = await getAlertasPublicadas();
  if (fallo) return { senales: [], contratos: 0, contratosSinDetalle: 0, fallo: true };

  const cat = await getCatalogoReglas().catch(() => ({} as CatalogoReglas));
  const ricas = await enParalelo(alertas, 8, (a) => banderasRicas(String(a.codigoconvocatoria)));

  const senales: Senal[] = [];
  let sinDetalle = 0;
  alertas.forEach((a, i) => {
    // Sólo cuenta como "sin detalle" el contrato que SÍ tiene señales publicadas y
    // aun así no devolvió nada: si no tiene banderas, no hay nada que enriquecer.
    if (ricas[i].length === 0 && Array.isArray(a.banderas) && a.banderas.length > 0) sinDetalle++;
    senales.push(...aplanar(a, ricas[i], cat));
  });

  senales.sort(
    (x, y) =>
      PESO[x.severidad] - PESO[y.severidad] ||
      y.score - x.score ||
      x.entidad.localeCompare(y.entidad, "es") ||
      x.etiqueta.localeCompare(y.etiqueta, "es"),
  );

  return { senales, contratos: alertas.length, contratosSinDetalle: sinDetalle, fallo: false };
}

// ─── Facetas ──────────────────────────────────────────────────────────────

export interface Faceta { valor: string; etiqueta: string; n: number }

export interface FacetasSenales {
  severidad: Faceta[];
  regla: Faceta[];
  entidad: Faceta[];
  agente: Faceta[];
}

/** Cuántas de ESTAS señales traen cotejo contra fuente oficial. Se cuenta sobre el conjunto que se está mirando. */
export const contarCotejadas = (senales: Senal[]) => senales.filter((s) => s.verificada === true).length;

const coincide = (s: Senal, q: SenalesQuery, salvo: keyof SenalesQuery) =>
  (salvo === "severidad" || !q.severidad || s.severidad === q.severidad) &&
  (salvo === "regla" || !q.regla || s.regla === q.regla) &&
  (salvo === "entidad" || !q.entidad || s.rucEntidad === q.entidad) &&
  (salvo === "agente" || !q.agente || (q.agente === SIN_AGENTE ? s.agente == null : s.agente === q.agente));

export function filtrarSenales(senales: Senal[], q: SenalesQuery): Senal[] {
  return senales.filter((s) => coincide(s, q, "pagina"));
}

function contar(senales: Senal[], clave: (s: Senal) => string | null, etiqueta: (s: Senal) => string): Faceta[] {
  const mapa = new Map<string, Faceta>();
  for (const s of senales) {
    const v = clave(s);
    if (v == null) continue;
    const f = mapa.get(v);
    if (f) f.n++;
    else mapa.set(v, { valor: v, etiqueta: etiqueta(s), n: 1 });
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

/**
 * Facetas cruzadas: cada lista se cuenta sobre el conjunto filtrado por *los otros*
 * filtros, nunca sobre el universo entero. Así una opción que diga "(14)" tiene de
 * verdad 14 resultados con los filtros puestos, y ninguna opción ofrece un callejón
 * sin salida.
 */
export function facetasSenales(senales: Senal[], q: SenalesQuery): FacetasSenales {
  const sub = (salvo: keyof SenalesQuery) => senales.filter((s) => coincide(s, q, salvo));
  const sevSub = sub("severidad");
  const ordenSev = (a: Faceta, b: Faceta) => PESO[a.valor as NivelBandera] - PESO[b.valor as NivelBandera];
  return {
    severidad: contar(sevSub, (s) => s.severidad, (s) => s.severidad).sort(ordenSev),
    regla: contar(sub("regla"), (s) => s.regla, (s) => s.etiqueta),
    entidad: contar(sub("entidad"), (s) => s.rucEntidad || null, (s) => s.entidad),
    agente: [
      ...contar(sub("agente"), (s) => s.agente, (s) => s.agenteLabel ?? s.agente ?? "—"),
      // Las señales cuyo agente de origen no consta se ofrecen como su propia opción,
      // con su conteo real, en vez de desaparecer del filtro sin decir nada.
      ...(() => {
        const n = sub("agente").filter((s) => s.agente == null).length;
        return n ? [{ valor: SIN_AGENTE, etiqueta: "Sin agente registrado", n }] : [];
      })(),
    ],
  };
}

// ─── Formato ──────────────────────────────────────────────────────────────

/**
 * Soles exactos, no redondeados. `formatSoles` de lib/mock-data devuelve "S/ 56 K",
 * que sirve para un titular y no para una señal: el monto es parte de la evidencia
 * y redondearlo la debilita frente a quien tiene que defenderla.
 */
export const soles = (n: number) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 }).format(n);

// ─── "En revisión humana" ─────────────────────────────────────────────────
// Vive en lib/revision-humana.ts (este módulo pasaba las 800 líneas); se reexporta para que
// quien lo importaba desde acá no cambie.
export { getAnalisisEnRevision, getRevisionPublica, type AnalisisEnRevision, type RevisionPublica } from "@/lib/revision-humana";
