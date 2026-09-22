import Link from "next/link";
import { ArrowUpRight, HeartHandshake } from "lucide-react";
import { BorderBeam } from "@/components/magicui/BorderBeam";
import type { RankingRow } from "@/lib/financiamiento";
import { AvatarAliado } from "./TarjetaAliado";

/**
 * Podio real (2º-izquierda / 1º-centro-elevado / 3º-derecha), no tres tarjetas iguales en
 * fila. El pedestal de cada posición tiene una altura fija y distinta (1º > 2º > 3º);
 * `items-end` en el grid de arriba hace que las tres bases compartan el mismo "piso" y las
 * tarjetas queden escalonadas — el efecto de podio sale de la altura del pedestal, no de la
 * tarjeta. Posiciones sin aliado real todavía (el caso normal hoy: solo hay 1) se muestran
 * como "vacante" en vez de desaparecer, para que el podio se vea completo e intencional.
 */
const TIER = {
  1: {
    pedestal: "h-24 sm:h-32 bg-gradient-to-b from-amber to-clay",
    numero: "1",
    avatarSize: "xl" as const,
    nombreClase: "text-lg sm:text-xl",
    beam: true,
  },
  2: {
    pedestal: "h-16 sm:h-20 bg-gradient-to-b from-mute to-inkSoft",
    numero: "2",
    avatarSize: "lg" as const,
    nombreClase: "text-sm sm:text-base",
    beam: false,
  },
  3: {
    pedestal: "h-11 sm:h-14 bg-gradient-to-b from-clay to-clay/70",
    numero: "3",
    avatarSize: "lg" as const,
    nombreClase: "text-sm sm:text-base",
    beam: false,
  },
} as const;

export function Podio({ destacados, periodoDestacado }: { destacados: RankingRow[]; periodoDestacado: string }) {
  // Orden visual del podio (izq/centro/der), no el orden de ranking (que es 1,2,3):
  const visual: [RankingRow | undefined, 2 | 1 | 3][] = [
    [destacados[1], 2],
    [destacados[0], 1],
    [destacados[2], 3],
  ];
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-wide text-mute">Podio {periodoDestacado}</h2>
        <span className="text-[11px] text-mute">se cuenta en contratos, no en soles</span>
      </div>
      <div className="mt-5 grid grid-cols-3 items-end gap-3 sm:gap-5">
        {visual.map(([row, posicion]) => (
          <PodioSlot key={posicion} row={row} posicion={posicion} />
        ))}
      </div>
    </section>
  );
}

function PodioSlot({ row, posicion }: { row: RankingRow | undefined; posicion: 1 | 2 | 3 }) {
  const tier = TIER[posicion];
  return (
    <div className="flex flex-col items-center">
      {row ? (
        <article className="relative flex w-full flex-col items-center overflow-hidden rounded-2xl border border-line bg-paper p-3 text-center shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper sm:p-4">
          {tier.beam && <BorderBeam size={60} duration={7} />}
          <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size={tier.avatarSize} />
          <div className={`mt-2 w-full truncate font-serif font-bold text-ink ${tier.nombreClase}`}>
            {row.slug ? <Link href={`/aliado/${row.slug}`} className="hover:underline">{row.nombre}</Link> : row.nombre}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-mute">
            {row.contratosFinanciados.toLocaleString("es-PE")} {row.contratosFinanciados === 1 ? "contrato" : "contratos"}
          </div>
          {row.slug && (
            <Link href={`/aliado/${row.slug}`} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-ink hover:underline">
              Ver perfil <ArrowUpRight size={10} aria-hidden />
            </Link>
          )}
        </article>
      ) : (
        <Link
          href="/app/financiar"
          className="flex w-full flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line p-3 text-center transition-colors hover:border-heroGreen/40 hover:bg-heroGreen/5 sm:p-4"
        >
          <HeartHandshake size={16} className="text-mute" aria-hidden />
          <span className="text-[11px] font-semibold text-ink">Vacante</span>
          <span className="text-[10px] text-mute">Sé el próximo</span>
        </Link>
      )}
      <div className={`mt-3 flex w-full items-start justify-center rounded-t-xl pt-1.5 font-serif text-2xl font-bold text-paper sm:text-3xl ${tier.pedestal}`}>
        {tier.numero}
      </div>
    </div>
  );
}
