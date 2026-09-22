"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Glass, Dni, PersonName, redactDnis, redactChildren, maskDnis, maskApellido, setRedactNames } from "../Redact";
import {
  Search,
  Loader2,
  ArrowRight,
  Sparkles,
  ScanSearch,
  Network,
  Globe2,
  FileText,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Coins,
  Download,
  Cloud,
  ExternalLink,
  Users,
  Package,
  Award,
  ChevronRight,
  Scale,
  RotateCcw,
  MapPin,
  Calendar,
  ShieldAlert,
  Eye,
  Newspaper,
  ListChecks,
  Pen,
  Globe,
  Brain,
  Shuffle,
  Hammer,
  HardHat,
  Boxes,
  Compass,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentTraceEvent, ApiResult, SortKey, SevFilter, CatFilter, GNode, TraceStep, Bandera, GraphNode, GraphEdge } from "./types";
import { ItemsConMarketPrice } from "./sections/ItemsConMarketPrice";
import { BanderasAgrupadas } from "./sections/BanderasAgrupadas";
import { MarketVerdictCard } from "./sections/MarketVerdictCard";
import { PostoresSection } from "./sections/PostoresSection";
import { DocumentosSection } from "./sections/DocumentosSection";
import { EmpresaAdjudicaCard } from "./sections/EmpresaAdjudicaCard";
import { FuentesConsultadasSection } from "./sections/FuentesConsultadasSection";
import { OtrosContratosSection } from "./sections/OtrosContratosSection";
import { RedFlagsDocumentalesSection } from "./sections/RedFlagsDocumentalesSection";
import { CronologiaSection } from "./sections/CronologiaSection";
import { CumplimientoNormativoSection } from "./sections/CumplimientoNormativoSection";
import { AportesPoliticosSection } from "./sections/AportesPoliticosSection";
import { EstructuraEntidadSection } from "./sections/EstructuraEntidadSection";
import { CausalDirectaSection } from "./sections/CausalDirectaSection";
import { NoticiasSection } from "./sections/NoticiasSection";
import { AnalisisPostoresSection } from "./sections/AnalisisPostoresSection";
import { CollapsibleSection } from "./sections/CollapsibleSection";
import { ObservabilidadPanel } from "./sections/ObservabilidadPanel";
import { AgentTraceSection } from "./sections/AgentTraceSection";
import { FirmantesYAdjudicacionSection } from "./sections/FirmantesYAdjudicacionSection";
import { RelationshipGraph } from "./sections/RelationshipGraph";
import { NodeDetailPanel } from "./sections/NodeDetailPanel";
import { PersonNetworkSection } from "./sections/PersonNetworkSection";
import { ShareableHeader } from "./sections/ShareableHeader";
import { ResumenHumano } from "./sections/ResumenHumano";
import { NumberTicker } from "@/components/magicui/NumberTicker";

