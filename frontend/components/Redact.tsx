"use client";

// Redacción de datos personales para la demo / cumplimiento legal.
//
// Regla del proyecto (ver README, principios): no publicamos datos personales de
// ciudadanos. Acá los "censuramos" visualmente tipo VIDRIO ESMERILADO (blur) y
// se revelan al hacer clic. DNI siempre censurado; del nombre completo se censura
// SOLO el último apellido (el resto del nombre se muestra).
//
// NOTA: esto es una capa VISUAL (el dato igual viaja al navegador y se revela en
// el cliente). Para privacidad real en producción habría que redactar también en
// el backend antes de enviar el payload. Suficiente para demo + reducir exposición.

import React, { useState } from "react";

// DNI peruano = 8 dígitos. \b…\b evita matchear dentro de un RUC (11) u otros números largos.
const DNI_RE = /\b\d{8}\b/g;

export function Glass({
  children,
  label = "Dato personal — clic para revelar",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [shown, setShown] = useState(false);
  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setShown((s) => !s);
  };
  return (
    <span
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle(e);
        }
      }}
      role="button"
      tabIndex={0}
      title={shown ? "Clic para ocultar" : label}
      aria-label={shown ? undefined : "dato censurado — clic para revelar"}
      className={
        "cursor-pointer rounded px-0.5 align-baseline transition-[filter,background-color] duration-150 " +
        (shown
          ? "bg-amber/10 text-ink"
          : "select-none bg-ink/10 text-transparent hover:bg-ink/15")
      }
      style={
        shown
          ? undefined
          : { filter: "blur(4.5px)", WebkitFilter: "blur(4.5px)", textShadow: "0 0 6px rgba(40,36,32,0.6)" }
      }
    >
      {children}
    </span>
  );
}

// DNI (8 dígitos) — siempre censurado, revelable al clic.
export function Dni({ value }: { value?: string | number | null }) {
  const v = value == null ? "" : String(value).trim();
  if (!v) return null;
  return <Glass label="DNI — clic para revelar">{v}</Glass>;
}

/**
 * En qué orden viene un nombre, porque de eso depende qué palabra es el apellido
 * que se tapa:
 *  - "nombres-primero" (JOSÉ MANUEL SARA QUISPE): el apellido materno es la
 *    ÚLTIMA palabra.
 *  - "sunat" (CARPIO COBOS ABEL, el orden del RUC y del RNP): los apellidos van
 *    PRIMERO, y el materno es la SEGUNDA palabra. Tapar la última acá dejaba los
 *    dos apellidos a la vista y escondía el nombre de pila.
 */
export type OrdenNombre = "nombres-primero" | "sunat";

/** Índice de la palabra que se tapa, según el orden del nombre. */
function indiceApellido(partes: string[], orden: OrdenNombre): number {
  if (orden === "sunat") return partes.length >= 3 ? 1 : 0;
  return partes.length - 1;
}

// Nombre completo: muestra todo MENOS un apellido, que va en vidrio (ver `OrdenNombre`).
// Funcionarios públicos electos/designados pueden mostrarse sin censura → usar `public`.
export function PersonName({
  name,
  isPublic = false,
  orden = "nombres-primero",
}: {
  name?: string | null;
  isPublic?: boolean;
  orden?: OrdenNombre;
}) {
  const n = (name || "").trim();
  if (!n) return null;
  // Una empresa (un socio puede serlo) no tiene apellido que tapar.
  if (isPublic || pareceEmpresa(n)) return <>{n}</>;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return <>{n}</>;
  const k = indiceApellido(parts, orden);
  return (
    <>
      {parts.slice(0, k).join(" ")}
      {k > 0 ? " " : ""}
      <Glass label="Apellido, clic para revelar">{parts[k]}</Glass>
      {k < parts.length - 1 ? " " : ""}
      {parts.slice(k + 1).join(" ")}
    </>
  );
}

/**
 * Un RUC que empieza con 10 es de una persona natural con negocio, y sus dígitos
 * 3 a 10 son su DNI. Mostrarlo en claro es mostrar el DNI.
 */
export const esPersonaNatural = (ruc?: string | number | null) => !!ruc && /^10\d{9}$/.test(String(ruc).trim());

/** Un RUC: de empresa, tal cual; de persona natural, en vidrio (lleva el DNI adentro). */
export function Ruc({ value }: { value?: string | number | null }) {
  const v = value == null ? "" : String(value).trim();
  if (!v) return null;
  if (!esPersonaNatural(v)) return <>{v}</>;
  return <Glass label="RUC de persona natural (contiene su DNI), clic para revelar">{v}</Glass>;
}

