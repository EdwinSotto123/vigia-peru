import Link from "next/link";
import { Code2, Lock, ShieldCheck, Sparkles, Server, Database, Activity, ArrowUpRight } from "lucide-react";
import { BlurFade } from "@/components/magicui/BlurFade";

const COMPROMISOS = [
  { icon: Code2, t: "100 % open source", d: "Todo el código en GitHub. Una herramienta anticorrupción cerrada sería una contradicción.", href: "https://github.com/EdwinSotto123/vigia-peru" },
  { icon: Lock, t: "Sin conflictos de interés", d: "Ni Estado, ni partidos, ni empresas que contratan con él. Quien financia no elige ni edita resultados." },
  { icon: ShieldCheck, t: "No acusamos", d: "Señales de riesgo con norma, opinión OECE y fuente oficial. Denunciar formalmente es tarea de Fiscalía, Contraloría y prensa." },
  { icon: Activity, t: "Auditable por dentro", d: "Cada análisis deja su traza completa (llamadas, costo, latencia) en Arize/Phoenix y un servidor MCP público expone los datos." },
];

const COSTOS = [
  { icon: Sparkles, l: "Gemini 2.5 (Vertex AI)", d: "~S/ 1 por contrato", m: "S/ 412" },
  { icon: Server, l: "Cloud Run + Cloud SQL", d: "orquestador, API, base", m: "S/ 285" },
  { icon: Database, l: "APIs externas", d: "SUNAT + Google Search", m: "S/ 148" },
];

/** "Quiénes somos" + "Plataforma" + "Cuentas claras" en una sola sección. */
export function ConfianzaSection() {
  return (
    <section id="organizacion" className="relative overflow-hidden scroll-mt-20 border-y border-line bg-gradient-to-br from-heroViolet/[0.05] via-paperDeep to-heroGreen/[0.04] py-16">
      <div className="container-page grid max-w-[1600px] gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-heroViolet">Organización sin fines de lucro</span>
          <h2 className="mt-2 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl lg:text-5xl">
            Construido para no <span className="text-heroViolet">depender de nadie</span>.
          </h2>
          <ul className="mt-7 grid gap-3 sm:grid-cols-2">
            {COMPROMISOS.map(({ icon: Icon, t, d, href }, i) => (
              <BlurFade key={t} as="li" delayMs={i * 70} className="rounded-2xl border border-line bg-paper p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-paper">
                <div className="flex items-center gap-2 text-ink"><Icon size={15} className="text-heroGreen" /><span className="font-semibold">{t}</span></div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">{d}</p>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-heroGreenTexto hover:underline">
                    Ver el código <ArrowUpRight size={11} />
                  </a>
                )}
              </BlurFade>
            ))}
          </ul>
        </div>
        <BlurFade as="div" delayMs={150} className="rounded-3xl border border-line bg-paper p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-heroViolet">Cuentas claras del mes pasado</span>
            <span className="font-mono text-[11px] text-mute">25 regiones</span>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {COSTOS.map(({ icon: Icon, l, d, m }) => (
              <li key={l} className="flex flex-col items-start gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2 text-ink"><Icon size={13} className="text-mute" />{l}<span className="ml-1 text-[11px] text-mute">{d}</span></span>
                <span className="font-mono text-ink">{m}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-heroViolet-deep px-4 py-3.5 text-paper">
            {/* heroGreenTexto es el verde CORREGIDO PARA FONDO CLARO; acá el fondo es
                heroViolet-deep y daba 2.15:1. Sobre oscuro hay que ir al otro
                extremo de la escala: heroGreen-soft llega a ~11:1 y sigue leyéndose
                verde. */}
            <div><div className="text-[10px] font-bold uppercase tracking-wide text-heroGreen-soft">Total mensual</div><div className="text-[11px] text-paper/60">Desarrollo ad honorem, y 17 aliados de S/ 50 lo cubren</div></div>
            <div className="font-mono text-2xl font-bold text-heroGreen">S/ 845</div>
          </div>
          <Link href="/preguntas#cuentas" className="mt-3 block text-center text-[12px] text-mute underline-offset-2 hover:underline">Ver el balance público y el código →</Link>
        </BlurFade>
      </div>
    </section>
  );
}
