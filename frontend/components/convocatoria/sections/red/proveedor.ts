/**
 * Los hechos del proveedor para contar su historia en la pestaña «Proveedor y red» (pedido del usuario del 2026-11-05:
 * «veo que solo apilamos y demás sin dar orden o contar una historia»). Cálculo puro, sin JSX: lo que dicen los registros
 * (`expediente_proveedor`: padrón SUNAT, RNP, OECE, CONOSCE) y, para un análisis anterior, el perfil que copió el agente
 * web (`web_research.empresa`). La frase de arriba, la ficha y los capítulos leen de aquí y dicen lo mismo.
 */

import { esRucPersonaNatural } from "@/lib/privacidad";

export type Sev = "alta" | "media" | "baja";
export const RANGO_SEV: Record<Sev, number> = { alta: 0, media: 1, baja: 2 };
export const sevDe = (v: unknown): Sev => (v === "alta" || v === "media" ? v : "baja");

// ─── «Falta de información SUNAT» cuando el padrón SÍ está ──────────────────────────────────────────────────────

/**
 * Lo que el agente escribe cuando decolecta no respondió («SUNAT no disponible (HTTP 403)», «Falta de información
 * SUNAT», «no se pudo obtener el RUC»). Con el padrón en la base es falso, y como señal confunde: se quita. Acotado a
 * la FALTA del dato: «sin trabajadores declarados en SUNAT» es un hallazgo y se queda.
 */
const FALTA_SUNAT = new RegExp(
  [
    String.raw`(falta|ausencia|carencia)\s+de\s+(informaci[oó]n|datos?)[^.]{0,30}sunat`,
    String.raw`sin\s+(informaci[oó]n|datos?)\s+(de\s+|del\s+|en\s+)?(la\s+)?sunat`,
    String.raw`sunat[^.]{0,40}(no\s+(estuvo\s+|est[aá]\s+)?disponible|no\s+respondi|no\s+se\s+pudo|inaccesible|no\s+accesible|http\s*\d{3}|incomplet)`,
    String.raw`no\s+se\s+(pudo|logr[oó])\s+(obtener|consultar|verificar|acceder)[^.]{0,40}sunat`,
    String.raw`informaci[oó]n\s+(de\s+|del\s+)?(la\s+)?sunat\s+(incompleta|no\s+disponible|faltante|insuficiente)`,
  ].join("|"),
  "i",
);

export function esFaltaSunat(...partes: unknown[]): boolean {
  return FALTA_SUNAT.test(partes.map((p) => (typeof p === "string" ? p : "")).join(" "));
}

/** ¿Tenemos el padrón del proveedor? (del expediente o, en un análisis viejo, el perfil que copió el agente web). */
export function haySunat(exp: any, empresaWeb?: any): boolean {
  const s = exp?.sunat;
  if (s && (s.estado || s.condicion || s.fecha_inicio_actividades || s.actividad)) return true;
  if (Array.isArray(exp?.integrantes) && exp.integrantes.some((e: any) => haySunat(e))) return true;
  const w = empresaWeb;
  return !!(w && (w.estado || w.condicion || w.fecha_inicio_actividades));
}

/** Las señales del agente sin la «falta de SUNAT» cuando el padrón está. */
export function sinFaltaSunat<T extends { titulo?: unknown; descripcion?: unknown; evidencia?: unknown }>(lista: T[], hay: boolean): T[] {
  if (!hay) return lista;
  return lista.filter((b) => !esFaltaSunat(b?.titulo, b?.descripcion, typeof b?.evidencia === "string" ? b.evidencia : ""));
}

/**
 * Las fuentes que consultó el agente web, con SUNAT dicho como es: si el padrón está en la base, la fila «SUNAT no
 * respondió» pasa a «leído del padrón de la base de Vigía» (antes decía que faltaba y el dato estaba arriba).
 */
