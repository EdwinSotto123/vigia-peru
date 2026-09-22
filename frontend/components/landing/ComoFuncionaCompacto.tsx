import { MapPin, Landmark, Cpu, FileCheck2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { BlurFade } from "@/components/magicui/BlurFade";
import { DetectionCarousel } from "./DetectionCarousel";

const PASOS = [
  { icon: MapPin, t: "Eliges una zona", d: "Departamento, provincia o distrito. Ves cuántos contratos esperan ser leídos y cuánto cuesta." },
  { icon: Landmark, t: "Financias su auditoría", d: "S/ 3 por contrato, desde 5. Empresa, colectivo o persona, también anónimo. Nadie elige cuáles: van por antigüedad." },
  { icon: Cpu, t: "Diez agentes los leen", d: "Expediente, reglas de contratación, precios de mercado, prensa, red de personas y sanciones — todo cruzado con 14 portales del Estado." },
  { icon: FileCheck2, t: "Resultados públicos", d: "Cada señal cita norma, opinión OECE y evidencia oficial. Tú recibes un comprobante de impacto con cada contrato procesado." },
];

const ACCENTS = ["heroViolet", "heroGreen", "heroViolet", "heroGreen"] as const;
const ACCENT_BADGE: Record<(typeof ACCENTS)[number], string> = {
  heroViolet: "bg-heroViolet text-paper",
  heroGreen: "bg-heroGreen text-paper",
};

/** Una sola sección para "cómo funciona" + "qué detecta" (antes eran tres). */
export function ComoFuncionaCompacto() {
  return (
    <section id="como" className="relative scroll-mt-20 overflow-hidden border-b border-line bg-gradient-to-br from-heroViolet/[0.05] via-paperDeep to-heroGreen/[0.04] py-16">
      <div className="container-page max-w-[1600px]">
        <div className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-heroViolet">Cómo funciona</span>
          <h2 className="mt-2 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl lg:text-5xl">
            De un contrato sin leer a un <em className="text-heroGreen not-italic">caso con evidencia</em>, en cuatro pasos.
          </h2>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-4">
          {PASOS.map(({ icon: Icon, t, d }, i) => (
            <BlurFade
              key={t}
              as="li"
              delayMs={i * 90}
              className="relative rounded-3xl border border-line bg-paper p-6 shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-paper"
            >
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl font-mono text-sm font-bold ${ACCENT_BADGE[ACCENTS[i]]}`}>
                {i + 1}
              </span>
              <Icon size={20} className="mt-3 text-mute" />
              <h3 className="mt-3 text-lg font-semibold text-ink">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-mute">{d}</p>
            </BlurFade>
          ))}
        </ol>
        <div className="mt-14">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-2xl font-bold text-ink">Qué señales busca en cada contrato</h3>
            {/* text-ink/70, no text-mute: esta sección usa bg-paperDeep — con ese fondo,
                text-mute cae a ~4.23:1 (bajo el mínimo AA de 4.5:1 para texto chico). Mismo
                fix ya aplicado en el ticker EN VIVO, que tiene el mismo fondo. */}
            <span className="text-xs text-ink/70">Patrón ilustrativo — señalamos patrones, no acusamos.</span>
          </div>
          <DetectionCarousel />
          <div className="mt-5 text-center">
            <Link
              href="/app/auditoria"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-heroViolet underline-offset-2 hover:underline"
            >
              Ver casos reales ya auditados <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
