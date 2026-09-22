import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Eye } from "lucide-react";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";
import { KpiTile } from "@/components/aliados/KpiTile";
import { PulseDot } from "@/components/ui/PulseDot";
import { BlurFade } from "@/components/magicui/BlurFade";
import { API_BASE } from "@/lib/api-client";

export const revalidate = 30;

/** Filas de "Contribuciones" que se muestran directo, sin interacción — un aliado
 * prolífico (muchos contratos financiados, cada uno con su propio código) puede acumular
 * decenas de filas; sin tope la ficha se vuelve una sola lista larga para scrollear. El
 * resto queda detrás de un <details> nativo (sin JS, sin nuevo fetch: son los mismos
 * datos ya traídos por getAliado, solo recortados para la primera pintura). */
const CONTRIB_VISIBLES = 8;

interface Aliado { id: number; tipo: "empresa" | "persona" | "organizacion"; nombre: string; slug: string; logoUrl: string | null; desde: string }
interface Contrib { codigo: string; contratos: number; estado: string; pagadaAt: string; ubigeo: string; zona: string; nivel: string; procesados: number; senales: number; enRevision?: number }

/**
 * Mismo vocabulario y colores que ESTADO_UI en lib/admin.ts (panel de contribuciones):
 * copiado aquí en vez de importado porque ese módulo es del panel admin y esta es una
 * página pública — misma paleta visual, sin acoplar una sección a la otra.
 */
const ESTADO_CONTRIB: Record<string, { label: string; cls: string }> = {
  pendiente_pago: { label: "Pendiente", cls: "bg-amber-soft text-amber" },
  pagada: { label: "Pagada", cls: "bg-moss/10 text-moss" },
  en_proceso: { label: "En proceso", cls: "bg-moss/10 text-moss" },
  procesada: { label: "Procesada", cls: "bg-moss text-paper" },
  rechazada: { label: "Rechazada", cls: "bg-crimson-soft text-crimson" },
  reembolsada: { label: "Reembolsada", cls: "bg-paperDeep text-mute" },
};

/** El punto pulsante solo va en "en_proceso" (agentes leyendo contratos ahora mismo) —
 * mismo criterio que EstadoPill.tsx: el punto pulsante siempre significa "en curso". */
function PildoraEstado({ estado }: { estado: string }) {
  const cfg = ESTADO_CONTRIB[estado] ?? { label: estado.replace(/_/g, " "), cls: "bg-paperDeep text-mute" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {estado === "en_proceso" && <PulseDot color="moss" size={5} />}
      {cfg.label}
    </span>
  );
}

/** Contenido de una fila de "Contribuciones" — factorizado porque ahora se renderiza
 * desde dos sitios (las visibles con BlurFade y el resto dentro del <details>) y antes
 * era JSX inline que se hubiera tenido que duplicar entero. */
function FilaContribucion({ c }: { c: Contrib }) {
  return (
    <>
      <div>
        <Link href={`/impacto/${c.codigo}`} className="font-mono text-ink hover:underline">{c.codigo}</Link>
        <span className="text-mute"> · </span>
        <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold hover:underline">{c.zona}</Link>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mute">
          <span>{new Date(c.pagadaAt).toLocaleDateString("es-PE")}</span>
          <PildoraEstado estado={c.estado} />
        </div>
      </div>
      <div className="text-right font-mono text-sm text-ink">
        {c.procesados}/{c.contratos}
        <div className="text-[10px] uppercase text-mute">{c.senales} señales{(c.enRevision ?? 0) > 0 ? ` · ${c.enRevision} en revisión` : ""}</div>
      </div>
    </>
  );
}

