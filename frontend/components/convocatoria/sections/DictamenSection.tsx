"use client";

/**
 * La pestaña Dictamen del dossier: el texto del agente que lo redacta, con los datos personales en
 * vidrio y un botón para copiarlo ya censurado. Salió de ResultadoView (que pasaba las 800 líneas).
 *
 * La sección "Recortes y datos no verificables" que el dictamen trae siempre se muestra plegada al
 * final de su lugar, como "Límites de esta revisión", con el vocabulario interno suavizado (ver
 * ../limitesDictamen.ts). El resto del texto se pinta igual que antes.
 */

import { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, ChevronDown, Copy, ExternalLink, FileText, ScanSearch } from "lucide-react";
import { maskDnis, redactChildren } from "../../Redact";
import { cn } from "@/lib/utils";
import { dictamenLimpio, separarLimites, TITULO_LLANO_LIMITES } from "../limitesDictamen";

export type NombreConocido = string | null | undefined | { nombre: string | null | undefined; orden: "sunat" | "nombres-primero" };

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

const PROSA = cn(
  // Medida de lectura: el dictamen es prosa larga; 68ch se lee sin esfuerzo.
  "mx-auto max-w-[68ch] px-4 py-8 sm:px-6",
  "prose prose-sm lg:prose-base",
  // Los títulos del markdown bajan dos niveles (ver COMPONENTES): "#" → h3, "##" → h4, "###" → h5,
  // "####" → h6. Así el dictamen no trae un segundo h1 a la página ni salta niveles bajo el h2
  // "Dictamen". Se estilan por etiqueta real, con el mismo aspecto que tenían antes.
  "[&_h3]:font-display [&_h4]:font-display [&_h5]:font-display [&_h6]:font-display",
  "[&_h3]:font-bold [&_h4]:font-bold [&_h5]:font-bold [&_h6]:font-bold [&_h3]:tracking-tight [&_h4]:tracking-tight",
  "[&_h3]:text-ink [&_h4]:text-ink [&_h5]:text-ink [&_h6]:text-ink",
  "[&_h3]:text-2xl [&_h3]:mt-0 [&_h3]:mb-3 [&_h3]:pb-2 [&_h3]:border-b [&_h3]:border-line",
  "[&_h4]:text-xl [&_h4]:mt-10 [&_h4]:mb-3 [&_h4]:pb-1.5 [&_h4]:border-b [&_h4]:border-line",
  "[&_h5]:text-base [&_h5]:mt-7 [&_h5]:mb-2",
  "[&_h6]:text-sm [&_h6]:mt-5 [&_h6]:mb-1.5",
  "prose-p:text-ink prose-p:leading-[1.7] prose-p:my-3.5",
  "prose-strong:text-ink prose-strong:font-bold",
  "prose-em:text-inkSoft prose-em:italic",
  "prose-ul:my-3 prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1.5",
  "prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1.5",
  "prose-li:text-ink prose-li:leading-relaxed prose-li:marker:text-mute",
  "prose-a:text-granate prose-a:font-medium prose-a:underline prose-a:decoration-granate/40 hover:prose-a:decoration-granate",
  "prose-a:break-words",
  "prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-ink prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
  "prose-blockquote:border-l-2 prose-blockquote:border-line prose-blockquote:bg-paperSoft prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:my-4 prose-blockquote:rounded-r-xl prose-blockquote:text-inkSoft prose-blockquote:not-italic",
  "prose-table:text-xs prose-table:w-full prose-table:border-collapse",
  "prose-th:bg-paperDeep prose-th:text-ink prose-th:font-semibold prose-th:text-[12px] prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-line",
  "prose-td:text-ink prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-line prose-td:align-top",
  "prose-hr:my-6 prose-hr:border-line",
);

const COMPONENTES: Components = {
  h1: ({ node, ...props }) => <h3 {...props} />,
  h2: ({ node, ...props }) => <h4 {...props} />,
  h3: ({ node, ...props }) => <h5 {...props} />,
  h4: ({ node, ...props }) => <h6 {...props} />,
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
          "text-granate font-medium hover:text-granate-deep transition-colors",
          isLongUrl ? "inline-flex items-center gap-1 max-w-full" : "underline decoration-granate/40 hover:decoration-granate",
        )}
        title={typeof href === "string" ? href : undefined}
      >
        {isLongUrl ? (
          <>
            <span className="truncate max-w-[36ch] underline decoration-granate/40">{String(children)}</span>
            <ExternalLink size={10} className="shrink-0" aria-hidden />
          </>
        ) : (
          children
        )}
      </a>
    );
  },
};

const Md = ({ texto }: { texto: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES}>
    {texto}
  </ReactMarkdown>
);

export function DictamenSection({
  dictamen,
  nombresPrivados,
  modelo,
}: {
  dictamen: string;
  /** Personas privadas conocidas: el texto copiado sale con su apellido tapado. */
  nombresPrivados: NombreConocido[];
  /** Modelo que redactó el dictamen, solo si el análisis lo trae. */
  modelo?: string | null;
}) {
  const partes = useMemo(() => separarLimites(dictamen), [dictamen]);

  // ─── Copiar el dictamen, ya censurado ───
  // Se copia lo que la página muestra: la sección de recortes suavizada y bajo su título llano,
  // no el bloque crudo (claves internas, restos de JSON) que la pantalla no enseña.
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  const copiarDictamen = async () => {
    try {
      await navigator.clipboard.writeText(redactarTextoPlano(dictamenLimpio(partes), nombresPrivados));
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
    setTimeout(() => setCopiado(null), 2500);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperSoft px-5 py-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">Dictamen</h2>
          <div className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-mute">
            <FileText size={12} aria-hidden />
            Redactado automáticamente{modelo ? ` (${modelo})` : ""} con la evidencia del análisis. Los datos personales van tapados.
          </div>
        </div>
        <button
          type="button"
          onClick={copiarDictamen}
          aria-live="polite"
          title="Copia el texto con los datos personales ya ocultos"
          className={cn(
            "inline-flex min-h-[32px] items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
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
      <article className={PROSA}>
        <Md texto={partes.antes} />
        {partes.limites && (
          <details className="group my-8 rounded-xl border border-line bg-paperSoft">
            <summary className="flex cursor-pointer list-none items-start gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <ScanSearch size={16} className="mt-0.5 shrink-0 text-mute" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-bold text-ink">{TITULO_LLANO_LIMITES}</span>
                <span className="block text-[12px] leading-snug text-mute">
                  Lo que no se pudo comprobar y lo que quedó fuera de la lectura de los documentos.
                </span>
              </span>
              <ChevronDown size={16} className="mt-1 shrink-0 text-mute transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-line px-4 pb-2 [&>:first-child]:mt-4">
              <Md texto={partes.limites} />
            </div>
          </details>
        )}
        {partes.despues.trim() && <Md texto={partes.despues} />}
      </article>
    </section>
  );
}