export function fuentesSinFaltaSunat(hallazgos: any[], hay: boolean): any[] {
  if (!hay) return hallazgos;
  return hallazgos.map((h) =>
    /sunat/i.test(String(h?.fuente ?? "")) && (h?.estado === "error" || esFaltaSunat(h?.mensaje))
      ? { ...h, estado: "ok", mensaje: "Estado, condición y fecha de inicio leídos del padrón de la SUNAT en la base de Vigía.", url: null }
      : h,
  );
}

// ─── El RUC en palabras ─────────────────────────────────────────────────────────────────────────────────────────

/** «ACTIVO» → «activo», «BAJA DE OFICIO» → «dado de baja de oficio», «SUSPENSION TEMPORAL» → «suspendido». */
export function estadoLegible(estado?: string | null): string | null {
  const e = String(estado ?? "").trim().toUpperCase();
  if (!e) return null;
  if (e.startsWith("ACTIV")) return "activo";
  if (e.startsWith("BAJA")) return e.includes("OFICIO") ? "dado de baja de oficio" : "dado de baja";
  if (e.startsWith("SUSPEN")) return "suspendido";
  return e.toLocaleLowerCase("es");
}

export function condicionLegible(c?: string | null): string | null {
  const t = String(c ?? "").trim().toUpperCase();
  if (!t) return null;
  if (t === "HABIDO") return "habido";
  if (t.startsWith("NO HABIDO")) return "no habido";
  if (t.startsWith("NO HALLADO")) return "no hallado";
  return t.toLocaleLowerCase("es");
}

/**
 * Activo y habido: lo normal. Lo que no se publicó no cuenta en contra (el agente a veces copió sólo la condición): sólo
 * un estado o una condición distintos se dicen.
 */
export function rucEnRegla(estado?: string | null, condicion?: string | null): boolean {
  const e = estadoLegible(estado);
  const c = condicionLegible(condicion);
  return (e == null || e === "activo") && (c == null || c === "habido");
}

/** «12 años», «8 meses», «45 días»: cuánto llevaba el RUC al contratar. */
export function antiguedadTexto(dias?: number | null): string | null {
  if (typeof dias !== "number" || !Number.isFinite(dias) || dias < 0) return null;
  if (dias >= 365) {
    const a = Math.floor(dias / 365);
    return a === 1 ? "1 año" : `${a} años`;
  }
  if (dias >= 60) return `${Math.floor(dias / 30)} meses`;
  return dias === 1 ? "1 día" : `${dias} días`;
}

// ─── Los hechos ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface HechosProveedor {
  nombre: string;
  ruc: string | null;
  natural: boolean;
  consorcio: boolean;
  integrantes: { nombre: string; ruc: string | null }[];
  sunat: {
    estado: string | null;
    condicion: string | null;
    enRegla: boolean;
    edadDias: number | null;
    actividad: string | null;
    departamento: string | null;
    inhabilitada: string | null;
    inhabilitadaHasta: string | null;
    fechaDudosa: string | null;
  } | null;
  historial: { procesos: number; monto: number | null; entidades: number | null; conEsta: { procesos: number; monto: number } | null } | null;
  /** null: el expediente no trae sanciones (la ficha de un análisis viejo). */
  sanciones: { total: number; vigentes: number } | null;
  penalidades: { n: number; monto: number | null; entidades: number | null } | null;
  /** Las banderas de Vigía del proveedor en otros procesos (cruces_proveedor). */
  banderasVigia: { tipos: number; conAlta: boolean };
}

const hoy = () => new Date().toISOString().slice(0, 10);

/** Una sanción del OECE vigente hoy: lo dice su estado o, sin estado, su fecha de fin. */
export function sancionVigente(s: any): boolean {
  const e = String(s?.estado ?? "").toLowerCase();
  if (e) return /vigente/.test(e) && !/no\s+vigente/.test(e);
  const hasta = typeof s?.fecha_hasta === "string" ? s.fecha_hasta.slice(0, 10) : null;
  return !!hasta && hasta >= hoy();
}

