"use client";

/**
 * El contenido de cada pestaña del dossier. Salió de ResultadoView, que rozaba las 800 líneas:
 * allá queda la estructura (identidad → veredicto → pestañas) y acá lo que se lee en cada una.
 *
 * Las siete se montan a la vez dentro de las `Pestanas` del kit (§14.3) y sólo se muestra una:
 * cambiar es instantáneo. Por eso ningún panel pide datos ni mide su tamaño al montarse (estaría
 * oculto); los ids (`#senales`) no se repiten entre paneles.
 *
 * Dentro del informe los avisos de "no hay nada acá" van con <AvisoSeccion>, sin la llamita:
 * el informe es evidencia (DESIGN_SYSTEM.md §6).
 */

import { Building2, FileText, Globe, Newspaper, Package, Pen, Receipt, Scale, Users } from "lucide-react";
import type { ApiResult, Bandera } from "../types";
import { montoDossier, type EstadoCorrida } from "../dossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { ItemsConMarketPrice } from "./ItemsConMarketPrice";
import { BanderasAgrupadas } from "./BanderasAgrupadas";
import { MarketVerdictCard } from "./MarketVerdictCard";
import { PostoresSection } from "./PostoresSection";
import { DocumentosSection } from "./DocumentosSection";
import { EmpresaAdjudicaCard } from "./EmpresaAdjudicaCard";
import { FuentesConsultadasSection } from "./FuentesConsultadasSection";
import { OtrosContratosSection } from "./OtrosContratosSection";
import { RedFlagsDocumentalesSection } from "./RedFlagsDocumentalesSection";
import { CronologiaSection } from "./CronologiaSection";
import { CumplimientoNormativoSection } from "./CumplimientoNormativoSection";
import { AportesPoliticosSection } from "./AportesPoliticosSection";
import { EstructuraEntidadSection } from "./EstructuraEntidadSection";
import { CausalDirectaSection } from "./CausalDirectaSection";
import { NoticiasSection } from "./NoticiasSection";
import { AnalisisPostoresSection } from "./AnalisisPostoresSection";
import { CollapsibleSection } from "./CollapsibleSection";
import { ObservabilidadPanel } from "./ObservabilidadPanel";
import { AgentTraceSection } from "./AgentTraceSection";
import { FirmantesYAdjudicacionSection } from "./FirmantesYAdjudicacionSection";
import { PersonNetworkSection } from "./PersonNetworkSection";
import { SeccionSegura } from "./SeccionSegura";
import { DictamenSection } from "./DictamenSection";
import type { NombreConocido } from "../../Redact";
import { evidenciaComoTexto } from "./Evidencia";

export type TabKey = "resumen" | "dictamen" | "items" | "proveedor" | "documentos" | "prensa" | "trace";

export interface PanelDossierProps {
  tab: TabKey;
  result: ApiResult;
  conv: any;
  dict: string;
  corrida: EstadoCorrida;
  banderasArr: Bandera[];
  noVerificables: Bandera[];
  nombresPrivados: NombreConocido[];
  nombresSunat: string[];
  ganador: any;
  ganadores: any[];
  ocidContrato: string | null;
  nItems: number;
  nDocs: number;
  nEvents: number;
}

export function PanelDossier(p: PanelDossierProps) {
  switch (p.tab) {
    case "resumen":
      return <PanelResumen {...p} />;
    case "dictamen":
      return <PanelDictamen {...p} />;
    case "items":
      return <PanelItems {...p} />;
    case "proveedor":
      return <PanelProveedor {...p} />;
    case "documentos":
      return <PanelDocumentos {...p} />;
    case "prensa":
      return <PanelPrensa {...p} />;
    case "trace":
      return <PanelComoSeHizo {...p} />;
    default:
      return null;
  }
}

// ─── Señales: TODAS las señales con su evidencia (el anticipo del dictamen va en el veredicto) ───

