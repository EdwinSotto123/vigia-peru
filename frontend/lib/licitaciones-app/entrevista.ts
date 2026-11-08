import type { TipoProceso } from "./filtros.ts";
import { MAX_PALABRAS, sugerirPalabras, type PerfilEmpresa } from "./onboarding.ts";

/**
 * El onboarding como entrevista (2026-11-07, el usuario: «que sea clickeable, tipo una entrevista con un chat»): seis
 * preguntas de a una, cada una con respuestas que se tocan (y el texto libre donde hace falta), y el perfil que se arma
 * a la vista. Aquí lo puro: las preguntas, los rubros con sus palabras (contadas en la bandeja en vivo el 11-07), cómo
 * se lee lo que escribiste y cómo se dice cada respuesta en la burbuja.
 */

export const PREGUNTAS = ["rubro", "palabras", "tipos", "lugar", "monto", "avisos"] as const;
export type Pregunta = (typeof PREGUNTAS)[number];

/** La primera pregunta sin responder después de `desde` (o antes, si todas las siguientes están); null: todas listas. */
export function siguientePendiente(respondidas: ReadonlySet<Pregunta>, desde: Pregunta | null = null): Pregunta | null {
  const i = desde ? PREGUNTAS.indexOf(desde) : -1;
  return PREGUNTAS.slice(i + 1).find((p) => !respondidas.has(p)) ?? PREGUNTAS.find((p) => !respondidas.has(p)) ?? null;
}

export interface Rubro {
  clave: string;
  nombre: string;
  descripcion: string;
  /** Las que más rinden en la bandeja (las primeras van elegidas). */
  palabras: string[];
  tipos: TipoProceso[];
}

/** Los rubros más comprados por el Estado, con palabras que sí aparecen en las convocatorias del SEACE. */
export const RUBROS: Rubro[] = [
  { clave: "oficina", nombre: "Útiles de oficina", descripcion: "Útiles de oficina y escritorio, papel bond, tóner y cartuchos para impresoras.", palabras: ["útiles", "papel bond", "tóner", "cartuchos"], tipos: ["bienes"] },
  { clave: "limpieza", nombre: "Limpieza", descripcion: "Servicio de limpieza, desinfección y fumigación de locales, y productos de limpieza.", palabras: ["limpieza", "desinfección", "fumigación"], tipos: ["servicios", "bienes"] },
  { clave: "computo", nombre: "Cómputo y software", descripcion: "Computadoras, impresoras, licencias de software y equipos de red.", palabras: ["computadoras", "software", "licencias", "impresoras"], tipos: ["bienes", "servicios"] },
  { clave: "salud", nombre: "Medicinas e insumos", descripcion: "Medicamentos, material médico, insumos y reactivos de laboratorio.", palabras: ["medicamentos", "material médico", "insumos médicos", "reactivos"], tipos: ["bienes"] },
  { clave: "alimentos", nombre: "Alimentos", descripcion: "Alimentos, víveres y raciones para comedores y programas sociales.", palabras: ["alimentos", "víveres", "raciones"], tipos: ["bienes", "servicios"] },
  { clave: "vigilancia", nombre: "Seguridad y vigilancia", descripcion: "Servicio de seguridad y vigilancia privada de locales.", palabras: ["vigilancia", "seguridad"], tipos: ["servicios"] },
  { clave: "mantenimiento", nombre: "Mantenimiento", descripcion: "Mantenimiento y reparación de locales, equipos e instalaciones.", palabras: ["mantenimiento", "reparación"], tipos: ["servicios"] },
  { clave: "vehiculos", nombre: "Vehículos y combustible", descripcion: "Combustible, vehículos, repuestos y mantenimiento de flota.", palabras: ["combustible", "vehículos", "repuestos"], tipos: ["bienes", "servicios"] },
  { clave: "obras", nombre: "Construcción y obras", descripcion: "Construcción, mejoramiento y rehabilitación de obras públicas.", palabras: ["construcción", "mejoramiento", "rehabilitación"], tipos: ["obras"] },
  { clave: "consultoria", nombre: "Consultoría y supervisión", descripcion: "Expedientes técnicos, estudios y supervisión de obras.", palabras: ["expediente técnico", "supervisión", "estudio"], tipos: ["consultoria"] },
  { clave: "textil", nombre: "Uniformes y vestuario", descripcion: "Uniformes, vestuario y calzado para personal.", palabras: ["uniformes", "vestuario", "calzado"], tipos: ["bienes"] },
  { clave: "transporte", nombre: "Transporte y alquileres", descripcion: "Transporte de carga y de personal, y alquiler de maquinaria y vehículos.", palabras: ["transporte", "alquiler"], tipos: ["servicios"] },
];

/** Cuántas palabras van elegidas de entrada (las demás quedan sugeridas, para tocarlas). */
export const PRIMERAS = 4;

