"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { esPersonaNatural, maskDnis, redactChildren, setRedactNames } from "../Redact";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Newspaper,
  Package,
  Pen,
  Receipt,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import type { ApiResult } from "./types";
import { estadoCorrida, nivelDelDossier, separarBanderas } from "./dossier";
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
import { PersonNetworkSection } from "./sections/PersonNetworkSection";
import { ShareableHeader } from "./sections/ShareableHeader";
import { ResumenHumano } from "./sections/ResumenHumano";
import { SeccionSegura } from "./sections/SeccionSegura";
import { evidenciaComoTexto } from "./sections/Evidencia";
import { NumberTicker } from "@/components/magicui/NumberTicker";

type TabKey = "resumen" | "dictamen" | "items" | "proveedor" | "documentos" | "prensa" | "trace";
const TAB_KEYS: TabKey[] = ["resumen", "dictamen", "items", "proveedor", "documentos", "prensa", "trace"];
const esTab = (v: string | null | undefined): v is TabKey => !!v && (TAB_KEYS as string[]).includes(v);

type NombreConocido = string | null | undefined | { nombre: string | null | undefined; orden: "sunat" | "nombres-primero" };

/** "CARPIO COBOS ABEL" (orden SUNAT) → "ABEL CARPIO COBOS": la misma persona como la escribe la prosa. */
function rotarSunat(n: string): string | null {
  const p = n.trim().split(/\s+/);
  if (p.length < 3) return null;
  return [...p.slice(2), p[0], p[1]].join(" ");
}

const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Versión en texto plano, para el portapapeles, de lo que la pantalla muestra en
 * vidrio: DNI y RUC de persona natural enmascarados, y el apellido que
 * corresponde de cada persona privada conocida reemplazado por "•••".
 */
function redactarTextoPlano(texto: string, nombres: NombreConocido[]): string {
  let out = maskDnis(texto);
  const lista = nombres
    .map((n) => (n && typeof n === "object" ? { nombre: String(n.nombre || "").trim(), orden: n.orden } : { nombre: String(n || "").trim(), orden: "nombres-primero" as const }))
    .filter((n) => n.nombre.split(/\s+/).length >= 2)
    .sort((a, b) => b.nombre.length - a.nombre.length);
  for (const { nombre, orden } of lista) {
    const partes = nombre.split(/\s+/);
    const k = orden === "sunat" ? (partes.length >= 3 ? 1 : 0) : partes.length - 1;
    const tapado = partes.map((p, i) => (i === k ? "•••" : p)).join(" ");
    out = out.replace(new RegExp(escRx(nombre), "gi"), tapado);
  }
  return out;
}

/** Aviso de sección vacía: dice por qué no hay nada, en vez de dejar la pestaña en blanco. */
function Vacio({ titulo, children, icon }: { titulo: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="surface flex items-start gap-3 p-5">
      <span className="mt-0.5 shrink-0 text-mute">{icon ?? <Info size={16} aria-hidden />}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{titulo}</p>
        {children && <div className="mt-1 text-[13px] leading-relaxed text-inkSoft">{children}</div>}
      </div>
    </div>
  );
}