function PanelResumen({ result, banderasArr, noVerificables, corrida, nombresPrivados }: PanelDossierProps) {
  const compl = result.compliance || {};
  const causal = (result as any).causal_directa_invocada;
  return (
    <div className="space-y-4">
      <div id="senales" className="scroll-mt-24">
        {banderasArr.length > 0 || noVerificables.length > 0 ? (
          <SeccionSegura nombre="las señales">
            {/* `perfil` y `reglasDisparadas` destraban la matriz de reglas evaluadas; sin
                ellas el componente dice que no tiene catálogo, en vez de inventar uno. */}
            <BanderasAgrupadas
              banderas={banderasArr}
              reglas_evaluadas={compl.reglas_evaluadas ?? null}
              perfil={compl.perfil ?? null}
              reglasDisparadas={compl.reglas_disparadas ?? compl.reglasDisparadas ?? null}
              noVerificables={noVerificables}
              nombresPrivados={nombresPrivados}
            />
          </SeccionSegura>
        ) : corrida.completa ? (
          // El veredicto de arriba ya lo explica (con su ⓘ): aquí sólo el hecho.
          <AvisoSeccion titulo="El análisis terminó sin señales">Ninguna regla de contratación disparó una señal.</AvisoSeccion>
        ) : (
          <AvisoSeccion titulo="Análisis incompleto: sin señales registradas">
            {corrida.faltan.length > 0 && `Faltó ${corrida.faltan.join(" y ")}. `}
            Que no aparezcan señales no quiere decir que el contrato no las tenga.
          </AvisoSeccion>
        )}
      </div>

      {causal?.match && (
        <SeccionSegura nombre="la causal de contratación directa">
          <CausalDirectaSection causal={causal} acto={(result as any).acto_resolutivo_directa} />
        </SeccionSegura>
      )}
    </div>
  );
}

// ─── Dictamen ───

function PanelDictamen({ result, dict, corrida, nombresPrivados }: PanelDossierProps) {
  if (!dict.trim()) {
    return (
      <AvisoSeccion titulo="Este análisis no tiene dictamen escrito" icono={<Pen size={16} aria-hidden />}>
        {corrida.corrioDictamen ? "La redacción del dictamen corrió, pero no guardó un texto." : "La redacción del dictamen no llegó a correr en este análisis."}{" "}
        Las señales, los ítems y los documentos que sí se leyeron están en las otras pestañas.
      </AvisoSeccion>
    );
  }
  return <DictamenSection dictamen={dict} nombresPrivados={nombresPrivados} modelo={result.dictamen?.gen_meta?.model ?? null} />;
}

// ─── Ítems y mercado ───

function PanelItems({ result, corrida, nItems }: PanelDossierProps) {
  const items = result.items || [];
  const findings = result.market_analysis?.findings || [];
  const consolidados = result.document_analysis?.items_consolidados || [];
  const hayItems = items.length > 0 || findings.length > 0;
  const hayVeredicto = !!result.market_analysis?.veredicto_global;
  const hayPostores = (result.postores || []).length > 0;
  if (!hayItems && !hayVeredicto && !hayPostores) {
    return (
      <AvisoSeccion titulo="No hay ítems ni comparación de mercado para este contrato" icono={<Package size={16} aria-hidden />}>
        {result.market_analysis_raw && !result.market_analysis
          ? "La comparación de precios respondió, pero su resultado no se pudo leer, así que no se publica ninguna."
          : corrida.agentes.includes("market")
            ? "La comparación de precios corrió, pero no llegó a desglosar ítems comparables."
            : "La comparación de precios no llegó a correr en este análisis."}{" "}
        No se muestra una comparación que no se hizo.
      </AvisoSeccion>
    );
  }
  return (
    <div className="space-y-4">
      {hayItems && (
        <SeccionSegura nombre="los ítems">
          <section className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="border-b border-line bg-paperSoft px-5 py-3">
              <h2 className="font-display text-xl font-bold text-ink">Qué se está comprando</h2>
              <p className="mt-0.5 text-[12px] text-mute">
                {nItems} {nItems === 1 ? "ítem" : "ítems"}
                {findings.length > items.length && ", desglosados al leer el requerimiento técnico"}
              </p>
              {consolidados.length > items.length && (
                <p className="mt-1 text-[12px] text-mute">
                  El registro OCDS reporta {items.length} {items.length === 1 ? "ítem global" : "ítems globales"}; al leer el
                  requerimiento técnico se desglosaron en {consolidados.length} productos.
                </p>
              )}
            </div>
            <ItemsConMarketPrice items={items} allItems={consolidados} market={result.market_analysis} fmtMoney={montoDossier} />
          </section>
        </SeccionSegura>
      )}
      {hayVeredicto && (
        <SeccionSegura nombre="el veredicto de mercado">
          <MarketVerdictCard market={result.market_analysis} fmtMoney={montoDossier} />
        </SeccionSegura>
      )}
      {hayPostores && (
        <SeccionSegura nombre="los postores">
          <PostoresSection postores={result.postores || []} fmtMoney={montoDossier} />
        </SeccionSegura>
      )}
    </div>
  );
}