// Diccionario de nombres de personas PRIVADAS conocidas (del análisis estructurado)
// para censurar su apellido también cuando aparecen en TEXTO LIBRE (síntesis, prosa,
// dictamen). Se puebla con setRedactNames() en el render del dossier. Confiable porque
// matchea nombres CONOCIDOS, no adivina con NER. Los funcionarios ELECTOS no se incluyen.
let _names: string[] = [];
/** Nombres (clave normalizada) que vienen en orden SUNAT: se les tapa la segunda palabra. */
let _sunat = new Set<string>();
const _esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Un RUC 10 (11 dígitos) lleva el DNI adentro y va entero en vidrio. El DNI
// suelto son 8 dígitos con límite de palabra: no matchea dentro de un RUC 20.
const _NUMEROS = "\\b10\\d{9}\\b|\\b\\d{8}\\b";
/**
 * El patrón de `redactDnis`, compilado una vez en `setRedactNames` y no en cada
 * texto. `u` para `\p{L}`; `i` sigue emparejando "Ó" con "ó" bajo `u`.
 */
let _re = new RegExp(`(${_NUMEROS})`, "giu");
/** Los nombres con los que se compiló `_re`: si no cambian, no se recompila. */
let _firma = "";

/** Clave de comparación: sin tildes, minúsculas, un solo espacio ("ALARCÓN  Vela" → "alarcon vela"). */
const _clave = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Patrón que encuentra el nombre con o sin tildes: el mismo nombre llega como
 * "ALARCÓN" en la prosa y "ALARCON" en el registro OCDS/RNP.
 */
const _patron = (nombre: string) =>
  _esc(_clave(nombre))
    .replace(/a/g, "[aáàä]").replace(/e/g, "[eéèë]").replace(/i/g, "[iíìï]")
    .replace(/o/g, "[oóòö]").replace(/u/g, "[uúùü]").replace(/n/g, "[nñ]")
    .replace(/ /g, "\\s+");

/**
 * El mismo nombre en el otro orden. Con 3+ palabras, los dos apellidos van al
 * final ("ISAÍAS FLORENCIO ALARCÓN VELA") o al principio, como en el RUC y el
 * RNP ("ALARCON VELA ISAIAS FLORENCIO"); la evidencia mezcla ambos y se escapaba.
 * Con 2 palabras es el nombre y el apellido, en un orden o en el otro ("JUAN
 * PEREZ" ↔ "PEREZ JUAN"); en orden SUNAT se tapa la palabra 0, que es el mismo
 * apellido (ver `indiceApellido`).
 */
function _otroOrden(nombre: string, orden: OrdenNombre): string | null {
  const p = nombre.split(/\s+/).filter(Boolean);
  if (p.length < 2) return null;
  if (p.length === 2) return `${p[1]} ${p[0]}`;
  return orden === "sunat"
    ? [...p.slice(2), p[0], p[1]].join(" ")
    : [p[p.length - 2], p[p.length - 1], ...p.slice(0, -2)].join(" ");
}

/**
 * Siglas y palabras que sólo lleva una organización. Se comparan contra la
 * clave sin tildes ni puntos, con las siglas deletreadas juntas: "S.A.C.",
 * "S. A. C." y "SAC" son la misma "sac".
 */
const MARCAS_EMPRESA = new Set([
  "sac", "saa", "sa", "sacs", "srl", "eirl", "ltda", "consorcio", "inversiones", "empresa", "corporacion",
  "asociacion", "sociedad", "compania", "cooperativa", "grupo", "contratistas", "constructora", "distribuidora",
  "servicios", "municipalidad",
]);

/**
 * ¿Es una empresa y no una persona? Por su forma societaria o una palabra que
 * sólo lleva una organización ("S.A.C.", "E.I.R.L.", "CONSORCIO"…), o por su
 * RUC: uno que empieza con 20 es de una persona jurídica. Las empresas no se
 * tapan: un socio puede ser otra empresa, y tapar su "S.A.C." no protege a nadie.
 */
export function pareceEmpresa(nombre?: string | null, ruc?: string | number | null): boolean {
  if (ruc != null && /^20\d{9}$/.test(String(ruc).trim())) return true;
  const palabras = _clave(String(nombre || "")).split(/[^a-z0-9]+/).filter(Boolean);
  const juntas: string[] = [];
  let sigla = "";
  for (const p of palabras) {
    if (p.length === 1) {
      sigla += p; // "s", "a", "c" → "sac"
      continue;
    }
    if (sigla) juntas.push(sigla);
    sigla = "";
    juntas.push(p);
  }
  if (sigla) juntas.push(sigla);
  return juntas.some((p) => MARCAS_EMPRESA.has(p));
}

export type NombreConocido =
  | string
  | null
  | undefined
  | { nombre: string | null | undefined; orden: OrdenNombre; ruc?: string | number | null };

/**
 * Registra los nombres de personas PRIVADAS que se van a tapar en el texto
 * libre. Un nombre en orden SUNAT (proveedor persona natural, postor del RNP)
 * se pasa como `{ nombre, orden: "sunat" }` para que se tape su apellido
 * materno y no su nombre de pila. Lo que parece una empresa (por su nombre o
 * por un `ruc` que empieza con 20) se salta: las empresas no se tapan.
 */
