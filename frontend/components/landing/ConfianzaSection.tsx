import Link from "next/link";
import { Code2, Lock, ShieldCheck, Sparkles, Server, Database, Activity } from "lucide-react";

const COMPROMISOS = [
  { icon: Code2, t: "100 % open source", d: "Todo el código en GitHub. Una herramienta anticorrupción cerrada sería una contradicción." },
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
    <section id="organizacion" className="scroll-mt-20 border-y border-line bg-paperDeep py-16">
      <div className="container-page grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-mute">Organización sin fines de lucro</span>
          <h2 className="mt-2 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Construido para no <span className="text-rust">depender de nadie</span>.
          </h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {COMPROMISOS.map(({ icon: Icon, t, d }) => (
              <li key={t} className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex items-center gap-2 text-ink"><Icon size={15} className="text-clay" /><span className="font-semibold">{t}</span></div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">{d}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-clay">Cuentas claras · mes pasado</span>
            <span className="font-mono text-[11px] text-mute">25 regiones</span>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {COSTOS.map(({ icon: Icon, l, d, m }) => (
              <li key={l} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2 text-ink"><Icon size={13} className="text-mute" />{l}<span className="text-[11px] text-mute">· {d}</span></span>
                <span className="font-mono text-ink">{m}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between rounded-xl bg-ink px-4 py-3 text-paper">
            <div><div className="text-[10px] font-bold uppercase tracking-wide text-amber">Total mensual</div><div className="text-[11px] text-paper/60">Desarrollo ad honorem · 17 aliados × S/ 50 lo cubren</div></div>
            <div className="font-mono text-2xl font-bold text-amber">S/ 845</div>
          </div>
          <Link href="/preguntas#transparencia" className="mt-3 block text-center text-[12px] text-mute underline-offset-2 hover:underline">Ver el balance público y el código →</Link>
        </div>
      </div>
    </section>
  );
}
