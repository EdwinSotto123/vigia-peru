"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { oeceProcesoUrl } from "../utils";

export function ShareableHeader({
  conv,
  codigo,
  nAlta,
  totalSec,
  eventsADK,
  onReset,
}: {
  conv: any;
  codigo: string;
  nAlta: number;
  totalSec?: number;
  eventsADK: number;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  const handleShare = async () => {
    try {
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/app/convocatoria/${codigo}`;
      if (navigator.share) {
        await navigator.share({
          title: `Vigía Perú · ${conv.objeto?.slice(0, 80) || "Análisis"}`,
          text: `Análisis automático de la convocatoria ${codigo}: ${nAlta} bandera${nAlta === 1 ? "" : "s"} de alta severidad. Verificalo:`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // user cancelled share dialog
    }
  };

  const oeceUrl = oeceProcesoUrl(conv.ocid || codigo);

  return (
    <header className="surface px-4 py-3">
      {/* TOP ROW: código + acciones */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-mute">#{codigo}</span>
        {conv.fecha_fin && (
          <span className="text-[11px] text-mute">· Buena pro {conv.fecha_fin}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-semibold text-ink hover:bg-paperDeep"
            title="Nueva búsqueda"
          >
            <RotateCcw size={10} /> Nueva
          </button>
          <a
            href={oeceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-semibold text-ink hover:bg-paperDeep"
            title="Ver en portal oficial OECE"
          >
            <ExternalLink size={10} /> OECE
          </a>
          <button
            type="button"
            onClick={handleShare}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-paper transition-colors",
              copied ? "bg-moss" : "bg-heroViolet hover:bg-heroViolet/90",
            )}
            title={copied ? "Link copiado" : "Copiar link compartible"}
          >
            {copied ? (
              <><CheckCircle2 size={11} /> Copiado</>
            ) : (
              <><Sparkles size={11} /> Compartir</>
            )}
          </button>
        </span>
      </div>

      {/* OBJETO — h2 más compacto */}
      <h1 className="mt-2 font-serif text-lg font-bold leading-snug text-ink sm:text-xl">
        {conv.objeto}
      </h1>
    </header>
  );
}
