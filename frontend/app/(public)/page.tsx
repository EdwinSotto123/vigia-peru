import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroLupa } from "@/components/landing/HeroLupa";
import { EscalaDinero } from "@/components/landing/EscalaDinero";
import { CasoLeido } from "@/components/landing/CasoLeido";
import { PipelineAgentes } from "@/components/landing/PipelineAgentes";
import { FuentesSection } from "@/components/landing/FuentesSection";
import { MapaRegiones } from "@/components/landing/MapaRegiones";
import { CasosReales } from "@/components/landing/CasosReales";
import { Aliados } from "@/components/landing/Aliados";
import { Participar } from "@/components/landing/Participar";
import { ConfianzaSection } from "@/components/landing/ConfianzaSection";
import { ExpansionSection } from "@/components/landing/ExpansionSection";
import { getAlertas } from "@/lib/api-client";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { getContratosGeo, getResumenContratos } from "@/lib/contratos";
import { elegirCasos } from "@/lib/landing";

// El metadata de una page gana sobre el de app/layout.tsx solo para esta ruta.
// Dice qué hace el producto por quien lo busca, no con qué está hecho.
export const metadata: Metadata = {
  title: { absolute: "Vigía Perú: en qué se gasta el dinero de tu región" },
  description:
    "Vigía lee los contratos del Estado peruano, los cruza con registros oficiales y te muestra cuáles merecen una segunda mirada, con la ley y la fuente para comprobarlo. Explora tu región, financia una lectura o denuncia una obra.",
};

/**
 * La portada cuenta una historia, en este orden:
 *
 *  1. Qué es (HeroLupa). La lupa se abre y del otro lado está…
 *  2. …el problema: miles de millones en contratos, casi nada leído (EscalaDinero).
 *  3. Qué hace Vigía, con un contrato real (CasoLeido).
 *  4. Cómo lo hace, en palabras de persona (PipelineAgentes).
 *  5. De dónde sale lo que dice (FuentesSection).
 *  6. El país, y tu región (MapaRegiones: el único mapa de la portada).
 *  7. Lo que ya encontró (CasosReales).
 *  8. Quién lo hace posible (Aliados: foco, podio, calculadora).
 *  9. Cómo sumarse sin financiar (Participar).
 * 10. Por qué creerle (ConfianzaSection), adónde va (ExpansionSection), y el cierre.
 *
 * Toda cifra sale del API. Si una lectura falla, la sección que depende de ella
 * no se dibuja: una portada que estima lo que no sabe es exactamente lo que este
 * producto le reprocha al Estado. Nada cae a datos de maqueta.
 */
export default async function LandingPage() {
  // Las lecturas en paralelo: son independientes, y en serie cada una le sumaba
  // su viaje de ida y vuelta al primer byte de la portada.
  const [alertas, estado, resumen, regiones] = await Promise.all([
    getAlertas({ limit: 100 }).catch(() => []),
    getEstadoGlobal().catch(() => null),
    getResumenContratos().catch(() => null),
    getContratosGeo({ nivel: "departamento" }).catch(() => null),
  ]);

  const montoTotal = (regiones ?? []).reduce((s, r) => s + (r.montoPen ?? 0), 0);

  // "Leído" es "tiene score": la misma definición que usa /app/contratos para
  // decir "98 leídos de 18 394". Las tres cifras salen del mismo resumen, o sea
  // del mismo universo.
  const publicados = resumen?.total ?? 0;
  // Un análisis en revisión o descartado también se leyó: suma a "leídos",
  // aunque no a las señales.
  const r = resumen?.porRiesgo;
  const leidos = r
    ? (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0)
    : 0;
  const senalAlta = resumen?.porRiesgo.alto ?? 0;

  const [casoPrincipal, ...otrosCasos] = elegirCasos(alertas, 4);

  return (
    <>
      <HeroLupa />

      {publicados > 0 && montoTotal > 0 && (
        <EscalaDinero montoTotal={montoTotal} publicados={publicados} leidos={leidos} senalAlta={senalAlta} />
      )}

      {casoPrincipal && <CasoLeido caso={casoPrincipal} />}

      <PipelineAgentes />

      <FuentesSection />

      {regiones && regiones.length > 0 && <MapaRegiones zonas={regiones} />}

      <CasosReales casos={otrosCasos} />

      <Aliados />

      <Participar />

      <ConfianzaSection enRevision={estado?.enRevision ?? null} />

      <ExpansionSection />

      <CierreLanding enCola={estado?.colaGlobal ?? null} />
    </>
  );
}

/** El cierre: una cifra real y las dos acciones que importan. */
function CierreLanding({ enCola }: { enCola: number | null }) {
  return (
    <section aria-labelledby="cierre-titulo" className="container-page max-w-[1400px] pt-16">
      <div className="relative isolate overflow-hidden rounded-[2rem] bg-heroViolet-deep px-7 py-12 text-paper sm:px-14 sm:py-16">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 -z-10 h-80 w-80 rounded-full bg-heroViolet/60 blur-3xl" />
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h2 id="cierre-titulo" className="max-w-[20ch] text-balance font-serif text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              {enCola != null && enCola > 0
                ? `Hay ${enCola.toLocaleString("es-PE")} contratos esperando que alguien los lea.`
                : "Empieza por los contratos de tu región."}
            </h2>
            <p className="mt-5 max-w-[48ch] text-lg leading-relaxed text-paper/80">
              Mira qué se contrata donde vives, financia la lectura de algunos o denuncia la obra que tienes enfrente.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/app/financiar"
                className="group inline-flex items-center gap-2 rounded-full bg-heroGreen px-7 py-4 text-base font-semibold text-ink shadow-card transition-transform duration-rapido hover:-translate-y-0.5 active:translate-y-0"
              >
                Financiar una auditoría
                <ArrowRight size={18} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                href="/app/mapa"
                className="inline-flex items-center rounded-full border border-paper/30 px-7 py-4 text-base font-semibold text-paper transition-colors duration-rapido hover:bg-paper/10"
              >
                Ver mi región
              </Link>
            </div>
          </div>
          <Image
            src="/assets/logo/lupa-llama.webp"
            alt=""
            width={720}
            height={725}
            sizes="16rem"
            className="hidden h-auto w-64 select-none opacity-95 drop-shadow-[0_24px_48px_rgba(0,0,0,0.35)] lg:block"
          />
        </div>
      </div>
    </section>
  );
}
