import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Newspaper, Camera, Gavel, MapPin } from "lucide-react";
import { HeroCompacto } from "@/components/landing/HeroCompacto";
import { LaBrecha } from "@/components/landing/LaBrecha";
import { ComoFuncionaCompacto } from "@/components/landing/ComoFuncionaCompacto";
import { PipelineAgentes } from "@/components/landing/PipelineAgentes";
import { FuentesSection } from "@/components/landing/FuentesSection";
import { AliadosSection } from "@/components/landing/AliadosSection";
import { ConfianzaSection } from "@/components/landing/ConfianzaSection";
import { ExpansionSection } from "@/components/landing/ExpansionSection";
import { BlurFade } from "@/components/magicui/BlurFade";
import { getAlertas } from "@/lib/api-client";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { ALERTAS_MOCK } from "@/lib/mock-data";

// El metadata de una page gana sobre el de app/layout.tsx solo para esta ruta — así "/"
// deja de anunciarse con "corrupción" + gancho de urgencia (clickbait) sin tocar el
// layout compartido por todo el sitio.
export const metadata: Metadata = {
  title: "Vigía Perú — Contrataciones públicas del Perú, leídas por IA, en un mapa",
  description:
    "Plataforma cívica que cruza SEACE, OECE y 14 portales del Estado para señalar riesgo en contratos públicos, con norma y evidencia oficial. Explora el mapa, financia una auditoría o denuncia una obra.",
};

/**
 * Landing compacta (un solo mapa): hero+mapa → en vivo → cómo funciona (+ qué
 * detecta) → los diez agentes → de dónde sale cada dato → aliados → denuncia
 * ciudadana → confianza → expansión → CTA.
 *
 * Lo que se fue: `FeatureHighlights`, cuatro cajas de ícono+título+párrafo
 * ("Datos abiertos", "Agentes de IA", "Participación ciudadana", "Un Perú más
 * transparente"). Dos de las cuatro son exactamente lo que ahora dicen
 * `PipelineAgentes` y `FuentesSection` con el grafo real y las fuentes con
 * enlace; repetirlas arriba en versión genérica era decir dos veces lo mismo, la
 * segunda peor. Las otras dos ya las sostienen la sección de denuncia ciudadana
 * y el cierre.
 */
