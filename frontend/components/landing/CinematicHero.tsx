import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { HeroMap } from "./HeroMap";

const STATS = [
  { v: "S/. 57 MM", l: "en contratos con riesgo · 2021–2024" },
  { v: "14", l: "portales públicos cruzados" },
  { v: "Áncash", l: "región piloto del MVP" },
];

/**
 * Hero 1×2: a la izquierda el pitch claro (qué es Vigía, en texto plano),
 * a la derecha el MAPA real del Perú con los pines de alertas y reportes.
 */
export function CinematicHero() {
  return (
    <section id="inicio" className="relative overflow-hidden border-b border-line bg-paper">
      {/* glow de acento sutil */}
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[460px] w-[460px] rounded-full bg-amber/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-40 bottom-0 h-[360px] w-[360px] rounded-full bg-rust/5 blur-3xl" />

      <div className="container-page relative py-12 sm:py-16 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          {/* ── IZQUIERDA · pitch ── */}
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              Plataforma cívica · sin fines de lucro · Perú
            </div>

            <h1 className="font-techno font-bold uppercase leading-[0.98] tracking-tight text-ink">
              <span className="block text-4xl sm:text-5xl lg:text-6xl">Agentes de IA</span>
              <span className="mt-1 block bg-gradient-to-r from-amber to-clay bg-clip-text text-4xl text-transparent sm:text-5xl lg:text-6xl">
                contra la corrupción
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-inkSoft sm:text-lg">
              <strong className="font-semibold text-ink">La primera red de agentes de IA que busca
              indicios de corrupción en los contratos públicos del Perú.</strong> Cruzan 14 portales
              del Estado y los reportes de ciudadanos, marcan cada señal de riesgo con su norma y su
              evidencia oficial, y arman el caso para periodistas y fiscales — antes de que el dinero
              se gaste.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/app"
                className="group inline-flex items-center gap-2 rounded-full bg-amber px-6 py-3.5 text-sm font-semibold text-ink shadow-[0_8px_24px_-8px_rgba(190,123,38,0.6)] transition-all hover:scale-[1.03] hover:bg-amber/90 sm:text-base"
              >
                Ver el mapa de casos
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#como"
                className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-6 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-paperSoft sm:text-base"
              >
                Cómo funciona <ChevronDown size={16} />
              </a>
            </div>

            {/* stats / data */}
            <div className="mt-10 grid max-w-xl grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-paperSoft">
              {STATS.map((s) => (
                <div key={s.l} className="px-4 py-4">
                  <div className="font-mono text-xl font-bold text-ink sm:text-2xl">{s.v}</div>
                  <div className="mt-1 text-[11px] leading-tight text-mute">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── DERECHA · mapa real ── */}
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-line bg-paperSoft shadow-card">
              <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2">
                    <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-rust opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rust" />
                  </span>
                  <span className="text-xs font-semibold text-ink">Mapa de riesgo · en vivo</span>
                </div>
                <span className="font-mono text-[10px] text-mute">SEACE · OECE · INFOBRAS</span>
              </div>
              <div className="relative h-[400px] sm:h-[480px] lg:h-[540px]">
                <HeroMap />
              </div>
            </div>

            {/* leyenda de pines */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-mute">
              <Legend color="#C28840" label="Alerta automática" />
              <Legend color="#8B2A1E" label="Reporte ciudadano" />
              <Legend color="#14171A" label="Convergencia → caso" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
