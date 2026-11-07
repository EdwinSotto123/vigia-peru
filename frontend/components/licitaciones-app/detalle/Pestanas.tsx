import Link from "next/link";
import { cn } from "@/lib/utils";

export const PESTANAS = ["resumen", "items", "documentos", "cronograma", "analisis", "asistente", "notas", "historial", "postulacion"] as const;
export type Pestana = (typeof PESTANAS)[number];

export const NOMBRE_PESTANA: Record<Pestana, string> = {
  resumen: "Resumen",
  items: "Ítems",
  documentos: "Documentos",
  cronograma: "Cronograma",
  analisis: "Análisis",
  asistente: "Asistente",
  notas: "Notas",
  historial: "Historial",
  postulacion: "Postulación",
};

/** La pestaña de la URL; «comentarios» (los enlaces de antes) es «notas». */
export const leerPestana = (t: string | undefined): Pestana => {
  const x = t === "comentarios" ? "notas" : t;
  return (PESTANAS as readonly string[]).includes(x ?? "") ? (x as Pestana) : "resumen";
};

/**
 * Las pestañas del detalle como enlaces (?tab=): cada una se puede compartir y el botón Atrás vuelve a la anterior. Van
 * pegadas bajo la cabecera de la app al bajar; en el celular se deslizan de costado.
 */
export function Pestanas({ actual, href, cuentas }: { actual: Pestana; href: (p: Pestana) => string; cuentas: Partial<Record<Pestana, number>> }) {
  return (
    <nav aria-label="Secciones del proceso" className="sticky top-16 z-20 -mx-4 mb-6 border-b border-line bg-lienzo/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PESTANAS.map((p) => (
          <li key={p} className="shrink-0">
            <Link
              href={href(p)}
              scroll={false}
              aria-current={p === actual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-dato font-semibold transition-colors duration-rapido",
                p === actual ? "border-granate text-ink" : "border-transparent text-inkSoft hover:border-ink/20 hover:text-ink",
              )}
            >
              {NOMBRE_PESTANA[p]}
              {cuentas[p] != null && cuentas[p]! > 0 && (
                <span className={cn("rounded-full px-1.5 text-rotulo tabular-nums", p === actual ? "bg-granate-50 text-granate" : "bg-ink/[0.06] text-inkSoft")}>{cuentas[p]}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
