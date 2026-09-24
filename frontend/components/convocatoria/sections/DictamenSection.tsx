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
  "prose-headings:font-serif prose-headings:text-ink prose-headings:font-bold prose-headings:tracking-tight",
  "prose-h1:text-2xl prose-h1:mt-0 prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-heroViolet",
  "prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-3 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-line",
  "prose-h3:text-base prose-h3:mt-7 prose-h3:mb-2 prose-h3:text-heroViolet prose-h3:font-bold",
  "prose-h4:text-sm prose-h4:mt-5 prose-h4:mb-1.5 prose-h4:font-bold prose-h4:text-ink",
  "prose-p:text-ink prose-p:leading-[1.7] prose-p:my-3.5",
  "prose-strong:text-ink prose-strong:font-bold",
  "prose-em:text-inkSoft prose-em:italic",
  "prose-ul:my-3 prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-1.5",
  "prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1.5",
  "prose-li:text-ink prose-li:leading-relaxed prose-li:marker:text-heroViolet",
  "prose-a:text-heroViolet prose-a:font-medium prose-a:underline prose-a:decoration-heroViolet/40 hover:prose-a:decoration-heroViolet",
  "prose-a:break-words",
  "prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-heroViolet prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
  "prose-blockquote:border-l prose-blockquote:border-heroViolet/50 prose-blockquote:bg-paperSoft prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:my-4 prose-blockquote:rounded-r prose-blockquote:text-inkSoft prose-blockquote:not-italic",
  "prose-table:text-xs prose-table:w-full prose-table:border-collapse",
  "prose-th:bg-paperDeep prose-th:text-ink prose-th:font-bold prose-th:uppercase prose-th:tracking-wider prose-th:text-[10px] prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-line",
  "prose-td:text-ink prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-line prose-td:align-top",
  "prose-hr:my-6 prose-hr:border-line",
);

const COMPONENTES: Components = {
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
          "text-heroViolet font-medium hover:text-heroViolet-deep transition-colors",
          isLongUrl ? "inline-flex items-center gap-1 max-w-full" : "underline decoration-heroViolet/40 hover:decoration-heroViolet",
        )}
        title={typeof href === "string" ? href : undefined}
      >
        {isLongUrl ? (
          <>
            <span className="truncate max-w-[36ch] underline decoration-heroViolet/40">{String(children)}</span>
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
    <section className="surface overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
        <div>
          <h2 className="font-serif text-xl font-bold text-ink">Dictamen periodístico</h2>
          <div className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-mute">
            <FileText size={11} aria-hidden />
            Redactado por el agente de dictamen{modelo ? ` con ${modelo}` : ""}, con la evidencia de los demás agentes
          </div>
        </div>
        <button
          type="button"
          onClick={copiarDictamen}
          aria-live="polite"
          title="Copia el texto con los datos personales ya ocultos"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
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
                <span className="block font-serif text-base font-bold text-ink">{TITULO_LLANO_LIMITES}</span>
                <span className="block text-[12px] leading-snug text-mute">
                  Lo que no se pudo comprobar y lo que quedó fuera de la lectura de los documentos.
                </span>
              </span>
              <ChevronDown size={16} className="mt-1 shrink-0 text-mute transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-line px-4 pb-2 [&>h3:first-child]:mt-4">
              <Md texto={partes.limites} />
            </div>
          </details>
        )}
        {partes.despues.trim() && <Md texto={partes.despues} />}
      </article>
    </section>
  );
}
