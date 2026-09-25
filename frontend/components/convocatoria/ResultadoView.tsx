"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { setRedactNames } from "../Redact";
import { nombresPrivadosDe } from "./nombresPrivados";
import { ArrowRight, Building2, ChevronRight, FileText, Info, Newspaper, Package, Pen, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, numero } from "@/lib/formato";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Indicadores } from "@/components/listado";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import type { ApiResult } from "./types";
import { contarSeveridades, dossierEnRevision, estadoCorrida, nivelDelDossier, separarBanderas } from "./dossier";
import { IdentidadDossier, indicadoresDossier } from "./sections/IdentidadDossier";
import { ResumenHumano } from "./sections/ResumenHumano";
import { SeccionSegura } from "./sections/SeccionSegura";
import { EnRevisionDossier } from "./sections/EnRevisionDossier";
import { PanelDossier, type TabKey } from "./sections/PanelesDossier";

const TAB_KEYS: TabKey[] = ["resumen", "dictamen", "items", "proveedor", "documentos", "prensa", "trace"];
const esTab = (v: string | null | undefined): v is TabKey => !!v && (TAB_KEYS as string[]).includes(v);

/**
 * El informe de un contrato, tal como lo ve el público: la plantilla Ficha (DESIGN_SYSTEM.md §14.2).
 *   1. identidad: volver, qué se contrató (h1), código, quién compra, quién ganó y chips de estado;
 *   2. `Indicadores`: valor referencial, adjudicado, señales por severidad y la fecha del proceso;
 *   3. el veredicto, una tarjeta en palabras;
 *   4. la evidencia, en pestañas (señales, dictamen, ítems, proveedor, documentos, prensa) y,
 *      desde xl, la columna de datos del proceso;
 *   5. "Cómo se hizo", la última pestaña: ahí sí va el vocabulario técnico.
 *
 * El informe es evidencia: sin franja textil ni llamita en su cuerpo. La llamita vive en los
 * estados de la página (cargando, no encontrado, error), que arma la página y no este componente.
 *
 * `vistaPrevia` es para el panel admin, que muestra el informe de una alerta en revisión antes de
 * publicarla: mismo contenido, sin las acciones que no tienen sentido ahí (volver al listado,
 * compartir un enlace que todavía no es público) y sin pestañas pegajosas que se montarían sobre
 * la cabecera del panel. Por eso la vista previa NUNCA cae en el aviso "En revisión": el equipo
 * tiene que ver el informe entero para decidir.
 */
