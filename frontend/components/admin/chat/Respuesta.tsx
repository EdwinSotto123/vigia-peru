"use client";

import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La respuesta final del asistente, en markdown: react-markdown + remark-gfm, como el dictamen del informe
 * (components/convocatoria/sections/DictamenSection.tsx). Sin HTML crudo (react-markdown no lo pinta) y sin censura:
 * el panel es del equipo y el API ya aplica las reglas de privacidad del MCP.
 *
 * Los colores del plugin de tipografía son grises fijos: acá sus variables apuntan a los tokens, así la respuesta se
 * lee igual de día y de noche. Los títulos bajan dos niveles (# → h3) para no competir con el h1 de la página. Una
 * tabla se desliza de costado dentro de su propia caja; un enlace se abre en otra pestaña.
 *
 * Lo que la revisión automática no encontró en los datos consultados (Revision.tsx) se marca en el texto: el enlace con
 * un triángulo y el monto resaltado, cada uno con el motivo al pasar el mouse. Las exportaciones lo quitan.
 */
const PROSA = cn(
  "prose prose-sm max-w-none text-ink",
  "[--tw-prose-body:rgb(var(--ink))] [--tw-prose-headings:rgb(var(--ink))] [--tw-prose-bold:rgb(var(--ink))]",
  "[--tw-prose-links:rgb(var(--granate))] [--tw-prose-counters:rgb(var(--mute))] [--tw-prose-bullets:rgb(var(--mute))]",
  "[--tw-prose-hr:rgb(var(--line))] [--tw-prose-quotes:rgb(var(--ink-soft))] [--tw-prose-quote-borders:rgb(var(--line))]",
  "[--tw-prose-captions:rgb(var(--mute))] [--tw-prose-code:rgb(var(--ink))] [--tw-prose-pre-code:rgb(var(--ink))]",
  "[--tw-prose-pre-bg:rgb(var(--paper-deep))] [--tw-prose-th-borders:rgb(var(--line))] [--tw-prose-td-borders:rgb(var(--line))]",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_h3]:font-display [&_h4]:font-display [&_h5]:font-display [&_h6]:font-display",
  "[&_h3]:font-bold [&_h4]:font-bold [&_h5]:font-semibold [&_h6]:font-semibold [&_h3]:tracking-tight [&_h4]:tracking-tight",
  "[&_h3]:text-bloque [&_h3]:mb-2 [&_h3]:mt-5 [&_h4]:text-cuerpo [&_h4]:mb-1.5 [&_h4]:mt-4",
  "[&_h5]:text-dato [&_h5]:mb-1 [&_h5]:mt-3 [&_h6]:text-dato [&_h6]:mb-1 [&_h6]:mt-3",
  "prose-p:my-2.5 prose-p:leading-relaxed",
  "prose-ul:my-2.5 prose-ul:pl-5 prose-ol:my-2.5 prose-ol:pl-5 prose-li:my-1 prose-li:leading-relaxed",
  "prose-em:text-inkSoft",
  "prose-code:rounded prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:rounded-xl prose-pre:border prose-pre:border-line",
  "prose-blockquote:my-3 prose-blockquote:rounded-r-xl prose-blockquote:border-l-2 prose-blockquote:bg-paper prose-blockquote:px-4 prose-blockquote:py-1.5 prose-blockquote:font-normal prose-blockquote:not-italic",
  "[&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none",
  "prose-table:my-0 prose-th:whitespace-nowrap prose-th:border prose-th:border-line prose-th:bg-paperDeep prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold",
  "prose-td:min-w-[6rem] prose-td:border prose-td:border-line prose-td:px-3 prose-td:py-2 prose-td:align-top",
  "prose-hr:my-5",
);

type Nodo = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Nodo[] };

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Un plugin de rehype que envuelve en <mark> cada aparición de estos textos (montos por revisar), fuera del código. La
 * cifra no puede ser parte de otra más larga: «1,200» no marca «11,200.50».
 */
