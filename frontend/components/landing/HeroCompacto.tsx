import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { getAlertas } from "@/lib/api-client";
import { PeruFlag } from "./CountryFlags";
import { HeroKpis } from "./HeroKpis";
import { HeroMapPanel } from "./HeroMapPanel";
import { HeroMapSyncProvider } from "./HeroMapSync";
import { getEstadoGlobal, getZonas } from "@/lib/financiamiento";

/**
 * Hero compacto: UN solo mapa (el de auditoría, con estados reales), el pitch en
 * una frase, dos acciones y cuatro cifras reales. Reemplaza al hero anterior +
 * la sección "MapaHub" + el mapa de "Financia".
 */
export async function HeroCompacto() {
  const [estado, zonas, alertas] = await Promise.all([
    getEstadoGlobal(),
    getZonas("departamento"),
    getAlertas({ limit: 30 }).catch(() => []),
  ]);
  const zonasList = zonas ?? [];
  const top = [...zonasList].filter((z) => z.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola).slice(0, 5);
  const precio = estado?.tarifa.precioPen ?? 3;
  // Las alertas presentables (con entidad/objeto) se mandan completas — HeroMapPanel elige
  // cuál "destacar" según la región que esté seleccionada en el mapa, no una fija de por
  // vida. Filtrado acá (server) para no mandar al cliente alertas sin entidad/objeto.
  const alertasPresentables = alertas.filter((a) => a.entidad && a.objeto);
  // El backend puede reportar `regionesConCola` desincronizado del propio listado de
  // `zonas` (dos fuentes distintas) — se recalcula acá del dato ya obtenido para que el
  // hero nunca se contradiga con el top-5 que muestra al lado, en el mismo panel.
  const regionesConCola = zonasList.filter((z) => z.totalCola > 0).length;

  return (
    <section id="inicio" className="relative overflow-hidden border-b border-line bg-paper">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[460px] w-[460px] rounded-full bg-heroViolet/10 blur-3xl" />
      <div className="container-page relative max-w-[1600px] py-6 sm:py-8">
        <HeroMapSyncProvider zonas={zonasList}>
          {/* El mapa es un SVG 480×640 (más alto que ancho, 4:3 invertido) — a ancho casi
              igual al de la columna de texto (1fr_0.95fr) terminaba más alto que la
              pantalla entera (medido: 848px de mapa + lista de zonas, contra 900px de
              viewport). 1.35fr/0.8fr lo angosta ~20% (y por lo tanto lo achica en alto en
              la misma proporción, mismo aspect ratio) para que el hero completo — mapa
              incluido — entre en una sola pantalla en laptops típicas. */}
          <div className="grid items-start gap-8 lg:grid-cols-[1.35fr_0.8fr] lg:gap-10">
            <div>
              {/* Antes era una sola píldora con 3 datos unidos por "·" — ahora son dos
                  chips separados: cada dato tiene su propio borde, no una coma disfrazada
                  de punto. */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-heroGreen/30 bg-heroGreen/10 py-1.5 pl-1.5 pr-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-heroGreen">
                  <PeruFlag size={16} className="rounded-[3px] shadow-sm ring-1 ring-black/10" />
                  Perú
                </span>
                <span className="inline-flex items-center rounded-full border border-line bg-paperSoft px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-mute">
                  Plataforma cívica sin fines de lucro
                </span>
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
                <Link
                  href="/app/mapa"
                  className="group inline-flex items-center gap-2 rounded-full bg-heroGreen px-6 py-3.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0 sm:text-base"
                >
                  Explorar el mapa <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/app/financiar"
                  className="inline-flex items-center gap-2 rounded-full bg-heroViolet px-6 py-3.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0 sm:text-base"
                >
                  <Landmark size={16} /> Financiar una auditoría
                </Link>
              </div>
              <HeroKpis initial={estado} regionesConCola={regionesConCola} />
            </div>

            <HeroMapPanel zonas={zonasList} top={top} alertas={alertasPresentables} />
          </div>
        </HeroMapSyncProvider>
      </div>
    </section>
  );
}
