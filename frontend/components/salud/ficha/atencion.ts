/**
 * Lo que una persona quiere saber antes de atenderse, leído del detalle de RENIPRESS de la ficha: si declaró emergencia,
 * hospitalización, partos, centro quirúrgico, cuidados intensivos, laboratorio, imágenes, farmacia, rehabilitación,
 * diálisis y telesalud; y la lista de todo lo que declaró (especialidades, servicios, unidades y cartera), en oración,
 * para buscar en ella. Sin JSX (server-safe y usable en el navegador).
 *
 * Tres respuestas, nunca dos: «sí» (lo declaró y está activo), «no lo declaró» (leímos su detalle y no está) y «sin dato»
 * (todavía no leímos su detalle). Y «suspendida» cuando RENIPRESS la registra así.
 */
import type { FichaIpress, Servicio } from "@/lib/gobserva-salud";
import { normalizarTexto } from "@/lib/salud-necesidades";
import { detalleLeido, nombreServicio } from "./piezas";

export type Sabe = "si" | "no" | "suspendida" | "sin_dato";

export interface ServicioClave {
  clave: string;
  pregunta: string;
  /** Lo que se busca en las UPSS y actividades (normalizado). */
  patron: RegExp;
  /** También en la cartera de servicios (para los del primer nivel, que no tienen la UPSS). */
  enCartera?: RegExp;
}

/** Las preguntas de siempre, en el orden en que alguien las haría. */
export const SERVICIOS_CLAVE: ServicioClave[] = [
  { clave: "emergencia", pregunta: "Emergencia", patron: /\b(EMERGENCIA|URGENCIA)/, enCartera: /\bATENCION DE URGENCIAS|\bEMERGENCIA/ },
  { clave: "hospitalizacion", pregunta: "Hospitalización", patron: /\bHOSPITALIZACION\b|\bINTERNAMIENTO\b/ },
  { clave: "partos", pregunta: "Partos", patron: /\bCENTRO OBSTETRICO\b/, enCartera: /\bATENCION DE PARTO\b/ },
  { clave: "quirurgico", pregunta: "Centro quirúrgico", patron: /\bCENTRO QUIRURGICO\b/ },
  { clave: "uci", pregunta: "Cuidados intensivos", patron: /\bCUIDADOS INTENSIVOS\b/ },
  { clave: "laboratorio", pregunta: "Laboratorio", patron: /\bPATOLOGIA CLINICA\b|\bLABORATORIO\b|\bTOMA DE MUESTRAS\b/ },
  { clave: "imagenes", pregunta: "Rayos X y ecografía", patron: /\bDIAGNOSTICO POR IMAGENES\b|\bRADIOLOG|\bECOGRAF/ },
  { clave: "farmacia", pregunta: "Farmacia", patron: /\bFARMACIA\b/ },
  { clave: "rehabilitacion", pregunta: "Rehabilitación", patron: /\bREHABILITACION\b/ },
  { clave: "dialisis", pregunta: "Diálisis", patron: /\bDIALISIS\b|\bHEMODIALISIS\b/ },
  { clave: "telesalud", pregunta: "Teleconsulta", patron: /\bTELESALUD\b|\bTELEMEDICINA\b/, enCartera: /\bTELECONSULTA\b/ },
];

const activo = (e: string | null | undefined) => !e || /^ACTIV/i.test(e);

export interface RespuestaServicio {
  clave: string;
  pregunta: string;
  sabe: Sabe;
  /** El nombre con que lo declaró (en oración), si lo declaró. */
  como: string | null;
}

