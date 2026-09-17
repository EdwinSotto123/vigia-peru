import { MapPin, Landmark, Cpu, FileCheck2 } from "lucide-react";
import { BlurFade } from "@/components/magicui/BlurFade";
import { DetectionCarousel } from "./DetectionCarousel";

const PASOS = [
  { icon: MapPin, t: "Eliges una zona", d: "Departamento, provincia o distrito. Ves cuántos contratos esperan ser leídos y cuánto cuesta." },
  { icon: Landmark, t: "Financias su auditoría", d: "S/ 3 por contrato, desde 5. Empresa, colectivo o persona, también anónimo. Nadie elige cuáles: van por antigüedad." },
  { icon: Cpu, t: "Once agentes los leen", d: "Expediente, reglas de contratación, precios de mercado, prensa, red de personas y sanciones — todo cruzado con 14 portales del Estado." },
  { icon: FileCheck2, t: "Resultados públicos", d: "Cada señal cita norma, opinión OECE y evidencia oficial. Tú recibes un comprobante de impacto con cada contrato procesado." },
];

/** Una sola sección para "cómo funciona" + "qué detecta" (antes eran tres). */
export function ComoFuncionaCompacto() {
  return (
    <section id="como" className="scroll-mt-20 border-b border-line bg-paperDeep py-16">
      <div className="container-page">
        <div className="max-w-2xl">
          <span className="text-[11px] font-medium uppercase tracking-wide text-mute">Cómo funciona</span>
          <h2 className="mt-2 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            De un contrato sin leer a un <em className="text-clay">caso con evidencia</em>, en cuatro pasos.
          </h2>
        </div>
        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {PASOS.map(({ icon: Icon, t, d }, i) => (
            <BlurFade key={t} as="li" delayMs={i * 90} className="rounded-2xl border border-line bg-paper p-5 transition-shadow hover:shadow-card">
              <div className="flex items-center gap-2 text-clay"><span className="font-mono text-xs">{i + 1}</span><Icon size={18} /></div>
              <h3 className="mt-2 font-semibold text-ink">{t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-mute">{d}</p>
            </BlurFade>
          ))}
        </ol>
        <div className="mt-10">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl font-bold text-ink">Qué señales busca en cada contrato</h3>
            <span className="text-xs text-mute">Señalamos patrones; no acusamos.</span>
          </div>
          <DetectionCarousel />
        </div>
      </div>
    </section>
  );
}
