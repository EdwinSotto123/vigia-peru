import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const ES_SEACE = /^https?:\/\/[a-z0-9.-]*seace\.gob\.pe(?::\d+)?\//i;

/** ¿El enlace lleva a un documento del SEACE (prod1, prod4…)? */
export const esDocumentoSeace = (url: string | null | undefined): url is string => !!url && ES_SEACE.test(url);

/** La copia del documento que guarda Vigía; si no la tiene, esa ruta redirige al SEACE. */
export const copiaDeDocumento = (url: string) => `/v1/documentos/copia?u=${encodeURIComponent(url)}`;

const ENLACE = "font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/**
 * El enlace a un documento del expediente. La descarga del SEACE falla a menudo (error 502): si el documento es del SEACE,
 * el enlace principal es la copia que guarda Vigía (`/v1/documentos/copia`, que redirige al SEACE si no la tiene) y el
 * SEACE queda al lado como alternativa. Cualquier otro enlace va tal cual. El mismo criterio que la evidencia de los
 * cruces (contratos/CrucesProveedor, `TextoLeido`).
 */
export function EnlaceDocumento({ url, children = "Ver el documento", className }: { url: string; children?: React.ReactNode; className?: string }) {
  if (!esDocumentoSeace(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1", ENLACE, className)}>
        {children} <ExternalLink size={11} className="shrink-0" aria-hidden />
      </a>
    );
  }
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5", className)}>
      <a href={copiaDeDocumento(url)} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1", ENLACE)}>
        {children} <ExternalLink size={11} className="shrink-0" aria-hidden />
      </a>
      <span className="text-rotulo text-mute">
        (copia de Vigía; también{" "}
        <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
          en el SEACE
        </a>
        )
      </span>
    </span>
  );
}
