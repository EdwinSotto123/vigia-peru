import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EstadoContratoPill } from "./ContratosLista";
import { limpiarObjeto, recortar } from "./recortar";
import { fechaCorta, solesCompacto } from "@/lib/formato";
import type { ContratoResumen } from "@/lib/contratos";

/**
 * "Más contratos de esta entidad": hasta 5 filas, una línea cada una (objeto, fecha, estado y valor).
 * Va bajo el estado de lectura cuando la ficha es corta (contrato sin leer) para que la persona tenga
 * adónde seguir en vez de una pantalla a medio llenar. Datos reales de /contratos?entidad=; si no hay otros,
 * no se dibuja. Server-safe.
 */
export function OtrosContratosEntidad({
  entidad,
  entidadRuc,
  contratos,
  total,
  titulo,
  verHref,
  idSeccion = "otros-contratos",
  compacta = false,
}: {
  entidad: string | null;
  entidadRuc: string;
  contratos: ContratoResumen[];
  total: number;
  /** Otro encabezado (p. ej. "Contratos parecidos en la provincia") y su enlace "Ver todos". */
  titulo?: string;
  verHref?: string;
  idSeccion?: string;
  /** Sin la píldora de estado: para la columna lateral angosta. */
  compacta?: boolean;
}) {
  if (contratos.length === 0) return null;
  const quedan = total - contratos.length;
  return (
    <section aria-labelledby={idSeccion} className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 id={idSeccion} className="text-[13px] font-semibold text-ink">
          {titulo ?? `Otros procesos de ${entidad ? recortar(entidad, 60) : "esta entidad"}`}
        </h2>
        <Link
          href={verHref ?? `/app/contratos?entidad=${entidadRuc}`}
          className="text-[13px] font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          Ver {quedan > 0 ? `los ${total.toLocaleString("es-PE")}` : "todos"}
        </Link>
      </div>
      <p className="text-[12px] leading-snug text-mute">
        {titulo ? "Otras convocatorias, no relacionadas con esta." : "Otras convocatorias de la misma entidad, no relacionadas con esta."}{" "}
        {compacta ? "" : "La etiqueta dice si Vigía ya revisó su expediente."}
      </p>
      <ul className="divide-y divide-line">
        {contratos.map((c) => (
          <li key={c.ocid}>
            <Link
              href={`/app/contratos/${encodeURIComponent(c.ocid)}`}
              className="group flex items-center gap-3 py-2 transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink sm:line-clamp-1">{recortar(c.titulo ? limpiarObjeto(c.titulo) : `Contrato ${c.codigo}`, 110)}</span>
                <span className="block text-[12px] text-mute tabular-nums">{c.fecha ? `Convocado el ${fechaCorta(c.fecha)}` : "Sin fecha de convocatoria"}</span>
              </span>
              <span className={compacta ? "hidden" : "hidden shrink-0 sm:block"}>
                <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />
              </span>
              <span className={compacta ? "w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-inkSoft" : "w-24 shrink-0 text-right font-mono text-[12.5px] tabular-nums text-inkSoft"}>
                {c.montoPen ? solesCompacto(c.montoPen) : <span className="font-sans text-[11.5px] text-mute">sin monto publicado</span>}
              </span>
              <ChevronRight size={14} className="shrink-0 text-mute group-hover:text-granate" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
