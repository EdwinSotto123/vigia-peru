"use client";

import type { ReactNode } from "react";
import { Globe, Network, PenLine, UserRound } from "lucide-react";
import { plural } from "@/lib/formato";
import { redactDnis } from "../../../Redact";
import { FuentesConsultadasSection } from "../FuentesConsultadasSection";
import { SeccionSegura } from "../SeccionSegura";
import { Pliegue } from "./Pliegue";
import { SenalesRed } from "./SenalesRed";
import { fuentesSinFaltaSunat, sinFaltaSunat } from "./proveedor";

/** Un texto del agente con de qué trata (ícono y rótulo): nunca un párrafo suelto. */
function Texto({ icono, rotulo, children }: { icono: ReactNode; rotulo: string; children: ReactNode }) {
  return (
    <figure className="rounded-xl border border-line bg-paperSoft px-4 py-3">
      <figcaption className="flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-mute">
        <span aria-hidden>{icono}</span>
        {rotulo}
      </figcaption>
      <p className="mt-1.5 max-w-prose text-dato leading-relaxed text-inkSoft text-pretty">{children}</p>
    </figure>
  );
}

/**
 * Lo que escribió el agente sobre el proveedor, plegado al final de la pestaña: sus síntesis de la web y de la red, lo
 * que encontró en la web que no está en un registro y las fuentes que consultó. Va al final y cerrado porque es su
 * lectura; los capítulos de arriba salen de los registros. Con el padrón SUNAT en la base, la «falta de información
 * SUNAT» no se muestra (era falsa: el agente no la encontraba en decolecta, pero Vigía la tiene).
 */
export function LoQueEscribioElAgente({ web, person, sunatEnBase }: { web: any; person: any; sunatEnBase: boolean }) {
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

  if (!textos.length && !sugeridas.length && !fuentes.length) return null;
  const partes = [
    textos.length && plural(textos.length, "síntesis", "síntesis"),
    sugeridas.length && plural(sugeridas.length, "hallazgo en la web", "hallazgos en la web"),
    fuentes.length && plural(fuentes.length, "fuente consultada", "fuentes consultadas"),
  ].filter(Boolean) as string[];

  return (
    <Pliegue
      titulo="Lo que escribió el agente"
      icono={<PenLine size={16} />}
      detalle={`Su lectura, tal como la escribió (${partes.join(", ")}). Los capítulos de arriba salen de los registros públicos.`}
    >
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
    </Pliegue>
  );
}

