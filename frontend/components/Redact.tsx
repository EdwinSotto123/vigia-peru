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
  if (isPublic) return <>{n}</>;
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
/** Nombres (en minúsculas) que vienen en orden SUNAT: se les tapa la segunda palabra. */
let _sunat = new Set<string>();
const _esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type NombreConocido = string | null | undefined | { nombre: string | null | undefined; orden: OrdenNombre };

/**
 * Registra los nombres de personas PRIVADAS que se van a tapar en el texto
 * libre. Un nombre en orden SUNAT (proveedor persona natural, postor del RNP)
 * se pasa como `{ nombre, orden: "sunat" }` para que se tape su apellido
 * materno y no su nombre de pila.
 */
export function setRedactNames(names: NombreConocido[]) {
  const sunat = new Set<string>();
  const todos = (names || []).map((n) => {
    if (n && typeof n === "object") {
      const nombre = String(n.nombre || "").trim();
      if (n.orden === "sunat" && nombre) sunat.add(nombre.toLowerCase());
      return nombre;
    }
    return String(n || "").trim();
  });
  _sunat = sunat;
  _names = Array.from(new Set(todos.filter((n) => n.split(/\s+/).filter(Boolean).length >= 2))).sort(
    (a, b) => b.length - a.length,
  ); // más largo primero → evita match parcial
}

// Redacta DNIs, RUC de persona natural y NOMBRES conocidos embebidos en TEXTO
// LIBRE (evidencia, síntesis, dictamen) → nodos React en vidrio. Del nombre se
// tapa el apellido que corresponde a su orden (ver `OrdenNombre`), consistente con
// PersonName en las tarjetas. No-op si no hay nada que redactar.
export function redactDnis(text: any): React.ReactNode {
  if (typeof text !== "string" || !text) return text;
  const namePart = _names.length ? _names.map(_esc).join("|") + "|" : "";
  // Un RUC 10 (11 dígitos) lleva el DNI adentro y va entero en vidrio. El DNI
  // suelto son 8 dígitos con límite de palabra: no matchea dentro de un RUC 20.
  const re = new RegExp("(" + namePart + "\\b10\\d{9}\\b|\\b\\d{8}\\b)", "gi");
  if (!re.test(text)) return text;
  re.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
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
          <PersonName name={tok} orden={_sunat.has(tok.toLowerCase()) ? "sunat" : "nombres-primero"} />
        </span>,
      );
    }
    if (m.index === re.lastIndex) re.lastIndex++; // guard anti-loop
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// Para usar en los `components` de react-markdown: redacta DNIs en los hijos string.
export function redactChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (c) => (typeof c === "string" ? redactDnis(c) : c));
}

// Para etiquetas dibujadas en CANVAS (grafo), donde no hay clic-para-revelar:
// enmascara los DNIs de un string (sin reveal).
export function maskDnis(text?: string | null): string {
  return (text || "").replace(/\b10\d{9}\b/g, "10•••••••••").replace(DNI_RE, "••••••••");
}

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
