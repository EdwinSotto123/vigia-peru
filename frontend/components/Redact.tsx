"use client";

// Redacción de datos personales para la demo / cumplimiento legal.
//
// Regla del proyecto (CLAUDE.md §8.2): no publicamos datos personales de
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

// Nombre completo: muestra todo MENOS el último apellido (último token), que va en vidrio.
// Funcionarios públicos electos/designados pueden mostrarse sin censura → usar `public`.
export function PersonName({
  name,
  isPublic = false,
}: {
  name?: string | null;
  isPublic?: boolean;
}) {
  const n = (name || "").trim();
  if (!n) return null;
  if (isPublic) return <>{n}</>;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return <>{n}</>;
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(" ");
  return (
    <>
      {head} <Glass label="Apellido — clic para revelar">{last}</Glass>
    </>
  );
}

// Redacta DNIs embebidos en TEXTO LIBRE (evidencia de banderas, dictamen) →
// devuelve nodos React con los DNIs en vidrio revelable. Si no hay DNI, retorna el texto tal cual.
export function redactDnis(text: any): React.ReactNode {
  if (typeof text !== "string" || !text) return text;
  DNI_RE.lastIndex = 0;
  if (!DNI_RE.test(text)) return text;
  DNI_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = DNI_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Glass key={`dni-${i++}`} label="DNI — clic para revelar">
        {m[0]}
      </Glass>,
    );
    last = m.index + m[0].length;
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
  return (text || "").replace(DNI_RE, "••••••••");
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
