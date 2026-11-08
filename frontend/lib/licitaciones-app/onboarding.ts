import { FILTROS_POR_DEFECTO, aParams, normalizar, type TipoProceso } from "./filtros.ts";

/**
 * El perfil de la empresa que arma el onboarding (la entrevista de entrevista.ts): qué vende, dónde, qué contratos le
 * interesan y cómo avisarle. Aquí, lo puro: sugerir palabras clave desde lo que escribió y convertir el perfil en una
 * línea de negocio («Para ti»), una búsqueda de la bandeja y una alerta.
 */

export interface PerfilEmpresa {
  nombre: string;
  descripcion: string;
  palabras: string[];
  /** Vacío: todo el Perú. */
  regiones: string[];
  /** Vacío: todos los tipos. */
  tipos: TipoProceso[];
  min: number | null;
  max: number | null;
  alerta: boolean;
  frecuencia: "semanal" | "diaria";
}

export const PERFIL_VACIO: PerfilEmpresa = { nombre: "", descripcion: "", palabras: [], regiones: [], tipos: [], min: null, max: null, alerta: true, frecuencia: "semanal" };

export const MAX_PALABRAS = 10;

const VACIAS = new Set(
  "a al como con de del el en entre la las lo los mas más nuestra nuestras nuestro nuestros o otros para por que se sus su todo todos tipo un una y vendemos vender venta ventas empresa productos producto servicio servicios brindamos ofrecemos somos general generales diversos varios".split(" "),
);

/** Palabras clave posibles desde la descripción: las palabras con contenido, en su orden, sin repetir las que ya están. */
export function sugerirPalabras(descripcion: string, ya: string[], max = 8): string[] {
  const tiene = new Set(ya.map(normalizar));
  const vistas = new Set<string>();
  const r: string[] = [];
  for (const w of descripcion.toLowerCase().split(/[^a-záéíóúüñ0-9]+/i)) {
    const n = normalizar(w);
    if (w.length < 4 || VACIAS.has(n) || tiene.has(n) || vistas.has(n) || /^\d+$/.test(w)) continue;
    vistas.add(n);
    r.push(w);
    if (r.length >= max) break;
  }
  return r;
}

/** Suma palabras escritas a mano («tóner, papel bond»): limpias, de 2 a 40 letras, sin repetir y hasta el tope. */
export function agregarPalabras(actuales: string[], texto: string): string[] {
  const r = [...actuales];
  const tiene = new Set(actuales.map(normalizar));
  for (const t of texto.split(/[,;\n]/)) {
    const w = t.trim().replace(/\s+/g, " ");
    if (w.length < 2 || w.length > 40 || tiene.has(normalizar(w)) || r.length >= MAX_PALABRAS) continue;
    tiene.add(normalizar(w));
    r.push(w);
  }
  return r;
}

/** El perfil como búsqueda de la bandeja (lo que se guarda en «Mis búsquedas»): tipos, regiones y montos. */
export function aQueryBandeja(p: PerfilEmpresa): string {
  return aParams({ ...FILTROS_POR_DEFECTO, tipo: p.tipos, region: p.regiones, min: p.min, max: p.max, orden: "vence" }).toString();
}

/**
 * La alerta del perfil. Las alertas filtran como /oportunidades (una región y un tipo, el texto con todas sus palabras):
 * va la palabra principal y la región o el tipo sólo si es uno. Lo demás lo ordena «Para ti».
 */
export function aAlerta(p: PerfilEmpresa): { nombre: string; filtros: Record<string, string | number> } {
  const filtros: Record<string, string | number> = { q: p.palabras[0] ?? "", dias: 15 };
  if (p.regiones.length === 1) filtros.region = p.regiones[0];
  if (p.tipos.length === 1) filtros.tipo = p.tipos[0];
  if (p.min != null) filtros.min = p.min;
  if (p.max != null) filtros.max = p.max;
  return { nombre: `${p.nombre.trim()} (mi perfil)`.slice(0, 80), filtros };
}