function hechosDeUno(exp: any): Omit<HechosProveedor, "nombre" | "consorcio" | "integrantes"> & { razon: string | null } {
  const ruc: string | null = exp?.ruc ? String(exp.ruc) : null;
  const s = exp?.sunat ?? null;
  const h = exp?.historial ?? null;
  const sanc: any[] | null = Array.isArray(exp?.sanciones) ? exp.sanciones : exp?.desde_ficha ? null : [];
  const pen = exp?.penalidades ?? null;
  const porTipo = new Map<string, boolean>();
  for (const b of (exp?.banderas ?? []) as any[]) porTipo.set(String(b?.tipo ?? ""), (porTipo.get(String(b?.tipo ?? "")) ?? false) || b?.severidad === "alta");
  return {
    razon: s?.razon_social ?? null,
    ruc,
    natural: esRucPersonaNatural(ruc),
    sunat: s
      ? {
          estado: s.estado ?? null,
          condicion: s.condicion ?? null,
          enRegla: rucEnRegla(s.estado, s.condicion),
          edadDias: typeof s.edad_dias_al_contratar === "number" ? s.edad_dias_al_contratar : null,
          actividad: s.actividad ? String(s.actividad).trim().replace(/\.$/, "") : null,
          departamento: s.departamento ?? null,
          inhabilitada: s.inhabilitada ? String(s.inhabilitada) : null,
          inhabilitadaHasta: s.inhabilitada_hasta ?? null,
          fechaDudosa: s.fecha_inicio_dudosa ?? null,
        }
      : null,
    historial: h
      ? {
          procesos: Number(h.procesos ?? 0),
          monto: typeof h.monto === "number" ? h.monto : null,
          entidades: typeof h.entidades === "number" ? h.entidades : null,
          conEsta: h.con_esta_entidad ? { procesos: Number(h.con_esta_entidad.procesos ?? 0), monto: Number(h.con_esta_entidad.monto ?? 0) } : null,
        }
      : null,
    sanciones: sanc ? { total: sanc.length, vigentes: sanc.filter(sancionVigente).length } : null,
    penalidades: pen && Number(pen.n) > 0 ? { n: Number(pen.n), monto: typeof pen.monto === "number" ? pen.monto : null, entidades: pen.entidades ?? null } : null,
    banderasVigia: { tipos: porTipo.size, conAlta: Array.from(porTipo.values()).some(Boolean) },
  };
}

/**
 * Los hechos del ganador. Un consorcio suma lo de sus integrantes (sanciones, penalidades, banderas) y no tiene padrón
 * propio. Sin expediente (análisis anterior al 2026-11-04), lo que copió el agente web del padrón.
 */