const ARRANQUES =
  /^(?:(?:nosotros\s+)?(?:vendemos|ofrecemos|brindamos|proveemos|comercializamos|distribuimos|fabricamos|importamos|hacemos|damos|prestamos|realizamos)|(?:somos|soy)\s+(?:una\s+empresa|proveedores?|distribuidores?|fabricantes?)(?:\s+(?:de|que))?|nos\s+dedicamos\s+a(?:\s+la\s+venta\s+de)?|me\s+dedico\s+a|(?:la\s+)?venta\s+de)\s+/i;

/** Un nombre corto para la línea desde lo que escribiste: sin «Vendemos…», hasta el primer punto y 60 letras. */
export function nombreDesdeTexto(texto: string): string {
  let t = texto.trim().replace(/\s+/g, " ").replace(ARRANQUES, "");
  t = t.split(/[.;:\n]/)[0].trim();
  if (t.length > 60) t = t.slice(0, 60).replace(/\s+\S*$/, "");
  t = t.replace(/[,\s]+(?:y|e|o)?$/i, "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** El perfil desde un rubro: su nombre, su frase, sus primeras palabras elegidas y sus tipos. */
export function perfilDesdeRubro(p: PerfilEmpresa, r: Rubro): PerfilEmpresa {
  return { ...p, nombre: r.nombre, descripcion: r.descripcion, palabras: r.palabras.slice(0, PRIMERAS), tipos: [...r.tipos] };
}

/** El perfil desde lo que escribiste: la frase, un nombre corto y las primeras palabras con contenido. Los tipos no se tocan. */
export function perfilDesdeTexto(p: PerfilEmpresa, texto: string): PerfilEmpresa {
  const descripcion = texto.trim().replace(/\s+/g, " ").slice(0, 1000);
  return { ...p, nombre: nombreDesdeTexto(descripcion).slice(0, 80), descripcion, palabras: sugerirPalabras(descripcion, [], PRIMERAS) };
}

/** Las palabras para tocar en la segunda pregunta: las elegidas y, detrás, las del rubro o del texto que aún no están. */
export function candidatas(p: PerfilEmpresa, rubro: Rubro | null, max = 12): string[] {
  const extra = rubro ? rubro.palabras : sugerirPalabras(p.descripcion, p.palabras, 8);
  const r = [...p.palabras];
  for (const w of extra) if (!r.some((x) => x.toLowerCase() === w.toLowerCase())) r.push(w);
  return r.slice(0, Math.max(max, p.palabras.length));
}

/** Prende o apaga una palabra (respetando el tope). */
export function alternarPalabra(palabras: string[], w: string): string[] {
  if (palabras.includes(w)) return palabras.filter((x) => x !== w);
  return palabras.length >= MAX_PALABRAS ? palabras : [...palabras, w];
}

/** «a», «a y b», «a, b y c»; con más de `max`, «a, b, c y 4 más». */
export function listaNatural(xs: string[], max = 4): string {
  if (xs.length === 0) return "";
  if (xs.length > max) return `${xs.slice(0, max - 1).join(", ")} y ${xs.length - (max - 1)} más`;
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

export const NOMBRE_TIPO: Record<TipoProceso, string> = { bienes: "Bienes", servicios: "Servicios", obras: "Obras", consultoria: "Consultoría" };

export const RANGOS = [
  { clave: "todo", etiqueta: "Cualquier monto", min: null, max: null },
  { clave: "chico", etiqueta: "Hasta S/ 100 mil", min: null, max: 100_000 },
  { clave: "medio", etiqueta: "De S/ 100 mil a S/ 1 millón", min: 100_000, max: 1_000_000 },
  { clave: "grande", etiqueta: "Más de S/ 1 millón", min: 1_000_000, max: null },
] as const;

/** Lima y Callao (ubigeos 15 y 07): la respuesta rápida más común después de «Todo el Perú». */
export const LIMA_CALLAO = ["15", "07"];

/** Cómo se dice cada respuesta en la burbuja de quien responde. `region`: el nombre de un ubigeo. */
export function textoRespuesta(q: Pregunta, p: PerfilEmpresa, region: (u: string) => string, rubro: Rubro | null): string {
  switch (q) {
    case "rubro":
      return rubro ? rubro.nombre : p.descripcion;
    case "palabras":
      return listaNatural(p.palabras, 6);
    case "tipos":
      return p.tipos.length ? listaNatural(p.tipos.map((t, i) => (i === 0 ? NOMBRE_TIPO[t] : NOMBRE_TIPO[t].toLowerCase()))) : "Todos: bienes, servicios, obras y consultoría";
    case "lugar":
      if (!p.regiones.length) return "Todo el Perú";
      if (p.regiones.length === 2 && LIMA_CALLAO.every((u) => p.regiones.includes(u))) return "Lima y Callao";
      return listaNatural(p.regiones.map(region));
    case "monto": {
      const r = RANGOS.find((x) => x.min === p.min && x.max === p.max);
      return r ? r.etiqueta : "Un rango propio";
    }
    case "avisos":
      return !p.alerta ? "No, yo entro a mirar" : p.frecuencia === "diaria" ? "Sí, cada mañana" : "Sí, cada semana";
  }
}
