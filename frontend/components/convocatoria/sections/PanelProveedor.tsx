"use client";

/**
 * Pestaña "Proveedor y red" del informe, cargada con `next/dynamic` al abrirla (PanelesDossier):
 * trae el grafo de relaciones y las secciones de investigación, que pesan y casi nadie abre primero.
 */

import { Building2, Globe, Receipt, Scale, Users } from "lucide-react";
import { setRedactNames } from "../../Redact";
import { montoDossier } from "../dossier";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { EmpresaAdjudicaCard } from "./EmpresaAdjudicaCard";
import { FuentesConsultadasSection } from "./FuentesConsultadasSection";
import { OtrosContratosSection } from "./OtrosContratosSection";
import { AportesPoliticosSection } from "./AportesPoliticosSection";
import { EstructuraEntidadSection } from "./EstructuraEntidadSection";
import { AnalisisPostoresSection } from "./AnalisisPostoresSection";
import { CollapsibleSection } from "./CollapsibleSection";
import { PersonNetworkSection } from "./PersonNetworkSection";
import { SeccionSegura } from "./SeccionSegura";
import { evidenciaComoTexto } from "./Evidencia";

export function PanelProveedor({ result, conv, ganador, ganadores, nombresPrivados }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const ctx = (result as any).person_network_context;
  const ep = (result as any).entity_personnel;
  const hayEstructura = (ctx?.autoridades_entidad?.n_autoridades_encontradas || 0) > 0 || (ep?.funcionarios_designados?.length || 0) > 0;
  const otros = result.web_research?.otros_contratos_con_estado || [];
  const fuentes = result.web_research?.hallazgos_por_fuente || [];
  return (
    <div className="space-y-4">
      {!result.web_research && !result.person_network && (
        <AvisoSeccion titulo="La investigación del proveedor no corrió en este análisis" icono={<Building2 size={16} aria-hidden />}>
          {result.web_research_raw || result.person_network_raw ? "Respondió, pero su resultado no se pudo leer. " : ""}
          Lo que aparece abajo sale de los registros públicos que sí se consultaron.
        </AvisoSeccion>
      )}
      {result.web_research?.empresa && (
        <SeccionSegura nombre="la ficha del proveedor">
          <EmpresaAdjudicaCard empresa={result.web_research.empresa} banderasSugeridas={result.web_research.banderas_sugeridas || []} />
        </SeccionSegura>
      )}
      {result.person_network && (
        <SeccionSegura nombre="la red de personas">
          <PersonNetworkSection person={result.person_network} web={result.web_research} proveedor={ganador} ctx={ctx} />
        </SeccionSegura>
      )}
      {hayEstructura && (
        <SeccionSegura nombre="la estructura de la entidad">
          <EstructuraEntidadSection autoridades={ctx?.autoridades_entidad} entityPersonnel={ep} entidad={(result as any).entidad ?? conv.entidad} />
        </SeccionSegura>
      )}
      <div className="columns-1 gap-3 md:columns-2 [&>*]:mb-3 [&>*]:break-inside-avoid">
        {result.analisis_postores?.postores?.length > 0 && (
          <SeccionSegura nombre="el análisis de competencia">
            <CollapsibleSection
              title="Análisis de competencia"
              subtitle={evidenciaComoTexto(result.analisis_postores.evidencia).replace(/\s+·\s+/g, ", ") || undefined}
              icon={<Users size={13} aria-hidden />}
              defaultOpen={!ganadores.length}
            >
              <AnalisisPostoresSection data={result.analisis_postores} ocidActual={result.ocid ?? conv.ocid} />
            </CollapsibleSection>
          </SeccionSegura>
        )}
        {otros.length > 0 && (
          <SeccionSegura nombre="los otros contratos">
            <CollapsibleSection
              title="Otros contratos con el Estado"
              subtitle={`${otros.length} ${otros.length === 1 ? "contrato público" : "contratos públicos"} del proveedor`}
              icon={<Receipt size={13} aria-hidden />}
            >
              <OtrosContratosSection otros={otros} relacion={result.web_research.relacion_proveedor_entidad} fmtMoney={montoDossier} />
            </CollapsibleSection>
          </SeccionSegura>
        )}
        <SeccionSegura nombre="las vinculaciones políticas">
          <CollapsibleSection title="Vinculaciones políticas" subtitle="Aportes de campaña (ONPE) y candidaturas (JNE)" icon={<Scale size={13} aria-hidden />}>
            <AportesPoliticosSection web={result.web_research} person={result.person_network} ctx={ctx} />
          </CollapsibleSection>
        </SeccionSegura>
        {fuentes.length > 0 && (
          <SeccionSegura nombre="las fuentes consultadas">
            <CollapsibleSection
              title="Fuentes consultadas"
              subtitle={`${fuentes.length} ${fuentes.length === 1 ? "portal público consultado" : "portales públicos consultados"}`}
              icon={<Globe size={13} aria-hidden />}
            >
              <FuentesConsultadasSection hallazgos={fuentes} />
            </CollapsibleSection>
          </SeccionSegura>
        )}
      </div>
    </div>
  );
}