export function hechosProveedor(result: any, ganador?: any): HechosProveedor | null {
  const exp = result?.expediente_proveedor ?? null;
  const web = result?.web_research?.empresa ?? null;
  const nombreBase: string = String(ganador?.nombre || exp?.nombre || exp?.sunat?.razon_social || web?.razon_social || "").trim();

  if (exp?.consorcio && Array.isArray(exp.integrantes)) {
    const partes = exp.integrantes.map(hechosDeUno);
    const suma = (f: (p: ReturnType<typeof hechosDeUno>) => number) => partes.reduce((a: number, p: ReturnType<typeof hechosDeUno>) => a + f(p), 0);
    const conSanciones = partes.filter((p: ReturnType<typeof hechosDeUno>) => p.sanciones);
    return {
      nombre: String(exp.nombre || nombreBase || "Consorcio"),
      ruc: ganador?.ruc ?? null,
      natural: false,
      consorcio: true,
      integrantes: exp.integrantes.map((e: any, i: number) => ({ nombre: String(e?.nombre || partes[i].razon || "Integrante"), ruc: e?.ruc ?? null })),
      sunat: null,
      historial: null,
      sanciones: conSanciones.length ? { total: suma((p) => p.sanciones?.total ?? 0), vigentes: suma((p) => p.sanciones?.vigentes ?? 0) } : null,
      penalidades: partes.some((p: ReturnType<typeof hechosDeUno>) => p.penalidades)
        ? { n: suma((p) => p.penalidades?.n ?? 0), monto: suma((p) => p.penalidades?.monto ?? 0), entidades: null }
        : null,
      banderasVigia: { tipos: suma((p) => p.banderasVigia.tipos), conAlta: partes.some((p: ReturnType<typeof hechosDeUno>) => p.banderasVigia.conAlta) },
    };
  }

  if (exp) {
    const u = hechosDeUno(exp);
    return {
      nombre: nombreBase || u.razon || "El proveedor",
      ruc: u.ruc ?? ganador?.ruc ?? null,
      natural: u.natural || esRucPersonaNatural(ganador?.ruc),
      consorcio: false,
      integrantes: [],
      sunat: u.sunat,
      historial: u.historial,
      sanciones: u.sanciones,
      penalidades: u.penalidades,
      banderasVigia: u.banderasVigia,
    };
  }

  if (!nombreBase && !web) return null;
  const ruc: string | null = ganador?.ruc ?? web?.ruc ?? null;
  const edad = typeof web?.edad_dias_al_contrato === "number" ? web.edad_dias_al_contrato : null;
  return {
    nombre: nombreBase || "El proveedor",
    ruc,
    natural: esRucPersonaNatural(ruc),
    consorcio: !!ganador?.es_consorcio,
    integrantes: [],
    sunat:
      web && (web.estado || web.condicion || web.fecha_inicio_actividades)
        ? {
            estado: web.estado ?? null,
            condicion: web.condicion ?? null,
            enRegla: rucEnRegla(web.estado, web.condicion),
            edadDias: edad,
            actividad: Array.isArray(web.actividades_comerciales) && web.actividades_comerciales[0] ? String(web.actividades_comerciales[0]) : null,
            departamento: null,
            inhabilitada: null,
            inhabilitadaHasta: null,
            fechaDudosa: null,
          }
        : null,
    historial: null,
    sanciones: null,
    penalidades: null,
    banderasVigia: { tipos: 0, conAlta: false },
  };
}

// ─── El vínculo más fuerte de la red ────────────────────────────────────────────────────────────────────────────

export interface Vinculo {
  texto: string;
  severidad: Sev;
}

/**
 * Lo más fuerte que encontró la red, para la frase de arriba: la señal de red más grave (con la falta de SUNAT ya
 * quitada) o, si el agente no dejó señales, el cruce duro más fuerte de los datos (un firmante con relación, el mismo
 * domicilio, un vínculo con autoridades, la política, otras empresas del mismo titular). null: la red no encontró nada.
 */
export function vinculoMasFuerte(result: any, sunatEnBase: boolean): Vinculo | null {
  const pn = result?.person_network ?? null;
  const banderas = sinFaltaSunat((pn?.banderas_red ?? []) as any[], sunatEnBase)
    .filter((b) => b?.titulo)
    .sort((a, b) => RANGO_SEV[sevDe(a.severidad)] - RANGO_SEV[sevDe(b.severidad)]);
  if (banderas.length) return { texto: String(banderas[0].titulo).trim().replace(/\.$/, ""), severidad: sevDe(banderas[0].severidad) };

  const firmantes = ((pn?.cruce_firmantes_ganador ?? []) as any[]).filter(
    (c) => String(c?.severidad ?? "").toLowerCase() === "alta" || (c?.tipo_relacion && String(c.tipo_relacion).toLowerCase() !== "sin_relacion"),
  );
  if (firmantes.length) {
    return {
      texto: firmantes.length === 1 ? "un firmante del acta tiene relación con el proveedor" : `${firmantes.length} firmantes del acta tienen relación con el proveedor`,
      severidad: "alta",
    };
  }
  const red = pn?.red_empresarial ?? {};
  const dom = (red.empresas_misma_direccion ?? []).length;
  if (dom) return { texto: `comparte domicilio fiscal con ${dom === 1 ? "otra empresa" : `${dom} empresas`}`, severidad: "media" };
  const aut = (pn?.vinculo_autoridades ?? []).length;
  if (aut) return { texto: `su representante tiene vínculo con ${aut === 1 ? "una autoridad" : `${aut} autoridades`}`, severidad: "media" };
  const p = pn?.persona_principal ?? {};
  const cand = (p.candidaturas ?? []).length;
  const aportes = (p.aportes_campañas ?? p.aportes_campanas ?? []).length;
  if (cand) return { texto: cand === 1 ? "su representante postuló a un cargo de elección" : `su representante postuló ${cand} veces a cargos de elección`, severidad: "baja" };
  if (aportes) return { texto: aportes === 1 ? "su representante aportó a una campaña política" : `su representante aportó ${aportes} veces a campañas políticas`, severidad: "baja" };
  const titular = (red.empresas_mismo_titular ?? []).length;
  if (titular) return { texto: `su representante figura en ${titular === 1 ? "otra empresa" : `${titular} empresas más`}`, severidad: "baja" };
  return null;
}

