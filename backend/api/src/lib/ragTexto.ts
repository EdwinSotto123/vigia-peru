/**
 * RAG de documentos (migración 258, lib/rag.ts): la parte que no toca la base ni Workers AI, para probarla sin nada
 * alrededor (test/rag.test.ts).
 *
 *   · trocear(texto)      trozos de ~700-900 tokens (TROCEO: 3 000 caracteres de objetivo, 3 800 de tope; el español de
 *                         los documentos rinde ~3,6 caracteres por token en bge-m3, medido con Workers AI), por líneas y
 *                         secciones: un título («3.2. REQUISITOS DE CALIFICACIÓN», «CLÁUSULA DÉCIMA», «## …») abre trozo
 *                         nuevo y, si un corte parte un párrafo, el trozo siguiente arranca con las últimas líneas del
 *                         anterior (solape de ~450 caracteres). Lleva la página (marcas ⟦p.N⟧ de documentos_texto) y el
 *                         archivo de un ZIP (⟦archivo: …⟧, que siempre corta). Salta las líneas del modelo estándar de las
 *                         bases (rag_linea_comun: la huella de huellaLinea, la misma cuenta que la migración).
 *   · textoDeLectura      lo que Claude leyó de un documento (documento_lectura.salida, migración 245) como un bloque
 *                         que se puede leer y buscar.
 *   · validarBusqueda     los parámetros de GET /documentos/buscar, cerrados.
 *   · fusionarRrf         fusión por rango recíproco (k = 60) de lo que encuentran el texto y el significado.
 *   · quitarCasiIguales   las bases administrativas y las integradas de un proceso son casi el mismo texto: un trozo casi
 *                         igual a otro ya elegido no ocupa un lugar en los resultados.
 *   · recorte             los ~1 200 caracteres del trozo donde más aparecen las palabras buscadas (cortado en espacios:
 *                         nunca parte un número, que lib/privacidad.ts no reconocería como DNI).
 */
import { createHash } from "node:crypto";

/** Cambiarla vuelve a trocear todo (es parte de la huella de cada fuente en rag_origen). */
export const VERSION_TROCEO = "t2";
export const TROCEO = { objetivo: 3000, maximo: 3800, solape: 450, minimo: 600 };
/** Una línea normalizada de 40 caracteres o más que se repite en 20 procesos es del modelo estándar (migración 258). */
export const LARGO_LINEA_COMUN = 40;

// ─── Líneas ──────────────────────────────────────────────────────────────────

const SIN_TILDE: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n", Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ü: "u", Ñ: "n",
};

/** Igual que la migración 258: btrim(regexp_replace(translate(lower(l), 'áéíóúüñÁÉÍÓÚÜÑ', …), '[^a-z0-9]+', ' ', 'g')). */
export function normalizarLinea(l: string): string {
  return l.toLowerCase().replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (m) => SIN_TILDE[m]!).replace(/[^a-z0-9]+/g, " ").replace(/^ +| +$/g, "");
}

/** md5 de la línea normalizada (la `huella` de rag_linea_comun); null si es corta (los títulos se quedan siempre). */
export function huellaLinea(l: string): string | null {
  const n = normalizarLinea(l);
  return n.length >= LARGO_LINEA_COMUN ? createHash("md5").update(n).digest("hex") : null;
}

export const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// ─── Troceo ──────────────────────────────────────────────────────────────────

export interface Trozo {
  orden: number;
  pagina: number | null;
  archivo: string | null;
  texto: string;
}

export interface OpcionesTroceo {
  objetivo?: number;
  maximo?: number;
  solape?: number;
  minimo?: number;
  /** Huellas de rag_linea_comun: esas líneas no entran. */
  comunes?: ReadonlySet<string>;
}

interface Linea {
  texto: string;
  pagina: number | null;
  archivo: string | null;
  titulo: boolean;
  /** Empieza un párrafo (antes había una línea en blanco, un salto de archivo o una línea del modelo estándar). */
  parrafo: boolean;
  /** Viene del trozo anterior (solape): no cuenta como contenido nuevo. */
  arrastre?: boolean;
}

