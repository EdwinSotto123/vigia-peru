"use client";

/**
 * La evidencia de una señal, venga como venga del backend.
 *
 * El campo `evidencia` cambió de forma sin aviso: primero era un string, ahora
 * en muchas secciones es una lista `[{cita, documento | url, pagina, …}]`. Un
 * `{c.evidencia}` pelado con la lista adentro tiraba "Objects are not valid as
 * a React child" y se llevaba el dossier entero. Toda evidencia se pinta por
 * acá: string o lista, cada cita pasa por `redactDnis` y lleva su fuente.
 */

import { ExternalLink, FileText } from "lucide-react";
import { redactDnis } from "../../Redact";
import { cn } from "@/lib/utils";

export interface CitaEvidencia {
  cita: string;
  url?: string | null;
  documento?: string | null;
  pagina?: number | null;
  verificada?: boolean | null;
}

/** Cualquier forma de `evidencia` → lista de citas. Nunca tira: lo que no se reconoce se descarta. */
export function normalizarEvidencia(e: unknown): CitaEvidencia[] {
  if (e == null) return [];
  if (typeof e === "string") return e.trim() ? [{ cita: e.trim() }] : [];
  if (typeof e === "number") return [{ cita: String(e) }];
  if (Array.isArray(e)) return e.flatMap((x) => normalizarEvidencia(x));
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const cita = typeof o.cita === "string" ? o.cita.trim() : typeof o.texto === "string" ? o.texto.trim() : "";
    if (!cita) return [];
    const pagina = Number(o.pagina ?? o.folio);
    return [
      {
        cita,
        url: typeof o.url === "string" ? o.url : null,
        documento: typeof o.documento === "string" ? o.documento : null,
        pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : null,
        verificada: typeof o.verificada === "boolean" ? o.verificada : null,
      },
    ];
  }
  return [];
}

/** La evidencia como texto plano (para un subtítulo o un `title`). */
export function evidenciaComoTexto(e: unknown): string {
  return normalizarEvidencia(e)
    .map((c) => c.cita)
    .join("; ");
}

/**
 * Nombres internos que el backend pone en `documento`/`url` cuando la cita no
 * salió de un documento público sino del propio contexto del análisis. No son
 * una fuente que la persona pueda abrir: se nombran en castellano o se omiten.
 */
const FUENTE_INTERNA: Record<string, string> = {
  person_network_context: "datos cruzados por el análisis de red",
  web_research: "investigación web",
  news_research: "búsqueda de prensa",
  entity_personnel: "funcionarios de la entidad",
  document_analysis: "lectura de los documentos",
};

const esUrl = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "fuente";
  }
}

/** Qué decir sobre de dónde salió una cita. `null` si no hay nada que la persona pueda usar. */
function fuenteDe(c: CitaEvidencia): { texto: string; href: string | null } | null {
  if (esUrl(c.url)) return { texto: hostDe(c.url!), href: c.url! };
  const interna = c.documento ?? c.url ?? null;
  if (interna && FUENTE_INTERNA[interna]) return { texto: FUENTE_INTERNA[interna], href: null };
  if (interna && /\s/.test(interna)) return { texto: interna, href: null };
  return null;
}

export function Evidencia({
  value,
  className,
  citaClassName,
}: {
  value: unknown;
  className?: string;
  citaClassName?: string;
}) {
  const citas = normalizarEvidencia(value);
  if (citas.length === 0) return null;
  // Un string suelto se lee como prosa, sin comillas ni viñeta.
  if (typeof value === "string") {
    return <p className={className}>{redactDnis(citas[0].cita)}</p>;
  }
  return (
    <ul className={cn("space-y-1", className)}>
      {citas.map((c, i) => {
        const f = fuenteDe(c);
        return (
          <li key={i} className="leading-relaxed">
            <q className={cn("italic", citaClassName)}>{redactDnis(c.cita)}</q>
            {(f || c.pagina != null) && (
              <span className="ml-1.5 inline-flex flex-wrap items-center gap-1 align-baseline text-[11px] not-italic text-mute">
                {c.pagina != null && (
                  <span className="inline-flex items-center gap-0.5">
                    <FileText size={9} aria-hidden /> pág. {c.pagina}
                  </span>
                )}
                {f &&
                  (f.href ? (
                    <a
                      href={f.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-granate hover:underline"
                    >
                      {f.texto} <ExternalLink size={9} aria-hidden />
                    </a>
                  ) : (
                    <span>({f.texto})</span>
                  ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