// ─── La competencia: quién ofertó y qué pasó con cada uno ───────────────────────────────────────────────────────

export type EstadoPostor = "Ganó" | "No admitido" | "Descalificado" | "Quedó fuera" | "Oferta válida" | "Se registró" | "Participó";

export interface FilaPostor {
  clave: string;
  nombre: string;
  ruc: string | null;
  consorcio: boolean;
  gano: boolean;
  estado: EstadoPostor;
  motivo: string | null;
  puntaje: number | null;
  oferta: number | null;
  adjudicado: number | null;
  sospechas: string[];
  direccion: string | null;
  apariciones: number | null;
  /** Otros procesos (OCID) en que coincide con postores de éste. */
  coOcurrencias: string[];
}

/** «ocds-dgv273-seacev3-1212799» y «1212799» son el mismo proceso. */
export const normOcid = (o: unknown) => String(o ?? "").trim().replace(/^ocds-[a-z0-9]+-seacev3-/i, "").replace(/^OECE-/i, "");

/** La llave de un postor entre fuentes: su RUC (o la ref que lo tapa) o su nombre sin forma societaria ni signos. */
function llave(ruc: unknown, nombre: unknown): string {
  const r = String(ruc ?? "").trim();
  if (/^\d{11}$/.test(r) || /ref·/.test(r)) return `r:${r}`;
  return `n:${String(nombre ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?R\.?\s?L\.?|SOCIEDAD ANONIMA CERRADA)\b/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()}`;
}

const RE_FUERA = /descalific|rechaz|no\s+admit|inadmit|no\s+cumpl|no\s+alcanz|puntaje\s+(t[eé]cnico\s+)?m[ií]nimo|excluid|desestim|no\s+coincid|inconsistenc|no\s+v[aá]lid/i;
const RE_NO_FUERA = /no\s+(fue|qued[oó]|resulta)\s+(descalific|rechaz|excluid)|sin\s+ser\s+descalific/i;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Une las tres fuentes de la competencia: el acta leída (quién OFERTÓ, si fue admitido y calificado, por qué quedó
 * fuera, cuánto ofertó), el registro OCDS (quién se registró y quién ganó, con el monto adjudicado) y el análisis de
 * patrones (coincidencias en otros procesos, domicilio). El ganador primero, después los que ofertaron y al final los
 * que sólo se registraron.
 */
