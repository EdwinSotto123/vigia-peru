"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * La respuesta final del asistente, en markdown: react-markdown + remark-gfm, como el dictamen del informe
 * (components/convocatoria/sections/DictamenSection.tsx). Sin HTML crudo (react-markdown no lo pinta) y sin censura:
 * el panel es del equipo y el API ya aplica las reglas de privacidad del MCP.
 *
 * Los colores del plugin de tipografía son grises fijos: acá sus variables apuntan a los tokens, así la respuesta se
 * lee igual de día y de noche. Los títulos bajan dos niveles (# → h3) para no competir con el h1 de la página. Una
 * tabla se desliza de costado dentro de su propia caja; un enlace se abre en otra pestaña.
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

const COMPONENTES: Components = {
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
  a: ({ node, href, children, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-granate underline decoration-granate/40 underline-offset-2 transition-colors duration-rapido [overflow-wrap:anywhere] hover:decoration-granate"
    >
      {children}
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  ),
};

export const Respuesta = memo(function Respuesta({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={cn(PROSA, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES}>
        {texto}
      </ReactMarkdown>
    </div>
  );
});
