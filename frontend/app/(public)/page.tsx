import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Database,
  ShieldCheck,
  Newspaper,
  Camera,
  Gavel,
  Heart,
  Code2,
  Lock,
  Server,
  MapPin,
} from "lucide-react";
import { CinematicHero } from "@/components/landing/CinematicHero";
import { DetectionCarousel } from "@/components/landing/DetectionCarousel";
import { MapaHubSection } from "@/components/landing/MapaHubSection";
import { ComoFunciona } from "@/components/landing/ComoFunciona";
import { FinanciaSection } from "@/components/landing/FinanciaSection";
import { AliadosSection } from "@/components/landing/AliadosSection";
import { PlataformaTabs } from "@/components/landing/PlataformaTabs";
import { SectionDots } from "@/components/landing/SectionDots";
import { Marquee } from "@/components/magicui/Marquee";
import { getAlertas } from "@/lib/api-client";
import { ALERTAS_MOCK, formatSoles } from "@/lib/mock-data";

/**
 * Landing. Orden = recorrido del producto: hero → el mapa como interfaz →
 * cómo funciona → financiar → aliados → denunciar → plataforma → quiénes somos → CTA.
 */
export default async function LandingPage() {
  // Marquee "en vivo": alertas reales; el mock solo si el API no responde.
  let alertas: any[] = [];
  try {
    alertas = await getAlertas({ limit: 50 });
  } catch {
    alertas = [];
  }
  const topAlerts = [...(alertas.length > 0 ? alertas : ALERTAS_MOCK)]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  return (
    <>
      <SectionDots />

      {/* ─── HERO cinematográfico ─── */}
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
            {topAlerts.map((a: any) => (
              <div key={a.id ?? a.codigo} className="flex items-center gap-2 whitespace-nowrap text-xs">
                <span className="rounded bg-rust/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rust">
                  score {a.score}
                </span>
                <span className="text-mute">{a.region}</span>
                <span className="text-mute">·</span>
                <span className="max-w-[400px] truncate text-ink">{a.objeto}</span>
                <span className="text-mute">·</span>
                <span className="font-mono text-clay">{formatSoles(a.montoSoles ?? 0)}</span>
              </div>
            ))}
          </Marquee>
        </div>
      </section>

      {/* ─── EL MAPA ES LA INTERFAZ · cola, procesados hoy, señales ─── */}
      <MapaHubSection />

      {/* ─── CÓMO FUNCIONA · 3 pasos ─── */}
      <ComoFunciona />

      {/* ─── QUÉ DETECTA · señales de riesgo ─── */}
      <section id="detecta" className="container-page py-20 scroll-mt-20">
        <div className="mb-8 max-w-2xl">
          <span className="text-[11px] font-medium uppercase tracking-wide text-mute">Qué detecta</span>
          <h2 className="mt-2 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Señales de riesgo que los 11 agentes buscan en cada contrato
          </h2>
          <p className="mt-3 text-mute">
            Cada bandera cita la norma y la opinión del OECE que la sustenta, y enlaza a la evidencia oficial.
            Señalamos patrones; no acusamos.
          </p>
        </div>
        <DetectionCarousel />
      </section>

      {/* ─── FINANCIA UNA AUDITORÍA ─── */}
      <FinanciaSection />

      {/* ─── ALIADOS · gracias a… ─── */}
      <AliadosSection />

      {/* ─── DENUNCIA CIUDADANA ─── */}
      <section id="denunciar" className="scroll-mt-20 py-20">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
              <Camera size={11} /> Denuncia ciudadana
            </div>
            <h2 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-5xl">
              Tu foto vale más que <span className="text-rust">mil acusaciones</span>.
            </h2>
            <p className="mt-3 text-mute">
              Ves la obra paralizada, tomas la foto, marcas la ubicación. El sistema cruza tu reporte con los
              contratos del Estado y lo pone en el mapa. Anónimo por defecto; dos reportes independientes del
              mismo punto en 30 días lo confirman.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/reporte/nuevo"
                className="group inline-flex items-center gap-2 rounded-xl bg-rust px-6 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]"
              >
                <Camera size={16} /> Denunciar una obra
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/app/denuncias"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-6 py-3 text-sm font-semibold text-ink hover:bg-paperDeep"
              >
                Ver las denuncias publicadas
              </Link>
            </div>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <AudienceCard
              icon={<Persona tool={<Camera size={12} />} />}
              label="Ciudadano"
              title="Reportas lo que ves. El mapa hace el resto."
              body="Obra paralizada, fantasma, sobreprecio o calidad deficiente. Pin rojo + alerta automática sobre el mismo contrato = caso convergente público."
              action="Reportar algo →"
              href="/reporte/nuevo"
              accent
            />
            <AudienceCard
              icon={<Persona tool={<Newspaper size={12} />} />}
              label="Periodista"
              title="Tres meses de investigación, en tres minutos."
              body="Cada contrato procesado deja un dictamen con red de personas, señales que citan artículo de ley y opiniones OECE, y links a las fuentes oficiales. Tú verificas y publicas."
              action="Ver la auditoría en vivo →"
              href="/auditoria"
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

      {/* ─── LA PLATAFORMA · pestañas (cómo lo hace · motor · fuentes) ─── */}
      <PlataformaTabs />

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
            body="Cero plata de empresas postoras o funcionarios. Aliados publicados con contratos financiados y fecha."
          />
          <CompromisoMini
            icon={<ShieldCheck size={14} />}
            title="Sin publicidad, sin venta de datos"
            body="Dictámenes, alertas y mapa son públicos. No hay producto premium escondido."
          />
        </div>

        {/* Cuentas claras + financiar — fila horizontal */}
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
                  17 aliados × S/. 50 lo cubren
                </div>
              </div>
              <div className="font-mono text-2xl font-bold text-amber">S/. 845</div>
            </div>
          </div>

          {/* CTA financiar */}
          <div className="relative overflow-hidden border-t border-line bg-ink p-6 text-paper lg:border-l lg:border-t-0">
            <div className="absolute right-[-30px] top-[-30px] h-32 w-32 rounded-full bg-amber/15 blur-3xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber">
                <Heart size={10} className="fill-amber" /> Apoya el proyecto
              </div>
              <h3 className="mt-3 font-serif text-xl font-bold leading-tight">
                Financiar una auditoría mantiene la vigilancia <em className="text-amber">libre</em>.
              </h3>
              <p className="mt-2 text-[12px] leading-relaxed text-paper/70">
                Financias capacidad de análisis, no resultados. Cada aporte tiene un
                comprobante público con los contratos que hizo posible leer.
              </p>

              <Link
                href="/financiar"
                className="mt-4 group flex w-full items-center justify-center gap-2 rounded-xl bg-amber px-4 py-3 text-sm font-semibold text-coal transition-transform hover:scale-[1.02]"
              >
                <Heart size={14} className="fill-rust text-rust" />
                Financiar una auditoría
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
            <div className="absolute right-0 top-0 h-full w-full bg-gradient-to-l from-rust/50 via-rust/10 to-transparent" />
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
              <MapPin size={11} /> El mapa, en vivo
            </div>
            <h2 className="font-serif text-4xl font-bold leading-tight sm:text-6xl">
              Mientras lees esto,
              <br />
              <em className="text-amber">se firman contratos</em>.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-paper/80 sm:text-lg">
              Abre el mapa. Elige tu región. Mira cuántos contratos esperan ser leídos, financia su
              auditoría o denuncia la obra que tienes enfrente. Cada señal tiene fuente oficial, cada caso
              tiene dossier.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app/mapa"
                className="group inline-flex items-center gap-2 rounded-full bg-paper px-7 py-4 text-base font-medium text-ink transition-transform hover:scale-[1.03] sm:text-lg"
              >
                Abrir el mapa
                <ArrowRight size={20} className="transition-transform group-hover:translate-x-1" />
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

/** Silueta de persona + su herramienta (badge). SVG humano para las tarjetas de audiencia. */
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
        (accent ? "border-2 border-rust/40 bg-crimson-soft/40" : "")
      }
    >
      <div className="flex items-center gap-3">
        <span
          className={
            "relative flex h-14 w-14 items-center justify-center rounded-2xl " +
            (accent ? "bg-rust text-paper" : "bg-ink text-paper")
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