export function filasCompetencia(result: any, ocidActual?: string | null): { filas: FilaPostor[]; conActa: boolean; valorReferencial: number | null } {
  const salida = result?.lecturas_documentos?.acta?.salida ?? null;
  const acta: any[] = salida && salida.es_buena_pro !== false && Array.isArray(salida.postores) ? salida.postores.filter((p: any) => p && typeof p === "object") : [];
  const ocds: any[] = Array.isArray(result?.postores) ? result.postores : [];
  const patrones: any[] = Array.isArray(result?.analisis_postores?.postores) ? result.analisis_postores.postores : [];
  const actual = ocidActual ? normOcid(ocidActual) : null;

  const filas = new Map<string, FilaPostor>();
  const nueva = (clave: string, nombre: string, ruc: string | null): FilaPostor => ({
    clave, nombre, ruc, consorcio: /^CONSORCIO\b/i.test(nombre), gano: false, estado: "Participó", motivo: null, puntaje: null,
    oferta: null, adjudicado: null, sospechas: [], direccion: null, apariciones: null, coOcurrencias: [],
  });

  for (const p of acta) {
    const nombre = String(p.nombre ?? "").trim();
    const ruc = p.ruc ? String(p.ruc).trim() : null;
    const k = llave(ruc, nombre);
    const f = filas.get(k) ?? nueva(k, nombre || "Sin razón social", ruc);
    f.consorcio = f.consorcio || !!p.es_consorcio;
    f.gano = !!p.ganador;
    f.puntaje = num(p.puntaje);
    f.oferta = num(p.monto_ofertado);
    f.motivo = p.motivo_fuera ? String(p.motivo_fuera).trim() : null;
    f.estado = p.admitida === false
      ? "No admitido"
      : p.calificada === false
        ? "Descalificado"
        : p.ganador
          ? "Ganó"
          : f.motivo && RE_FUERA.test(f.motivo) && !RE_NO_FUERA.test(f.motivo)
            ? "Quedó fuera"
            : "Oferta válida";
    filas.set(k, f);
  }

  for (const p of ocds) {
    const nombre = String(p?.nombre ?? "").trim();
    const ruc = p?.ruc ? String(p.ruc).trim() : null;
    const k = llave(ruc, nombre);
    // El acta pudo traer al postor sin RUC: se busca también por el nombre.
    const porNombre = filas.get(llave(null, nombre));
    const f = filas.get(k) ?? porNombre ?? nueva(k, nombre || "Sin razón social", ruc);
    if (!f.ruc && ruc) f.ruc = ruc;
    f.consorcio = f.consorcio || !!p?.es_consorcio;
    const adj = num(p?.monto_ganado);
    if (adj && adj > 0) f.adjudicado = adj;
    if (p?.es_ganador || (adj && adj > 0)) {
      f.gano = true;
      f.estado = "Ganó";
    } else if (!filas.has(f.clave)) {
      // Con el acta leída, quien no está en ella sólo se registró: el OCDS llama «postor» a todo participante.
      f.estado = acta.length ? "Se registró" : "Participó";
    }
    filas.set(f.clave, f);
  }

  for (const p of patrones) {
    const nombre = String(p?.razon_social ?? "").trim();
    const ruc = p?.ruc ? String(p.ruc).trim() : null;
    const k = llave(ruc, nombre);
    const f = filas.get(k) ?? filas.get(llave(null, nombre)) ?? nueva(k, nombre || "Sin razón social", ruc);
    if (!f.ruc && ruc) f.ruc = ruc;
    f.direccion = p?.direccion ? String(p.direccion) : f.direccion;
    f.apariciones = typeof p?.n_apariciones_base_vigia === "number" ? p.n_apariciones_base_vigia : f.apariciones;
    const otros = Array.isArray(p?.ocids_co_ocurrencia) ? p.ocids_co_ocurrencia.map(normOcid).filter((o: string) => o && o !== actual) : null;
    f.coOcurrencias = otros ? Array.from(new Set<string>(otros)) : [];
    // El backend cuenta como coincidencia el propio proceso que se está leyendo: se descuenta.
    f.sospechas = (Array.isArray(p?.sospechas) ? p.sospechas : []).flatMap((s: unknown) => {
      const t = String(s);
      if (actual && otros && t.startsWith("co_ocurrencia_en_base_vigia")) return f.coOcurrencias.length ? [`co_ocurrencia_en_base_vigia:${f.coOcurrencias.length}`] : [];
      return [t];
    });
    filas.set(f.clave, f);
  }

  const ORDEN: Record<EstadoPostor, number> = { "Ganó": 0, "Oferta válida": 1, "Quedó fuera": 2, "Descalificado": 3, "No admitido": 4, "Participó": 5, "Se registró": 6 };
  const lista = Array.from(filas.values()).sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || (b.puntaje ?? -1) - (a.puntaje ?? -1));
  return { filas: lista, conActa: acta.length > 0, valorReferencial: num(salida?.valor_referencial) };
}

