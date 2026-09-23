"use client";

/**
 * Texto libre (evidencia de una señal) con los datos personales en vidrio.
 *
 * `ContratoDetalle` es un server component y no puede llamar a `redactDnis`
 * (vive en un módulo "use client" y además lee un diccionario global que puebla
 * el dossier). Esta isla recibe como DATOS los nombres de las personas privadas
 * del contrato y tapa, en el texto: el apellido que corresponde a cada nombre,
 * todo RUC de persona natural (10…, lleva el DNI adentro) y todo DNI suelto.
 */

import { Glass, PersonName, type OrdenNombre } from "@/components/Redact";

export interface PersonaTexto {
  nombre: string;
  orden: OrdenNombre;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function TextoRedactado({ texto, personas = [] }: { texto: string | null | undefined; personas?: PersonaTexto[] }) {
  if (!texto) return null;
  const nombres = personas
    .filter((p) => p.nombre.trim().split(/\s+/).length >= 2)
    .sort((a, b) => b.nombre.length - a.nombre.length);
  const orden = new Map(nombres.map((p) => [p.nombre.toLowerCase(), p.orden]));
  const alt = nombres.map((p) => esc(p.nombre.trim()).replace(/\s+/g, "\\s+"));
  const re = new RegExp(`(${[...alt, "\\b10\\d{9}\\b", "\\b\\d{8}\\b"].join("|")})`, "gi");

  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of texto.matchAll(re)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(texto.slice(last, at));
    if (/^10\d{9}$/.test(tok)) {
      out.push(<Glass key={i++} label="RUC de persona natural (contiene su DNI), clic para revelar">{tok}</Glass>);
    } else if (/^\d{8}$/.test(tok)) {
      out.push(<Glass key={i++} label="DNI, clic para revelar">{tok}</Glass>);
    } else {
      const o = orden.get(tok.replace(/\s+/g, " ").toLowerCase()) ?? "sunat";
      out.push(<PersonName key={i++} name={tok} orden={o} />);
    }
    last = at + tok.length;
  }
  if (last < texto.length) out.push(texto.slice(last));
  return <>{out}</>;
}
