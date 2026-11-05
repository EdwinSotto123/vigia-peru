"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, FileText, HardHat, Newspaper, Package, Pen, Workflow, type LucideIcon } from "lucide-react";
import { EnlaceFuente } from "@/components/patrones";
import { pasoDeClave, TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { fechaConAnio, numero, plural } from "@/lib/formato";
import { redactDnis } from "../../Redact";
import type { EstadoCorrida } from "../dossier";
import type { ApiResult } from "../types";
import type { TabKey } from "../sections/PanelesDossier";
import { AvisoSeccion } from "../sections/AvisoSeccion";
import { oeceProcesoUrl } from "../utils";
import { resumenDelDictamen } from "./historia";
import { ENLACE_RELATO } from "./PorQueLlama";

/**
 * «Lo que dice el análisis»: el dictamen plegado a su resumen ejecutivo (texto plano: react-markdown sólo baja al abrir la
 * pestaña Dictamen), citado como lo que es, el texto que redactó el análisis, con «Leer el dictamen completo».
 */
export function LoQueDice({
  dict,
  corrida,
  modelo,
  abrirTab,
}: {
  dict: string;
  corrida: EstadoCorrida;
  modelo?: string | null;
  abrirTab: (t: TabKey) => void;
}) {
  const { titulo, parrafos } = useMemo(() => resumenDelDictamen(dict), [dict]);
  if (!dict.trim() || parrafos.length === 0) {
    return (
      <AvisoSeccion titulo="Este análisis no tiene dictamen escrito" icono={<Pen size={16} aria-hidden />}>
        {corrida.corrioDictamen ? "La redacción del dictamen corrió, pero no guardó un texto." : "La redacción del dictamen no llegó a correr en este análisis."}{" "}
        Las señales, los ítems y los documentos que sí se leyeron están en las otras pestañas.
      </AvisoSeccion>
    );
  }
  return (
    <figure className="rounded-2xl border border-line bg-paperSoft px-4 py-3.5 sm:px-5">
      {titulo && <p className="break-words font-display text-destacado font-bold leading-snug text-ink text-balance">{redactDnis(titulo)}</p>}
      <blockquote className="mt-2 space-y-2 border-l-2 border-paperEdge pl-3">
        {parrafos.map((p, i) => (
          <p key={i} className="max-w-[68ch] break-words text-dato leading-relaxed text-inkSoft text-pretty">
            {redactDnis(p)}
          </p>
        ))}
      </blockquote>
      <figcaption className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-rotulo text-mute">
        <span>Resumen del dictamen, redactado automáticamente{modelo ? ` (${modelo})` : ""} con la evidencia del análisis.</span>
        <button type="button" onClick={() => abrirTab("dictamen")} className={ENLACE_RELATO}>
          Leer el dictamen completo <ChevronRight size={14} aria-hidden />
        </button>
      </figcaption>
    </figure>
  );
}

/** Las fuentes que no son registros (el redactor, los jueces): no se listan como «registros que se cruzaron». */
const SIN_FUENTE_PROPIA = new Set(["report_writer", "self_eval"]);

/**
 * «De dónde sale cada dato»: cada parte del detalle con su pestaña (documentos, ítems y mercado, prensa, la obra, cómo se
 * hizo), los registros que se cruzaron y los enlaces oficiales. Reúne lo que antes estaba en la columna «Datos del proceso»
 * y en el acceso a «Cómo se hizo este análisis».
 */
export function DeDondeSale({
  result,
  conv,
  corrida,
  ocidContrato,
  nDocs,
  nItems,
  nEvents,
  abrirTab,
}: {
  result: ApiResult;
  conv: any;
  corrida: EstadoCorrida;
  ocidContrato: string | null;
  nDocs: number;
  nItems: number;
  nEvents: number;
  abrirTab: (t: TabKey) => void;
}) {
  const nNoticias = (result.news_research?.noticias || []).length;
  const sup = (result as any).supervision_obra;
  const obra = (result as any).obra_ejecucion;
  const nObras = ((sup?.enlazada && sup.obras) || (obra?.enlazada && obra.obras) || []).length;
  const analizadoEn = (result._bridge_meta?.analizado_en as string | undefined) ?? null;

  const fuentes = useMemo(() => {
    const set = new Set<string>();
    for (const k of corrida.agentes) if (!SIN_FUENTE_PROPIA.has(k)) for (const f of pasoDeClave(k)?.fuentes ?? []) set.add(f);
    // El historial del proveedor sale del CONOSCE aunque ningún agente lo nombre.
    if ((result as any).expediente_proveedor?.historial) set.add("CONOSCE (OECE)");
    return [...set];
  }, [corrida.agentes, result]);

  const partes: { tab: TabKey; icono: LucideIcon; titulo: string; texto: string }[] = [
    {
      tab: "documentos",
      icono: FileText,
      titulo: "Los documentos del expediente",
      texto:
        nDocs > 0
          ? `${plural(nDocs, "documento publicado", "documentos publicados")} en el SEACE, con lo que se leyó de ellos, los firmantes y la línea de tiempo.`
          : "El registro OCDS no publica documentos para este proceso.",
    },
    {
      tab: "items",
      icono: Package,
      titulo: "Qué se compró y a qué precio",
      texto:
        nItems > 0
          ? `${plural(nItems, "ítem", "ítems")}, con su precio frente al mercado y a lo que pagó el Estado, y los postores.`
          : "Los ítems y la comparación de precios, si se hizo.",
    },
    ...(nObras > 0
      ? [{ tab: "obra" as TabKey, icono: HardHat, titulo: sup?.enlazada ? "La obra supervisada" : "La obra", texto: "Su avance y sus pagos en INFOBRAS." }]
      : []),
    {
      tab: "prensa",
      icono: Newspaper,
      titulo: "Lo que dice la prensa",
      texto: nNoticias > 0 ? `${plural(nNoticias, "noticia", "noticias")} de prensa peruana sobre el proveedor, la entidad o lo comprado.` : "Lo que buscó la revisión de prensa y si encontró algo.",
    },
    {
      tab: "trace",
      icono: Workflow,
      titulo: "Cómo se hizo este análisis",
      texto: corrida.hayTraza
        ? // La fecha con su año («5 nov. 2026»): la abreviatura del mes ya lleva punto y no puede cerrar la oración.
          `Corrieron ${corrida.agentes.length} de ${TOTAL_AGENTES} agentes${nEvents > 0 ? `, en ${numero(nEvents)} pasos registrados` : ""}${analizadoEn ? ` (leído el ${fechaConAnio(analizadoEn)})` : ""}.`
        : "Este análisis no guardó el registro de qué agentes corrieron.",
    },
  ];

  return (
    <div className="space-y-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {partes.map((p) => (
          <li key={p.tab}>
            <button
              type="button"
              onClick={() => abrirTab(p.tab)}
              className="flex h-full w-full items-start gap-3 rounded-2xl border border-line bg-paper p-3.5 text-left transition-colors duration-rapido hover:border-paperEdge hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
            >
              <p.icono size={18} className="mt-0.5 shrink-0 text-mute" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-meta font-semibold text-ink">
                  {p.titulo}
                  <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
                </span>
                <span className="mt-0.5 block text-rotulo leading-snug text-inkSoft">{p.texto}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section aria-labelledby="relato-registros" className="space-y-1.5">
        <h3 id="relato-registros" className="font-display text-cuerpo font-bold text-ink">
          Registros que se cruzaron
        </h3>
        {fuentes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {fuentes.map((f) => (
              <li key={f} className="pill border-line bg-paperSoft text-inkSoft">
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-mute">Este análisis no guardó qué registros cruzó.</p>
        )}
      </section>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
        <EnlaceFuente href={oeceProcesoUrl(conv.ocid || conv.codigo)}>Ver el proceso en el OECE</EnlaceFuente>
        {ocidContrato && (
          <Link href={`/app/contratos/${encodeURIComponent(ocidContrato)}`} className="inline-flex min-h-6 items-center gap-1 font-medium text-granate hover:underline">
            Documentos oficiales y citas por página <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </p>
    </div>
  );
}
