"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertTriangle, Check, Copy, Download, FileSpreadsheet, FileText, Printer, Table2 } from "lucide-react";
import { claseBoton } from "@/components/admin/ui";
import type { Paso } from "./conversacion";
import {
  bajar,
  contarTablas,
  documentoImpresion,
  htmlDeRespuesta,
  imprimir,
  informeExcel,
  informeWord,
  nombreBase,
  tablasCsv,
  type MetaInforme,
} from "./exportar";

/**
 * «Descargar» debajo de cada respuesta del chat: Word, PDF, Excel y CSV (estos dos sólo si la respuesta trae tablas), y
 * «Copiar», que deja la respuesta con formato para pegarla en Word o Google Docs (y en markdown donde no hay formato).
 * Todo se arma en el navegador (exportar.ts) con lo que ya se ve en la pantalla.
 */
export function Descargas({
  texto,
  pregunta,
  modelo,
  pasos,
  contenido,
}: {
  texto: string;
  pregunta: string | null;
  modelo: string | null;
  pasos: Paso[];
  /** La respuesta ya pintada: de ahí sale el PDF y el «Copiar» con formato. */
  contenido: RefObject<HTMLDivElement | null>;
}) {
  const tablas = useMemo(() => contarTablas(texto), [texto]);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloj = useRef<number | null>(null);
  useEffect(() => () => {
    if (reloj.current) window.clearTimeout(reloj.current);
  }, []);

  const meta = (): MetaInforme => ({
    pregunta,
    fecha: new Date(),
    modelo,
    consultas: pasos.flatMap((p) => (p.tipo === "herramienta" && p.estado === "listo" ? [p.titulo] : [])),
  });

  const hacer = (accion: () => void) => {
    setError(null);
    try {
      accion();
    } catch (e) {
      setError(`No se pudo armar el archivo: ${(e as Error)?.message ?? "error desconocido"}.`);
    }
  };

  const respuestaPintada = () => {
    const el = contenido.current?.firstElementChild;
    if (!el) throw new Error("la respuesta todavía no está en pantalla");
    return htmlDeRespuesta(el);
  };

  const word = () =>
    hacer(() => {
      const m = meta();
      bajar(informeWord(texto, m), `${nombreBase(m)}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    });
  const pdf = () =>
    hacer(() => {
      const m = meta();
      imprimir(documentoImpresion(respuestaPintada(), m), nombreBase(m));
    });
  const excel = () =>
    hacer(() => {
      const m = meta();
      bajar(informeExcel(texto, m), `${nombreBase(m)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });
  const csv = () =>
    hacer(() => {
      const r = tablasCsv(texto, meta());
      if (r) bajar(r.datos, r.nombre, r.tipo);
    });
  const copiar = async () => {
    setError(null);
    try {
      let html: string | null = null;
      try {
        html = respuestaPintada();
      } catch {
        /* sin la respuesta pintada: sólo el texto */
      }
      if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([texto], { type: "text/plain" }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(texto);
      }
      setCopiado(true);
      if (reloj.current) window.clearTimeout(reloj.current);
      reloj.current = window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError("El navegador no dejó copiar. Selecciona el texto y cópialo a mano.");
    }
  };

  return (
    <div className="border-t border-line px-4 py-2.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-meta font-medium text-inkSoft">
          <Download size={13} className="text-mute" aria-hidden /> Descargar
        </span>
        <button type="button" onClick={word} title="El informe en Word (.docx), con sus tablas y enlaces" className={claseBoton("secundario", "sm")}>
          <FileText size={13} aria-hidden /> Word
        </button>
        <button type="button" onClick={pdf} title="Abre la ventana de imprimir: elige «Guardar como PDF»" className={claseBoton("secundario", "sm")}>
          <Printer size={13} aria-hidden /> PDF
        </button>
        {tablas > 0 && (
          <>
            <button type="button" onClick={excel} title="Cada tabla en su hoja, con las cifras como números" className={claseBoton("secundario", "sm")}>
              <FileSpreadsheet size={13} aria-hidden /> Excel
            </button>
            <button
              type="button"
              onClick={csv}
              title={tablas > 1 ? `Un ZIP con un CSV por cada una de las ${tablas} tablas` : "La tabla en CSV"}
              className={claseBoton("secundario", "sm")}
            >
              <Table2 size={13} aria-hidden /> CSV
            </button>
          </>
        )}
        <button type="button" onClick={() => void copiar()} title="Copia la respuesta con formato, para pegarla en Word o Google Docs" className={claseBoton("fantasma", "sm", "sm:ml-auto")}>
          {copiado ? <Check size={13} className="text-mossTexto" aria-hidden /> : <Copy size={13} aria-hidden />}
          <span aria-live="polite">{copiado ? "Copiada" : "Copiar"}</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 flex items-start gap-2 text-meta text-crimsonTexto">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </p>
      )}
    </div>
  );
}