export default async function LandingPage() {
  // Las tres lecturas en paralelo: son independientes y una en serie le sumaba
  // el round-trip de las otras dos al primer byte de la portada.
  const [alertas, estado, resumen] = await Promise.all([
    getAlertas({ limit: 50 }).catch(() => [] as any[]),
    getEstadoGlobal().catch(() => null),
    getResumenContratos().catch(() => null),
  ]);
  // Muestra de una ventana reciente (por fecha de buena pro), no un top estricto por
  // score: un ranking estricto satura en "score 100" apenas 8+ contratos empatan en el
  // techo — un feed "en vivo" donde todo está al máximo de alarma lee como demo, no
  // como evidencia real. Ordenar por recencia además encaja mejor con "en vivo".
  const topAlerts = [...(alertas.length > 0 ? alertas : ALERTAS_MOCK)]
    .filter((a) => a.score != null)
    .sort((a, b) => (b.fechaBuenaPro ?? "").localeCompare(a.fechaBuenaPro ?? ""))
    .slice(0, 8);

  // Sin el resumen, la sección NO se dibuja. Una portada que estima cuántos
  // contratos quedaron sin leer es justo el tipo de dato que este producto le
  // reprocha al Estado — y el mock de alertas puede rellenar un ticker, nunca la
  // cifra que sostiene el argumento entero.
  //
  // Las tres cifras salen del MISMO resumen, o sea del mismo universo. "Leído" es
  // "tiene score", que es la misma definición que usa /app/contratos para decir
  // "98 leídos de 18 394": si acá se usara el `contratosProcesados` de
  // `getEstadoGlobal` —que cuenta sólo lo financiado por aliados— la portada
  // diría 33 y la página de contratos 98, con el mismo rótulo.
  const publicados = resumen?.total ?? 0;
  const brecha =
    resumen && publicados > 0
      ? {
          publicados,
          leidos:
            (resumen.porRiesgo.alto ?? 0) + (resumen.porRiesgo.medio ?? 0) + (resumen.porRiesgo.bajo ?? 0),
          senalAlta: resumen.porRiesgo.alto ?? 0,
          precioPen: estado?.tarifa.precioPen ?? null,
        }
      : null;

  return (
    <>
      <HeroCompacto />

      {brecha && <LaBrecha {...brecha} alertas={topAlerts} />}

      <ComoFuncionaCompacto />

      {/* El paso 3 de "cómo funciona" dice "diez agentes los leen". Estas dos
          secciones son la prueba de esa frase, y van pegadas a ella: primero
          quiénes son los diez, después de dónde sacan lo que dicen. */}
      <PipelineAgentes />

      <FuentesSection />

      <AliadosSection />

      {/* border-t: sin esto, esta sección y AliadosSection (las dos sin bg propio) se
          fusionaban en un bloque blanco de ~190px sin nada — dos paddings de sección
          apilados sin ningún ancla visual entre medio. */}
      <section id="denunciar" className="relative overflow-hidden scroll-mt-20 border-t border-line bg-gradient-to-b from-heroViolet/[0.04] to-transparent py-16">
        <div className="container-page max-w-[1600px]">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-rust/25 bg-rust/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-rust">
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
            <p className="mt-2 text-[13px] text-mute">
              No mostramos tu DNI ni tu nombre. Si dejas un correo es solo para contactarte —{" "}
              <Link href="/preguntas" className="underline-offset-2 hover:underline">nunca se publica</Link>.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/reporte/nuevo"
                className="group inline-flex items-center gap-2 rounded-full bg-rust px-6 py-3.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0"
              >
                <Camera size={16} /> Denunciar una obra
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            <BlurFade delayMs={0}>
              <AudienceCard
                icon={<Persona tool={<Camera size={12} />} />}
                label="Ciudadano"
                title="Reportas lo que ves. El mapa hace el resto."
                body="Obra paralizada, fantasma, sobreprecio o calidad deficiente. Pin rojo + alerta automática sobre el mismo contrato = caso convergente público."
                action="Ver las denuncias publicadas →"
                href="/app/denuncias"
                accent
              />
            </BlurFade>
            <BlurFade delayMs={90}>
              <AudienceCard
                icon={<Persona tool={<Newspaper size={12} />} />}
                label="Periodista"
                title="Tres meses de investigación, en tres minutos."
                body="Cada contrato procesado deja un dictamen con red de personas, señales que citan artículo de ley y opiniones OECE, y links a las fuentes oficiales. Tú verificas y publicas."
                action="Ver la auditoría en vivo →"
                href="/app/auditoria"
              />
            </BlurFade>
            <BlurFade delayMs={180}>
              <AudienceCard
                icon={<Persona tool={<Gavel size={12} />} />}
                label="Fiscalía y Contraloría"
                title="La auditoría que llega antes del daño."
                body="Cola priorizada por riesgo con evidencia pre-armada — contratos, socios, sanciones, aportes políticos. Tú inicias la investigación formal sin gastar semanas cruzando portales."
                action="Acceso institucional →"
                href="/preguntas"
              />
            </BlurFade>
          </div>
        </div>
      </section>

      <ConfianzaSection />

      <ExpansionSection />

      {/* ─── CTA FINAL ─── */}
      {/* pt-14, no pt-24: ExpansionSection ya cierra con su propio py-16 — sumado al
          padding de acá eran 160px de blanco antes de esta card, sin ningún corte visual
          entre medio (mismo problema que ya se corrigió entre Aliados y Denuncia). El
          mt-20 de Footer.tsx ya separa del footer por su cuenta, no hace falta acá.
          heroViolet, no el vino del isotipo: el logo se queda fijo, pero el cierre de la
          página tiene que hilar con el mismo acento violeta que ya usan el header, el
          footer y el resto del sitio — dos marcas distintas en la misma pantalla era
          justo la inconsistencia que se pidió eliminar. */}
      <section className="container-page max-w-[1600px] pt-14">
        <BlurFade as="div" y={20} className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-heroViolet to-heroViolet-deep p-10 text-paper shadow-paper sm:p-16">
          <div className="absolute inset-0 -z-10 opacity-40">
            <div className="absolute right-0 top-0 h-full w-full bg-gradient-to-l from-heroGreen/35 to-transparent" />
            <div
              className="absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage: `radial-gradient(circle, #F4EEDD 1px, transparent 1px)`,
                backgroundSize: "20px 20px",
              }}
            />
          </div>
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-heroGreen/30 bg-heroGreen/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-heroGreenTexto">
              <MapPin size={11} /> El mapa, en vivo
            </div>
            <h2 className="font-serif text-4xl font-bold leading-tight sm:text-6xl">
              Mientras lees esto,
              <br />
              <em className="text-heroGreen not-italic">se firman contratos</em>.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-paper/80 sm:text-lg">
              Abre el mapa. Elige tu región. Mira cuántos contratos esperan ser leídos, financia su
              auditoría o denuncia la obra que tienes enfrente. Cada señal tiene fuente oficial, cada caso
              tiene dossier.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app/mapa"
                className="group inline-flex items-center gap-2 rounded-full bg-heroGreen px-7 py-4 text-base font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0 sm:text-lg"
              >
                Abrir el mapa
                <ArrowRight size={20} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/preguntas"
                className="inline-flex items-center gap-2 rounded-full border border-paper/30 px-7 py-4 text-base font-medium text-paper shadow-card transition-all hover:-translate-y-0.5 hover:bg-paper/10 hover:shadow-paper sm:text-lg"
              >
                Preguntas frecuentes
              </Link>
            </div>
          </div>
        </BlurFade>
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
      <span className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-heroGreen text-paper shadow ring-2 ring-paperSoft">
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
        "group flex flex-col gap-3 rounded-3xl border p-6 shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-paper " +
        (accent ? "border-rust/30 bg-crimson-soft/40" : "border-line bg-paper")
      }
    >
      <div className="flex items-center gap-3">
        <span
          className={
            "relative flex h-14 w-14 items-center justify-center rounded-2xl " +
            (accent ? "bg-rust text-paper" : "bg-heroViolet text-paper")
          }
        >
          {icon}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-heroViolet">
          {label}
        </span>
      </div>
      <h3 className="font-serif text-xl font-bold leading-tight text-ink">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-mute">{body}</p>
      <span className="mt-auto pt-1 text-sm font-semibold text-heroGreenTexto group-hover:underline">
        {action}
      </span>
    </Link>
  );
}