/** Cada servicio clave con su respuesta. El centro quirúrgico y el internamiento, también del indicador de la lista. */
export function serviciosClave(f: FichaIpress): RespuestaServicio[] {
  const leido = detalleLeido(f);
  return SERVICIOS_CLAVE.map((s) => {
    if (!leido) {
      // Sin el detalle, el tipo de RENIPRESS ya dice si tiene internamiento.
      if (s.clave === "hospitalizacion" && f.internamiento) return { clave: s.clave, pregunta: s.pregunta, sabe: "si", como: "Establecimiento con internamiento" };
      return { clave: s.clave, pregunta: s.pregunta, sabe: "sin_dato", como: null };
    }
    const d = f.detalle;
    const suspendida = d.upssSuspendidas.find((u) => s.patron.test(normalizarTexto(u.nombre ?? "")));
    const upss = d.upss.find((u) => s.patron.test(normalizarTexto(u.nombre ?? "")));
    if (upss && activo(upss.estado)) return { clave: s.clave, pregunta: s.pregunta, sabe: "si", como: nombreServicio(upss.nombre) };
    if (suspendida || upss) return { clave: s.clave, pregunta: s.pregunta, sabe: "suspendida", como: nombreServicio((suspendida ?? upss)!.nombre) };
    // El desglose (UPS): 10 102 establecimientos traen las UPSS vacías y todo en las UPS (el Hospital de Apoyo de Cusco decía
    // «Emergencia: no lo declaró» con 286 unidades declaradas; 2026-11-22).
    const ups = d.ups.find((u) => s.patron.test(normalizarTexto(u.nombre ?? "")) && activo(u.estado));
    if (ups) return { clave: s.clave, pregunta: s.pregunta, sabe: "si", como: nombreServicio((ups.nombre ?? "").split(/\s*-\s*/)[0]) };
    const cartera = s.enCartera ? d.cartera.find((c) => s.enCartera!.test(normalizarTexto(c.nombre ?? ""))) : undefined;
    if (cartera) return { clave: s.clave, pregunta: s.pregunta, sabe: "si", como: nombreServicio(cartera.nombre) };
    if (s.clave === "telesalud" && d.consultores.length) return { clave: s.clave, pregunta: s.pregunta, sabe: "si", como: "Telesalud con otros establecimientos" };
    return { clave: s.clave, pregunta: s.pregunta, sabe: "no", como: null };
  });
}

/** Una línea de lo que declaró, para buscar en ella: de qué lista viene, su nombre en oración y si está suspendida. */
export interface ItemDeclarado {
  tipo: "Especialidad" | "Servicio" | "Atención" | "Unidad";
  nombre: string;
  /** Normalizado, para comparar. */
  n: string;
  suspendida?: boolean;
}

/** Las unidades administrativas y de mantenimiento no responden a «¿me atienden aquí?». */
const ADMINISTRATIVA = /^(SERV\.?\s*ADM|SERV\.?\s*GRALES|SERVICIOS ADMINISTRATIVOS|SERVICIOS GENERALES|REGI\.?\s*MED|UPSS - DEL ESTABLECIMIENTO)/i;

/** Todo lo que declaró, sin repetidos (la especialidad primero: es lo que la gente busca). */
export function itemsDeclarados(f: FichaIpress): ItemDeclarado[] {
  if (!detalleLeido(f)) return [];
  const d = f.detalle;
  const vistos = new Set<string>();
  const out: ItemDeclarado[] = [];
  const poner = (lista: Servicio[], tipo: ItemDeclarado["tipo"], suspendida = false) => {
    for (const s of lista) {
      if (!s.nombre || ADMINISTRATIVA.test(s.nombre)) continue;
      const nombre = nombreServicio(s.nombre).replace(/^Actividad - /i, "");
      const n = normalizarTexto(nombre);
      if (!n || vistos.has(n)) continue;
      vistos.add(n);
      out.push({ tipo, nombre, n, suspendida: suspendida || !activo(s.estado) || undefined });
    }
  };
  poner(d.especialidades, "Especialidad");
  poner(d.upss, "Servicio");
  poner(d.upssSuspendidas, "Servicio", true);
  poner(d.cartera, "Atención");
  poner(d.ups, "Unidad");
  return out;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/** El personal que declaró a SUSALUD su último mes publicado, el que hay (más de cero), en orden de importancia para la gente. */
export function personalDeclarado(f: FichaIpress): { mes: string | null; filas: { clave: string; etiqueta: string; n: number }[]; camas: number | null; consultorios: number | null } | null {
  const r = f.recursos;
  if (!r) return null;
  const etiquetas: [string, string, string][] = [
    ["medicos", "médico", "médicos"],
    ["enfermeras", "enfermera o enfermero", "enfermeras y enfermeros"],
    ["obstetrices", "obstetra", "obstetras"],
    ["odontologos", "odontólogo", "odontólogos"],
    ["psicologos", "psicólogo", "psicólogos"],
    ["nutricionistas", "nutricionista", "nutricionistas"],
    ["tecnologos", "tecnólogo médico", "tecnólogos médicos"],
    ["farmaceuticos", "químico farmacéutico", "químicos farmacéuticos"],
  ];
  const filas = etiquetas
    .map(([clave, uno, varios]) => ({ clave, n: r[clave] ?? 0, etiqueta: (r[clave] ?? 0) === 1 ? uno : varios }))
    .filter((x) => x.n > 0);
  const anio = r.anio ?? null;
  const mes = r.mes ?? null;
  return {
    mes: anio && mes ? `${MESES[mes - 1] ?? mes} de ${anio}` : null,
    filas,
    camas: r.camas ?? null,
    consultorios: r.consultoriosFuncionales ?? r.consultorios ?? null,
  };
}
