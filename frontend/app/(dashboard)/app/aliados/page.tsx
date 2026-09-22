import Link from "next/link";
import { ArrowRight, HeartHandshake, Scale, ShieldCheck, Trophy } from "lucide-react";
import { MuroAliados } from "@/components/aliados/MuroAliados";
import { KpiTile } from "@/components/aliados/KpiTile";
import { FiltroRegion } from "@/components/auditoria/FiltroRegion";
import { BlurFade } from "@/components/magicui/BlurFade";
import { getEstadoGlobal, getZonas } from "@/lib/financiamiento";

export const metadata = {
  title: "Aliados de transparencia — Vigía Perú",
  description:
    "Empresas, organizaciones y personas que financian la capacidad de leer contratos públicos. Reconocimiento público, proporcional y verificable.",
};

export const revalidate = 300;

export default async function AliadosPage({ searchParams }: { searchParams?: { ubigeo?: string; pagina?: string } }) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const [estado, zonas] = await Promise.all([getEstadoGlobal(), getZonas("departamento")]);
  const opciones = (zonas ?? [])
    .filter((z) => z.financiados > 0)
    .sort((a, b) => b.financiados - a.financiados || a.nombre.localeCompare(b.nombre, "es"))
    .map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre, hint: `${z.financiados.toLocaleString("es-PE")} financiados` }));
  const zonaActual = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo)?.nombre : undefined;
  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-br from-heroViolet/[0.06] via-paperDeep to-heroGreen/[0.05]">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-heroViolet/10 blur-3xl" />
        <div className="container-page relative grid gap-8 py-14 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-heroViolet">
              <HeartHandshake size={12} /> Reconocimiento público
            </span>
            <h1 className="mt-4 font-serif text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              Aliados de transparencia
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
              Nadie compra un resultado ni una región. Quienes aparecen aquí financiaron la <strong className="text-ink">capacidad de leer</strong>{" "}
              contratos públicos que ya eran de todos, y aceptaron que lo que se encuentre se publique aunque los señale a ellos.
              El reconocimiento es proporcional a los contratos que hicieron posible auditar.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <KpiTile label={estado?.financiadores === 1 ? "Aliado" : "Aliados"} value={estado?.financiadores ?? 0} />
            <KpiTile label="Contratos financiados" value={estado?.contratosFinanciados ?? 0} />
            <KpiTile label="Señales halladas" value={estado?.senalesHalladas ?? 0} valueTone={(estado?.senalesHalladas ?? 0) > 0 ? "rust" : undefined} />
          </div>
        </div>
      </section>

      {/* ─── MURO ─── */}
      {/* Barra de filtro pegajosa: "Todos los aliados" pagina hasta 24 tarjetas, así que
          cambiar de región no debería obligar a volver a scrollear hasta arriba. top-0 (no
          top-16, el offset típico bajo el Header): esta ruta cuelga de (dashboard)/layout.tsx,
          que NO renderiza el Header público, solo DashboardSidebar (una barra LATERAL, no
          superior) — no hay nada que esquivar arriba de esta barra. */}
      <div className="sticky top-0 z-10 border-b border-line bg-paper/95 py-3 backdrop-blur">
        <div className="container-page flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mute">{zonaActual ? `Aliados que financiaron auditorías en ${zonaActual}.` : "Filtra el muro por región."}</p>
          <FiltroRegion opciones={opciones} valor={ubigeo} />
        </div>
      </div>
      <section className="container-page py-8">
        <MuroAliados region={ubigeo} pagina={pagina} />
      </section>

      {/* ─── REGLAS + CTA ─── */}
      <section className="border-t border-line bg-paperDeep py-12">
        <div className="container-page grid gap-6 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-start">
          {/* Cascada corta: son 3 reglas independientes, no pasos de una secuencia —
              entran una tras otra en vez de golpear las tres a la vez. El CTA de al lado
              queda fuera de la cascada (una acción no debe demorar su aparición). */}
          <BlurFade delayMs={0}>
            <Regla icon={<Trophy size={16} />} titulo="Se cuenta en contratos">
              Trescientos vecinos que financian 300 contratos valen lo mismo que una empresa que financia 300. El ranking nunca mide soles.
            </Regla>
          </BlurFade>
          <BlurFade delayMs={90}>
            <Regla icon={<Scale size={16} />} titulo="Nadie elige qué se audita">
              Los contratos se asignan por antigüedad, en código. El pipeline no sabe quién financió. Los resultados se publican siempre.
            </Regla>
          </BlurFade>
          <BlurFade delayMs={180}>
            <Regla icon={<ShieldCheck size={16} />} titulo="Conflicto de interés automático">
              Una empresa con sanción vigente o señalada en alertas de la zona puede aportar, pero no aparece en este muro.
            </Regla>
          </BlurFade>
          <div className="rounded-2xl border border-line bg-paper p-5 shadow-card lg:max-w-xs">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-heroViolet/10 text-heroViolet">
              <HeartHandshake size={16} />
            </span>
            <div className="mt-3 text-sm font-semibold text-ink">Súmate al muro</div>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">Desde 5 contratos. Con tu nombre, como colectivo o de forma anónima.</p>
            <Link
              href="/app/financiar"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper"
            >
              Financiar una auditoría <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Regla({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-card">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-heroGreen/10 text-heroGreen">{icon}</span>
      <h3 className="mt-3 font-semibold text-ink">{titulo}</h3>
      <p className="mt-1 text-sm leading-relaxed text-mute">{children}</p>
    </div>
  );
}