/** Claves de patrón del backend → castellano. En pantalla son «patrones», nunca «sospechas»: no acusan a nadie. */
export function patronLegible(s: string): string {
  const [clave, n] = s.split(":");
  switch (clave) {
    case "direccion_compartida_con_otro_postor":
      return "Misma dirección que otro postor";
    case "sin_historial_contractual":
      return "Sin contratos previos con el Estado";
    case "solo_1_contrato_historico":
      return "Un solo contrato previo";
    case "co_ocurrencia_en_base_vigia":
      return `Coincide con otros postores en ${n ?? "varios"} ${n === "1" ? "proceso leído" : "procesos leídos"} por Vigía`;
    case "co_ocurrencia_otros_procesos":
      return `Coincide con otros postores en ${n ?? "varios"} ${n === "1" ? "proceso más" : "procesos más"}`;
    default: {
      const t = clave.replace(/_/g, " ").trim();
      return t.charAt(0).toUpperCase() + t.slice(1) + (n ? ` (${n})` : "");
    }
  }
}

// ─── Otros contratos ────────────────────────────────────────────────────────────────────────────────────────────

export interface FilaContrato {
  id: string;
  objeto: string | null;
  entidad: string | null;
  codigo: string | null;
  monto: number | null;
  fecha: string | null;
  conEsta: boolean;
  /** Integrante del consorcio que lo ganó (en un consorcio). */
  quien: string | null;
  url: string | null;
  fuente: "CONOSCE" | "web";
  evidencia?: unknown;
}

/**
 * Los otros contratos del proveedor: las buenas pro del CONOSCE que trae el expediente (lo oficial, con su código) y,
 * para lo que no esté ahí, lo que encontró el agente web. Sin el proceso que se está leyendo.
 */
export function filasOtrosContratos(result: any, ocidActual?: string | null, entidadRuc?: string | null): FilaContrato[] {
  const exp = result?.expediente_proveedor ?? null;
  const actual = ocidActual ? normOcid(ocidActual) : null;
  const vistos = new Set<string>();
  const out: FilaContrato[] = [];
  const fuentes: { h: any; quien: string | null }[] = exp?.consorcio && Array.isArray(exp.integrantes)
    ? exp.integrantes.map((e: any) => ({ h: e?.historial, quien: e?.nombre ?? null }))
    : [{ h: exp?.historial, quien: null }];
  for (const { h, quien } of fuentes) {
    for (const x of (h?.ultimos ?? []) as any[]) {
      const codigo = x?.codigo_convocatoria ? String(x.codigo_convocatoria) : null;
      if (!codigo || codigo === actual || vistos.has(codigo)) continue;
      vistos.add(codigo);
      out.push({
        id: `c-${codigo}`,
        objeto: x.descripcion || x.objeto || null,
        entidad: x.entidad ?? null,
        codigo,
        monto: num(x.monto),
        fecha: x.fecha_buena_pro ?? null,
        conEsta: !!entidadRuc && x.entidad_ruc === entidadRuc,
        quien,
        url: null,
        fuente: "CONOSCE",
      });
    }
  }
  ((result?.web_research?.otros_contratos_con_estado ?? []) as any[]).forEach((c, i) => {
    const codigo = c?.ocid_o_contrato ? normOcid(c.ocid_o_contrato) : null;
    if (codigo && (codigo === actual || vistos.has(codigo))) return;
    if (codigo) vistos.add(codigo);
    out.push({
      id: `w-${i}`,
      objeto: c?.objeto ?? null,
      entidad: c?.entidad ?? null,
      codigo,
      monto: num(c?.monto),
      fecha: c?.fecha ?? null,
      conEsta: false,
      quien: null,
      url: typeof c?.url === "string" && /^https?:\/\//i.test(c.url) ? c.url : null,
      fuente: "web",
      evidencia: c?.evidencia,
    });
  });
  return out.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
}
