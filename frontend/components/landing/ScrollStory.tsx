"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, ArrowDown, Cpu, ScanSearch, Users, ShieldAlert,
  Building2, User, TrendingUp, Banknote, Ban, FileWarning,
  GraduationCap, HeartPulse, Utensils,
} from "lucide-react";

/**
 * Scrollytelling BOLD — 5 beats centrados que se revelan al scrollear:
 *  1 · SOBRECARGA   → cientos de contratos / día (cascada + foto tenue)
 *  2 · LA CIFRA     → S/.57 mil M + "con ese dinero se pudo haber…"
 *  3 · QUÉ BUSCAN   → los patrones de corrupción que la red caza
 *  4 · LA CAZA      → un caso real: los agentes encienden las señales
 *  5 · CONVERGENCIA → ciudadano + agente IA → CASO ROJO
 */

const N = 5;
const clamp = (v: number, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function easeOutBack(t: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
const SEG = 1 / N;
function vis(p: number, i: number) {
  const s = i * SEG, e = s + SEG;
  const inA = clamp((p - (s - 0.025)) / 0.04);
  const outA = 1 - clamp((p - (e - 0.015)) / 0.04);
  return clamp(Math.min(inA, outA));
}
const rev = (l: number, at: number, ramp = 0.12) => clamp((l - at) / ramp);

const LEDGER = (() => {
  const OBJ = ["Mejoramiento de transitabilidad vehicular", "Construcción de centro de salud", "Adquisición de equipos biomédicos", "Rehabilitación de I.E.", "Mantenimiento vial periódico", "Ampliación de red de agua", "Adquisición de material logístico", "Losa deportiva multiuso"];
  const REG = ["Áncash", "Cusco", "Piura", "Lima", "Junín", "Puno", "La Libertad", "Loreto"];
  return Array.from({ length: 26 }, (_, i) => ({
    code: `OECE-${120000 + i * 131}`,
    txt: `${REG[(i * 5) % REG.length]} · ${OBJ[(i * 3) % OBJ.length]}`,
    monto: `S/. ${(0.4 + ((i * 37) % 90) / 10).toFixed(2)} M`,
  }));
})();

const STATS1 = [
  { v: "+200 000", l: "procesos de contratación al año", at: 0.28 },
  { v: "~2 800", l: "entidades públicas comprando", at: 0.46 },
  { v: "24/7", l: "sin pausa, en todo el país", at: 0.64 },
];
const EQUIV = [
  { icon: GraduationCap, v: "5 700", l: "colegios construidos" },
  { icon: HeartPulse, v: "11 000", l: "postas de salud equipadas" },
  { icon: Utensils, v: "14 años", l: "de desayuno escolar a todo el país" },
];
const PATTERNS = [
  { icon: Building2, name: "Empresa fachada", desc: "RUC de pocos días que gana millones" },
  { icon: User, name: "Único postor", desc: "gana solo, al 99 % del valor referencial" },
  { icon: TrendingUp, name: "Sobreprecio", desc: "muy por encima de la mediana del mercado" },
  { icon: Banknote, name: "Aportante = ganador", desc: "financió la campaña del que firma" },
  { icon: Ban, name: "Socio inhabilitado", desc: "sancionado, escondido en el consorcio" },
  { icon: FileWarning, name: "Adenda inflada", desc: "+25 % del monto, después de firmar" },
];
const CHECKS = [
  { k: "Antigüedad del RUC al ganar", v: "60 días", agent: "compliance", icon: ShieldAlert },
  { k: "Número de postores", v: "1 (único)", agent: "mercado", icon: ScanSearch },
  { k: "Precio vs. mediana de mercado", v: "+182 %", agent: "mercado", icon: ScanSearch },
  { k: "Socio del consorcio", v: "inhabilitado", agent: "red", icon: Users },
];

function useScrollProgress(ref: React.RefObject<HTMLElement>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const total = el.offsetHeight - window.innerHeight;
        setP(total > 0 ? clamp(-rect.top, 0, total) / total : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

export function ScrollStory() {
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);

  const v = [vis(p, 0), vis(p, 1), vis(p, 2), vis(p, 3), vis(p, 4)];
  const activeBeat = Math.min(N - 1, Math.floor(p / SEG));
  const b1 = clamp(p / SEG);
  const b2 = clamp((p - SEG) / SEG);
  const b3 = clamp((p - 2 * SEG) / SEG);
  const b4 = clamp((p - 3 * SEG) / SEG);
  const b5 = clamp((p - 4 * SEG) / SEG);

  const bignum = Math.round(57_000_000_000 * easeOut(clamp(b2 / 0.55))).toLocaleString("es-ES");
  const stampScale = lerp(1.7, 1, easeOutBack(clamp(b5 / 0.4)));
  const flash = v[4] * Math.max(0, 1 - Math.abs(b5 - 0.05) / 0.06);
  const cardHot = rev(b4, 0.62) > 0.4;

  return (
    <section ref={ref} id="historia" className="relative bg-ink text-paper" style={{ height: "700vh" }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .vg-stream{animation:vg-stream 13s linear infinite;}
              @keyframes vg-stream{from{transform:translateY(0)}to{transform:translateY(-50%)}}
              @media (prefers-reduced-motion: reduce){.vg-stream{animation:none}}
            `,
          }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-3 z-30 rounded-[22px] border border-amber/15 sm:inset-5" />
        <div aria-hidden className="pointer-events-none absolute inset-0 z-40 bg-[#E23B2E]" style={{ opacity: flash * 0.4 }} />

        {/* ───────── BEAT 1 · SOBRECARGA ───────── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6" style={{ opacity: v[0] }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img aria-hidden alt="" src="https://images.unsplash.com/photo-1543811303-5f6310068938?w=1400&q=55&auto=format&fit=crop" className="absolute inset-0 h-full w-full object-cover opacity-[0.1]" />
          <div aria-hidden className="absolute inset-0 grid grid-cols-1 gap-x-8 px-6 opacity-40 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((col) => (
              <div key={col} className="relative overflow-hidden">
                <div className="vg-stream" style={{ animationDelay: `${col * -4.3}s` }}>
                  {[...LEDGER, ...LEDGER].map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 border-b border-paper/5 py-1.5 font-mono text-[10px] text-paper/30">
                      <span className="text-paper/45">{r.code}</span>
                      <span className="truncate">{r.txt}</span>
                      <span className="shrink-0 text-paper/45">{r.monto}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/55 via-ink/75 to-ink/55" />
          <div className="relative max-w-3xl text-center">
            <div className="mb-3 font-mono text-xs uppercase tracking-[0.4em] text-paper/40">01 · La sobrecarga</div>
            <h2 className="font-techno text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-6xl">
              Cientos de contratos<span className="block text-paper/55">cada día</span>
            </h2>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {STATS1.map((s) => {
                const r = rev(b1, s.at);
                return (
                  <div key={s.l} className="rounded-xl border border-paper/10 bg-paper/[0.03] px-3 py-3" style={{ opacity: r, transform: `translateY(${(1 - r) * 12}px)` }}>
                    <div className="font-mono text-xl font-bold text-amber sm:text-2xl">{s.v}</div>
                    <div className="mt-1 text-[11px] leading-tight text-paper/55">{s.l}</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-7 text-sm text-paper/55 sm:text-base" style={{ opacity: rev(b1, 0.8) }}>
              Ningún equipo humano los revisa a tiempo. <strong className="text-paper/80">La mayoría son legítimos; algunos, no.</strong>
            </p>
          </div>
        </div>

        {/* ───────── BEAT 2 · LA CIFRA ───────── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center" style={{ opacity: v[1] }}>
          <div className="mb-3 font-mono text-xs uppercase tracking-[0.4em] text-paper/40">02 · La cifra</div>
          <div className="font-mono text-[11vw] font-bold leading-[0.85] tracking-tighter text-paper">
            <span className="text-amber/70">S/.</span> {bignum}
          </div>
          <p className="mx-auto mt-5 max-w-xl text-sm text-paper/60 sm:text-base">
            en contratos con <strong className="text-paper">riesgo de corrupción</strong> · 2021–2024
          </p>
          <div className="mt-8 w-full max-w-3xl" style={{ opacity: rev(b2, 0.45) }}>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-amber">Con ese dinero se pudo haber:</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {EQUIV.map((e, i) => {
                const r = rev(b2, 0.5 + i * 0.09);
                const Icon = e.icon;
                return (
                  <div key={e.l} className="flex items-center gap-3 rounded-xl border border-paper/10 bg-paper/[0.03] px-4 py-4 text-left" style={{ opacity: r, transform: `translateY(${(1 - r) * 12}px)` }}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber/15 text-amber"><Icon size={20} /></span>
                    <div>
                      <div className="font-mono text-lg font-bold text-paper sm:text-xl">{e.v}</div>
                      <div className="text-[11px] leading-tight text-paper/55">{e.l}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-sm italic leading-snug text-paper/70" style={{ opacity: rev(b2, 0.8) }}>No es una estadística: es la salud, la escuela y el plato que nunca llegaron.</div>
          </div>
        </div>

        {/* ───────── BEAT 3 · QUÉ BUSCAN ───────── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6" style={{ opacity: v[2] }}>
          <div className="mb-5 max-w-2xl text-center">
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.4em] text-paper/40">03 · Qué buscan</div>
            <h2 className="font-techno text-2xl font-bold uppercase tracking-tight sm:text-4xl">
              Los <span className="text-amber">patrones</span> que delatan la corrupción
            </h2>
            <p className="mt-2 text-sm text-paper/55">La red cruza 14 portales buscando señales que un humano no arma a tiempo.</p>
          </div>
          <div className="grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PATTERNS.map((pat, i) => {
              const r = rev(b3, 0.1 + i * 0.1);
              const Icon = pat.icon;
              return (
                <div key={pat.name} className="flex items-start gap-3 rounded-xl border border-paper/10 bg-paper/[0.03] px-4 py-3" style={{ opacity: r, transform: `translateY(${(1 - r) * 12}px)` }}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E23B2E]/15 text-[#E23B2E]"><Icon size={18} /></span>
                  <div>
                    <div className="text-sm font-bold text-paper">{pat.name}</div>
                    <div className="text-[11px] leading-tight text-paper/55">{pat.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ───────── BEAT 4 · LA CAZA ───────── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6" style={{ opacity: v[3] }}>
          <div className="mb-3 text-center">
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.4em] text-paper/40">04 · La caza</div>
            <h2 className="font-techno text-2xl font-bold uppercase tracking-tight sm:text-4xl">
              Y la máquina lo <span className="text-amber">encuentra en segundos</span>
            </h2>
          </div>
          <div className="mb-4 flex items-stretch justify-center gap-3" style={{ opacity: rev(b4, 0.05) }}>
            <div className="flex w-36 flex-col items-center rounded-xl border border-paper/10 bg-paper/[0.03] px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-paper/45">Fuentes cruzadas · 14</div>
              <div className="w-24"><DotMatrix n={14} color="#BE7B26" /></div>
            </div>
            <div className="flex w-36 flex-col items-center rounded-xl border border-paper/10 bg-paper/[0.03] px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-paper/45">Índice de riesgo</div>
              <div className="w-24"><Gauge value={78} color="#E23B2E" /></div>
            </div>
          </div>
          <div className="w-full max-w-lg rounded-xl border bg-ink/80 p-5 backdrop-blur-sm" style={{ borderColor: cardHot ? "#E23B2E" : "rgba(244,238,221,0.15)", boxShadow: cardHot ? "0 0 40px -8px rgba(226,59,46,0.55)" : "none" }}>
            <div className="flex justify-between font-mono text-xs text-paper/45">
              <span>OECE-1206058 · ÁNCASH</span>
              <span className="inline-flex items-center gap-1"><Cpu size={12} className="text-amber" /> 4 agentes</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {CHECKS.map((c, i) => {
                const r = rev(b4, 0.15 + i * 0.13);
                const Icon = c.icon;
                return (
                  <div key={c.k} className="flex items-center justify-between gap-3 rounded-lg border border-paper/5 bg-paper/[0.02] px-3 py-2 font-mono text-[11px]" style={{ opacity: r, transform: `translateX(${(1 - r) * -10}px)` }}>
                    <span className="flex items-center gap-2 text-paper/55">
                      <Icon size={13} className="text-paper/40" />
                      {c.k}
                      <span className="rounded bg-paper/5 px-1 py-0.5 text-[8px] uppercase tracking-wider text-paper/35">{c.agent}</span>
                    </span>
                    <span className="shrink-0 font-bold" style={{ color: r > 0.6 ? "#E23B2E" : "rgba(244,238,221,0.8)" }}>⚑ {c.v}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 border-t border-paper/10 pt-2 text-[10px] leading-snug text-paper/45" style={{ opacity: rev(b4, 0.78) }}>
              ⚖ Cada señal citada con su norma — <span className="font-semibold text-[#E23B2E]">Art. 50 · TUO Ley 30225</span> + opinión OECE, con link a la fuente oficial.
            </div>
          </div>
        </div>

        {/* ───────── BEAT 5 · CONVERGENCIA ───────── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center" style={{ opacity: v[4] }}>
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E23B2E]/15 blur-[120px]" style={{ opacity: clamp(b5 / 0.4) }} />
          <div className="mb-5 font-mono text-xs uppercase tracking-[0.4em] text-[#E23B2E]/70">05 · La convergencia</div>
          <div className="flex items-end justify-center gap-4 sm:gap-7">
            <FigureCard figure={<PersonFigure color="#E23B2E" />} titulo="Ciudadano" sub="ve la obra · reporta con foto y GPS" alpha={rev(b5, 0.08)} />
            <span className="mb-9 font-mono text-2xl text-paper/40" style={{ opacity: rev(b5, 0.4) }}>+</span>
            <FigureCard figure={<AgentFigure color="#BE7B26" />} titulo="Agente IA" sub="cruza 14 portales · detecta el patrón" alpha={rev(b5, 0.26)} />
          </div>
          <div className="my-3 flex flex-col items-center text-paper/40" style={{ opacity: rev(b5, 0.46) }}>
            <ArrowDown size={20} />
            <span className="text-[10px] uppercase tracking-widest">misma obra</span>
          </div>
          <div className="font-techno text-5xl font-black uppercase leading-none tracking-tight text-[#E23B2E] sm:text-7xl" style={{ transform: `scale(${stampScale})`, opacity: clamp((b5 - 0.5) / 0.2), textShadow: "0 0 40px rgba(226,59,46,0.5)" }}>
            Caso rojo
          </div>
          <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-paper/70 sm:text-base" style={{ opacity: clamp((b5 - 0.62) / 0.2) }}>
            Dos fuentes independientes sobre la misma obra. Expediente con toda la evidencia, listo
            para un <strong className="text-paper">fiscal</strong> o un <strong className="text-paper">periodista</strong> — antes de que el dinero se gaste.
          </p>
          <Link
            href="/app"
            className="group mt-7 inline-flex items-center gap-2 rounded-full bg-amber px-6 py-3 text-sm font-semibold text-ink shadow-[0_0_30px_-6px_rgba(190,123,38,0.7)] transition-all hover:scale-[1.03] sm:text-base"
            style={{ opacity: clamp((b5 - 0.78) / 0.12), pointerEvents: b5 > 0.85 ? "auto" : "none" }}
          >
            Explorá el mapa de casos
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* indicador de beats */}
        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-1 rounded-full transition-all duration-300" style={{ width: i === activeBeat ? 28 : 14, background: i === activeBeat ? (i >= 3 ? "#E23B2E" : "#BE7B26") : "rgba(244,238,221,0.2)" }} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DotMatrix({ n, color }: { n: number; color: string }) {
  const cols = 7;
  return (
    <svg viewBox="0 0 132 40" className="mt-1.5 w-full" aria-hidden>
      {Array.from({ length: n }).map((_, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        return <circle key={i} cx={10 + c * 18.5} cy={11 + r * 18} r={4} fill={color} opacity={0.85} />;
      })}
    </svg>
  );
}

function Gauge({ value, color }: { value: number; color: string }) {
  const w = 120, h = 58, cx = 60, cy = 52, r = 44;
  const pt = (f: number) => {
    const th = Math.PI * (1 - f);
    return [cx + r * Math.cos(th), cy - r * Math.sin(th)] as const;
  };
  const [sx, sy] = pt(0), [ex, ey] = pt(1), [vx, vy] = pt(value / 100);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 w-full" aria-hidden>
      <path d={`M${sx.toFixed(1)},${sy.toFixed(1)} A${r},${r} 0 0 1 ${ex.toFixed(1)},${ey.toFixed(1)}`} fill="none" stroke="rgba(244,238,221,0.12)" strokeWidth="7" strokeLinecap="round" />
      <path d={`M${sx.toFixed(1)},${sy.toFixed(1)} A${r},${r} 0 0 1 ${vx.toFixed(1)},${vy.toFixed(1)}`} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
      <text x={cx} y={cy - 7} textAnchor="middle" fontSize="18" fontWeight="700" fill="#FFFFFF" fontFamily="JetBrains Mono, monospace">{value}</text>
    </svg>
  );
}

function PersonFigure({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14" aria-hidden>
      <circle cx="28" cy="17" r="9" fill={color} />
      <path d="M9 52 C9 38 18 33 28 33 C38 33 47 38 47 52 Z" fill={color} />
    </svg>
  );
}

function AgentFigure({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14" aria-hidden>
      <line x1="28" y1="14" x2="28" y2="7" stroke={color} strokeWidth="2.5" />
      <circle cx="28" cy="6" r="3" fill={color} />
      <rect x="11" y="14" width="34" height="26" rx="7" fill={color} />
      <circle cx="21" cy="27" r="3.5" fill="#14171A" />
      <circle cx="35" cy="27" r="3.5" fill="#14171A" />
      <rect x="22" y="34" width="12" height="2.5" rx="1.25" fill="#14171A" />
      <path d="M18 44 C18 41 22 40 28 40 C34 40 38 41 38 44 L38 50 L18 50 Z" fill={color} />
    </svg>
  );
}

function FigureCard({ figure, titulo, sub, alpha }: { figure: React.ReactNode; titulo: string; sub: string; alpha: number }) {
  return (
    <div className="flex w-32 flex-col items-center gap-1.5 rounded-2xl border border-paper/10 bg-paper/[0.03] px-3 py-4 backdrop-blur-sm sm:w-36" style={{ opacity: alpha, transform: `translateY(${(1 - alpha) * 16}px)` }}>
      {figure}
      <div className="text-sm font-bold text-paper">{titulo}</div>
      <div className="text-center text-[10px] leading-tight text-paper/55">{sub}</div>
    </div>
  );
}