export function ResultadoView({ result, vistaPrevia = false }: { result: ApiResult; vistaPrevia?: boolean }) {
  const conv = result.convocatoria || {};
  const compl = result.compliance || {};
  const dict = result.dictamen?.dictamen_markdown || "";
  const ocidContrato: string | null = conv.ocid || conv.codigo || result.ocid || null;
  const entidadRuc: string | null = conv.buyer_ruc || (result as any).entidad_ruc || null;
  // La identidad enlaza la entidad por su RUC: si la convocatoria no lo trae, el del análisis.
  const convIdentidad = entidadRuc && !conv.buyer_ruc ? { ...conv, buyer_ruc: entidadRuc } : conv;
  const enRevision = !vistaPrevia && dossierEnRevision(result);

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

  // "Ver las señales": va a la pestaña Resumen y baja hasta la lista.
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
  // UNA lectura de severidad para la cabecera, los chips y la lista (ver ./dossier).
  const conteo = useMemo(() => contarSeveridades(banderasArr), [banderasArr]);
  const nivel = nivelDelDossier(compl.score, banderasArr.length, corrida);
  // El puntaje nunca aparece sin las señales que lo explican (§10.4).
  const score = typeof compl.score === "number" && banderasArr.length > 0 ? compl.score : null;

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
  // PROSA (síntesis, dictamen, evidencia). Se arma en ./nombresPrivados.ts, que también
  // usa el panel de revisión para registrarla antes de que este componente cargue.
  const nombresPrivados = useMemo(() => nombresPrivadosDe(result), [result]);
  setRedactNames(nombresPrivados);
  const nombresSunat = useMemo(
    () => nombresPrivados.flatMap((n) => (n && typeof n === "object" && n.orden === "sunat" && n.nombre ? [n.nombre] : [])),
    [nombresPrivados],
  );

  // Resumen ejecutivo del dictamen, como anticipo de dos líneas (§10.7: ≈180 caracteres); el
  // dictamen entero está en su pestaña. Se corta en un final de oración, nunca a mitad de palabra.
  const resumenEjecutivo = (() => {
    const m = dict.match(/#{2,3}\s*Resumen ejecutivo\s*\n+([\s\S]*?)(?:\n#{2,3}\s|$)/i);
    const raw = (m ? m[1] : dict) || "";
    const limpio = raw.replace(/[#*`>\[\]]/g, "").replace(/\s+/g, " ").trim();
    if (limpio.length <= 180) return limpio;
    const corte = limpio.slice(0, 180);
    const finOracion = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
    if (finOracion > 90) return corte.slice(0, finOracion + 1);
    const finPalabra = corte.lastIndexOf(" ");
    return (finPalabra > 0 ? corte.slice(0, finPalabra) : corte) + "…";
  })();

  // Insignias de las pestañas: conteos en tinta neutra. La de Resumen contaba las señales en
  // rojo aunque fueran todas bajas; el color de severidad sólo va donde se dice la severidad.
  const TABS: { key: TabKey; label: string; icon: React.ReactNode; badge: number | null }[] = [
    { key: "resumen", label: "Señales", icon: <ShieldAlert size={14} aria-hidden />, badge: banderasArr.length || null },
    { key: "dictamen", label: "Dictamen", icon: <Pen size={14} aria-hidden />, badge: null },
    { key: "items", label: "Ítems y mercado", icon: <Package size={14} aria-hidden />, badge: nItems || null },
    { key: "proveedor", label: "Proveedor y red", icon: <Building2 size={14} aria-hidden />, badge: nRed || null },
    { key: "documentos", label: "Documentos", icon: <FileText size={14} aria-hidden />, badge: nDocs || null },
    { key: "prensa", label: "Prensa", icon: <Newspaper size={14} aria-hidden />, badge: nNoticias || null },
    { key: "trace", label: "Cómo se hizo", icon: <Sparkles size={14} aria-hidden />, badge: null },
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

  // ─── Alerta frenada para revisión humana: "En revisión" y nada más (§10.4) ───
  if (enRevision) {
    return <EnRevisionDossier conv={convIdentidad} ganador={ganador} nGanadores={ganadores.length} />;
  }

  const analizadoEn = (result._bridge_meta?.analizado_en as string | undefined) ?? null;
  const IconoNivel = ICONO_SEVERIDAD[nivel.ui.icono];

  return (
    <div className="space-y-5">
      {/* 1. Identidad: qué, quién compra, quién ganó; el peso del riesgo como chip de estado. */}
      <IdentidadDossier
        conv={convIdentidad}
        ganador={ganador}
        nGanadores={ganadores.length}
        volver={!vistaPrevia}
        compartible={!vistaPrevia}
        chips={
          <>
            <span className={cn("pill font-semibold", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)}>
              <IconoNivel size={11} aria-hidden />
              {nivel.etiqueta}
            </span>
            {conv.tipo_proceso && <span className="pill border-line bg-paperSoft text-inkSoft">{conv.tipo_proceso}</span>}
            {analizadoEn && <span className="text-[12.5px] text-mute">Leído el {fechaCorta(analizadoEn)}</span>}
          </>
        }
      />

      {/* 2. Las cifras del contrato. */}
      <SeccionSegura nombre="las cifras del contrato">
        <Indicadores items={indicadoresDossier({ conv, ganador, conteo, corrida })} />
      </SeccionSegura>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),300px]">
        {/* ─── COLUMNA PRINCIPAL ─── */}
        <div className="min-w-0 space-y-4">
          {/* 3. Veredicto en palabras */}
          <SeccionSegura nombre="el veredicto">
            <ResumenHumano
              conteo={conteo}
              score={score}
              nivel={nivel}
              corrida={corrida}
              resumenEjecutivo={resumenEjecutivo}
              onVerEvidencia={verEvidencia}
              onLeerDictamen={() => irATab("dictamen")}
            />
          </SeccionSegura>

          {/* Los documentos sugieren una etapa que el OCDS todavía no publica: es un dato, no una señal. */}
          {result.estado_real?.estado_inconsistente && (
            <SeccionSegura nombre="el aviso de estado">
              <EstadoInconsistente er={result.estado_real} />
            </SeccionSegura>
          )}

          {/* 4. La evidencia, en pestañas */}
          <div
            role="tablist"
            aria-label="Secciones del informe"
            className={cn(
              "-mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-paper/95 px-1 py-1.5 backdrop-blur",
              !vistaPrevia && "sticky top-2 z-30",
            )}
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
                    "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-rapido",
                    isActive ? "bg-granate text-paper" : "text-inkSoft hover:bg-paperDeep hover:text-ink",
                  )}
                >
                  {t.icon}
                  <span>{t.label}</span>
                  {t.badge != null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-snug",
                        isActive ? "bg-paper/20 text-paper" : "bg-paperDeep text-inkSoft",
                      )}
                    >
                      {numero(t.badge)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="rounded-2xl focus-visible:outline-none">
            <SeccionSegura key={activeTab} nombre={`la pestaña ${tabActual.label}`}>
              <PanelDossier
                tab={activeTab}
                result={result}
                conv={conv}
                dict={dict}
                corrida={corrida}
                banderasArr={banderasArr}
                noVerificables={noVerificables}
                nombresPrivados={nombresPrivados}
                nombresSunat={nombresSunat}
                ganador={ganador}
                ganadores={ganadores}
                ocidContrato={ocidContrato}
                nItems={nItems}
                nDocs={nDocs}
                nEvents={nEvents}
              />
            </SeccionSegura>
          </div>

          {/* Una línea + ⓘ (§10.7). Es la única vez que el informe lo dice: antes lo repetían el
              veredicto, el pie de la lista de señales y este párrafo. */}
          <p className="flex items-center gap-1 border-t border-line pt-3 text-[12px] text-mute">
            <Info size={13} className="shrink-0" aria-hidden />
            Una señal no es una acusación.
            <Ayuda titulo="¿De dónde salen y qué hago con ellas?">
              Vigía detecta señales cruzando datos públicos (OECE, SUNAT, ONPE, JNE, prensa). Cada una es una pista para
              comprobar en su fuente. La denuncia formal corresponde a la Contraloría, la Fiscalía o el periodismo.
            </Ayuda>
          </p>
        </div>

        {/* ─── BARRA LATERAL: datos del proceso y cómo se hizo ─── */}
        <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start" aria-label="Datos del proceso">
          <div className="rounded-2xl border border-line bg-paper p-4">
            <h2 className="text-[13px] font-semibold text-ink">Datos del proceso</h2>
            {/* Filas etiqueta · cifra, alineadas a la izquierda: antes eran tres baldosas centradas. */}
            <dl className="mt-1.5 divide-y divide-line/70 text-[13px]">
              <DatoProceso valor={conv.n_postores} etiqueta={Number(conv.n_postores) === 1 ? "Postor" : "Postores"} />
              <DatoProceso valor={conv.n_items} etiqueta="Ítems" />
              <DatoProceso valor={conv.n_docs} etiqueta="Documentos" />
            </dl>
            {Number(conv.n_postores) === 1 && <p className="mt-1.5 text-[12px] leading-snug text-inkSoft">Se presentó un solo postor.</p>}
            {/* El perfil de la entidad ya se enlaza desde la identidad: aquí sólo lo que no está arriba. */}
            {ocidContrato && (
              <p className="mt-3 border-t border-line pt-3 text-[13px]">
                <Link href={`/app/contratos/${encodeURIComponent(ocidContrato)}`} className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                  Documentos oficiales y citas por página <ArrowRight size={13} aria-hidden />
                </Link>
              </p>
            )}
          </div>

          {/* 5. Cómo se hizo: plegado detrás de su pestaña. Aquí sólo el acceso. */}
          <button
            type="button"
            onClick={() => irATab("trace")}
            className="w-full rounded-2xl border border-line bg-paperSoft p-4 text-left transition-colors duration-rapido hover:bg-paperDeep"
          >
            <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-ink">
              Cómo se hizo este análisis
              <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
            </span>
            <span className="mt-1 block text-[12px] leading-snug text-inkSoft">
              {corrida.hayTraza ? (
                <>
                  Corrieron <strong className="font-semibold text-ink">{corrida.agentes.length} de {TOTAL_AGENTES}</strong> agentes
                  {nEvents > 0 && <>, en {numero(nEvents)} pasos registrados</>}.
                </>
              ) : (
                "Este análisis no guardó el registro de qué agentes corrieron."
              )}
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}

/** Una cifra del proceso con su etiqueta, en una fila. Sin dato no se inventa un cero. */
function DatoProceso({ valor, etiqueta }: { valor: unknown; etiqueta: string }) {
  const n = typeof valor === "number" && Number.isFinite(valor) ? valor : null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-mute">{etiqueta}</dt>
      <dd className={cn("font-mono tabular-nums", n === null ? "font-sans text-[12px] text-mute" : "font-semibold text-ink")}>
        {n === null ? "Sin dato" : numero(n)}
      </dd>
    </div>
  );
}

