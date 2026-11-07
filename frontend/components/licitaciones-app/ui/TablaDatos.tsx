import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La tabla de datos de la app. Desde md, una tabla de verdad (encabezados, columnas que aparecen según el ancho y orden
 * por columna con enlaces: el orden queda en la URL y el botón Atrás lo deshace). En el celular, cada fila se vuelve una
 * tarjeta (`tarjeta`), porque siete columnas no entran en 375 px.
 *
 * Server-safe: las celdas pueden traer componentes del cliente (el botón de seguir).
 */
export interface Columna<T> {
  clave: string;
  titulo: ReactNode;
  celda: (fila: T) => ReactNode;
  /** Desde qué ancho se muestra (por defecto, siempre que hay tabla). */
  desde?: "lg" | "xl";
  alinear?: "derecha" | "centro";
  /** Ancho fijo o mínimo de la columna. */
  className?: string;
  /** Si se puede ordenar por ella: el enlace y si está activa. */
  orden?: { href: string; activa: boolean; dir: "asc" | "desc"; etiqueta: string };
}

const DESDE = { lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" } as const;
const ALINEAR = { derecha: "text-right", centro: "text-center" } as const;

export function TablaDatos<T>({
  filas, columnas, claveFila, tarjeta, titulo,
}: {
  filas: T[];
  columnas: Columna<T>[];
  claveFila: (f: T) => string;
  /** La fila como tarjeta, en el celular. */
  tarjeta: (f: T) => ReactNode;
  /** El título de la tabla, para el lector de pantalla. */
  titulo: string;
}) {
  return (
    <>
      {/* relative: los textos sólo para el lector de pantalla (sr-only, absolutos) se quedan dentro y no ensanchan la página. */}
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-dato">
          <caption className="sr-only">{titulo}</caption>
          <thead>
            <tr className="border-b border-line bg-ink/[0.025]">
              {columnas.map((c) => (
                <th
                  key={c.clave}
                  scope="col"
                  aria-sort={c.orden?.activa ? (c.orden.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("whitespace-nowrap px-3 py-2.5 text-meta font-semibold text-mute first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.desde && DESDE[c.desde], c.alinear && ALINEAR[c.alinear], c.className)}
                >
                  {c.orden ? (
                    <Link
                      href={c.orden.href}
                      scroll={false}
                      className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors duration-rapido hover:text-ink", c.orden.activa && "text-ink")}
                    >
                      {c.titulo}
                      {c.orden.activa ? (
                        c.orden.dir === "asc" ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />
                      ) : (
                        <ArrowUpDown size={13} aria-hidden className="opacity-50" />
                      )}
                      <span className="sr-only">{c.orden.activa ? ", orden actual" : `, ordenar por ${c.orden.etiqueta}`}</span>
                    </Link>
                  ) : (
                    c.titulo
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={claveFila(f)} className="group align-top transition-colors duration-rapido hover:bg-ink/[0.025]">
                {columnas.map((c) => (
                  <td key={c.clave} className={cn("px-3 py-3.5 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.desde && DESDE[c.desde], c.alinear && ALINEAR[c.alinear], c.className)}>
                    {c.celda(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden" aria-label={titulo}>
        {filas.map((f) => (
          <li key={claveFila(f)}>{tarjeta(f)}</li>
        ))}
      </ul>
    </>
  );
}