const MARCA = /^⟦(?:p\.(\d{1,5})|archivo:\s*(.*))⟧$/;

/**
 * El sello de la firma digital que el OCR deja como texto («Firmado digitalmente por: …», «Motivo: Soy el autor del
 * documento», «FAU 20… soft», «Fecha: 2025/09/12 18:01»): no dice nada de la contratación y trae el nombre de quien
 * firma, que en prosa lib/privacidad.ts no siempre reconoce. Sólo líneas cortas (un sello, no un párrafo que lo nombra).
 * En los textos de DEV, ~6 300 líneas.
 */
const SELLO_FIRMA = /firmado\s+digitalmente|\bfirma\s+digital\b|motivo\s*:\s*(soy\s+el\s+autor|doy\s+v|en\s+se[nñ]al|v[°º.]?\s*b)|\b(FAU|FIR)\s+\d{8,11}\s+(soft|hard)\b|^fecha\s*:\s*\d{4}[/.-]\d{1,2}[/.-]\d{1,2}\s+\d{1,2}:\d{2}/i;
export const esSelloFirma = (l: string) => l.length < 160 && SELLO_FIRMA.test(l);

/** Un título de sección: corto, y con numeración o una palabra de sección, o markdown. */
export function esTitulo(l: string): boolean {
  if (l.length > 110) return false;
  if (/^#{1,6}\s/.test(l)) return true;
  if (/^(CAP[IÍ]TULO|SECCI[OÓ]N|ANEXO|ART[IÍ]CULO|CL[AÁ]USULA|T[IÍ]TULO)\b/i.test(l)) return true;
  const letras = l.replace(/[^\p{L}]/gu, "");
  return letras.length >= 6 && letras === letras.toUpperCase()
    && /^(\d{1,2}(\.\d{1,2}){0,3}\.?|[A-Z][.)]|[IVX]{1,4}[.)])\s/.test(l);
}

/** Dónde cortar `s` sin pasar de `max`: en un espacio y, si no hay, nunca entre dos cifras (no partir un DNI). */
export function puntoDeCorte(s: string, max: number): number {
  const espacio = s.lastIndexOf(" ", max);
  if (espacio > max * 0.3) return espacio;
  let i = Math.min(max, s.length);
  while (i > max * 0.3 && /\d/.test(s[i - 1] ?? "") && /\d/.test(s[i] ?? "")) i--;
  return i > max * 0.3 ? i : max;
}

/** Una línea más larga que `max` (texto sin saltos): por oraciones y, si no alcanza, por espacios. */
export function partirLargo(l: string, max: number): string[] {
  if (l.length <= max) return [l];
  const out: string[] = [];
  let resto = l;
  while (resto.length > max) {
    const punto = resto.lastIndexOf(". ", max);
    const corte = punto >= max * 0.5 ? punto + 1 : puntoDeCorte(resto, max);
    out.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) out.push(resto);
  return out;
}

/** Las últimas líneas de `lineas` que caben en `max` caracteres (si la última sola no cabe, su final, en espacios). */
function cola(lineas: Linea[], max: number): Linea[] {
  const out: Linea[] = [];
  let largo = 0;
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i]!;
    if (largo + l.texto.length + 1 > max) {
      if (!out.length) {
        const desde = l.texto.indexOf(" ", l.texto.length - max);
        if (desde > 0) out.unshift({ ...l, texto: l.texto.slice(desde + 1), arrastre: true, titulo: false, parrafo: false });
      }
      break;
    }
    out.unshift({ ...l, arrastre: true });
    largo += l.texto.length + 1;
  }
  return out;
}

/**
 * Trozos de un texto. Las marcas de documentos_texto (⟦p.N⟧, ⟦archivo: …⟧) no quedan en el texto: dan la página y el
 * archivo de cada trozo (la página de su primera línea nueva, no la del solape).
 */