/**
 * Los documentos y el portal oficial no coinciden en la etapa del proceso. Es un dato sobre el
 * registro, no una señal: va en tinta neutra (antes, en el rojo de error del sistema). Aviso
 * inevitable = una línea + ⓘ (§10.7); los documentos que lo muestran van en la ⓘ.
 */
function EstadoInconsistente({ er }: { er: any }) {
  const legible = (s: unknown) => String(s || "").replace(/_/g, " ");
  const docs: any[] = er.documentos_clave || [];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-paperSoft px-4 py-2.5 text-[13px]">
      <Info size={15} className="shrink-0 text-inkSoft" aria-hidden />
      <span className="font-semibold text-ink">Los documentos y el portal oficial no coinciden</span>
      <span className="text-inkSoft">
        OECE: {legible(er.estado_ocds)} · expediente: {legible(er.estado_documentos)}
      </span>
      <Ayuda titulo="¿Por qué no coinciden?">
        <span className="block">
          El registro OCDS del OECE muestra el estado &ldquo;{legible(er.estado_ocds)}&rdquo;, pero el expediente ya tiene{" "}
          {numero(docs.length)} {docs.length === 1 ? "documento clave" : "documentos clave"} de &ldquo;
          {legible(er.estado_documentos)}&rdquo;. El portal puede estar desactualizado o la publicación de la adjudicación,
          pendiente.
        </span>
        {docs.slice(0, 3).map((d: any, i: number) => (
          <span key={i} className="mt-1.5 block text-[12px] text-inkSoft">
            <strong className="font-semibold text-ink">{legible(d.tipo)}</strong> {d.titulo}
            {d.fecha && <span className="text-mute"> · {fechaCorta(String(d.fecha).slice(0, 10))}</span>}
          </span>
        ))}
      </Ayuda>
    </div>
  );
}
