"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { FileWarning, Repeat2 } from "lucide-react";
import { Pestanas } from "@/components/patrones";
import { EVENTO_ACTIVA, irAPestana } from "@/components/patrones/Pestanas";
import { P_PATRON_EMPRESA, P_SUB_ANTECEDENTES } from "@/lib/patronesEntidad";

/**
 * La pestaña Antecedentes de una empresa en dos subpestañas (pedido del usuario del 2026-11-18): lo que dicen de ella los
 * registros (pesa sobre cada contrato que gana) y los patrones en que aparece (lo que se repite entre varios). Antes iban
 * en un mismo índice con dos rótulos; lo acordado es que nunca se mezclan.
 *
 * Abre en la que pide la URL: `apv`, o la de patrones si trae `apat` (o un enlace de antes, `atipo=patron-…`) y no un tipo
 * de antecedente. Las banderas de la cabecera llevan `?atipo=<tipo>`: si llega uno con la de patrones abierta, abre la de
 * antecedentes (el índice de adentro lo elige).
 */
export function SubpestanasAntecedentes({
  antecedentes,
  patrones,
  nAntecedentes,
  nPatrones,
  paramTipo,
}: {
  antecedentes: ReactNode;
  patrones: ReactNode;
  nAntecedentes: number;
  nPatrones: number;
  /** El parámetro del índice de antecedentes (`atipo`). */
  paramTipo: string;
}) {
  const sp = useSearchParams();
  const pedida = sp?.get(P_SUB_ANTECEDENTES);
  const tipo = sp?.get(paramTipo) ?? null;
  const conPatron = !!sp?.get(P_PATRON_EMPRESA) || !!tipo?.startsWith("patron-");
  const activa = pedida === "patrones" || pedida === "antecedentes" ? pedida : conPatron && !(tipo && !tipo.startsWith("patron-")) ? "patrones" : "antecedentes";

  // La subpestaña abierta (la barra avisa cada cambio), para no pedir la que ya está: `irAPestana` le da el foco.
  const abierta = useRef(activa);
  useEffect(() => {
    const al = (e: Event) => {
      const d = (e as CustomEvent<{ param: string; clave: string }>).detail;
      if (d?.param === P_SUB_ANTECEDENTES) abierta.current = d.clave;
    };
    window.addEventListener(EVENTO_ACTIVA, al);
    return () => window.removeEventListener(EVENTO_ACTIVA, al);
  }, []);
  const previo = useRef(tipo);
  useEffect(() => {
    if (tipo === previo.current) return;
    previo.current = tipo;
    if (tipo && !tipo.startsWith("patron-") && abierta.current !== "antecedentes") irAPestana("antecedentes", P_SUB_ANTECEDENTES);
  }, [tipo]);

  return (
    <Pestanas
      param={P_SUB_ANTECEDENTES}
      variante="segunda"
      etiqueta="Antecedentes o patrones"
      activa={activa}
      pestanas={[
        { clave: "antecedentes", etiqueta: "Antecedentes", conteo: nAntecedentes, icono: <FileWarning size={15} aria-hidden />, contenido: antecedentes },
        { clave: "patrones", etiqueta: "Patrones en que aparece", conteo: nPatrones, icono: <Repeat2 size={15} aria-hidden />, contenido: patrones },
      ]}
    />
  );
}