// ─── Proveedor y red ───

function PanelProveedor({ result, conv, ganador, ganadores }: PanelDossierProps) {
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

// ─── Documentos ───

function PanelDocumentos({ result, conv, banderasArr, nombresSunat, ocidContrato, nDocs }: PanelDossierProps) {
  const da = result.document_analysis || {};
  const hayFirmas = (da.firmantes || []).length > 0 || (da.motivos_adjudicacion || []).length > 0 || (da.comite_evaluacion || []).length > 0;
  return (
    <div className="space-y-4">
      {nDocs > 0 ? (
        <SeccionSegura nombre="la lista de documentos">
          <DocumentosSection
            documentos={result.documentos || []}
            parserDocs={da.documentos || []}
            fundamento={da.fundamento_legal || []}
            modalidad={da.modalidad}
            ocid={ocidContrato}
          />
        </SeccionSegura>
      ) : (
        <AvisoSeccion titulo="El registro OCDS no publica documentos para este proceso" icono={<FileText size={16} aria-hidden />}>
          Sin bases ni actas publicadas, no hubo expediente que leer.
        </AvisoSeccion>
      )}
      {hayFirmas && (
        <SeccionSegura nombre="los firmantes y motivos de adjudicación">
          <FirmantesYAdjudicacionSection
            firmantes={da.firmantes || []}
            comite={da.comite_evaluacion || []}
            motivos={da.motivos_adjudicacion || []}
            lugarFecha={da.lugar_fecha_acta}
            cruceFirmantes={result.person_network?.cruce_firmantes_ganador || []}
            nombresSunat={nombresSunat}
          />
        </SeccionSegura>
      )}
      {(da.red_flags_documentales || []).length > 0 && (
        <SeccionSegura nombre="las señales en los documentos">
          <RedFlagsDocumentalesSection flags={da.red_flags_documentales} />
        </SeccionSegura>
      )}
      <SeccionSegura nombre="la línea de tiempo">
        <CronologiaSection convocatoria={conv} banderas={banderasArr} />
      </SeccionSegura>
      {result.normative_compliance && (
        <SeccionSegura nombre="el cumplimiento normativo">
          <CumplimientoNormativoSection nc={result.normative_compliance} sobreprecioMedido={result.market_analysis?.sobreprecio_pct != null} />
        </SeccionSegura>
      )}
    </div>
  );
}

// ─── Prensa ───

function PanelPrensa({ result }: PanelDossierProps) {
  if (!result.news_research) {
    return (
      <AvisoSeccion titulo="La búsqueda de prensa no corrió en este análisis" icono={<Newspaper size={16} aria-hidden />}>
        {result.news_research_raw
          ? "La búsqueda de prensa respondió, pero su resultado no se pudo leer."
          : "No hay notas de prensa asociadas a este contrato en el análisis guardado."}
      </AvisoSeccion>
    );
  }
  return (
    <SeccionSegura nombre="la prensa">
      <NoticiasSection news={result.news_research} />
    </SeccionSegura>
  );
}

// ─── Cómo se hizo: aquí sí va el vocabulario técnico (agentes, trazas, evaluadores) ───

function PanelComoSeHizo({ result, nEvents }: PanelDossierProps) {
  const total = Number(result.timing?.total_s);
  return (
    <div className="space-y-5">
      <SeccionSegura nombre="la observabilidad">
        <ObservabilidadPanel liveEvents={result.agent_trace || []} metrics={result.llm_metrics} />
      </SeccionSegura>
      {nEvents > 0 ? (
        <SeccionSegura nombre="la traza de agentes">
          <AgentTraceSection trace={result.agent_trace!} />
        </SeccionSegura>
      ) : (
        <AvisoSeccion titulo="Este análisis no guardó su traza paso a paso">
          Fue procesado antes de que la traza se guardara con el dossier. Las señales y el dictamen sí quedaron.
        </AvisoSeccion>
      )}
      {total > 0 && <p className="text-[12px] text-mute">Duración de esta corrida: {Math.round(total)} segundos.</p>}
    </div>
  );
}
