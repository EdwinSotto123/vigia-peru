"use client";

import { useContext, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { oeceProcesoUrl } from "../utils";
import { NivelTituloDossier } from "./nivelTitulo";

/**
 * Cabecera del dossier: QUÉ se contrató (el título, único h1 de la página), su código y las
 * acciones (otro contrato, ver en el OECE, compartir). Quién compra, quién ganó, cuánto y
 * cuándo van justo debajo, en la ficha (./FichaContrato).
 *
 * El texto que se comparte no lleva conteos de severidad: el enlace es el informe, y el
 * informe los dice con su evidencia.
 */
export function ShareableHeader({
  conv,
  codigo,
  onReset,
  compartible = true,
}: {
  conv: any;
  codigo: string;
  /** Ya no se muestran: se aceptan para no romper a quien todavía los pase. */
  nAlta?: number;
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
          text: `Análisis del contrato ${codigo}, con cada señal, su norma y su evidencia. Revísalo tú:`,
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
  const accion =
    "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-paperDeep";

  return (
    <header>
      {/* Fila superior: código a la izquierda (envuelve si falta ancho), acciones a la derecha. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 text-[13px] text-mute">
          Convocatoria <span className="font-mono font-semibold text-inkSoft">{codigo}</span>
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {onReset && (
            <button type="button" onClick={onReset} className={accion}>
              <ArrowLeft size={13} aria-hidden /> Otro contrato
            </button>
          )}
          <a href={oeceUrl} target="_blank" rel="noreferrer" className={accion}>
            <ExternalLink size={13} aria-hidden /> Ver en el OECE
          </a>
          {compartible && (
            <button
              type="button"
              onClick={handleShare}
              aria-live="polite"
              className={cn(
                "inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-paper transition-colors",
                copied ? "bg-mossTexto" : "bg-granate hover:bg-granate-deep",
              )}
            >
              {copied ? (
                <>
                  <CheckCircle2 size={13} aria-hidden /> Enlace copiado
                </>
              ) : (
                <>
                  <Share2 size={13} aria-hidden /> Compartir
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <Titulo className="mt-2 max-w-4xl break-words font-display text-[24px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[30px]">
        {objetoCompleto(conv.objeto) || "Contrato sin objeto registrado"}
      </Titulo>
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
