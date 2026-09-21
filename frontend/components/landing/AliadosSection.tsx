import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { MuroAliados } from "@/components/aliados/MuroAliados";
import { AliadosStats } from "@/components/landing/AliadosStats";
import { BlurFade } from "@/components/magicui/BlurFade";
import { getEstadoGlobal } from "@/lib/financiamiento";

/** Aliados + cifras de financiamiento en una sola sección (antes: "Financia" con mapa + "Aliados"). */
export async function AliadosSection() {
  const estado = await getEstadoGlobal();
  return (
    <section id="aliados" className="scroll-mt-20 py-16">
      <div className="container-page grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-mute">Aliados de transparencia</span>
          <h2 className="mt-2 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Gracias a ellos, hay contratos que <em className="text-moss">sí se leyeron</em>.
          </h2>
          <p className="mt-3 text-mute">
            Empresas, colectivos y personas que financian capacidad de auditoría. Reciben reconocimiento público
            y un comprobante con cada contrato que su aporte hizo posible leer. El ranking cuenta contratos, no soles.
          </p>
          <AliadosStats initial={estado} />
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/app/financiar" className="group inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]">
              Financiar una auditoría <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/app/financiar#independencia" className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep">
              <ShieldCheck size={16} /> Reglas de independencia
            </Link>
          </div>
        </div>
        <BlurFade as="div" delayMs={80} className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
          <MuroAliados compact />
        </BlurFade>
      </div>
    </section>
  );
}