export function trocear(texto: string, opciones: OpcionesTroceo = {}): Trozo[] {
  const { objetivo, maximo, solape, minimo } = { ...TROCEO, ...opciones };
  const comunes = opciones.comunes?.size ? opciones.comunes : null;
  const lineas: Linea[] = [];
  let pagina: number | null = null;
  let archivo: string | null = null;
  let parrafo = true;
  let trasFirma = false;
  const crudo = (texto ?? "").replace(/\r/g, "").replace(/⟦[^⟧\n]{1,300}⟧/g, (m) => `\n${m}\n`);
  for (const bruta of crudo.split("\n")) {
    const marca = MARCA.exec(bruta.trim());
    if (marca) {
      if (marca[1]) pagina = Number(marca[1]);
      else {
        archivo = marca[2]!.trim() || null;
        parrafo = true;
      }
      continue;
    }
    const l = bruta.replace(/[ \t ​]+/g, " ").trim();
    if (!l) {
      parrafo = true;
      continue;
    }
    // El sello de la firma y, si terminaba en «por:», la línea siguiente (el nombre), si es corta y sin cifras.
    if (esSelloFirma(l) || (trasFirma && l.length <= 60 && !/\d/.test(l))) {
      trasFirma = esSelloFirma(l) && /\bpor\s*:?\s*$/i.test(l);
      parrafo = true;
      continue;
    }
    trasFirma = false;
    if (comunes) {
      const h = huellaLinea(l);
      if (h && comunes.has(h)) {
        parrafo = true;
        continue;
      }
    }
    for (const pedazo of partirLargo(l, maximo - solape)) {
      lineas.push({ texto: pedazo, pagina, archivo, titulo: esTitulo(pedazo), parrafo });
      parrafo = false;
    }
  }

  const trozos: Trozo[] = [];
  let actual: Linea[] = [];
  const largoDe = (ls: Linea[]) => ls.reduce((n, l) => n + l.texto.length + 1, 0);
  const nuevasDe = (ls: Linea[]) => ls.filter((l) => !l.arrastre);
  const emitir = (ls: Linea[]) => {
    const nuevas = nuevasDe(ls);
    if (!nuevas.length) return;
    trozos.push({ orden: trozos.length, pagina: nuevas[0]!.pagina, archivo: nuevas[0]!.archivo, texto: ls.map((l) => l.texto).join("\n") });
  };

  for (const l of lineas) {
    const nuevas = nuevasDe(actual);
    if (nuevas.length) {
      const largo = largoDe(actual);
      if (l.archivo !== nuevas[0]!.archivo) {
        // Otro archivo del ZIP: corte limpio, sin solape.
        emitir(actual);
        actual = [];
      } else if (l.titulo && largoDe(nuevas) >= objetivo * 0.5) {
        // Una sección nueva: empieza su propio trozo, sin arrastrar el final de la anterior.
        emitir(actual);
        actual = [];
      } else if (largo + l.texto.length + 1 > objetivo) {
        // Un corte natural (título o comienzo de párrafo) en el último tercio: lo de después pasa al trozo siguiente.
        let i = actual.length - 1;
        let acumulado = 0;
        let corte = -1;
        for (; i > 0 && acumulado < objetivo / 3; i--) {
          acumulado += actual[i]!.texto.length + 1;
          if (!actual[i]!.arrastre && (actual[i]!.titulo || actual[i]!.parrafo) && nuevasDe(actual.slice(0, i)).length) {
            corte = i;
            break;
          }
        }
        if (corte > 0) {
          emitir(actual.slice(0, corte));
          actual = actual.slice(corte);
          // Lo que pasó al trozo siguiente más esta línea no puede pasar el tope: entonces va solo.
          if (largoDe(actual) + l.texto.length + 1 > maximo) {
            emitir(actual);
            actual = cola(actual, solape);
          }
        } else {
          emitir(actual);
          actual = cola(actual, solape);
        }
      }
    }
    actual.push(l);
  }
  // El final: si es chico y cabe, se suma al trozo anterior (sin repetir el solape).
  const nuevasFinal = nuevasDe(actual);
  if (nuevasFinal.length) {
    const anterior = trozos[trozos.length - 1];
    const extra = nuevasFinal.map((l) => l.texto).join("\n");
    if (anterior && largoDe(nuevasFinal) < minimo && nuevasFinal[0]!.archivo === anterior.archivo
      && anterior.texto.length + extra.length + 1 <= maximo) {
      anterior.texto += `\n${extra}`;
    } else {
      emitir(actual);
    }
  }
  return trozos;
}