export function setRedactNames(names: NombreConocido[]) {
  const sunat = new Set<string>();
  const todos: string[] = [];
  for (const n of names || []) {
    const nombre = String((n && typeof n === "object" ? n.nombre : n) || "").normalize("NFC").trim();
    if (nombre.split(/\s+/).filter(Boolean).length < 2) continue;
    if (pareceEmpresa(nombre, n && typeof n === "object" ? n.ruc : null)) continue;
    const orden: OrdenNombre = n && typeof n === "object" ? n.orden : "nombres-primero";
    todos.push(nombre);
    if (orden === "sunat") sunat.add(_clave(nombre));
    // La variante en el otro orden va con SU orden, para tapar el mismo apellido.
    const otro = _otroOrden(nombre, orden);
    if (otro) {
      todos.push(otro);
      if (orden !== "sunat") sunat.add(_clave(otro));
    }
  }
  _sunat = sunat;
  const vistos = new Set<string>();
  _names = todos
    .filter((n) => !vistos.has(_clave(n)) && !!vistos.add(_clave(n)))
    .sort((a, b) => b.length - a.length); // más largo primero → evita match parcial
  // El dossier llama a esto en cada render: sólo se recompila si cambió la lista.
  const firma = _names.join("\n");
  if (firma === _firma) return;
  _firma = firma;
  // Límite de letra DESPUÉS del nombre con (?!\p{L}): "ANA PEÑA" no se tapa
  // dentro de "SUSANA PEÑAFIEL". El de ANTES se mira a mano en `redactDnis`:
  // un lookbehind (?<!\p{L}) no compila en Safari anterior a 16.4, que Next 14
  // todavía soporta, y tiraba abajo el dossier entero.
  const nombres = _names.length ? `(?:${_names.map(_patron).join("|")})(?!\\p{L})|` : "";
  _re = new RegExp(`(${nombres}${_NUMEROS})`, "giu");
}

const _esLetra = (c: string | undefined) => !!c && /\p{L}/u.test(c);

// Redacta DNIs, RUC de persona natural y NOMBRES conocidos embebidos en TEXTO
// LIBRE (evidencia, síntesis, dictamen) → nodos React en vidrio. Del nombre se
// tapa el apellido que corresponde a su orden (ver `OrdenNombre`), consistente con
// PersonName en las tarjetas. No-op si no hay nada que redactar.
export function redactDnis(text: any): React.ReactNode {
  if (typeof text !== "string" || !text) return text;
  // NFC: un acento descompuesto ("ALARCÓN") no calzaba con [oóòö].
  const t = text.normalize("NFC");
  const re = _re;
  re.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const tok = m[0];
    // Un nombre pegado a una letra por delante es parte de otra palabra.
    if (!/^\d/.test(tok) && _esLetra(t[m.index - 1])) {
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push(t.slice(last, m.index));
    if (/^10\d{9}$/.test(tok)) {
      out.push(
        <Glass key={`r${i++}`} label="RUC de persona natural (contiene su DNI), clic para revelar">
          {tok}
        </Glass>,
      );
    } else if (/^\d{8}$/.test(tok)) {
      out.push(<Glass key={`r${i++}`} label="DNI, clic para revelar">{tok}</Glass>);
    } else {
      out.push(
        <span key={`r${i++}`}>
          <PersonName name={tok} orden={_sunat.has(_clave(tok)) ? "sunat" : "nombres-primero"} />
        </span>,
      );
    }
    if (m.index === re.lastIndex) re.lastIndex++; // guard anti-loop
    last = m.index + tok.length;
  }
  if (!out.length) return text;
  if (last < t.length) out.push(t.slice(last));
  return <>{out}</>;
}

// Para usar en los `components` de react-markdown: redacta DNIs en los hijos string.
export function redactChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (c) => (typeof c === "string" ? redactDnis(c) : c));
}

// Para etiquetas dibujadas en CANVAS (grafo), donde no hay clic-para-revelar:
// enmascara los DNIs de un string (sin reveal).
// maskDnis vive en lib/privacidad.ts (sin "use client") para que los server components lo usen.
export { maskDnis } from "@/lib/privacidad";

// Enmascara el ÚLTIMO apellido de un nombre para etiquetas de CANVAS (grafo):
// "EDUARDO SOLANO SIU" -> "EDUARDO SOLANO •••". Sin reveal (el canvas no lo permite).
// Un solo token (p.ej. "Funcionario", "Socio") se deja igual.
export function maskApellido(name?: string | null): string {
  const n = (name || "").trim();
  if (!n) return n;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return n;
  const last = parts[parts.length - 1];
  return parts.slice(0, -1).join(" ") + " " + "•".repeat(Math.min(Math.max(last.length, 3), 8));
}
