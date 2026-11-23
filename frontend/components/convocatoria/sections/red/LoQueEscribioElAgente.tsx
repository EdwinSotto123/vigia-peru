"use client";

import type { ReactNode } from "react";
import { Globe, Network, UserRound } from "lucide-react";
import { redactDnis } from "../../../Redact";
import { FuentesConsultadasSection } from "../FuentesConsultadasSection";
import { SeccionSegura } from "../SeccionSegura";
import { SenalesRed } from "./SenalesRed";
import { fuentesSinFaltaSunat, sinFaltaSunat } from "./proveedor";

/** Un texto del agente con de qué trata (ícono y rótulo): nunca un párrafo suelto. */
function Texto({ icono, rotulo, children }: { icono: ReactNode; rotulo: string; children: ReactNode }) {
  return (
    <figure className="rounded-xl border border-line bg-paperSoft px-4 py-3 [.tarjeta_&]:border-0">
      <figcaption className="flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-mute">
        <span aria-hidden>{icono}</span>
        {rotulo}
      </figcaption>
      <p className="mt-1.5 max-w-prose text-dato leading-relaxed text-inkSoft text-pretty">{children}</p>
    </figure>
  );
}

/** Lo que escribió el agente: sus síntesis, lo que encontró en la web y las fuentes que consultó (sin la falsa «falta de SUNAT»). */
export function escritoDelAgente(web: any, person: any, sunatEnBase: boolean) {
  const p = person?.persona_principal ?? {};
  const red = person?.red_empresarial ?? {};
  const sugeridas = sinFaltaSunat((web?.banderas_sugeridas ?? []) as any[], sunatEnBase);
  const fuentes = fuentesSinFaltaSunat((web?.hallazgos_por_fuente ?? []) as any[], sunatEnBase);
  const textos = [
    web?.sintesis && { k: "web", icono: <Globe size={13} />, rotulo: "Sobre la empresa, en la web", texto: web.sintesis },
    person?.sintesis && { k: "red", icono: <Network size={13} />, rotulo: "Sobre su red de personas", texto: person.sintesis },
    p.sintesis_personal && { k: "persona", icono: <UserRound size={13} />, rotulo: "Sobre su representante", texto: p.sintesis_personal },
    red.observaciones && { k: "empresas", icono: <Network size={13} />, rotulo: "Sobre sus otras empresas", texto: red.observaciones },
  ].filter(Boolean) as { k: string; icono: ReactNode; rotulo: string; texto: string }[];
  return { textos, sugeridas, fuentes, total: textos.length + sugeridas.length + fuentes.length };
}

/**
 * Lo que escribió el agente sobre el proveedor: sus síntesis de la web y de la red, lo que encontró en la web que no está
 * en un registro y las fuentes que consultó. Es su lectura; los otros capítulos salen de los registros. Con el padrón SUNAT
 * en la base, la «falta de información SUNAT» no se muestra (era falsa: el agente no la encontraba en decolecta, pero
 * Vigía la tiene). Es el último capítulo de la pestaña (el título y la bajada los pone el capítulo).
 */
export function LoQueEscribioElAgente({ web, person, sunatEnBase }: { web: any; person: any; sunatEnBase: boolean }) {
  const { textos, sugeridas, fuentes, total } = escritoDelAgente(web, person, sunatEnBase);
  if (!total) return null;
  return (
    <div className="space-y-3">
      {textos.map((t) => (
        <Texto key={t.k} icono={t.icono} rotulo={t.rotulo}>
          {redactDnis(t.texto)}
        </Texto>
      ))}
      {sugeridas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-cuerpo font-semibold text-ink">Lo que encontró en la web</h3>
          <SenalesRed banderas={sugeridas} etiqueta="Lo que el agente encontró en la web sobre el proveedor" />
        </div>
      )}
      {fuentes.length > 0 && (
        <SeccionSegura nombre="las fuentes consultadas">
          <FuentesConsultadasSection hallazgos={fuentes} />
        </SeccionSegura>
      )}
    </div>
  );
}
