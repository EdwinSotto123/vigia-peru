import Link from "next/link";
import { ArrowRight, HeartHandshake, Heart } from "lucide-react";
import { MuroAliados } from "@/components/aliados/MuroAliados";

/**
 * "Gracias a…" en la landing (server component): el top de aliados del mes en
 * formato compacto + enlace al muro completo. Reconocimiento por contratos
 * financiados, no por soles.
 */
export function AliadosSection() {
  return (
    <section id="aliados" className="scroll-mt-20 border-y border-line bg-paperSoft py-20">
      <div className="container-page">
        <div className="grid items-end gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
              <HeartHandshake size={11} /> Aliados de transparencia
            </div>
            <h2 className="mt-3 font-serif text-3xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              Gracias a ellos, hay contratos que <em className="text-moss">sí se leyeron</em>.
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-mute">
            Empresas, colectivos y personas que financiaron capacidad de auditoría. El reconocimiento es
            público y verificable: cada aporte tiene un comprobante de impacto con los contratos que hizo
            posible leer y las señales halladas. Nadie paga por resultados ni elige qué se analiza.
          </p>
        </div>

        <div className="mt-10">
          <MuroAliados compact />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/aliados"
            className="group inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep"
          >
            Ver todos los aliados
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/financiar"
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]"
          >
            <Heart size={15} className="text-amber" /> Sumarme como aliado
          </Link>
        </div>
      </div>
    </section>
  );
}
