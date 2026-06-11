import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Database,
  ShieldCheck,
  Newspaper,
  Users,
  Scale,
  Camera,
  Gavel,
  Heart,
  Code2,
  Lock,
  Server,
  MapPin,
} from "lucide-react";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { DetectionCarousel } from "@/components/landing/DetectionCarousel";
import { FuentesCarousel } from "@/components/landing/FuentesCarousel";
import { PipelineInteractive } from "@/components/landing/PipelineInteractive";
import { CinematicHero } from "@/components/landing/CinematicHero";
import { ComoFunciona } from "@/components/landing/ComoFunciona";
import { ScrollStory } from "@/components/landing/ScrollStory";
import { ImpactoODS } from "@/components/landing/ImpactoODS";
import { PlataformaTabs } from "@/components/landing/PlataformaTabs";
import { SectionDots } from "@/components/landing/SectionDots";
import { Marquee } from "@/components/magicui/Marquee";
import {
  METRICAS_MOCK,
  ALERTAS_MOCK,
  formatSoles,
} from "@/lib/mock-data";

export default function LandingPage() {
  const m = METRICAS_MOCK;
  const topAlerts = [...ALERTAS_MOCK]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return (
    <>
      <SectionDots />

      {/* ─── HERO cinematográfico (oscuro, inspirado en alpha-wave.ai) ─── */}
      <CinematicHero />

      {/* Marquee de alertas en vivo · transición al cuerpo editorial */}
      <section className="border-y border-line bg-paperDeep">
          <div className="relative overflow-hidden py-2">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-paperDeep to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-paperDeep to-transparent" />
            <div className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-rust px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-paper">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-paper" />
              en vivo
            </div>
            <Marquee className="[--duration:80s] [--gap:3rem] pl-32" pauseOnHover>
              {topAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 whitespace-nowrap text-xs"
                >
                  <span className="rounded bg-rust/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rust">
                    score {a.score}
                  </span>
                  <span className="text-mute">{a.region}</span>
                  <span className="text-mute">·</span>
                  <span className="max-w-[400px] truncate text-ink">{a.objeto}</span>
                  <span className="text-mute">·</span>
                  <span className="font-mono text-clay">{formatSoles(a.montoSoles)}</span>
                </div>
              ))}
            </Marquee>
          </div>
      </section>

      {/* ─── HISTORIA · scrollytelling cinematográfico (gancho) ─── */}
      <ScrollStory />

      {/* ─── POR QUÉ IMPORTA · ODS / cerrar brechas (emocional) ─── */}
      <ImpactoODS />

      {/* ─── CÓMO FUNCIONA · explicación llana (3 pasos), ya que importa ─── */}
      <ComoFunciona />

      {/* ─── ASÍ DETECTA EL SISTEMA ─── */}
      <section id="detecta" className="container-page py-20 scroll-mt-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
            <ShieldCheck size={11} /> Esto es lo que detecta
          </div>
          <h2 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-5xl">
            <em className="text-rust">Patrones</em> que un humano no puede armar a tiempo.
          </h2>
          <p className="mt-3 text-mute">
            Cada uno se cruza contra norma específica y opinión OECE relacionada.
            Navega los seis patrones más frecuentes con las flechas.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <DetectionCarousel />
        </div>
      </section>

      {/* (S/.57B → ya vive en el scrollytelling + la sección ODS; duplicado removido) */}

      {/* ─── KPIs en vivo — banner editorial compacto ─── */}
      <section className="border-y border-line bg-paperSoft">
        <div className="container-page py-10">
          <div className="grid items-center gap-6 lg:grid-cols-[auto,1fr]">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-rust">
              <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rust" />
              En el sistema ahora
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              <BigStat
                label="Alertas activas"
                value={m.alertasActivas}
                suffix=""
                hint="cruzadas con OECE + SUNAT"
                accent="text-amber"
              />
              <BigStat
                label="Casos convergentes"
                value={m.casosConvergentes}
                suffix=""
                hint="alerta + reporte ciudadano"
                accent="text-rust"
              />
              <BigStat
                label="Contratos vigilados"
                value={m.contratosVigilados}
                suffix=""
                hint={`${formatSoles(m.montoVigiladoSoles)} bajo seguimiento`}
                accent="text-clay"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── PROBLEMA / SOLUCIÓN ─── */}
      <section id="problema" className="container-page py-20 scroll-mt-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
            <Scale size={11} /> El problema
          </div>
          <h2 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            El Estado publica todo.<br />
            <span className="text-rust">Nadie lee nada.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-mute sm:text-lg">
            En el Perú la transparencia es por ley.{" "}
            <strong className="text-ink">Todo está publicado</strong> — pero en
            sistemas distintos, formatos distintos, ventanas distintas. La
            corrupción ocurre en el hueco entre portales.
          </p>
        </div>

        {/* DATA FLOW — disconected portals → Vigía → caso conectado */}
        <div className="mx-auto mt-14 max-w-5xl">
          <DisconnectionDiagram />
        </div>

        {/* (cards "Antes / Con Vigía" → el scrollytelling ya narra ese arco) */}
      </section>

      {/* ─── LA PLATAFORMA · pestañas (cómo lo hace · motor · fuentes) ─── */}
      <PlataformaTabs />

      {/* ─── PARA QUIÉN ─── */}
      <section className="border-y border-line bg-paperDeep py-20">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
              <Users size={11} /> Para quién
            </div>
            <h2 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-5xl">
              Tres personas. Una sola red.
            </h2>
            <p className="mt-3 text-mute">
              Cada quien aporta lo que ve. La IA lo conecta. La verdad pesa más.
            </p>
          </div>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <AudienceCard
              icon={<Persona tool={<Camera size={12} />} />}
              label="Ciudadano"
              title="Tu foto vale más que mil acusaciones."
              body="Ves la obra paralizada, tomas la foto, marcas la ubicación. El sistema cruza tu reporte con los contratos del Estado. Pin rojo + alerta automática = caso convergente público."
              action="Reportar algo →"
              href="/reporte/nuevo"
            />
            <AudienceCard
              icon={<Persona tool={<Newspaper size={12} />} />}
              label="Periodista"
              title="Tres meses de investigación, en treinta segundos."
              body="Recibes el dictamen con red de personas, banderas duras citando artículo de ley, opiniones normativas OECE, links a fuentes oficiales y borrador editorial. Tú verificas y publicas."
              action="Ver generador IA →"
              href="/noticia"
              accent
            />
            <AudienceCard
              icon={<Persona tool={<Gavel size={12} />} />}
              label="Fiscalía · Contraloría"
              title="La auditoría que llega antes del daño."
              body="Cola priorizada por riesgo con evidencia pre-armada — contratos, socios, sanciones, aportes políticos. Tú inicias la investigación formal sin gastar semanas cruzando portales."
              action="Acceso institucional →"
              href="/preguntas"
            />
          </div>
        </div>
      </section>

      {/* (Fuentes → ahora pestaña dentro de PlataformaTabs) */}

      {/* ─── QUIÉNES SOMOS · compacto a una pantalla ─── */}
      <section id="organizacion" className="container-page py-16 scroll-mt-20">
        {/* Header */}
        <div className="grid items-end gap-6 lg:grid-cols-[1.4fr,1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-moss/30 bg-moss/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-moss">
              <Heart size={11} className="fill-moss" /> Organización sin fines de lucro
            </div>
            <h2 className="mt-3 font-serif text-3xl font-bold leading-[1.05] tracking-tight text-ink sm:text-4xl">
              Construido para no
              <span className="text-rust"> depender de nadie</span>.
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-mute">
            Vigía Perú no recibe dinero del Estado, ni de empresas que contratan
            con él, ni de partidos políticos. La única forma de garantizar que el
            sistema publique <strong className="text-ink">lo que detecta</strong>,
            no lo que conviene.
          </p>
        </div>

        {/* 3 compromisos en grid horizontal compacto */}
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <CompromisoMini
            icon={<Code2 size={14} />}
            title="100% open source"
            body="Todo el código en GitHub. Una herramienta anticorrupción cerrada sería una contradicción."
          />
          <CompromisoMini
            icon={<Lock size={14} />}
            title="Sin conflictos de interés"
            body="Cero plata de empresas postoras o funcionarios. Donantes publicados con monto y fecha."
          />
          <CompromisoMini
            icon={<ShieldCheck size={14} />}
            title="Sin publicidad, sin venta de datos"
            body="Dictámenes, alertas y mapa son públicos. No hay producto premium escondido."
          />
        </div>

        {/* Cuentas claras + donación — fila horizontal */}
        <div className="mt-7 grid gap-0 overflow-hidden rounded-2xl border border-line bg-paperSoft lg:grid-cols-[1.5fr,1fr]">
          {/* Costos */}
          <div className="p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-clay">
                <Server size={10} /> Cuentas claras · mes pasado
              </div>
              <span className="font-mono text-[11px] text-mute">25 regiones</span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <CostoMini icon={<Sparkles size={12} />} label="Gemini 2.5" detail="~80 llamadas × 250 análisis" monto="S/. 412" color="rust" />
              <CostoMini icon={<Server size={12} />} label="Cloud Run + SQL" detail="Postgres 6.4M filas" monto="S/. 285" color="clay" />
              <CostoMini icon={<Database size={12} />} label="APIs externas" detail="SUNAT + Google Search" monto="S/. 148" color="moss" />
              <CostoMini icon={<Code2 size={12} />} label="Desarrollo" detail="2 personas part-time" monto="ad honorem" color="ink" />
            </div>

            <div className="mt-4 flex items-baseline justify-between rounded-xl bg-ink px-4 py-3 text-paper">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber">
                  Total mensual
                </div>
                <div className="text-[10px] text-paper/55">
                  17 donantes × S/. 50 lo cubren
                </div>
              </div>
              <div className="font-mono text-2xl font-bold text-amber">S/. 845</div>
            </div>
          </div>

          {/* CTA donar */}
          <div className="relative overflow-hidden border-t border-line bg-ink p-6 text-paper lg:border-l lg:border-t-0">
            <div className="absolute right-[-30px] top-[-30px] h-32 w-32 rounded-full bg-amber/15 blur-3xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber">
                <Heart size={10} className="fill-amber" /> Apoya el proyecto
              </div>
              <h3 className="mt-3 font-serif text-xl font-bold leading-tight">
                Donar mantiene la vigilancia <em className="text-amber">libre</em>.
              </h3>
              <p className="mt-2 text-[12px] leading-relaxed text-paper/70">
                Donar no compra influencia. Cada aporte se publica anonimizado en
                cuentas claras.
              </p>

              <Link
                href="/donar"
                className="mt-4 group flex w-full items-center justify-center gap-2 rounded-xl bg-amber px-4 py-3 text-sm font-semibold text-coal transition-transform hover:scale-[1.02]"
              >
                <Heart size={14} className="fill-rust text-rust" />
                Donar a Vigía Perú
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/preguntas#transparencia"
                className="mt-2 block text-center text-[11px] text-paper/55 underline-offset-2 hover:text-paper hover:underline"
              >
                Ver el balance público →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA FINAL ─── */}
      <section className="container-page py-24">
        <div className="relative isolate overflow-hidden rounded-3xl bg-ink p-10 text-paper sm:p-16">
          <div className="absolute inset-0 -z-10 opacity-30">
            <div
              className="absolute right-0 top-0 h-full w-full bg-gradient-to-l from-rust/50 via-rust/10 to-transparent"
            />
            <div
              className="absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage: `radial-gradient(circle, #F4EEDD 1px, transparent 1px)`,
                backgroundSize: "20px 20px",
              }}
            />
          </div>
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-paper/20 bg-paper/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber">
              <Sparkles size={11} /> Centro de mando en vivo
            </div>
            <h2 className="font-serif text-4xl font-bold leading-tight sm:text-6xl">
              Mientras lees esto,
              <br />
              <em className="text-amber">se firman contratos</em>.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-paper/80 sm:text-lg">
              Abre el mapa. Mira tu distrito. Haz clic en las regiones rojas.
              Cada bandera tiene fuente oficial, cada caso tiene dossier, cada
              dossier tiene un agente detrás trabajando ahora mismo.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app"
                className="group inline-flex items-center gap-2 rounded-full bg-paper px-7 py-4 text-base font-medium text-ink transition-transform hover:scale-[1.03] sm:text-lg"
              >
                Entrar a Vigía Perú
                <ArrowRight
                  size={20}
                  className="transition-transform group-hover:translate-x-1"
                />
              </Link>
              <Link
                href="/preguntas"
                className="inline-flex items-center gap-2 rounded-full border border-paper/30 px-7 py-4 text-base font-medium text-paper hover:bg-paper/10 sm:text-lg"
              >
                Preguntas frecuentes
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function DisconnectionDiagram() {
  const portales = [
    "OECE", "MEF", "SUNAT", "INFOBRAS", "ONPE", "JNE", "OSCE",
    "PIDE", "Poder Judicial", "Contraloría", "El Peruano", "OEFA",
    "SBS", "SUNARP",
  ];
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[1fr,auto,1fr]">
      {/* Antes: portales sueltos */}
      <div className="rounded-2xl border-2 border-dashed border-line bg-paperSoft p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Antes
          </div>
          <div className="font-mono text-xs text-mute">
            14 portales · 0 conexiones
          </div>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {portales.map((p, i) => (
            <li
              key={p}
              className="rounded-md border border-line bg-paper px-2 py-0.5 text-[10px] font-medium text-mute"
              style={{
                transform: `rotate(${((i * 37) % 5) - 2}deg)`,
              }}
            >
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <DiagStat n="14" label="portales" />
          <DiagStat n="8M" label="filas" />
          <DiagStat n="0" label="personas leyendo" tone="rust" />
        </div>
      </div>

      {/* Arrow + Vigía label */}
      <div className="flex flex-col items-center gap-3">
        <ArrowVisual />
        <div className="rounded-full bg-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-paper">
          Vigía agéntico
        </div>
        <ArrowVisual />
      </div>

      {/* Después: caso conectado */}
      <div className="rounded-2xl border-2 border-rust/30 bg-crimson-soft/40 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-rust">
            Después
          </div>
          <div className="font-mono text-xs text-rust/80">
            1 caso · evidencia conectada
          </div>
        </div>
        <ul className="space-y-1.5">
          {[
            { icon: "🏛", t: "Mun. Yungay adjudicó S/. 4.25M" },
            { icon: "🏢", t: "RUC creado 65 días antes" },
            { icon: "👤", t: "Socio sancionado por OSCE 2019" },
            { icon: "🪙", t: "Otro socio aportó S/. 35K al partido" },
            { icon: "👥", t: "Director es cuñado del alcalde" },
          ].map((row, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md border border-rust/20 bg-paper px-2.5 py-1 text-[11px]"
            >
              <span>{row.icon}</span>
              <span className="text-ink">{row.t}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <DiagStat n="3" label="personas" />
          <DiagStat n="14" label="fuentes" />
          <DiagStat n="91" label="score" tone="rust" />
        </div>
      </div>
    </div>
  );
}

function DiagStat({
  n,
  label,
  tone = "ink",
}: {
  n: string;
  label: string;
  tone?: "ink" | "rust";
}) {
  return (
    <div className="rounded-lg bg-paperDeep px-1.5 py-1">
      <div
        className={
          "font-mono text-base font-bold leading-none " +
          (tone === "rust" ? "text-rust" : "text-ink")
        }
      >
        {n}
      </div>
      <div className="text-[8.5px] uppercase tracking-wider text-mute">
        {label}
      </div>
    </div>
  );
}

function ArrowVisual() {
  return (
    <svg
      width="40"
      height="28"
      viewBox="0 0 40 28"
      fill="none"
      className="text-clay"
    >
      <path
        d="M2 14 L 30 14 M 24 8 L 30 14 L 24 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroCaseMockup() {
  return (
    <div className="relative mx-auto max-w-md">
      {/* Tarjeta fantasma detrás */}
      <div
        aria-hidden
        className="absolute -right-3 -top-3 h-full w-full -rotate-3 rounded-3xl border border-line bg-paperDeep shadow-card"
      />
      <div
        aria-hidden
        className="absolute -left-2 top-3 h-full w-full rotate-2 rounded-3xl border border-line bg-paperSoft shadow-card opacity-80"
      />

      {/* Tarjeta principal */}
      <div className="relative animate-floatYSm rounded-3xl border border-line bg-paper p-6 shadow-paper">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-coal px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-paper">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              Caso convergente
            </span>
            <span className="font-mono text-[10px] text-mute">ALT-2026-0005</span>
          </div>
          <ExternalLinkIcon />
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="relative flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-rust text-paper shadow-card">
            <span
              aria-hidden
              className="absolute inset-0 rounded-2xl bg-gradient-to-br from-paper/15 to-transparent"
            />
            <span className="font-serif text-3xl font-bold leading-none">91</span>
            <span className="mt-1 text-[8px] uppercase tracking-widest opacity-80">
              / 100 score
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-mute">
              Adjudicado a
            </div>
            <div className="font-serif text-lg font-bold leading-tight text-ink">
              CORPORACIÓN VIAL RANRAHIRCA SAC
            </div>
            <div className="mt-0.5 text-xs text-mute">
              Yungay · Áncash · S/. 4.25M · 65 días de RUC
            </div>
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {[
            { label: "RUC creado hace 65 días", art: "Funes C1", sev: "alta" },
            { label: "Único postor al 99.8%", art: "C2 · OECE D008-2025", sev: "alta" },
            { label: "Socio con sanción OSCE 2019", art: "Art. 50 TUO", sev: "alta" },
            { label: "Aporte ONPE al partido del alcalde", art: "C3 · Funes", sev: "media" },
          ].map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-lg border border-line bg-paperSoft px-3 py-1.5 text-[11px]"
            >
              <span
                className={
                  "h-1.5 w-1.5 shrink-0 rounded-full " +
                  (f.sev === "alta" ? "bg-rust" : "bg-amber")
                }
              />
              <span className="line-clamp-1 flex-1 text-ink">{f.label}</span>
              <span className="shrink-0 font-mono text-[9px] text-mute">
                {f.art}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-coal px-3 py-2 text-paper">
          <span className="inline-flex items-center gap-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            <span className="uppercase tracking-widest">Reporte ciudadano</span>
          </span>
          <span className="font-mono text-[10px] text-paper/70">RPT-2026-0058</span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { v: "3", l: "personas" },
            { v: "14", l: "fuentes" },
            { v: "5", l: "señales" },
          ].map((s) => (
            <div key={s.l} className="rounded-lg bg-paperDeep px-2 py-1.5">
              <div className="font-mono text-sm font-bold text-ink">{s.v}</div>
              <div className="text-[8px] uppercase tracking-widest text-mute">
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Badge flotante */}
      <div
        className="absolute -bottom-4 -left-6 animate-floatYSm rounded-2xl border border-line bg-paper px-4 py-2.5 shadow-card"
        style={{ animationDelay: "1s" }}
      >
        <div className="text-[9px] font-bold uppercase tracking-widest text-clay">
          Dossier IA listo en
        </div>
        <div className="font-mono text-xl font-bold text-ink">
          2 <span className="text-sm text-mute">min</span>
        </div>
      </div>

      {/* Badge agentes */}
      <div
        className="absolute -right-2 top-12 animate-floatYSm rounded-full border border-line bg-paper px-3 py-1.5 shadow-card"
        style={{ animationDelay: "0.5s" }}
      >
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" />
          <span className="font-mono text-ink">5 agentes activos</span>
        </div>
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-mute"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function DetectionCard({
  tilt,
  tag,
  tagColor,
  title,
  location,
  score,
  flags,
  article,
  featured,
}: {
  tilt: number;
  tag: string;
  tagColor: "rust" | "amber";
  title: string;
  location: string;
  score: number;
  flags: string[];
  article: string;
  featured?: boolean;
}) {
  return (
    <article
      className={
        "surface relative overflow-hidden p-5 transition-all hover:rotate-0 hover:scale-[1.02] hover:shadow-paper " +
        (featured ? "border-2 border-rust/40 bg-crimson-soft/40" : "")
      }
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest " +
            (tagColor === "rust"
              ? "bg-rust text-paper"
              : "bg-amber text-paper")
          }
        >
          {tag}
        </span>
        <div
          className={
            "flex h-11 w-11 flex-col items-center justify-center rounded-xl text-paper " +
            (score >= 85 ? "bg-rust" : score >= 70 ? "bg-clay" : "bg-amber")
          }
        >
          <span className="font-serif text-base font-bold leading-none">{score}</span>
          <span className="text-[7px] uppercase tracking-wider opacity-80">/ 100</span>
        </div>
      </div>
      <h3 className="mt-3 font-serif text-lg font-bold leading-tight text-ink">
        {title}
      </h3>
      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-mute">
        <MapPin size={10} /> {location}
      </div>
      <ul className="mt-4 space-y-1.5">
        {flags.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-ink">
            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-rust" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 inline-flex items-center gap-1 rounded-full bg-paperDeep px-2 py-0.5 font-mono text-[9px] text-mute">
        <Scale size={9} /> {article}
      </div>
    </article>
  );
}

function BigStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint: string;
  accent: string;
}) {
  return (
    <div className="text-center">
      <div className="text-xs uppercase tracking-wider text-mute">{label}</div>
      <div className={`mt-1 font-serif text-5xl font-bold leading-none ${accent} sm:text-6xl`}>
        <NumberTicker value={value} duration={1800} />
      </div>
      <div className="mt-2 text-xs text-mute">{hint}</div>
    </div>
  );
}

function CompromisoMini({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink text-paper">
          {icon}
        </span>
        <h3 className="font-serif text-sm font-bold leading-tight text-ink">
          {title}
        </h3>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-mute">{body}</p>
    </div>
  );
}

function CostoMini({
  icon,
  label,
  detail,
  monto,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  monto: string;
  color: "rust" | "clay" | "moss" | "ink";
}) {
  const colorMap = {
    rust: "bg-rust/10 text-rust",
    clay: "bg-clay/10 text-clay",
    moss: "bg-moss/15 text-moss",
    ink: "bg-ink/10 text-ink",
  };
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-paper p-2.5">
      <span
        className={
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md " +
          colorMap[color]
        }
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate text-[12px] font-semibold text-ink">{label}</div>
        <div className="truncate text-[10px] text-mute">{detail}</div>
      </div>
      <div className="font-mono text-[12px] font-bold text-ink">{monto}</div>
    </div>
  );
}

function PipelineMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-paper/15 bg-paper/[0.04] px-3 py-2 text-center">
      <div className="font-mono text-lg font-bold leading-none text-amber sm:text-xl">{value}</div>
      <div className="mt-1 text-[9px] uppercase tracking-widest text-paper/55">{label}</div>
    </div>
  );
}

const FUENTES = [
  { nombre: "OECE", subtitle: "Contrataciones Abiertas OCDS 1.1", tag: "API en vivo" },
  { nombre: "MEF", subtitle: "Datos Abiertos · 8M filas presupuesto", tag: "API CKAN" },
  { nombre: "SUNAT", subtitle: "Consulta RUC vía apis.net.pe", tag: "API tokenizada" },
  { nombre: "INFOBRAS", subtitle: "Contraloría · avance físico obras", tag: "Scraping" },
  { nombre: "ONPE", subtitle: "Portal Claridad · aportes campaña", tag: "Scraping" },
  { nombre: "JNE", subtitle: "Plataforma Electoral · hojas vida", tag: "Scraping + PDF" },
  { nombre: "OSCE", subtitle: "Registro de inhabilitados", tag: "Web público" },
  { nombre: "PIDE", subtitle: "Declaración Jurada Intereses", tag: "Web público" },
  { nombre: "Poder Judicial", subtitle: "CEJ · expedientes judiciales", tag: "Scraping" },
  { nombre: "Contraloría DJBR", subtitle: "Declaración Jurada Bienes y Rentas", tag: "Web público" },
  { nombre: "El Peruano", subtitle: "Normas Legales · designaciones", tag: "Scraping + PDF" },
  { nombre: "OEFA / SBS / SUNARP", subtitle: "Sanciones · PEPs · partidas", tag: "Multi-fuente" },
];

function FuenteCard({
  nombre,
  subtitle,
  tag,
}: {
  nombre: string;
  subtitle: string;
  tag: string;
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-base font-bold text-ink">{nombre}</h3>
        <span className="rounded-full bg-paperDeep px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-mute">
          {tag}
        </span>
      </div>
      <p className="mt-1 text-xs text-mute">{subtitle}</p>
    </div>
  );
}

/** Silueta de persona + su herramienta (badge). SVG humano para "Para quién". */
function Persona({ tool }: { tool: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden>
        <circle cx="20" cy="13.5" r="6.5" fill="currentColor" />
        <path d="M6 38 C6 27.5 12.8 23.5 20 23.5 C27.2 23.5 34 27.5 34 38 Z" fill="currentColor" />
      </svg>
      <span className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber text-ink shadow ring-2 ring-paperSoft">
        {tool}
      </span>
    </span>
  );
}

function AudienceCard({
  icon,
  label,
  title,
  body,
  action,
  href,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  action: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group surface flex flex-col gap-3 p-6 transition-all hover:shadow-paper " +
        (accent ? "border-2 border-clay bg-amber-soft" : "")
      }
    >
      <div className="flex items-center gap-3">
        <span
          className={
            "relative flex h-14 w-14 items-center justify-center rounded-2xl " +
            (accent ? "bg-clay text-paper" : "bg-ink text-paper")
          }
        >
          {icon}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-clay">
          {label}
        </span>
      </div>
      <h3 className="font-serif text-xl font-bold leading-tight text-ink">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-mute">{body}</p>
      <span className="mt-auto pt-1 text-sm font-medium text-ink group-hover:underline">
        {action}
      </span>
    </Link>
  );
}