export function ResultadoView({ result, onReset }: { result: ApiResult; onReset: () => void }) {
  const conv = result.convocatoria || {};
  const compl = result.compliance || {};
  const dict = result.dictamen?.dictamen_markdown || "";
  const ocidContrato: string | null = conv.ocid || conv.codigo || result.ocid || null;
  const entidadRuc: string | null = conv.buyer_ruc || (result as any).entidad_ruc || null;

  // ─── Pestaña activa, reflejada en la URL (?tab=) para poder compartirla ───
  const [activeTab, setActiveTab] = useState<TabKey>("resumen");
  useEffect(() => {
    const leer = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      setActiveTab(esTab(t) ? t : "resumen");
    };
    leer();
    window.addEventListener("popstate", leer);
    return () => window.removeEventListener("popstate", leer);
  }, []);
  const irATab = useCallback((t: TabKey) => {
    setActiveTab(t);
    try {
      const url = new URL(window.location.href);
      if (t === "resumen") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* sin URL no hay nada que sincronizar */
    }
  }, []);

  // "Ver evidencia": va a la pestaña Resumen y baja hasta las señales.
  // Un contador, no un booleano: si ya estás en Resumen, igual tiene que bajar.
  const [pedidoScroll, setPedidoScroll] = useState(0);
  const scrollPendiente = useRef(false);
  const verEvidencia = useCallback(() => {
    scrollPendiente.current = true;
    irATab("resumen");
    setPedidoScroll((n) => n + 1);
  }, [irATab]);
  useEffect(() => {
    if (!scrollPendiente.current || activeTab !== "resumen") return;
    scrollPendiente.current = false;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() =>
      document.getElementById("senales")?.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" }),
    );
  }, [activeTab, pedidoScroll]);

  // ─── Qué corrió, qué señales se sostienen, qué nivel tiene ───
  const corrida = useMemo(() => estadoCorrida(result), [result]);
  const { visibles: banderasArr, noVerificables } = useMemo(() => separarBanderas(result), [result]);
  const sev = (b: any) => String(b?.severidad || "").toLowerCase();
  const nAlta = banderasArr.filter((b) => sev(b) === "alta").length;
  const nMedia = banderasArr.filter((b) => sev(b) === "media").length;
  const nBaja = banderasArr.filter((b) => sev(b) === "baja").length;
  const nivel = nivelDelDossier(compl.score, banderasArr.length, corrida);

  const ganadores = ((result.postores || []) as any[]).filter((p) => p?.es_ganador);
  const ganador = [...ganadores].sort((a, b) => (Number(b?.monto_ganado) || 0) - (Number(a?.monto_ganado) || 0))[0];

  // Contadores para las pestañas
  const nItems = Math.max(
    (result.items || []).length,
    (result.market_analysis?.findings || []).length,
    (result.document_analysis?.items_consolidados || []).length,
  );
  const nDocs = (result.documentos || []).length;
  const nNoticias = (result.news_research?.noticias || []).length;
  const nEvents = (result.agent_trace || []).length;

  const _pn = result.person_network || {};
  const _red = _pn.red_empresarial || {};
  const _persona = _pn.persona_principal || {};
  const nRed =
    (_red.empresas_mismo_titular || []).length +
    (_red.empresas_misma_direccion || []).length +
    (_persona.candidaturas || []).length +
    (_persona.aportes_campañas || _persona.aportes_campanas || []).length +
    (result.web_research?.otros_contratos_con_estado || []).length;

  // Diccionario de personas PRIVADAS conocidas para censurar su apellido también en la
  // PROSA (síntesis, dictamen, evidencia). Los funcionarios ELECTOS no se incluyen: son
  // públicos. Un ganador o postor persona natural (RUC 10) viene en orden SUNAT
  // (APELLIDO APELLIDO NOMBRE): se registra así y además rotado, porque la prosa del
  // dictamen lo escribe con el nombre primero ("ABEL CARPIO COBOS").
  const nombresPrivados = useMemo<NombreConocido[]>(() => {
    const da = result.document_analysis || {};
    // Solo el registro OCDS (y el RNP/SUNAT, de donde sale el gerente) garantiza el orden
    // SUNAT. Las actas escriben a la misma persona con el nombre primero.
    const enOrdenSunat = ((result.postores || []) as any[])
      .filter((p) => typeof p?.nombre === "string" && esPersonaNatural(p?.ruc))
      .map((p) => String(p.nombre).trim());
    const gerente = result.web_research?.empresa?.gerente_general?.nombre;
    if (typeof gerente === "string" && gerente.trim()) enOrdenSunat.push(gerente.trim());
    const clave = (n: string) => n.toLowerCase().split(/\s+/).sort().join(" ");
    const conocidas = new Set(enOrdenSunat.map(clave));
    const sunat: NombreConocido[] = [];
    for (const n of enOrdenSunat) {
      sunat.push({ nombre: n, orden: "sunat" });
      const rotado = rotarSunat(n);
      if (rotado) sunat.push(rotado);
    }
    // Personas naturales que aparecen solo en los documentos: su orden no se conoce; si
    // son la misma persona del OCDS ya quedaron cubiertas por la versión rotada.
    const deDocumentos = [
      ...((da.postores_consolidados || da.postores_extraidos || []) as any[]).map((p) => ({ nombre: p?.razon_social || p?.nombre, ruc: p?.ruc })),
      ...((da.motivos_adjudicacion || []) as any[]).map((m) => ({ nombre: m?.ganador_razon_social, ruc: m?.ganador_ruc })),
    ]
      .filter((p) => typeof p.nombre === "string" && esPersonaNatural(p.ruc) && !conocidas.has(clave(p.nombre)))
      .map((p) => String(p.nombre));
    return [
      ...sunat,
      ...deDocumentos,
      _persona.nombre_completo,
      ...((da.firmantes || []) as any[]).map((f) => f?.nombre_completo),
      ...((da.comite_evaluacion || []) as any[]).map((m) => m?.nombre_completo || m?.nombre),
      ...((_pn.cruce_firmantes_ganador || []) as any[]).map((c) => c?.firmante),
      ...(((result as any).entity_personnel?.funcionarios_designados || []) as any[]).map((f) => f?.nombre_completo || f?.nombre),
      ...((_pn.pareja_o_familia || []) as any[]).map((f) => f?.nombre),
      ...((result.web_research?.empresa?.socios || []) as any[]).map((s) => s?.nombre),
      ...(((result as any).proveedor?.socios || []) as any[]).map((s) => s?.nombre),
      ...((_red.socios || []) as any[]).map((s) => s?.nombre),
    ];
  }, [result, _pn, _persona, _red]);
  setRedactNames(nombresPrivados);
  const nombresSunat = useMemo(
    () => nombresPrivados.flatMap((n) => (n && typeof n === "object" && n.orden === "sunat" && n.nombre ? [n.nombre] : [])),
    [nombresPrivados],
  );

  // Resumen ejecutivo del dictamen: se corta en un final de oración, nunca a mitad de palabra.
  const resumenEjecutivo = (() => {
    const m = dict.match(/#{2,3}\s*Resumen ejecutivo\s*\n+([\s\S]*?)(?:\n#{2,3}\s|$)/i);
    const raw = (m ? m[1] : dict) || "";
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
    if (v >= 1e9) return `S/ ${(v / 1e9).toFixed(2)} mil M`;
    if (v >= 1e6) return `S/ ${(v / 1e6).toFixed(2)} M`;
    if (v >= 1e3) return `S/ ${(v / 1e3).toFixed(0)} K`;
    return `S/ ${v.toLocaleString("es-PE")}`;
  };

  // ─── Copiar el dictamen, ya censurado ───
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  const copiarDictamen = async () => {
    try {
      await navigator.clipboard.writeText(redactarTextoPlano(dict, nombresPrivados));
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
    setTimeout(() => setCopiado(null), 2500);
  };

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; badge: number | string | null; badgeColor: string }[] = [
    { key: "resumen", label: "Resumen", icon: <ShieldAlert size={13} aria-hidden />, badge: banderasArr.length || null, badgeColor: "bg-rust" },
    { key: "dictamen", label: "Dictamen", icon: <Pen size={13} aria-hidden />, badge: dict.length > 100 ? "✓" : null, badgeColor: "bg-mossTexto" },
    { key: "items", label: "Ítems y mercado", icon: <Package size={13} aria-hidden />, badge: nItems || null, badgeColor: "bg-heroViolet" },
    { key: "proveedor", label: "Proveedor y red", icon: <Building2 size={13} aria-hidden />, badge: nRed || null, badgeColor: "bg-heroViolet" },
    { key: "documentos", label: "Documentos", icon: <FileText size={13} aria-hidden />, badge: nDocs || null, badgeColor: "bg-heroViolet" },
    { key: "prensa", label: "Prensa", icon: <Newspaper size={13} aria-hidden />, badge: nNoticias || null, badgeColor: "bg-heroViolet" },
    { key: "trace", label: "Cómo se hizo", icon: <Sparkles size={13} aria-hidden />, badge: nEvents || null, badgeColor: "bg-inkSoft" },
  ];
  const tabActual = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let j: number | null = null;
    if (e.key === "ArrowRight") j = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = TABS.length - 1;
    if (j === null) return;
    e.preventDefault();
    irATab(TABS[j].key);
    tabRefs.current[TABS[j].key]?.focus();
  };

  const nombreAgenteDictamen = result.dictamen?.gen_meta?.model ? ` con ${result.dictamen.gen_meta.model}` : "";
  const corrio = (clave: string) => corrida.agentes.includes(clave);

  // ─── Contenido de cada pestaña ───
  const contenido = (() => {
    switch (activeTab) {
      case "resumen":
        return (
          <div className="space-y-3">
            {resumenEjecutivo && (
              <SeccionSegura nombre="el resumen ejecutivo">
                <div className="surface p-4">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-heroViolet">
                    <Pen size={11} aria-hidden /> Resumen ejecutivo del dictamen
                  </div>
                  <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-inkSoft">{resumenEjecutivo}</p>
                  <button
                    type="button"
                    onClick={() => irATab("dictamen")}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-heroViolet px-3 py-1.5 text-xs font-bold text-paper transition-colors hover:bg-heroViolet-deep"
                  >
                    Leer el dictamen completo <ChevronRight size={13} aria-hidden />
                  </button>
                </div>
              </SeccionSegura>
            )}

            <div id="senales" className="scroll-mt-20">
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
                  />
                </SeccionSegura>
              ) : corrida.completa ? (
                <Vacio titulo="El análisis terminó sin señales de riesgo" icon={<CheckCircle2 size={16} className="text-mossTexto" aria-hidden />}>
                  Corrieron {corrida.nombres.length} de {corrida.total} agentes, se evaluaron las reglas de contratación y se
                  escribió el dictamen. Ninguna regla disparó una señal. No es un certificado de limpieza: es lo que
                  permitieron ver los datos públicos de este proceso.
                </Vacio>
              ) : (
                <Vacio titulo="Análisis incompleto: sin señales registradas" icon={<CircleDashed size={16} aria-hidden />}>
                  {corrida.hayTraza
                    ? `Corrieron ${corrida.nombres.length} de ${corrida.total} agentes${corrida.nombres.length ? ` (${corrida.nombres.join(", ")})` : ""}. `
                    : "No quedó registro de qué agentes corrieron. "}
                  {corrida.faltan.length > 0 && `Faltó ${corrida.faltan.join(" y ")}. `}
                  Que no aparezcan señales no quiere decir que este contrato esté limpio.
                </Vacio>
              )}
            </div>

            {(result as any).causal_directa_invocada?.match && (
              <SeccionSegura nombre="la causal de contratación directa">
                <CausalDirectaSection causal={(result as any).causal_directa_invocada} acto={(result as any).acto_resolutivo_directa} />
              </SeccionSegura>
            )}
          </div>
        );

      case "dictamen":
        if (!dict.trim()) {
          return (
            <Vacio titulo="Este análisis no tiene dictamen escrito" icon={<Pen size={16} aria-hidden />}>
              {corrida.corrioDictamen
                ? "El agente que redacta el dictamen corrió, pero no guardó un texto."
                : "El agente que redacta el dictamen no llegó a correr en este análisis."}{" "}
              Las señales, los ítems y los documentos que sí se leyeron están en las otras pestañas.
            </Vacio>
          );
        }
        return (
          <section className="surface overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
              <div>
                <h2 className="font-serif text-xl font-bold text-ink">Dictamen periodístico</h2>
                <div className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-mute">
                  <FileText size={11} aria-hidden />
                  Redactado por el agente de dictamen{nombreAgenteDictamen}, con la evidencia de los demás agentes
                </div>
              </div>
              <button
                type="button"
                onClick={copiarDictamen}
                aria-live="polite"
                title="Copia el texto con los datos personales ya ocultos"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  copiado === "ok"
                    ? "border-moss/40 bg-moss/10 text-mossTexto"
                    : copiado === "error"
                      ? "border-rust/40 bg-crimson-soft text-crimsonTexto"
                      : "border-line bg-paper text-ink hover:bg-paperDeep",
                )}
              >
                {copiado === "ok" ? <CheckCircle2 size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
                {copiado === "ok" ? "Copiado, sin datos personales" : copiado === "error" ? "No se pudo copiar" : "Copiar"}
              </button>
            </div>
            <article
              className={cn(
                // Medida de lectura: el dictamen es prosa larga; 68ch se lee sin esfuerzo.
                "mx-auto max-w-[68ch] px-4 py-8 sm:px-6",
                "prose prose-sm lg:prose-base",
                "prose-headings:font-serif prose-headings:text-ink prose-headings:font-bold prose-headings:tracking-tight",
                "prose-h1:text-2xl prose-h1:mt-0 prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-heroViolet",
                "prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-3 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-line",
                "prose-h3:text-base prose-h3:mt-7 prose-h3:mb-2 prose-h3:text-heroViolet prose-h3:font-bold",
                "prose-h4:text-sm prose-h4:mt-5 prose-h4:mb-1.5 prose-h4:font-bold prose-h4:text-ink",
                "prose-p:text-ink prose-p:leading-[1.7] prose-p:my-3.5",
                "prose-strong:text-ink prose-strong:font-bold",
                "prose-em:text-inkSoft prose-em:italic",
                "prose-ul:my-3 prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1.5",
                "prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1.5",
                "prose-li:text-ink prose-li:leading-relaxed prose-li:marker:text-heroViolet",
                "prose-a:text-heroViolet prose-a:font-medium prose-a:underline prose-a:decoration-heroViolet/40 hover:prose-a:decoration-heroViolet",
                "prose-a:break-words",
                "prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-heroViolet prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
                "prose-blockquote:border-l prose-blockquote:border-heroViolet/50 prose-blockquote:bg-paperSoft prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:my-4 prose-blockquote:rounded-r prose-blockquote:text-inkSoft prose-blockquote:not-italic",
                "prose-table:text-xs prose-table:w-full prose-table:border-collapse",
                "prose-th:bg-paperDeep prose-th:text-ink prose-th:font-bold prose-th:uppercase prose-th:tracking-wider prose-th:text-[10px] prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-line",
                "prose-td:text-ink prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-line prose-td:align-top",
                "prose-hr:my-6 prose-hr:border-line",
              )}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Censura DNI, RUC de persona natural y apellidos conocidos en la prosa (vidrio revelable).
                  p: ({ node, children, ...props }) => <p {...props}>{redactChildren(children)}</p>,
                  li: ({ node, children, ...props }) => <li {...props}>{redactChildren(children)}</li>,
                  strong: ({ node, children, ...props }) => <strong {...props}>{redactChildren(children)}</strong>,
                  em: ({ node, children, ...props }) => <em {...props}>{redactChildren(children)}</em>,
                  td: ({ node, children, ...props }) => <td {...props}>{redactChildren(children)}</td>,
                  // Una tabla de datos necesita ancho: rompe la medida y scrollea en su propia caja.
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
                            <span className="truncate max-w-[36ch] underline decoration-heroViolet/40">{String(children)}</span>
                            <ExternalLink size={10} className="shrink-0" aria-hidden />
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
        );

      case "items": {
        const hayItems = (result.items || []).length > 0 || (result.market_analysis?.findings || []).length > 0;
        const hayVeredicto = !!result.market_analysis?.veredicto_global;
        const hayPostores = (result.postores || []).length > 0;
        if (!hayItems && !hayVeredicto && !hayPostores) {
          return (
            <Vacio titulo="No hay ítems ni comparación de mercado para este contrato" icon={<Package size={16} aria-hidden />}>
              {result.market_analysis_raw && !result.market_analysis
                ? "El agente de precios respondió, pero su resultado no se pudo leer, así que no se publica ninguna comparación."
                : corrio("market")
                  ? "El agente de precios corrió, pero no llegó a desglosar ítems comparables."
                  : "El agente de precios no llegó a correr en este análisis."}{" "}
              No se muestra una comparación que no se hizo.
            </Vacio>
          );
        }
        return (
          <div className="space-y-3">
            {hayItems && (
              <SeccionSegura nombre="los ítems">
                <section className="surface overflow-hidden p-0">
                  <div className="border-b border-line bg-paperDeep px-5 py-3">
                    <h2 className="font-serif text-xl font-bold text-ink">Qué se está comprando</h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-mute">
                      <span className="inline-flex items-center gap-1.5">
                        <Package size={11} aria-hidden />
                        {nItems} ítems convocados
                      </span>
                      {(result.market_analysis?.findings || []).length > (result.items || []).length && (
                        <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-medium text-amberTexto">desglosado por los agentes</span>
                      )}
                    </div>
                    {(result.document_analysis?.items_consolidados || []).length > (result.items || []).length && (
                      <p className="mt-1 text-xs text-mute">
                        El registro OCDS reporta {(result.items || []).length} ítem(s) globales, pero los agentes los desglosaron en{" "}
                        {(result.document_analysis?.items_consolidados || []).length} productos según el requerimiento técnico.
                      </p>
                    )}
                  </div>
                  <ItemsConMarketPrice
                    items={result.items || []}
                    allItems={result.document_analysis?.items_consolidados || []}
                    market={result.market_analysis}
                    fmtMoney={fmtMoney}
                  />
                </section>
              </SeccionSegura>
            )}
            {hayVeredicto && (
              <SeccionSegura nombre="el veredicto de mercado">
                <MarketVerdictCard market={result.market_analysis} fmtMoney={fmtMoney} />
              </SeccionSegura>
            )}
            {hayPostores && (
              <SeccionSegura nombre="los postores">
                <PostoresSection postores={result.postores || []} fmtMoney={fmtMoney} />
              </SeccionSegura>
            )}
          </div>
        );
      }

      case "proveedor": {
        const ctx = (result as any).person_network_context;
        const ep = (result as any).entity_personnel;
        const hayEstructura = (ctx?.autoridades_entidad?.n_autoridades_encontradas || 0) > 0 || (ep?.funcionarios_designados?.length || 0) > 0;
        return (
          <div className="space-y-3">
            {!result.web_research && !result.person_network && (
              <Vacio titulo="La investigación del proveedor no corrió en este análisis" icon={<Building2 size={16} aria-hidden />}>
                {result.web_research_raw || result.person_network_raw
                  ? "Los agentes respondieron, pero su resultado no se pudo leer. "
                  : ""}
                Lo que aparece abajo sale de los registros públicos que sí se consultaron.
              </Vacio>
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
              {(result.web_research?.otros_contratos_con_estado || []).length > 0 && (
                <SeccionSegura nombre="los otros contratos">
                  <CollapsibleSection
                    title="Otros contratos con el Estado"
                    subtitle={`${(result.web_research?.otros_contratos_con_estado || []).length} contratos públicos del proveedor`}
                    icon={<Receipt size={13} aria-hidden />}
                  >
                    <OtrosContratosSection otros={result.web_research.otros_contratos_con_estado || []} relacion={result.web_research.relacion_proveedor_entidad} fmtMoney={fmtMoney} />
                  </CollapsibleSection>
                </SeccionSegura>
              )}
              <SeccionSegura nombre="las vinculaciones políticas">
                <CollapsibleSection title="Vinculaciones políticas" subtitle="Aportes de campaña (ONPE) y candidaturas (JNE)" icon={<ShieldAlert size={13} aria-hidden />}>
                  <AportesPoliticosSection web={result.web_research} person={result.person_network} ctx={ctx} />
                </CollapsibleSection>
              </SeccionSegura>
              {(result.web_research?.hallazgos_por_fuente || []).length > 0 && (
                <SeccionSegura nombre="las fuentes consultadas">
                  <CollapsibleSection
                    title="Fuentes consultadas"
                    subtitle={`${(result.web_research?.hallazgos_por_fuente || []).length} portales públicos consultados`}
                    icon={<Globe size={13} aria-hidden />}
                  >
                    <FuentesConsultadasSection hallazgos={result.web_research.hallazgos_por_fuente} />
                  </CollapsibleSection>
                </SeccionSegura>
              )}
            </div>
          </div>
        );
      }

      case "documentos": {
        const da = result.document_analysis || {};
        const hayFirmas = (da.firmantes || []).length > 0 || (da.motivos_adjudicacion || []).length > 0 || (da.comite_evaluacion || []).length > 0;
        return (
          <div className="space-y-3">
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
              <Vacio titulo="El registro OCDS no publica documentos para este proceso" icon={<FileText size={16} aria-hidden />}>
                Sin bases ni actas publicadas, los agentes no tuvieron expediente que leer.
              </Vacio>
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

      case "prensa":
        if (!result.news_research) {
          return (
            <Vacio titulo="La búsqueda de prensa no corrió en este análisis" icon={<Newspaper size={16} aria-hidden />}>
              {result.news_research_raw
                ? "El agente de prensa respondió, pero su resultado no se pudo leer."
                : "No hay notas de prensa asociadas a este contrato en el análisis guardado."}
            </Vacio>
          );
        }
        return (
          <SeccionSegura nombre="la prensa">
            <NoticiasSection news={result.news_research} />
          </SeccionSegura>
        );

      case "trace":
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
              <Vacio titulo="Este análisis no guardó su traza paso a paso">
                Fue procesado antes de que la traza se guardara con el dossier. Las señales y el dictamen sí quedaron.
              </Vacio>
            )}
            {Number(result.timing?.total_s) > 0 && (
              <p className="text-[12px] text-mute">Duración de esta corrida: {Math.round(Number(result.timing!.total_s))} segundos.</p>
            )}
          </div>
        );
    }
  })();

  const score = typeof compl.score === "number" ? compl.score : null;
  const mostrarScore = nivel.nivel !== "incompleto" && score !== null;

  const TarjetaNivel = ({ compacta = false }: { compacta?: boolean }) => (
    <div className={cn("surface flex items-center gap-3 border", nivel.ui.borde, compacta ? "p-3" : "p-4")}>
      <div
        className={cn(
          "flex shrink-0 flex-col items-center justify-center rounded-xl border",
          nivel.ui.fondo,
          nivel.ui.texto,
          nivel.ui.borde,
          compacta ? "h-12 w-12" : "h-16 w-16",
        )}
      >
        {mostrarScore ? (
          <>
            <NumberTicker value={score!} format="entero" className={cn("font-serif font-bold leading-none", compacta ? "text-xl" : "text-2xl")} />
            <span className="mt-0.5 text-[10px] font-medium">/ 100</span>
          </>
        ) : (
          <CircleDashed size={compacta ? 18 : 22} aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-mute">{mostrarScore ? "Puntaje de riesgo" : "Puntaje de riesgo: sin calificar"}</div>
        <div className="mt-0.5 text-sm font-bold leading-tight text-ink">{nivel.etiqueta}</div>
        <div className="mt-0.5 text-[11px] text-mute">{nivel.detalle}</div>
      </div>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
      {/* ─── COLUMNA PRINCIPAL ─── */}
      <div className="min-w-0 space-y-3">
        <ShareableHeader conv={conv} codigo={conv.codigo} nAlta={nAlta} onReset={onReset} />

        {/* En el celular la barra lateral queda al final: el nivel va arriba, compacto. */}
        <div className="lg:hidden">
          <TarjetaNivel compacta />
        </div>

        <SeccionSegura nombre="el resumen">
          <ResumenHumano
            conv={conv}
            ganador={ganador}
            nGanadores={ganadores.length}
            nAlta={nAlta}
            nMedia={nMedia}
            nBaja={nBaja}
            banderasArr={banderasArr}
            fmtMoney={fmtMoney}
            nivel={nivel}
            corrida={corrida}
            onVerEvidencia={verEvidencia}
          />
        </SeccionSegura>

        {/* Inconsistencia: los documentos sugieren una etapa que el OCDS todavía no publica */}
        {result.estado_real?.estado_inconsistente && (
          <div className="surface flex items-start gap-3 border-2 border-rust/40 p-4">
            <AlertTriangle size={20} className="shrink-0 text-crimsonTexto" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-sm font-bold text-crimsonTexto">Los documentos y el portal oficial no coinciden</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-inkSoft">
                El registro OCDS del OECE muestra el estado <strong>{String(result.estado_real.estado_ocds || "").replace(/_/g, " ")}</strong>, pero el
                expediente ya tiene documentos de <strong>{String(result.estado_real.estado_documentos || "").replace(/_/g, " ")}</strong> (
                {result.estado_real.documentos_clave?.length || 0} documentos clave). El portal oficial puede estar desactualizado o la publicación
                de la adjudicación, pendiente.
              </p>
              {(result.estado_real.documentos_clave || []).slice(0, 3).map((d: any, i: number) => (
                <div key={i} className="mt-1.5 flex flex-wrap items-start gap-2 text-[11px]">
                  <span className="rounded bg-crimson-soft px-1.5 py-0 text-[11px] font-semibold text-crimsonTexto">
                    {String(d.tipo || "").replace(/_/g, " ")}
                  </span>
                  <span className="line-clamp-1 text-mute">{d.titulo}</span>
                  {d.fecha && <span className="font-mono text-[11px] text-mute">{String(d.fecha).slice(0, 10)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PESTAÑAS */}
        <div
          role="tablist"
          aria-label="Secciones del dossier"
          className="sticky top-2 z-30 -mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-paper/95 px-1 py-1.5 shadow-sm backdrop-blur"
        >
          {TABS.map((t, i) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                id={`tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${t.key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => irATab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/60",
                  isActive ? "bg-heroViolet text-paper shadow-card" : "bg-paperSoft text-inkSoft hover:bg-paperDeep hover:text-ink",
                )}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.badge && (
                  <span
                    className={cn(
                      "ml-0.5 rounded-full px-1.5 py-0 text-[10px] font-bold leading-tight",
                      isActive ? "bg-paper/30 text-paper" : cn(t.badgeColor, "text-paper"),
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="focus-visible:outline-none">
          <SeccionSegura key={activeTab} nombre={`la pestaña ${tabActual.label}`}>
            {contenido}
          </SeccionSegura>
        </div>

        <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-mute">
          <ShieldAlert size={10} className="mr-1 inline text-amberTexto" aria-hidden />
          Vigía detecta señales cruzando datos públicos (OECE, SUNAT, ONPE, JNE, prensa). No constituye acusación. La denuncia formal
          corresponde a la Contraloría, la Fiscalía o el periodismo.
        </p>
      </div>

      {/* ─── BARRA LATERAL ─── */}
      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="hidden lg:block">
          <TarjetaNivel />
        </div>

        {/* DATOS DEL PROCESO */}
        <div className="surface p-3">
          {conv.tipo_proceso && (
            <div className="mb-2 border-b border-line pb-2">
              <div className="text-[11px] text-mute">Tipo de proceso</div>
              <div className="mt-0.5 text-[12px] font-semibold leading-tight text-ink">{conv.tipo_proceso}</div>
            </div>
          )}
          <dl className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className={cn("font-mono text-base font-bold tabular-nums leading-none", (conv.n_postores ?? 0) === 1 ? "text-crimsonTexto" : "text-ink")}>
                <NumberTicker value={conv.n_postores ?? 0} format="entero" />
              </dd>
              <dt className="mt-0.5 text-[10px] text-mute">{(conv.n_postores ?? 0) === 1 ? "Postor único" : "Postores"}</dt>
            </div>
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">
                <NumberTicker value={conv.n_items ?? 0} format="entero" />
              </dd>
              <dt className="mt-0.5 text-[10px] text-mute">Ítems</dt>
            </div>
            <div className="rounded-md bg-paperDeep p-1.5">
              <dd className="font-mono text-base font-bold tabular-nums leading-none text-ink">
                <NumberTicker value={conv.n_docs ?? 0} format="entero" />
              </dd>
              <dt className="mt-0.5 text-[10px] text-mute">Documentos</dt>
            </div>
          </dl>
          {(ocidContrato || entidadRuc) && (
            <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[12px]">
              {ocidContrato && (
                <li>
                  <Link href={`/app/contratos/${encodeURIComponent(ocidContrato)}`} className="inline-flex items-center gap-1 font-medium text-heroViolet hover:underline">
                    Contrato, documentos y citas por página <ArrowRight size={11} aria-hidden />
                  </Link>
                </li>
              )}
              {entidadRuc && (
                <li>
                  <Link href={`/entidad/${encodeURIComponent(entidadRuc)}`} className="inline-flex items-center gap-1 font-medium text-heroViolet hover:underline">
                    Perfil de la entidad que contrata <ArrowRight size={11} aria-hidden />
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* CÓMO SE HIZO: qué agentes corrieron, en palabras */}
        <button
          type="button"
          onClick={() => irATab("trace")}
          className="surface w-full p-3 text-left transition-colors duration-200 hover:bg-paperDeep"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
              <Sparkles size={12} className="text-heroViolet" aria-hidden /> Cómo se hizo este análisis
            </div>
            <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
          </div>
          <p className="mt-1.5 text-[12px] leading-snug text-inkSoft">
            {corrida.hayTraza ? (
              <>
                Corrieron <strong className="font-semibold text-ink">{corrida.agentes.length} de {TOTAL_AGENTES}</strong> agentes
                {nEvents > 0 && <>, en {nEvents.toLocaleString("es-PE")} pasos registrados</>}.
              </>
            ) : (
              "Este análisis no guardó el registro de qué agentes corrieron."
            )}
          </p>
          <div className="mt-1.5 text-[11px] font-medium text-heroViolet">Ver los evaluadores y la traza completa</div>
        </button>
      </aside>
    </div>
  );
}
