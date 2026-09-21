import Link from "next/link";
import { ArrowRight, Landmark, Radio } from "lucide-react";
import { CampaignMap } from "@/components/financiar/CampaignMap";
import { PeruFlag } from "./CountryFlags";
import { HeroKpis } from "./HeroKpis";
import { LlamaHero } from "./LlamaHero";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { getEstadoGlobal, getZonas } from "@/lib/financiamiento";

/**
 * Hero compacto: UN solo mapa (el de auditoría, con estados reales), el pitch en
 * una frase, dos acciones y cuatro cifras reales. Reemplaza al hero anterior +
 * la sección "MapaHub" + el mapa de "Financia".
 */
export async function HeroCompacto() {
  const [estado, zonas] = await Promise.all([getEstadoGlobal(), getZonas("departamento")]);
  const top = [...(zonas ?? [])].filter((z) => z.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola).slice(0, 5);
  const precio = estado?.tarifa.precioPen ?? 3;

  return (
    <section id="inicio" className="relative overflow-hidden border-b border-line bg-paper">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[460px] w-[460px] rounded-full bg-heroViolet/10 blur-3xl" />
      <div className="container-page relative py-12 sm:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_0.95fr] lg:gap-14">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-heroGreen/30 bg-heroGreen/10 py-1.5 pl-1.5 pr-3.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-heroGreen">
              <PeruFlag size={20} className="rounded-[3px] shadow-sm ring-1 ring-black/10" />
              Plataforma cívica · sin fines de lucro · Perú
            </div>
            <h1 className="font-serif text-4xl font-bold leading-[1.02] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              El Estado publica todos sus contratos.
              <span className="block text-heroGreen">Nadie tiene capacidad de leerlos.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-mute sm:text-lg">
              Once agentes de IA leen cada contrato público, cruzan 14 portales del Estado y marcan cada señal de
              riesgo con su norma y su evidencia oficial. Leer un contrato cuesta{" "}
              <strong className="text-ink">S/ {precio}</strong>. Elige una zona y financia su auditoría; los
              resultados son públicos, siempre.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/app/mapa" className="group inline-flex items-center gap-2 rounded-full bg-heroGreen px-6 py-3.5 text-sm font-semibold text-paper transition-transform hover:scale-[1.02] active:scale-[0.97] sm:text-base">
                Explorar el mapa <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link href="/app/financiar" className="inline-flex items-center gap-2 rounded-full bg-heroViolet px-6 py-3.5 text-sm font-semibold text-paper transition-transform hover:scale-[1.02] active:scale-[0.97] sm:text-base">
                <Landmark size={16} /> Financiar una auditoría
              </Link>
            </div>
            <HeroKpis initial={estado} />
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-line bg-paperSoft shadow-card">
              <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-2.5">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink"><Radio size={12} className="text-rust" /> Mapa de auditoría · toca una región</span>
                <span className="font-mono text-[10px] text-mute">SEACE · OECE · OCDS</span>
              </div>
              <div className="p-4 sm:p-5">
                {zonas ? <CampaignMap zonas={zonas} compact linkToHub /> : <div className="p-10 text-center text-sm text-mute">Mapa no disponible por ahora.</div>}
              </div>
            </div>
            <LlamaHero width={168} className="pointer-events-none absolute -bottom-6 -right-4 hidden drop-shadow-xl sm:block" />
            {top.length > 0 && (
              <ul className="mt-3 grid grid-cols-5 gap-2 text-center">
                {top.map((z) => (
                  <li key={z.ubigeo}>
                    <Link href={`/app/mapa?region=${UBIGEO_REGION[z.ubigeo] ?? ""}`} className="block rounded-xl border border-line bg-paper px-2 py-2 hover:bg-paperDeep">
                      <div className="truncate text-[11px] font-semibold text-ink">{z.nombre}</div>
                      <div className="font-mono text-[11px] text-mute">{z.totalCola.toLocaleString("es-PE")}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