// ─── Lecturas de Claude (documento_lectura) ──────────────────────────────────

export const NOMBRE_LECTURA: Record<string, string> = {
  buena_pro: "acta de otorgamiento de la buena pro",
  bases: "bases del procedimiento",
  consultas: "pliego de absolución de consultas y observaciones",
  contrato: "contrato firmado",
};

const soles = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? `S/ ${n.toLocaleString("es-PE", { maximumFractionDigits: 2 })}` : null;
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const cita = (v: unknown) => (txt(v) ? ` Cita: «${txt(v)}».` : "");
const frase = (...partes: (string | null | false | undefined)[]) => partes.filter(Boolean).join(" ");
const humano = (s: string) => s.replace(/_/g, " ");

function postor(p: any): string {
  const nombre = txt(p?.nombre) ?? "Postor sin nombre";
  const ruc = txt(p?.ruc);
  const estado = p?.ganador ? "ganó la buena pro" : p?.admitida === false ? "su oferta no fue admitida"
    : p?.calificada === false ? "fue descalificado" : "oferta admitida";
  return `- ${nombre}${ruc ? ` (RUC ${ruc})` : ""}${p?.es_consorcio ? " (consorcio)" : ""}: ${estado}.`
    + (typeof p?.puntaje === "number" ? ` Puntaje: ${p.puntaje}.` : "")
    + (soles(p?.monto_ofertado) ? ` Oferta: ${soles(p.monto_ofertado)}.` : "")
    + (txt(p?.motivo_fuera) ? ` Motivo${txt(p?.motivo_tipo) ? ` (${humano(p.motivo_tipo)})` : ""}: ${txt(p.motivo_fuera)}` : "");
}