function marcarTextos(textos: Map<string, string>) {
  const lista = [...textos.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  const re = lista.length ? new RegExp(`(?<![\\d.,])(?:${lista.map(escapar).join("|")})(?![\\d])`, "g") : null;
  return () => (arbol: Nodo) => {
    if (!re) return;
    const recorrer = (n: Nodo) => {
      if (!n.children || n.tagName === "code" || n.tagName === "pre") return;
      const hijos: Nodo[] = [];
      for (const h of n.children) {
        if (h.type !== "text" || !h.value) {
          recorrer(h);
          hijos.push(h);
          continue;
        }
        let desde = 0;
        re.lastIndex = 0;
        for (let m = re.exec(h.value); m; m = re.exec(h.value)) {
          if (m.index > desde) hijos.push({ type: "text", value: h.value.slice(desde, m.index) });
          hijos.push({
            type: "element",
            tagName: "mark",
            properties: { "data-revision": "", title: textos.get(m[0]) ?? "Por revisar" },
            children: [{ type: "text", value: m[0] }],
          });
          desde = m.index + m[0].length;
        }
        if (desde < h.value.length) hijos.push({ type: "text", value: h.value.slice(desde) });
      }
      n.children = hijos;
    };
    recorrer(arbol);
  };
}

function componentes(enlacesPorRevisar: Map<string, string>): Components {
  return {
    h1: ({ node, ...props }) => <h3 {...props} />,
    h2: ({ node, ...props }) => <h4 {...props} />,
    h3: ({ node, ...props }) => <h5 {...props} />,
    h4: ({ node, ...props }) => <h6 {...props} />,
    // Una tabla ancha no empuja la página: se desliza dentro de su caja.
    table: ({ node, ...props }) => (
      <div className="scrollbar-warm my-3 max-w-full overflow-x-auto">
        <table {...props} />
      </div>
    ),
    a: ({ node, href, children, ...props }) => {
      const motivo = href ? enlacesPorRevisar.get(href) : undefined;
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={motivo ? `Por revisar: ${motivo}` : undefined}
          data-revision={motivo ? "" : undefined}
          className={cn(
            "font-medium underline underline-offset-2 transition-colors duration-rapido [overflow-wrap:anywhere]",
            motivo ? "text-amberTexto decoration-amber decoration-dotted" : "text-granate decoration-granate/40 hover:decoration-granate",
          )}
        >
          {children}
          {motivo && <AlertTriangle size={12} className="ml-0.5 inline-block align-[-1px]" aria-hidden />}
          <span className="sr-only">{motivo ? " (por revisar: no salió de los datos consultados)" : ""} (se abre en otra pestaña)</span>
        </a>
      );
    },
    mark: ({ node, children, ...props }) => (
      <mark {...props} className="rounded-sm bg-amber-soft px-0.5 text-ink underline decoration-amber decoration-dotted underline-offset-2">
        {children}
        <span className="sr-only"> (por revisar)</span>
      </mark>
    ),
  };
}

const SIN_MARCAS = new Map<string, string>();

export const Respuesta = memo(function Respuesta({
  texto,
  className,
  enlacesPorRevisar = SIN_MARCAS,
  montosPorRevisar = SIN_MARCAS,
}: {
  texto: string;
  className?: string;
  /** href → motivo, de la revisión automática. */
  enlacesPorRevisar?: Map<string, string>;
  /** monto tal como se escribió → motivo. */
  montosPorRevisar?: Map<string, string>;
}) {
  const comps = useMemo(() => componentes(enlacesPorRevisar), [enlacesPorRevisar]);
  const rehype = useMemo(() => [marcarTextos(montosPorRevisar)], [montosPorRevisar]);
  return (
    <div className={cn(PROSA, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehype} components={comps}>
        {texto}
      </ReactMarkdown>
    </div>
  );
});
