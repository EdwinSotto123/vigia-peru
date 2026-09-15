import Link from "next/link";
import { ArrowRight, Newspaper, Camera, Gavel, MapPin } from "lucide-react";
import { HeroCompacto } from "@/components/landing/HeroCompacto";
import { ComoFuncionaCompacto } from "@/components/landing/ComoFuncionaCompacto";
import { AliadosSection } from "@/components/landing/AliadosSection";
import { ConfianzaSection } from "@/components/landing/ConfianzaSection";
import { Marquee } from "@/components/magicui/Marquee";
import { getAlertas } from "@/lib/api-client";
import { ALERTAS_MOCK, formatSoles } from "@/lib/mock-data";

/**
 * Landing compacta (un solo mapa): hero+mapa → cómo funciona (+ qué detecta) →
 * aliados (+ cifras de financiamiento) → denuncia ciudadana → confianza → CTA.
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
      <HeroCompacto />

      {/* ─── EN VIVO · alertas reales ─── */}
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

      <ComoFuncionaCompacto />

      <AliadosSection />

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
              href="/app/auditoria"
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

      <ConfianzaSection />

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