/** El bloque de texto de una lectura. Sin DNI (los lectores no los piden); los nombres los tapa la API al publicar. */
export function textoDeLectura(clase: string, salida: any, banderas: string[] = []): string {
  const s = salida && typeof salida === "object" ? salida : {};
  const cab = `Lectura de IA (Claude) del ${NOMBRE_LECTURA[clase] ?? humano(clase)}${txt(s.confianza) ? `, confianza ${s.confianza}` : ""}.`;
  const out: string[] = [cab];
  if (clase === "buena_pro") {
    out.push(frase(txt(s.procedimiento) && `Procedimiento: ${s.procedimiento}.`, txt(s.objeto) && `Objeto: ${s.objeto}.`,
      soles(s.valor_referencial) && `Valor referencial: ${soles(s.valor_referencial)}.`,
      typeof s.n_miembros_comite === "number" && `Miembros del comité: ${s.n_miembros_comite}.`));
    const ps = lista(s.postores);
    if (ps.length) out.push(`Postores (${ps.length}):`, ...ps.map(postor));
  } else if (clase === "bases") {
    out.push(frase(txt(s.objeto) && `Objeto: ${s.objeto}.`, soles(s.valor_referencial) && `Valor referencial: ${soles(s.valor_referencial)}.`,
      typeof s.plazo_dias === "number" && `Plazo de ejecución: ${s.plazo_dias} días.`));
    const e = s.experiencia_postor ?? {};
    const exp = frase(soles(e.monto_minimo) && `monto facturado mínimo ${soles(e.monto_minimo)}`,
      typeof e.anios === "number" && `en los últimos ${e.anios} años`, txt(e.especialidad) && `en ${e.especialidad}`);
    if (exp || txt(e.cita)) out.push(`Experiencia del postor en la especialidad: ${exp || "ver cita"}.${cita(e.cita)}`);
    const personal = lista(s.personal_clave).map((p) => `${txt(p?.cargo) ?? "cargo sin nombre"}${typeof p?.experiencia_anios === "number" ? ` (${p.experiencia_anios} años de experiencia)` : ""}`);
    if (personal.length) out.push(`Personal clave exigido: ${personal.join("; ")}.`);
    const equipo = lista(s.equipamiento).map(txt).filter(Boolean);
    if (equipo.length) out.push(`Equipamiento exigido: ${equipo.join("; ")}.`);
    const factores = lista(s.factores_evaluacion).map((f) => `${txt(f?.factor) ?? "factor"}${typeof f?.puntaje === "number" ? ` (${f.puntaje} puntos)` : ""}`);
    if (factores.length) out.push(`Factores de evaluación: ${factores.join("; ")}.`);
    const marcas = lista(s.marcas);
    if (marcas.length) {
      out.push("Marcas mencionadas en las bases:", ...marcas.map((m) =>
        `- ${txt(m?.marca) ?? "marca"}: ${m?.con_equivalente ? "con «o equivalente»" : "sin «o equivalente»"}.${cita(m?.cita)}`));
    }
  } else if (clase === "consultas") {
    out.push(frase(typeof s.n_consultas === "number" && `${s.n_consultas} consultas u observaciones`,
      typeof s.n_participantes === "number" && `de ${s.n_participantes} participantes`) + ".");
    const obs = lista(s.observaciones);
    if (obs.length) out.push("Consultas y observaciones:", ...obs.map((o) =>
      `- ${humano(txt(o?.tema) ?? "otro")}${txt(o?.respuesta) ? ` (${humano(o.respuesta)})` : ""}: ${txt(o?.resumen) ?? ""}`));
    const den = lista(s.denuncias);
    if (den.length) out.push("Denuncias de direccionamiento de los participantes:", ...den.map((d) => `- ${txt(d?.explicacion) ?? ""}${cita(d?.cita)}`));
  } else if (clase === "contrato") {
    const k = s.contratista ?? {};
    const garantia = s.garantia_fiel_cumplimiento ?? {};
    out.push(frase(txt(s.numero_contrato) && `Contrato N° ${s.numero_contrato}.`, txt(s.fecha_suscripcion) && `Suscrito el ${s.fecha_suscripcion}.`,
      txt(s.objeto) && `Objeto: ${s.objeto}.`,
      txt(k.nombre) && `Contratista: ${k.nombre}${txt(k.ruc) ? ` (RUC ${k.ruc})` : ""}${k.es_consorcio ? " (consorcio)" : ""}.`,
      typeof s.monto_contratado === "number" && `Monto contratado: ${txt(s.moneda) && s.moneda !== "PEN" ? `${s.moneda} ` : "S/ "}${s.monto_contratado.toLocaleString("es-PE", { maximumFractionDigits: 2 })}.`,
      typeof s.plazo_dias === "number" && `Plazo: ${s.plazo_dias} días${txt(s.fecha_inicio) ? ` desde el ${s.fecha_inicio}` : ""}${txt(s.fecha_fin) ? ` hasta el ${s.fecha_fin}` : ""}.`));
    out.push(frase(txt(s.forma_de_pago) && `Forma de pago: ${s.forma_de_pago}.`,
      (txt(garantia.tipo) || typeof garantia.porcentaje === "number") && `Garantía de fiel cumplimiento: ${frase(txt(garantia.tipo) && humano(garantia.tipo), typeof garantia.porcentaje === "number" && `${garantia.porcentaje} %`)}.`,
      typeof s.adelanto_directo_pct === "number" && `Adelanto directo: ${s.adelanto_directo_pct} %.`,
      typeof s.adelanto_materiales_pct === "number" && `Adelanto de materiales: ${s.adelanto_materiales_pct} %.`,
      typeof s.penalidad_mora_tope_pct === "number" && `Penalidad por mora: tope de ${s.penalidad_mora_tope_pct} %.`,
      typeof s.otras_penalidades === "boolean" && `Otras penalidades: ${s.otras_penalidades ? "sí" : "no"}.`,
      txt(s.solucion_controversias) && `Solución de controversias: ${s.solucion_controversias}.`,
      txt(s.cargo_firmante_entidad) && `Firma por la entidad: ${s.cargo_firmante_entidad}.`));
  } else {
    for (const [k, v] of Object.entries(s)) {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
      out.push(`${humano(k)}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  }
  const obs = clase === "consultas" ? [] : lista(s.observaciones);
  if (obs.length) out.push("Observaciones de la lectura:", ...obs.map((o) => `- ${txt(o?.tipo) ? `${humano(o.tipo)}: ` : ""}${txt(o?.explicacion) ?? ""}${cita(o?.cita)}`));
  if (banderas.length) out.push(`Banderas de Vigía: ${banderas.map(humano).join("; ")}.`);
  return out.filter((l) => l.trim() && l.trim() !== ".").join("\n");
}

/** Un informe de control de la Contraloría (informes_control): sólo título, modalidad, entidad y lugar; sin personas. */
export function textoDeInforme(i: Record<string, any>): string {
  const lugar = [i.distrito, i.provincia, i.departamento].map(txt).filter(Boolean).join(", ");
  const resp = lista(i.responsabilidades).map((r) => humano(String(r)));
  return [
    frase(`Informe de control${txt(i.numero) ? ` N° ${i.numero}` : ""} de la Contraloría General de la República`,
      txt(i.modalidad) && `(${String(i.modalidad).toLowerCase()})`, i.fecha_emision && `emitido el ${String(i.fecha_emision).slice(0, 10)}`) + ".",
    frase(txt(i.entidad_nombre) && `Entidad: ${i.entidad_nombre}.`, txt(i.sector) && `Sector: ${i.sector}.`,
      txt(i.nivel_gobierno) && `Nivel de gobierno: ${i.nivel_gobierno}.`, lugar && `Lugar: ${lugar}.`),
    `Materia: ${txt(i.titulo) ?? ""}`,
    resp.length ? `Responsabilidades señaladas: ${resp.join(", ")}${typeof i.funcionarios === "number" ? ` (${i.funcionarios} funcionarios comprendidos)` : ""}.` : "",
  ].filter((l) => l.trim()).join("\n");
}

/** documentos_gcs.tipo (OCDS) → el tipo del fragmento. */
export const TIPO_DOCUMENTO: Record<string, string> = {
  biddingDocuments: "bases",
  awardNotice: "buena_pro",
  contractSigned: "contrato",
  evaluationReports: "evaluacion",
  clarifications: "consultas",
  contractAnnexe: "contrato_anexo",
};
export const NOMBRE_TIPO: Record<string, string> = {
  bases: "Bases",
  buena_pro: "Otorgamiento de la buena pro",
  contrato: "Contrato",
  evaluacion: "Evaluación de ofertas",
  consultas: "Absolución de consultas y observaciones",
  contrato_anexo: "Anexo del contrato",
  otro: "Documento del proceso",
  dictamen: "Dictamen de Vigía",
  informe_control: "Informe de control",
};
export const TIPOS = Object.keys(NOMBRE_TIPO);
export const ORIGENES = ["documento", "lectura", "dictamen", "informe_control"] as const;

/** «Bases — Bases Integradas/BASES SIE 3.pdf — 1224840: ADQUISICIÓN DE CEMENTO …» (también va al modelo, como contexto). */
export function tituloFragmento(partes: { tipo: string; documento?: string | null; archivo?: string | null; ocid?: string | null; objeto?: string | null }): string {
  const doc = txt(partes.documento);
  const archivo = txt(partes.archivo);
  const cab = [NOMBRE_TIPO[partes.tipo] ?? "Documento", doc && doc !== NOMBRE_TIPO[partes.tipo] ? doc : null,
    archivo && archivo !== doc ? archivo : null].filter(Boolean).join(" — ");
  const objeto = txt(partes.objeto)?.replace(/\s+/g, " ");
  const proceso = partes.ocid ? ` — proceso ${partes.ocid}${objeto ? `: ${objeto.length > 160 ? `${objeto.slice(0, 159)}…` : objeto}` : ""}` : "";
  return `${cab}${proceso}`.slice(0, 400);
}

// ─── Búsqueda ────────────────────────────────────────────────────────────────

export class ErrorBusqueda extends Error {}

export interface Busqueda {
  q: string;
  ocids: string[];
  entidad: string | null;
  tipos: string[];
  origenes: string[];
  desde: number | null;
  hasta: number | null;
  limite: number;
}

export const LIMITE_DEFECTO = 8;
export const LIMITE_MAXIMO = 20;
const MAX_OCIDS = 20;

/** Los parámetros de GET /documentos/buscar (`get(k)` lee uno, `todos(k)` los repetidos), o ErrorBusqueda con el motivo. */
export function validarBusqueda(get: (k: string) => string | undefined, todos: (k: string) => string[] = (k) => [get(k) ?? ""],
  anioActual = new Date().getUTCFullYear()): Busqueda {
  const q = (get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length < 3) throw new ErrorBusqueda("Falta q: la pregunta o las palabras que buscas (3 caracteres o más).");
  if (q.length > 300) throw new ErrorBusqueda(`q: hasta 300 caracteres (mandaste ${q.length}).`);
  if ((q.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) throw new ErrorBusqueda("q: escribe palabras, no sólo signos.");

  const ocids = Array.from(new Set(todos("ocid").flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean)
    .map((x) => x.replace(/^OECE-/i, "").replace(/^ocds-dgv273-seacev3-/, ""))));
  if (ocids.length > MAX_OCIDS) throw new ErrorBusqueda(`ocid: hasta ${MAX_OCIDS} procesos (mandaste ${ocids.length}).`);
  if (ocids.some((x) => !/^[\w.-]{1,64}$/.test(x))) throw new ErrorBusqueda("ocid: algún código no es un OCID del SEACE.");

  const entidad = get("entidad")?.trim() || null;
  if (entidad && !/^20\d{9}$/.test(entidad)) {
    throw new ErrorBusqueda("entidad: el RUC de 11 dígitos de una entidad pública (empieza con 20).");
  }

  const listaDe = (k: string, validos: readonly string[]) => {
    const xs = Array.from(new Set((get(k) ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)));
    const malos = xs.filter((x) => !validos.includes(x));
    if (malos.length) throw new ErrorBusqueda(`${k}: «${malos[0]!.slice(0, 30)}» no existe. Valen: ${validos.join(", ")}.`);
    return xs;
  };
  const tipos = listaDe("tipo", TIPOS);
  const origenes = listaDe("origen", ORIGENES);

  const anio = (k: string) => {
    const v = get(k)?.trim();
    if (!v) return null;
    const n = Number(v.slice(0, 4));
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v) || n < 2000 || n > anioActual + 1) {
      throw new ErrorBusqueda(`${k}: un año de 4 cifras entre 2000 y ${anioActual + 1}.`);
    }
    return n;
  };
  const desde = anio("desde");
  const hasta = anio("hasta");
  if (desde && hasta && desde > hasta) throw new ErrorBusqueda("desde no puede ser mayor que hasta.");

  const lim = get("limite")?.trim();
  const limite = lim ? Number(lim) : LIMITE_DEFECTO;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) throw new ErrorBusqueda(`limite: de 1 a ${LIMITE_MAXIMO}.`);
  return { q, ocids, entidad, tipos, origenes, desde, hasta, limite };
}

export const K_RRF = 60;

export interface Candidato {
  id: string | number;
  posTexto: number | null;
  posSentido: number | null;
}

/**
 * Fusión por rango recíproco (Cormack et al., 2009): puntaje = Σ 1 / (k + posición) en cada lista donde aparece. Lo que
 * está arriba en las dos gana; lo que sólo una encontró entra igual. Empate: el que tiene la mejor posición.
 */
export function fusionarRrf<T extends Candidato>(candidatos: T[], k = K_RRF): (T & { puntaje: number })[] {
  const p = (pos: number | null) => (pos && pos > 0 ? 1 / (k + pos) : 0);
  return candidatos
    .map((c) => ({ ...c, puntaje: p(c.posTexto) + p(c.posSentido) }))
    .sort((a, b) => b.puntaje - a.puntaje
      || Math.min(a.posTexto ?? Infinity, a.posSentido ?? Infinity) - Math.min(b.posTexto ?? Infinity, b.posSentido ?? Infinity)
      || String(a.id).localeCompare(String(b.id)));
}

/** Tejas de 5 palabras normalizadas: para comparar dos trozos sin mirar mayúsculas, tildes ni signos. */
function tejas(texto: string): Set<string> {
  const p = normalizarLinea(texto).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= p.length; i++) out.add(p.slice(i, i + 5).join(" "));
  if (!out.size && p.length) out.add(p.join(" "));
  return out;
}

/**
 * Los elementos de `lista` (ya en orden) sin los casi iguales (Jaccard de tejas ≥ umbral) a uno anterior, hasta `max` y
 * con no más de `porFuente` trozos de una misma fuente (`fuente`: un documento, un dictamen): así una respuesta trae las
 * bases, el acta y el dictamen, no seis trozos seguidos del mismo texto.
 */
export function quitarCasiIguales<T extends { texto: string; fuente?: string }>(lista: T[], umbral = 0.7, max = Infinity, porFuente = Infinity): T[] {
  const elegidos: { t: T; s: Set<string> }[] = [];
  const deFuente = new Map<string, number>();
  for (const t of lista) {
    if (elegidos.length >= max) break;
    if (t.fuente && (deFuente.get(t.fuente) ?? 0) >= porFuente) continue;
    const s = tejas(t.texto);
    const repetido = elegidos.some((e) => {
      let comun = 0;
      const [chico, grande] = s.size < e.s.size ? [s, e.s] : [e.s, s];
      for (const x of chico) if (grande.has(x)) comun++;
      return comun / (s.size + e.s.size - comun || 1) >= umbral;
    });
    if (!repetido) {
      elegidos.push({ t, s });
      if (t.fuente) deFuente.set(t.fuente, (deFuente.get(t.fuente) ?? 0) + 1);
    }
  }
  return elegidos.map((e) => e.t);
}

const VACIAS = new Set(`que cual cuales como cuando donde quien quienes por para con sin sobre entre desde hasta del de la las el los
una uno unos unas este esta estos estas ese esa eso esos esas fue fueron ser son era eran hay habia han pidio pidieron dice
dijo segun sus su mas muy tambien porque cuanto cuanta cuantos todo toda todos todas otro otra otros otras proceso`.split(/\s+/));

/** Raíces de las palabras de la pregunta (5 letras, sin tildes) para elegir el pedazo del trozo que se muestra. */
export function terminos(q: string): string[] {
  return Array.from(new Set(normalizarLinea(q).split(" ").filter((w) => w.length >= 3 && !VACIAS.has(w)).map((w) => w.slice(0, 5))));
}

/**
 * Hasta `max` caracteres del trozo: la ventana de líneas donde más aparecen los términos (si ninguno aparece, el
 * comienzo). Corta en espacios, con «…» donde recorta.
 */
export function recorte(texto: string, raices: string[], max = 1200): string {
  if (texto.length <= max) return texto;
  const lineas = texto.split("\n");
  const pesos = lineas.map((l) => {
    const n = ` ${normalizarLinea(l)}`;
    return raices.reduce((s, r) => s + (n.includes(` ${r}`) ? 1 : 0), 0);
  });
  let mejor = 0;
  let mejorPeso = 0;
  const hay = pesos.some((x) => x > 0);
  for (let i = 0; i < lineas.length && hay; i++) {
    let largo = 0;
    let peso = 0;
    for (let j = i; j < lineas.length && largo + lineas[j]!.length + 1 <= max; j++) {
      largo += lineas[j]!.length + 1;
      peso += pesos[j]!;
    }
    if (peso > mejorPeso) {
      mejorPeso = peso;
      mejor = i;
    }
  }
  // La primera línea que coincide, con dos de contexto antes (la ventana elegida la dejaba al final).
  if (hay) {
    let k = mejor;
    while (k < lineas.length - 1 && pesos[k] === 0) k++;
    mejor = Math.max(mejor, k - 2);
  }
  let out = "";
  let j = mejor;
  for (; j < lineas.length && out.length + lineas[j]!.length + 1 <= max; j++) out += (out ? "\n" : "") + lineas[j];
  if (!out) {
    // Una sola línea más larga que max: su comienzo, cortado en un espacio.
    const l = lineas[mejor]!;
    out = l.slice(0, puntoDeCorte(l, max - 1));
    return `${mejor > 0 ? "…" : ""}${out}…`;
  }
  return `${mejor > 0 ? "…" : ""}${out}${j < lineas.length ? "…" : ""}`;
}