async function getAliado(slug: string): Promise<{ aliado: Aliado; contribuciones: Contrib[] } | null> {
  try {
    const r = await fetch(`${API_BASE}/financiamiento/aliados/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } } as any);
    if (r.ok) return await r.json();
  } catch { /* 404 abajo */ }
  return null;
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getAliado(params.slug);
  if (!data) return { title: "Aliado no encontrado — Vigía Perú" };
  const total = data.contribuciones.reduce((n, c) => n + c.contratos, 0);
  const senales = data.contribuciones.reduce((n, c) => n + c.senales, 0);
  const description = `${data.aliado.nombre} financió la auditoría de ${total} contratos públicos${senales > 0 ? ` · ${senales} señales de riesgo halladas` : ""}. Reconocimiento público y verificable.`;
  return {
    title: `${data.aliado.nombre} — Aliado de transparencia · Vigía Perú`,
    description,
    openGraph: { title: `${data.aliado.nombre} — Aliado de transparencia`, description },
    twitter: { card: "summary" },
  };
}

export default async function AliadoPage({ params }: { params: { slug: string } }) {
  const data = await getAliado(params.slug);
  if (!data) notFound();
  const { aliado, contribuciones } = data;
  const total = contribuciones.reduce((n, c) => n + c.contratos, 0);
  const procesados = contribuciones.reduce((n, c) => n + c.procesados, 0);
  const senales = contribuciones.reduce((n, c) => n + c.senales, 0);
  const enRevision = contribuciones.reduce((n, c) => n + (c.enRevision ?? 0), 0);
  const zonas = new Set(contribuciones.map((c) => c.ubigeo)).size;
  const contribVisibles = contribuciones.slice(0, CONTRIB_VISIBLES);
  const contribResto = contribuciones.slice(CONTRIB_VISIBLES);

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/app/aliados" className="inline-flex items-center gap-1.5 text-sm text-mute transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Aliados de transparencia
        </Link>

        {/* Ficha propia del aliado: la única página que existe para celebrar a esta empresa/
            persona en particular (el resto del sitio lo muestra de paso, en una fila o un
            puesto del podio) — merecía más que un avatar de 56px en texto plano. Mismo acento
            decorativo sutil que ya usa el puesto 1 del podio (Podio.tsx), no uno nuevo. */}
        <div className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-paper p-6 shadow-card sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-heroViolet/[0.06] blur-3xl" />
          <div className="flex items-center gap-5">
            <AvatarAliado tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} size="xl" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-heroViolet">
                {aliado.slug === "vigia-peru" ? "Fundador · capital semilla" : `Aliado de transparencia · ${aliado.tipo}`}
              </div>
              <h1 className="mt-0.5 font-serif text-3xl font-bold text-ink sm:text-4xl">{aliado.nombre}</h1>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Contratos financiados" value={total} />
          <KpiTile
            label="Procesados"
            value={procesados}
            valueTone="verde"
            hint={enRevision > 0 ? `${enRevision} en revisión humana` : undefined}
            hintTone="clay"
          />
          <KpiTile
            label="Señales halladas"
            value={senales}
            valueTone={senales > 0 ? "rust" : undefined}
            hint="contratos con dictamen publicado y ≥ 1 señal"
          />
          <KpiTile label="Zonas apoyadas" value={zonas} />
        </div>
        {enRevision > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[12px] leading-relaxed text-mute">
            <Eye size={14} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <span>
              <strong className="text-clay">{enRevision}</strong> de los {procesados} procesados {enRevision === 1 ? "espera" : "esperan"} revisión humana: la autoevaluación del análisis
              no alcanzó el umbral para publicar y una persona decide. No cuentan como señales halladas.
            </span>
          </div>
        )}

        <h2 className="mt-8 font-semibold text-ink">Contribuciones</h2>
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {contribVisibles.map((c, i) => (
            <BlurFade
              key={c.codigo}
              as="li"
              delayMs={i * 60}
              className="flex items-center justify-between gap-3 bg-paper px-4 py-3 text-sm transition-colors hover:bg-paperDeep"
            >
              <FilaContribucion c={c} />
            </BlurFade>
          ))}
        </ul>
        {/* Cola larga (aliados con muchos contratos financiados): detrás de un <details>
            nativo en vez de seguir apilando filas — funciona sin JS y no obliga a nadie a
            scrollear una lista de decenas de códigos para llegar al CTA de abajo. Sin
            BlurFade acá: son filas que arrancan ocultas (display:none del propio <details>
            cerrado), no tiene sentido animar una entrada que nadie ve todavía. */}
        {contribResto.length > 0 && (
          <details className="group mt-2 overflow-hidden rounded-2xl border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-paper px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-paperDeep">
              <span>Ver los {contribResto.length} contratos restantes</span>
              <ChevronDown size={14} className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {contribResto.map((c) => (
                <li key={c.codigo} className="flex items-center justify-between gap-3 bg-paper px-4 py-3 text-sm transition-colors hover:bg-paperDeep">
                  <FilaContribucion c={c} />
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper p-5 shadow-card">
          <div>
            <div className="text-sm font-semibold text-ink">¿Quieres sumarte al muro?</div>
            <p className="mt-1 text-[13px] text-mute">Desde 5 contratos. Con tu nombre, como colectivo o de forma anónima.</p>
          </div>
          <Link
            href="/app/financiar"
            className="inline-flex items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper"
          >
            Financiar una auditoría <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
