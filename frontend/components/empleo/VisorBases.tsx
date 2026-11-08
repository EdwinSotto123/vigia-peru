"use client";

import { useState } from "react";
import { ArrowUpRight, Download, FileText, Loader2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";
import { documentoPrincipal, urlDocumento, useBasesPlaza, type BasesPlaza } from "./datosPlaza";

type Documento = BasesPlaza["documentos"][number];

/**
 * ¿Se puede ver el PDF dentro de la página? Con la copia que guardamos (es de nuestro dominio) y un navegador que
 * muestra PDF (Chrome en Android no: `pdfViewerEnabled` es false y abre el archivo aparte).
 */
function seVeAqui(d: Documento): boolean {
  if (!d.copia) return false;
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { pdfViewerEnabled?: boolean }) : null;
  return nav?.pdfViewerEnabled !== false;
}

/**
 * Las bases dentro de la ficha (2026-11-08, el usuario: «sin botón de previsualizar bases»): el PDF en un panel, con
 * los otros documentos de la convocatoria arriba, descargar y abrir en otra pestaña. Donde el navegador no muestra PDF
 * (el celular), «Ver» abre el archivo aparte.
 */
export function VisorBases({ documentos, inicial, abierto, onCerrar }: { documentos: Documento[]; inicial: number; abierto: boolean; onCerrar: () => void }) {
  const [i, setI] = useState(inicial);
  const [visto, setVisto] = useState(inicial);
  // Al abrir con otro documento, ése.
  if (abierto && inicial !== visto) {
    setVisto(inicial);
    setI(inicial);
  }
  const d = documentos[i] ?? documentos[0];
  if (!d) return null;
  const url = urlDocumento(d);
  const boton = "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:bg-paperDeep hover:text-ink";
  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={d.titulo}
      descripcion={
        d.copia ? (
          <>
            La copia que guardamos de la web de la entidad.{" "}
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-inkSoft underline underline-offset-2 hover:text-ink">
              Ver el original
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </>
        ) : (
          "En la web de la entidad"
        )
      }
      posicion="centro"
      ancho="xl"
      className="h-[92dvh] max-h-[92dvh] sm:max-w-5xl"
      acciones={
        <>
          {d.copia && (
            <a href={url} download className={boton}>
              <Download size={15} aria-hidden /> <span className="hidden sm:inline">Descargar</span>
              <span className="sr-only sm:hidden">Descargar</span>
            </a>
          )}
          <a href={url} target="_blank" rel="noopener noreferrer" className={boton}>
            <ArrowUpRight size={15} aria-hidden /> <span className="hidden sm:inline">Otra pestaña</span>
            <span className="sr-only">{" "}(abrir en otra pestaña)</span>
          </a>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        {documentos.length > 1 && (
          <div role="tablist" aria-label="Documentos de la convocatoria" className="flex shrink-0 gap-1 overflow-x-auto rounded-lg bg-ink/[0.06] p-1 [scrollbar-width:none]">
            {documentos.map((x, k) => (
              <button
                key={x.url}
                type="button"
                role="tab"
                aria-selected={k === i}
                onClick={() => setI(k)}
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-meta font-semibold transition-colors duration-rapido",
                  k === i ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                )}
              >
                <FileText size={13} aria-hidden /> {x.titulo}
              </button>
            ))}
          </div>
        )}
        {seVeAqui(d) ? (
          <iframe key={url} src={url} title={d.titulo} className="block min-h-[60dvh] w-full flex-1 rounded-xl border border-line bg-paper" />
        ) : (
          <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-line p-6 text-center">
            <div>
              <p className="text-dato text-inkSoft">Este documento se abre en la web de la entidad.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-granate px-5 text-dato font-semibold text-paper">
                Abrirlo <ArrowUpRight size={15} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Abre un documento: en el panel si se ve aquí; si no, en otra pestaña. Devuelve si abrió el panel. */
export function abrirDocumento(d: Documento, panel: () => void) {
  if (seVeAqui(d)) panel();
  else window.open(urlDocumento(d), "_blank", "noopener,noreferrer");
}

/**
 * «Ver las bases» en la cabecera de la ficha: mientras las buscamos, «Buscando las bases…»; con ellas, abre la que
 * leímos; sin ellas, nada (la caja «Las bases» explica por qué).
 */
export function BotonVerBases({ aviso, className }: { aviso: number; className?: string }) {
  const { data, isLoading } = useBasesPlaza(aviso);
  const [abierto, setAbierto] = useState(false);
  const principal = documentoPrincipal(data);
  if (isLoading) {
    return (
      <span aria-live="polite" className={cn(className, "cursor-default text-inkSoft")}>
        <Loader2 size={15} aria-hidden className="animate-spin" /> Buscando las bases…
      </span>
    );
  }
  if (!data || !principal) return null;
  const docs = data.documentos;
  return (
    <>
      <button type="button" onClick={() => abrirDocumento(principal, () => setAbierto(true))} className={className}>
        <FileText size={15} aria-hidden /> Ver las bases
      </button>
      <VisorBases documentos={docs} inicial={Math.max(0, docs.indexOf(principal))} abierto={abierto} onCerrar={() => setAbierto(false)} />
    </>
  );
}
