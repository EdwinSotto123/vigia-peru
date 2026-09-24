"use client";

import { useContext, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { oeceProcesoUrl } from "../utils";
import { NivelTituloDossier } from "./nivelTitulo";

export function ShareableHeader({
  conv,
  codigo,
  nAlta,
  onReset,
  compartible = true,
}: {
  conv: any;
  codigo: string;
  nAlta: number;
  /** Ya no se muestran: se aceptan para no romper a quien todavía los pase. */
  totalSec?: number;
  eventsADK?: number;
  /** Sin él no se muestra "Otro contrato" (la vista previa del panel admin no navega a otro). */
  onReset?: () => void;
  /** false: sin "Compartir" (una alerta en revisión todavía no tiene enlace público). */
  compartible?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // <h1> en la página pública; <h2> dentro de la vista previa del panel (ver ./nivelTitulo).
  const Titulo = useContext(NivelTituloDossier);

  const handleShare = async () => {
    try {
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/app/convocatoria/${codigo}`;
      if (navigator.share) {
        await navigator.share({
          title: `Vigía Perú: ${conv.objeto?.slice(0, 80) || "análisis de un contrato"}`,
          text: `Análisis automático de la convocatoria ${codigo}: ${nAlta} ${nAlta === 1 ? "señal" : "señales"} de severidad alta. Revísalo tú mismo:`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // la persona cerró el diálogo de compartir
    }
  };

  const oeceUrl = oeceProcesoUrl(conv.ocid || codigo);
  const buenaPro = conv.fecha_buena_pro ?? null;

  return (
    <header className="surface px-4 py-3">
      {/* Fila superior: código y fecha a la izquierda (se apilan si falta ancho), acciones a la derecha. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* min-w: sin piso, esta columna se encogía a cero en móvil y el código
            y la fecha quedaban debajo de los botones en vez de envolver. */}
        <div className="min-w-[9.5rem] flex-1">
          <div className="font-mono text-[12px] font-bold text-mute">#{codigo}</div>
          {buenaPro && <div className="whitespace-nowrap text-[12px] text-mute">Buena pro: {buenaPro}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[11px] font-semibold text-ink hover:bg-paperDeep"
            >
              <ArrowLeft size={11} aria-hidden /> Otro contrato
            </button>
          )}
          <a
            href={oeceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[11px] font-semibold text-ink hover:bg-paperDeep"
            title="Ver este proceso en el portal oficial del OECE"
          >
            <ExternalLink size={11} aria-hidden /> OECE
          </a>
          {compartible && (
            <button
              type="button"
              onClick={handleShare}
              aria-live="polite"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-paper transition-colors",
                copied ? "bg-mossTexto" : "bg-heroViolet hover:bg-heroViolet/90",
              )}
              title={copied ? "Enlace copiado" : "Copiar el enlace para compartir"}
            >
              {copied ? (
                <>
                  <CheckCircle2 size={11} aria-hidden /> Copiado
                </>
              ) : (
                <>
                  <Share2 size={11} aria-hidden /> Compartir
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <Titulo className="mt-2 break-words font-serif text-lg font-bold leading-snug text-ink sm:text-xl">{objetoCompleto(conv.objeto)}</Titulo>
    </header>
  );
}

/**
 * El objeto llega de SEACE cortado a 300 caracteres, a veces a mitad de un
 * paréntesis ("…EMP. CU-989 ("). Si viene al tope y no cierra en puntuación, se
 * marca como cortado en vez de parecer un título que termina en "(".
 */
function objetoCompleto(objeto?: string | null): string {
  const t = (objeto ?? "").trim();
  if (t.length < 295 || /[.…)"»]$/.test(t)) return t;
  return `${t.replace(/[\s(,;:-]+$/, "")}…`;
}
