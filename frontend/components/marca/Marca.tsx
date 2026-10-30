import { cn } from "@/lib/utils";
import { Isotipo } from "./Isotipo";

/**
 * La firma de Vigía (identidad Píxel): el ojo de puntos y el nombre en mono, con un
 * guion bajo que parpadea como el cursor de una terminal: `vigía_`.
 *
 * Por qué SVG + texto y no una imagen: un texto se selecciona, se copia, lo lee un
 * lector de pantalla sin depender de un `alt`, escala con el zoom y pesa cero.
 * El guion bajo es decorativo (aria-hidden); el nombre accesible es "Vigía Perú".
 *
 * `placaClara` es para una placa clara explícita (carbón sobre blanco). `tono` se
 * conserva por compatibilidad y se ignora: ahora todo fondo, claro u oscuro de banda,
 * es carbón. `isotipo={false}` deja sólo el nombre. `firma` agrega «by Gobserva» debajo
 * (Vigía es un producto de Gobserva, GovTech; pedido del usuario, 2026-10-29).
 */

const TAMANO = {
  sm: { texto: "text-destacado", iso: 22, nota: "text-micro" },
  md: { texto: "text-seccion", iso: 26, nota: "text-micro" },
  lg: { texto: "text-cifra", iso: 36, nota: "text-micro" },
} as const;

export function Marca({
  placaClara = false,
  tamano = "md",
  nota,
  isotipo = true,
  firma = false,
  className,
}: {
  /** Histórico (antes elegía entre fondo claro y oscuro). Se ignora. */
  tono?: "claro" | "oscuro";
  /** Sólo para una placa clara explícita: dibuja carbón sobre claro. */
  placaClara?: boolean;
  tamano?: keyof typeof TAMANO;
  /** Bajada opcional debajo del nombre, en versalitas. El pie la usa; el header no. */
  nota?: string;
  isotipo?: boolean;
  /** «by Gobserva» debajo del nombre: la portada y el pie. */
  firma?: boolean;
  className?: string;
}) {
  const t = TAMANO[tamano];
  const sobreClaro = placaClara;
  return (
    <span className={cn("inline-flex items-center gap-2.5 leading-none", className)} aria-label={firma ? "Vigía Perú, by Gobserva" : "Vigía Perú"} role="img">
      {isotipo && <Isotipo tamano={t.iso} tono={sobreClaro ? "claro" : "oscuro"} />}
      <span className="inline-flex flex-col" aria-hidden>
        {/* Colores por variable (globals.css: --marca-*): carbón y lima de noche, tinta y verde de día, claros sobre
            las bandas de marca. */}
        <span className={cn("font-mono font-bold tracking-[-0.06em]", t.texto, sobreClaro ? "text-[#0B0F0F]" : "text-[rgb(var(--marca-texto))]")}>
          vigía<span className={cn("cursor-parpadeo", sobreClaro ? "text-[#3E5C08]" : "text-[rgb(var(--marca-acento))]")}>_</span>
          <span className="ml-1.5 align-middle text-[max(11px,0.5em)] font-medium uppercase tracking-[0.16em] text-[rgb(var(--marca-nota))]">perú</span>
        </span>
        {nota && (
          <span className={cn("mt-1.5 font-mono font-medium uppercase tracking-[0.14em]", t.nota, "text-[rgb(var(--marca-nota))]")}>
            {nota}
          </span>
        )}
        {firma && (
          <span className={cn("mt-1 font-mono font-medium tracking-[0.04em]", t.nota, sobreClaro ? "text-[#3E5C08]" : "text-[rgb(var(--marca-nota))]")}>
            by <span className={cn("font-bold", sobreClaro ? "text-[#0B0F0F]" : "text-[rgb(var(--marca-texto))]")}>Gobserva</span>
          </span>
        )}
      </span>
    </span>
  );
}