export function ResultadoView({ result, onReset }: { result: ApiResult; onReset: () => void }) {
  const conv = result.convocatoria || {};
  const compl = result.compliance || {};
  const dict = result.dictamen?.dictamen_markdown || "";
  const bridge = result._bridge_meta || {};
  const banderasAltas = (compl.banderas || []).filter((b: any) => b.severidad === "alta").length;
  const ganador = (result.postores || []).find((p: any) => p.es_ganador);
  const [activeTab, setActiveTab] = useState<
    "resumen" | "items" | "documentos" | "proveedor" | "prensa" | "trace" | "dictamen"
  >("resumen");

  // Contadores para badges en tabs
  const nBanderas = (compl.banderas || []).length;
  const nItems = Math.max(
    (result.items || []).length,
    (result.market_analysis?.findings || []).length,
    (result.document_analysis?.items_consolidados || []).length,
  );
  const nDocs = (result.documentos || []).length;
  const nNoticias = (result.news_research?.noticias || []).length;
  const nEvents = (result.agent_trace || []).length;
  const _traceArr = (result.agent_trace || []) as any[];
  const nToolCalls = _traceArr.filter((e) => e.kind === "tool_call").length;
  const nAgentes = new Set(_traceArr.map((e) => e.agent).filter(Boolean)).size;
  const _lm = (result.llm_metrics || {}) as any;

  // Badge "Proveedor + Red": empresas vinculadas + partidos + contratos
  const _pn = result.person_network || {};
  const _red = _pn.red_empresarial || {};
  const _persona = _pn.persona_principal || {};
  const nRed =
    (_red.empresas_mismo_titular || []).length +
    (_red.empresas_misma_direccion || []).length +
    (_persona.candidaturas || []).length +
    (_persona.aportes_campañas || _persona.aportes_campanas || []).length +
    ((result.web_research?.otros_contratos_con_estado) || []).length;

  // Diccionario de nombres de personas PRIVADAS conocidas (gerente, firmantes, comité,
  // socios, funcionarios designados, familia) → para censurar su apellido también en la
  // PROSA (síntesis, dictamen, evidencia), no solo en las tarjetas. Los funcionarios
  // ELECTOS (alcalde, regidores) NO se incluyen: son públicos y el sujeto del escrutinio.
  // setRedactNames puebla el diccionario que lee redactDnis; corre en el body del dossier
  // (antes que los hijos con la prosa rendericen).
  const _da_red = result.document_analysis || {};
  setRedactNames([
    _persona.nombre_completo,
    ...((_da_red.firmantes || []) as any[]).map((f) => f?.nombre_completo),
    ...((_da_red.comite_evaluacion || []) as any[]).map((m) => m?.nombre_completo || m?.nombre),
    ...((_pn.cruce_firmantes_ganador || []) as any[]).map((c) => c?.firmante),
    ...(((result as any).entity_personnel?.funcionarios_designados || []) as any[]).map((f) => f?.nombre_completo || f?.nombre),
    ...((_pn.pareja_o_familia || []) as any[]).map((f) => f?.nombre),
    ...((result.web_research?.empresa?.socios || []) as any[]).map((s) => s?.nombre),
    ...(((result as any).proveedor?.socios || []) as any[]).map((s) => s?.nombre),
    ...((_red.socios || []) as any[]).map((s) => s?.nombre),
  ]);

  // Badge dictamen: presencia (1 = ✓)
  const _dictamenText = result.dictamen?.dictamen_markdown || "";
  const nDictamen = _dictamenText.length > 100 ? 1 : 0;

  // Conteos por severidad para el banner crítico
  const banderasArr = (compl.banderas || []) as any[];
  const nAlta = banderasArr.filter(b => (b.severidad || "").toLowerCase() === "alta").length;
  const nMedia = banderasArr.filter(b => (b.severidad || "").toLowerCase() === "media").length;

  // Orden secuencial: VEREDICTO (resumen portada + dictamen) → EVIDENCIA → MÉTODO (auditoría al final).
  const TABS = [
    { key: "resumen",    label: "Resumen",         icon: <ShieldAlert size={13}/>, badge: nBanderas || null, badgeColor: "bg-rust" },
    { key: "dictamen",   label: "Dictamen",        icon: <Pen size={13}/>,         badge: nDictamen ? "✓" : null, badgeColor: "bg-moss" },
    { key: "items",      label: "Items + Mercado", icon: <Package size={13}/>,     badge: nItems || null,    badgeColor: "bg-heroViolet" },
    { key: "proveedor",  label: "Proveedor + Red", icon: <Building2 size={13}/>,   badge: nRed || null,      badgeColor: "bg-heroViolet" },
    { key: "documentos", label: "Documentos",      icon: <FileText size={13}/>,    badge: nDocs || null,     badgeColor: "bg-heroViolet" },
    { key: "prensa",     label: "Prensa",          icon: <Newspaper size={13}/>,   badge: nNoticias || null, badgeColor: "bg-heroViolet" },
    { key: "trace",      label: "Auditoría",       icon: <Sparkles size={13}/>,    badge: nEvents || null,   badgeColor: "bg-mute" },
  ] as Array<{ key: string; label: string; icon: any; badge: number | string | null; badgeColor: string }>;

  // Resumen ejecutivo extraído del dictamen → portada con CTA "leer dictamen completo".
  // Antes esto era un .slice(0, 400) pelado, que cortaba a mitad de palabra: el
  // resumen del artefacto principal del producto terminaba en "la entidad adjud".
  // Ahora se corta en el último final de oración que entre, y si no hay ninguno,
  // en el último espacio — nunca dentro de una palabra.
  const _resumenEjecutivo = (() => {
    const m = _dictamenText.match(/#{2,3}\s*Resumen ejecutivo\s*\n+([\s\S]*?)(?:\n#{2,3}\s|$)/i);
    const raw = (m ? m[1] : _dictamenText) || "";
    const limpio = raw.replace(/[#*`>\[\]]/g, "").replace(/\s+/g, " ").trim();
    if (limpio.length <= 400) return limpio;
    const corte = limpio.slice(0, 400);
    const finOracion = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
    if (finOracion > 200) return corte.slice(0, finOracion + 1);
    const finPalabra = corte.lastIndexOf(" ");
    return (finPalabra > 0 ? corte.slice(0, finPalabra) : corte) + "…";
  })();

  const fmtMoney = (n: number | string | undefined) => {
    const v = Number(n) || 0;
    if (v === 0) return "—";
    if (v >= 1e9) return `S/. ${(v / 1e9).toFixed(2)} B`;
    if (v >= 1e6) return `S/. ${(v / 1e6).toFixed(2)} M`;
    if (v >= 1e3) return `S/. ${(v / 1e3).toFixed(0)} K`;
    return `S/. ${v.toLocaleString("es-PE")}`;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
      {/* ─── MAIN COLUMN ─── */}
      <main className="space-y-3 min-w-0">
        {/* HEADER */}
        <ShareableHeader
          conv={conv}
          codigo={conv.codigo}
          nAlta={nAlta}
          totalSec={result.timing?.total_s}
          eventsADK={bridge.agent_events ?? 0}
          onReset={onReset}
        />

        {/* OVERVIEW EJECUTIVO */}
        <ResumenHumano
          conv={conv}
          ganador={ganador}
          nAlta={nAlta}
          nMedia={nMedia}
          nBaja={(compl.banderas || []).filter((b: any) => (b.severidad || "").toLowerCase() === "baja").length}
          banderasArr={banderasArr}
          fmtMoney={fmtMoney}
          onClickResumen={() => setActiveTab("resumen")}
        />

        {/* PORTADA: resumen ejecutivo del dictamen + CTA — solo en el tab Resumen */}
        {activeTab === "resumen" && _resumenEjecutivo && (
          <div className="surface p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-heroViolet">
              <Pen size={11} /> Resumen ejecutivo
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-inkSoft line-clamp-4">{_resumenEjecutivo}…</p>
            <button
              type="button"
              onClick={() => setActiveTab("dictamen")}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-heroViolet px-3 py-1.5 text-xs font-bold text-paper transition-colors hover:bg-heroViolet-deep"
            >
              Leer dictamen completo <ChevronRight size={13} />
            </button>
          </div>
        )}

        {/* BANNER INCONSISTENCIA — si docs sugieren adjudicación pero OCDS aún no */}
        {result.estado_real?.estado_inconsistente && (
          <div className="surface flex items-start gap-3 border-2 border-rust/40 p-4">
            <AlertTriangle size={20} className="shrink-0 animate-pulse text-rust" />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-sm font-bold text-rust">
                Inconsistencia detectada: documentos vs portal oficial
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-inkSoft">
                El OCDS publicado por OECE muestra estado{" "}
                <strong>{result.estado_real.estado_ocds}</strong>, pero el expediente
                ya tiene documentos de <strong>{result.estado_real.estado_documentos}</strong>{" "}
                ({result.estado_real.documentos_clave?.length || 0} documentos clave).
                Esto sugiere que el portal oficial está desactualizado o que la
                publicación oficial de la adjudicación está pendiente.
              </p>
              {(result.estado_real.documentos_clave || []).slice(0, 3).map((d: any, i: number) => (
                <div key={i} className="mt-1.5 flex items-start gap-2 text-[11px]">
                  <span className="rounded bg-rust/15 px-1.5 py-0 font-mono text-[10px] font-bold text-rust">
                    {d.tipo}
                  </span>
                  <span className="line-clamp-1 text-mute">{d.titulo}</span>
                  {d.fecha && <span className="font-mono text-[10px] text-mute">{d.fecha}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TABS NAVIGATION — sticky */}
        <nav className="sticky top-2 z-30 -mx-1 overflow-x-auto rounded-2xl border border-line bg-paper/95 px-1 py-1.5 shadow-sm backdrop-blur">
          <div className="flex gap-1">
            {TABS.map(t => {
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key as typeof activeTab)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-all",
                    isActive
                      ? "bg-heroViolet text-paper shadow-card scale-[1.02]"
                      : "bg-paperSoft text-mute hover:bg-paperDeep hover:text-ink",
                  )}
                >
                  {t.icon}
                  <span>{t.label}</span>
                  {t.badge && (
                    <span className={cn(
                      "ml-0.5 rounded-full px-1.5 py-0 text-[9px] font-bold leading-tight",
                      isActive ? "bg-paper/30 text-paper" : cn(t.badgeColor, "text-paper"),
                    )}>
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ─── TAB: RESUMEN ─── */}
        {activeTab === "resumen" && (compl.banderas || []).length > 0 && (
          // `perfil` y `reglasDisparadas` destraban la matriz de reglas
          // evaluadas ("se evaluaron 25, dispararon 5", incluidas las que NO
          // dispararon). Sin ellas el componente cae —correctamente— a decir
          // que no tiene catálogo, en vez de inventar uno.
          <BanderasAgrupadas
            banderas={compl.banderas}
            reglas_evaluadas={compl.reglas_evaluadas ?? 3}
            perfil={compl.perfil ?? null}
            reglasDisparadas={compl.reglas_disparadas ?? compl.reglasDisparadas ?? null}
          />
        )}

      {/* ─── TAB: ITEMS + MERCADO ─── */}
      {activeTab === "items" && ((result.items || []).length > 0 || (result.market_analysis?.findings || []).length > 0) && (
        <section className="surface overflow-hidden p-0">
          <div className="border-b border-line bg-paperDeep px-5 py-3">
            {/* El conteo estaba como kicker mayúscula ENCIMA del h2 — el
                patrón que la dirección prohíbe. Es un dato de contexto: va
                debajo del título, en la línea de estado de la sección. */}
            <h2 className="font-serif text-xl font-bold text-ink">
              Qué se está comprando
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-mute">
              <span className="inline-flex items-center gap-1.5">
                <Package size={11} aria-hidden />
                {Math.max(
                  (result.items || []).length,
                  (result.market_analysis?.findings || []).length,
                  (result.document_analysis?.items_consolidados || []).length,
                )}{" "}
                ítems convocados
              </span>
              {(result.market_analysis?.findings || []).length > (result.items || []).length && (
                <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-medium text-amberTexto">
                  desglosado por agentes
                </span>
              )}
            </div>
            {(result.document_analysis?.items_consolidados || []).length > (result.items || []).length && (
              <p className="mt-1 text-xs text-mute">
                El OCDS reporta {(result.items || []).length} ítem(s) globales pero los agentes
                desglosaron en {(result.document_analysis?.items_consolidados || []).length} productos
                físicos según el REQUERIMIENTO técnico.
              </p>
            )}
          </div>
          <ItemsConMarketPrice items={result.items || []} allItems={result.document_analysis?.items_consolidados || []} market={result.market_analysis} fmtMoney={fmtMoney} />
        </section>
      )}

      {/* VEREDICTO GLOBAL MARKET_PRICE */}
      {activeTab === "items" && result.market_analysis?.veredicto_global && (
        <MarketVerdictCard market={result.market_analysis} fmtMoney={fmtMoney} />
      )}

      {/* POSTORES + sus banderas individuales */}
      {activeTab === "items" && (result.postores || []).length > 0 && (
        <PostoresSection postores={result.postores || []} fmtMoney={fmtMoney} />
      )}

      {/* ─── TAB: DOCUMENTOS ─── */}
      {activeTab === "documentos" && (result.documentos || []).length > 0 && (
        <DocumentosSection
          documentos={result.documentos || []}
          parserDocs={result.document_analysis?.documentos || []}
          fundamento={result.document_analysis?.fundamento_legal || []}
          modalidad={result.document_analysis?.modalidad}
        />
      )}

      {/* ─── TAB: PROVEEDOR + RED ─── orden lógico: empresa, red, contratos, política, fuentes */}
      {activeTab === "proveedor" && result.web_research?.empresa && (
        <EmpresaAdjudicaCard
          empresa={result.web_research.empresa}
          banderasSugeridas={result.web_research.banderas_sugeridas || []}
        />
      )}

      {activeTab === "documentos" && ((result.document_analysis?.firmantes || []).length > 0 ||
        (result.document_analysis?.motivos_adjudicacion || []).length > 0 ||
        (result.document_analysis?.comite_evaluacion || []).length > 0) && (
        <FirmantesYAdjudicacionSection
          firmantes={result.document_analysis?.firmantes || []}
          comite={result.document_analysis?.comite_evaluacion || []}
          motivos={result.document_analysis?.motivos_adjudicacion || []}
          lugarFecha={result.document_analysis?.lugar_fecha_acta}
          cruceFirmantes={result.person_network?.cruce_firmantes_ganador || []}
        />
      )}

      {activeTab === "documentos" && (result.document_analysis?.red_flags_documentales || []).length > 0 && (
        <RedFlagsDocumentalesSection
          flags={result.document_analysis.red_flags_documentales}
        />
      )}

      {activeTab === "proveedor" && result.person_network && (
        <PersonNetworkSection
          person={result.person_network}
          web={result.web_research}
          proveedor={result.postores?.find((p: any) => p.es_ganador)}
          ctx={(result as any).person_network_context}
        />
      )}

      {/* ESTRUCTURA DE LA ENTIDAD CONTRATANTE — autoridades + funcionarios designados */}
      {activeTab === "proveedor" && (
        (((result as any).person_network_context?.autoridades_entidad?.n_autoridades_encontradas || 0) > 0 ||
         ((result as any).entity_personnel?.funcionarios_designados?.length || 0) > 0) && (
        <EstructuraEntidadSection
          autoridades={(result as any).person_network_context?.autoridades_entidad}
          entityPersonnel={(result as any).entity_personnel}
          entidad={(result as any).entidad}
        />)
      )}

      {/* CAUSAL DE CONTRATACIÓN DIRECTA — si aplica */}
      {activeTab === "resumen" && (result as any).causal_directa_invocada?.match && (
        <CausalDirectaSection
          causal={(result as any).causal_directa_invocada}
          acto={(result as any).acto_resolutivo_directa}
        />
      )}

      {/* Secciones secundarias del proveedor — masonry 2-col (competencia · contratos · política · fuentes) */}
      {activeTab === "proveedor" && (
        <div className="columns-1 gap-3 md:columns-2 [&>*]:mb-3 [&>*]:break-inside-avoid">
          {result.analisis_postores?.postores?.length > 0 && (
            <CollapsibleSection
              title="Análisis de competencia"
              subtitle={result.analisis_postores.evidencia}
              icon={<Users size={13} />}
              defaultOpen={!(result.postores || []).some((p: any) => p.es_ganador)}
            >
              <AnalisisPostoresSection data={result.analisis_postores} />
            </CollapsibleSection>
          )}
          {(result.web_research?.otros_contratos_con_estado || []).length > 0 && (
            <CollapsibleSection
              title="Otros contratos con el Estado"
              subtitle={`${(result.web_research?.otros_contratos_con_estado || []).length} contratos públicos del proveedor`}
              icon={<Receipt size={13} />}
            >
              <OtrosContratosSection
                otros={result.web_research.otros_contratos_con_estado || []}
                relacion={result.web_research.relacion_proveedor_entidad}
                fmtMoney={fmtMoney}
              />
            </CollapsibleSection>
          )}
          <CollapsibleSection
            title="Vinculaciones políticas"
            subtitle="Aportes ONPE · candidaturas JNE"
            icon={<ShieldAlert size={13} />}
          >
            <AportesPoliticosSection
              web={result.web_research}
              person={result.person_network}
              ctx={(result as any).person_network_context}
            />
          </CollapsibleSection>
          {(result.web_research?.hallazgos_por_fuente || []).length > 0 && (
            <CollapsibleSection
              title="Fuentes consultadas"
              subtitle={`${(result.web_research?.hallazgos_por_fuente || []).length} portales públicos verificados`}
              icon={<Globe size={13} />}
            >
              <FuentesConsultadasSection hallazgos={result.web_research.hallazgos_por_fuente} />
            </CollapsibleSection>
          )}
        </div>
      )}

      {activeTab === "documentos" && result.convocatoria && (
        <CronologiaSection convocatoria={result.convocatoria} />
      )}

      {activeTab === "documentos" && result.normative_compliance && (
        <CumplimientoNormativoSection nc={result.normative_compliance} />
      )}

      {/* ─── TAB: PRENSA ─── */}
      {activeTab === "prensa" && result.news_research && (
        <NoticiasSection news={result.news_research} />
      )}

      {/* FALLBACKS texto crudo (si parseo falló) */}
      {!result.market_analysis && result.market_analysis_raw && (
        <FallbackText title="market_price_agent (texto crudo)" text={result.market_analysis_raw} icon={<Receipt size={11}/>} />
      )}
      {!result.document_analysis && result.doc_parser_raw && (
        <FallbackText title="document_parser_agent (texto crudo)" text={result.doc_parser_raw} icon={<FileText size={11}/>} />
      )}
      {!result.web_research && result.web_research_raw && (
        <FallbackText title="web_research_agent (texto crudo)" text={result.web_research_raw} icon={<Globe2 size={11}/>} />
      )}
      {!result.news_research && result.news_research_raw && (
        <FallbackText title="news_research_agent (texto crudo)" text={result.news_research_raw} icon={<Eye size={11}/>} />
      )}
      {!result.person_network && result.person_network_raw && (
        <FallbackText title="person_network_agent (texto crudo)" text={result.person_network_raw} icon={<Network size={11}/>} />
      )}

      {/* ─── TAB: TRACE ADK + OBSERVABILIDAD ─── */}
      {activeTab === "trace" && (
        <div className="space-y-5">
          <ObservabilidadPanel liveEvents={result.agent_trace || []} metrics={result.llm_metrics} />
          {(result.agent_trace || []).length > 0 && <AgentTraceSection trace={result.agent_trace!} />}
        </div>
      )}

      {/* ─── TAB: DICTAMEN ─── */}
      {activeTab === "dictamen" && dict && (
        <section className="surface overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line bg-paperDeep px-5 py-3">
            <div>
              {/* El kicker "report_writer_agent · Gemini" estaba ENCIMA del h2.
                  Además de ser el patrón prohibido, ponía el nombre interno del
                  agente por delante del nombre del documento. La autoría del
                  modelo es una nota al pie de credibilidad, no un antetítulo:
                  va debajo, en tono secundario. */}
              <h2 className="font-serif text-xl font-bold text-ink">
                Dictamen periodístico
              </h2>
              <div className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-mute">
                <FileText size={11} aria-hidden />
                Redactado por report_writer_agent · {result.dictamen?.gen_meta?.model ?? "Gemini"}
              </div>
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(dict)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-paperDeep"
            >
              <Download size={11} /> Copiar
            </button>
          </div>
          <article
            className={cn(
              // MEDIDA DE LECTURA. Antes era `max-w-none`, así que el dictamen
              // —el artefacto que un periodista cita y una fiscalía lee, 4.400+
              // caracteres de prosa— se servía en líneas tan anchas como la
              // pantalla. A 1440 px eso son ~150 caracteres por línea: al saltar
              // de renglón el ojo pierde el punto de retorno y hay que releer.
              // 68ch es el rango en el que la prosa larga se lee sin esfuerzo.
              // Esta sección es deliberadamente una isla de modo Lectura dentro
              // de una app de modo Operación, y se trata como tal.
              "mx-auto max-w-[68ch] px-6 py-8",
              // Headings
              "prose prose-sm lg:prose-base",
              "prose-headings:font-serif prose-headings:text-ink prose-headings:font-bold prose-headings:tracking-tight",
              // Más aire ARRIBA de cada título que abajo: el espacio agrupa el
              // título con su propio texto en vez de dejarlo flotando al medio.
              "prose-h1:text-2xl prose-h1:mt-0 prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-heroViolet",
              "prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-3 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-line",
              // El h3 era uppercase con tracking: un micro-rótulo, no un título.
              // En un documento legal eso entorpece el escaneo y repite la
              // estética de antetítulo que el resto del rediseño está sacando.
              "prose-h3:text-base prose-h3:mt-7 prose-h3:mb-2 prose-h3:text-heroViolet prose-h3:font-bold",
              "prose-h4:text-sm prose-h4:mt-5 prose-h4:mb-1.5 prose-h4:font-bold prose-h4:text-ink",
              // Body — prosa larga necesita respirar entre párrafos
              "prose-p:text-ink prose-p:leading-[1.7] prose-p:my-3.5",
              "prose-strong:text-ink prose-strong:font-bold",
              "prose-em:text-inkSoft prose-em:italic",
              // Lists
              "prose-ul:my-3 prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1.5",
              "prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1.5",
              "prose-li:text-ink prose-li:leading-relaxed prose-li:marker:text-heroViolet",
              // Links: break-words, no break-all. break-all parte cualquier
              // palabra por la mitad, no sólo las URLs largas que se quería
              // domar.
              "prose-a:text-heroViolet prose-a:font-medium prose-a:underline prose-a:decoration-heroViolet/40 hover:prose-a:decoration-heroViolet",
              "prose-a:break-words",
              // Code & blockquote. El blockquote tenía border-l-4 de color, que
              // el craft floor rechaza: la cita se distingue por su fondo y su
              // sangría, y la regla queda en 1px.
              "prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-heroViolet prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
              "prose-blockquote:border-l prose-blockquote:border-heroViolet/50 prose-blockquote:bg-paperSoft prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:my-4 prose-blockquote:rounded-r prose-blockquote:text-inkSoft prose-blockquote:not-italic",
              // Tables
              "prose-table:text-xs prose-table:w-full prose-table:border-collapse",
              "prose-th:bg-paperDeep prose-th:text-ink prose-th:font-bold prose-th:uppercase prose-th:tracking-wider prose-th:text-[10px] prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-line",
              "prose-td:text-ink prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-line prose-td:align-top",
              // HR
              "prose-hr:my-6 prose-hr:border-line",
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Censura DNIs embebidos en la prosa del dictamen (vidrio revelable).
                p: ({ node, children, ...props }) => <p {...props}>{redactChildren(children)}</p>,
                li: ({ node, children, ...props }) => <li {...props}>{redactChildren(children)}</li>,
                strong: ({ node, children, ...props }) => <strong {...props}>{redactChildren(children)}</strong>,
                em: ({ node, children, ...props }) => <em {...props}>{redactChildren(children)}</em>,
                td: ({ node, children, ...props }) => <td {...props}>{redactChildren(children)}</td>,
                // La medida de 68ch es para la prosa, no para los datos. Una
                // tabla de ítems o de postores necesita ancho y comparabilidad
                // por columna: se le deja romper el margen de lectura y, si aun
                // así no entra, scrollea dentro de su propia caja — nunca
                // empujando la página entera hacia los costados.
                table: ({ node, children, ...props }) => (
                  <div className="scrollbar-warm -mx-2 my-4 overflow-x-auto sm:-mx-6 lg:-mx-10">
                    <div className="min-w-full px-2 sm:px-6 lg:px-10">
                      <table {...props}>{children}</table>
                    </div>
                  </div>
                ),
                a: ({ node, href, children, ...props }) => {
                  const isLongUrl = typeof href === "string" && href.length > 80;
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      {...props}
                      className={cn(
                        "text-heroViolet font-medium hover:text-heroViolet-deep transition-colors",
                        isLongUrl ? "inline-flex items-center gap-1 max-w-full" : "underline decoration-heroViolet/40 hover:decoration-heroViolet",
                      )}
                      title={typeof href === "string" ? href : undefined}
                    >
                      {isLongUrl ? (
                        <>
                          <span className="truncate max-w-[36ch] underline decoration-heroViolet/40">
                            {String(children)}
                          </span>
                          <ExternalLink size={10} className="shrink-0" />
                        </>
                      ) : (
                        children
                      )}
                    </a>
                  );
                },
              }}
            >
              {dict}
            </ReactMarkdown>
          </article>
        </section>
      )}

        {/* DIAGNÓSTICO TÉCNICO — solo en el tab Auditoría (antes aparecía al pie de CADA tab) */}
        {activeTab === "trace" && (
        <details className="surface p-4 text-xs">
          <summary className="cursor-pointer font-semibold text-ink">
            🔧 Diagnóstico técnico
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-mute">Timing (segundos)</div>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink">
                {Object.entries(result.timing || {}).map(([k, v]) => (
                  <li key={k}>{k}: <strong>{v}</strong></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-mute">Bridge Next → GCP</div>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink">
                {Object.entries(bridge).map(([k, v]) => (
                  <li key={k}>{k}: <strong>{String(v)}</strong></li>
                ))}
              </ul>
            </div>
          </div>
        </details>
        )}

        {/* DISCLAIMER FOOTER */}
        <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-mute">
          <ShieldAlert size={10} className="mr-1 inline text-amberTexto" />
          Vigía detecta señales cruzando datos públicos (OECE, SUNAT, OSCE, ONPE, prensa). No constituye acusación. La denuncia formal corresponde a Contraloría, Fiscalía o periodismo.
        </p>
      </main>

      {/* ─── SIDEBAR — score + hechos clave + acciones ─── */}
      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        {/* SCORE CARD — único contenido del sidebar que no está duplicado en otro lado */}
        <div className="surface flex items-center gap-3 p-4">
          <div className={cn(
            "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl text-paper",
            (compl.score ?? 0) >= 85 ? "bg-rust" :
            (compl.score ?? 0) >= 70 ? "bg-clay" :
            (compl.score ?? 0) >= 40 ? "bg-amber" : "bg-mute",
          )}>
            {/* Cifra protagonista de la tarjeta (score de riesgo del dossier): cuenta
                desde 0 al entrar en pantalla en vez de aparecer estática de golpe. */}
            <NumberTicker
              value={compl.score ?? 0}
              format="entero"
              className="font-serif text-2xl font-bold leading-none"
            />
            <span className="mt-0.5 text-[9px] uppercase tracking-widest opacity-80">/ 100</span>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-mute">Score de riesgo</div>
            <div className="mt-0.5 text-sm font-bold leading-tight text-ink">
              {(compl.score ?? 0) >= 85 ? "Crítico" :
               (compl.score ?? 0) >= 70 ? "Alto" :
               (compl.score ?? 0) >= 40 ? "Medio" :
                                          "Bajo"}
            </div>
            <div className="mt-0.5 text-[10px] text-mute">
              {(compl.score ?? 0) >= 85 ? "Atención inmediata" :
               (compl.score ?? 0) >= 70 ? "Patrones múltiples" :
               (compl.score ?? 0) >= 40 ? "Señales aisladas" :
                                          "Pocas señales"}
            </div>
          </div>
        </div>

        {/* DATOS DEL PROCESO — info única, layout numérico tipo dashboard */}
        <div className="surface p-3">
          {conv.tipo_proceso && (
            <div className="mb-2 border-b border-line pb-2">
              <div className="text-[10px] text-mute">Tipo de proceso</div>
              <div className="mt-0.5 text-[12px] font-semibold leading-tight text-ink">
                {conv.tipo_proceso}
              </div>
            </div>
          )}
          <dl className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className={cn(
                "font-mono text-base font-bold tabular-nums leading-none",
                (conv.n_postores ?? 0) === 1 ? "text-rust" : "text-ink",
              )}>
                <NumberTicker value={conv.n_postores ?? 0} format="entero" />
              </dd>
              <dt className="mt-0.5 text-[9px] text-mute">
                Postores
                {(conv.n_postores ?? 0) === 1 && <span className="ml-0.5 text-rust">⚠</span>}
              </dt>
            </div>
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">
                <NumberTicker value={conv.n_items ?? 0} format="entero" />
              </dd>
              <dt className="mt-0.5 text-[9px] text-mute">Ítems</dt>
            </div>
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">
                <NumberTicker value={conv.n_docs ?? 0} format="entero" />
              </dd>
              <dt className="mt-0.5 text-[9px] text-mute">Docs</dt>
            </div>
          </dl>
        </div>

        {/* AUDITORÍA TÉCNICA — resumen del pipeline (no solo un enlace vacío) */}
        {nEvents > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab("trace")}
            className="surface w-full p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-paperDeep hover:shadow-paper"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                <Sparkles size={12} className="text-heroViolet" /> Auditoría técnica
              </div>
              <ChevronRight size={14} className="shrink-0 text-mute" />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-md bg-paperDeep p-1.5">
                <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink"><NumberTicker value={nEvents} format="entero" /></dd>
                <dt className="mt-0.5 text-[9px] text-mute">pasos</dt>
              </div>
              <div className="rounded-md bg-paperDeep p-1.5">
                <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink"><NumberTicker value={nAgentes} format="entero" /></dd>
                <dt className="mt-0.5 text-[9px] text-mute">agentes</dt>
              </div>
              <div className="rounded-md bg-paperDeep p-1.5">
                <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink"><NumberTicker value={nToolCalls} format="entero" /></dd>
                <dt className="mt-0.5 text-[9px] text-mute">tools</dt>
              </div>
            </dl>
            {(_lm.tokens_total || _lm.cost_usd != null) && (
              <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-[10px] text-mute">
                <span className="font-mono">
                  {/* Mismo cálculo/unidad de antes (K tokens) — solo se anima el conteo.
                      cost_usd NO se anima: NumberTicker solo tiene formato "pen" (soles,
                      redondeado a entero) y este costo es en USD con 3 decimales
                      (típicamente <$1) — animarlo mostraría "S/ 0", un dato incorrecto. */}
                  {_lm.tokens_total ? (
                    <><NumberTicker value={Math.round(_lm.tokens_total / 1000)} format="entero" />K tokens</>
                  ) : "Gemini + grounding"}
                </span>
                {_lm.cost_usd != null && <span className="font-mono text-heroViolet">${Number(_lm.cost_usd).toFixed(3)}</span>}
              </div>
            )}
            <div className="mt-1.5 text-[10px] font-medium text-heroViolet">Ver los {nEvents} pasos del pipeline →</div>
          </button>
        )}
      </aside>
    </div>
  );
}

// ─── sub-components ───────────────────────────────────────────

// Surfacing de la capa de observabilidad (track Arize): trazabilidad en Phoenix,
// evaluadores LLM-as-judge y guardrails anti-alucinación. `compact` = tira para
// el proceso en curso; full = tarjeta para el resultado (tab Auditoría).
// Dashboard de Arize: muestra TODO lo que la capa de observabilidad hace —
// trazas a Phoenix Cloud, métricas (tokens/costo/llamadas) en vivo, los 4
// evaluadores LLM-as-judge y los guardrails anti-alucinación. Con `liveEvents`
// muestra las métricas en vivo; sin ellos (resultado), la versión cualitativa.

// Convierte URLs sueltas dentro de un texto en enlaces clicables.




// ─── Nuevos componentes para JSON estructurado ───────────────



// ─── BANDERAS agrupadas + filtros + clickeables ───────────────────────












function FallbackText({ title, text, icon }: { title: string; text: string; icon: React.ReactNode }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-amber-soft px-5 py-3">
        <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amberTexto">
          {icon} {title}
        </div>
        <p className="mt-1 text-xs text-mute">El JSON estructurado no pudo parsearse — mostramos el texto crudo del agente.</p>
      </div>
      <article className="prose prose-sm max-w-none px-6 py-4 prose-headings:font-serif prose-headings:text-ink prose-p:text-ink prose-strong:text-ink prose-a:text-heroViolet prose-li:text-ink prose-table:text-xs prose-th:bg-paperDeep prose-th:text-ink prose-td:text-ink">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          p: ({ node, children, ...props }) => <p {...props}>{redactChildren(children)}</p>,
          li: ({ node, children, ...props }) => <li {...props}>{redactChildren(children)}</li>,
          strong: ({ node, children, ...props }) => <strong {...props}>{redactChildren(children)}</strong>,
        }}>{text}</ReactMarkdown>
      </article>
    </section>
  );
}


// ════════════════════════════════════════════════════════════════════
// RelationshipGraph — grafo SVG persona → empresas → contratos
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// NodeDetailPanel — panel expandible al click en un nodo del grafo
// ════════════════════════════════════════════════════════════════════



