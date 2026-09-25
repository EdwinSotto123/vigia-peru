import type { Metadata } from "next";
import { Llamita } from "@/components/marca";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "@/components/landing/EnlaceAccion";
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
import { getContratosGeo, getResumenContratos, TIPOS } from "@/lib/contratos";
import type { CifrasFlujo } from "@/components/landing/ExploradorFuentes";
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
  // decir "118 leídos de 18,393". Las tres cifras salen del mismo resumen, o sea
  // del mismo universo (y coinciden con la suma de `procesados` del mapa).
  const publicados = resumen?.total ?? 0;
  // Un análisis en revisión o descartado también se leyó: suma a "leídos",
  // aunque no a las señales.
  const r = resumen?.porRiesgo;
  const leidos = r
    ? (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0)
    : 0;
  const senalAlta = resumen?.porRiesgo.alto ?? 0;

  // Los gráficos del mapa de fuentes: las mismas cifras de arriba, nada nuevo.
  // Si una lectura falló, su gráfico no se dibuja (queda null).
  const cifrasFuentes: CifrasFlujo = {
    publicados: resumen?.total ?? null,
    leidos: r ? leidos : null,
    porTipo: resumen ? tiposConResto(resumen.total, resumen.porTipo) : null,
    // Los mismos cinco grupos que suman `leidos`: el nodo de señales y el del
    // informe cuentan el mismo universo.
    porRiesgo: r
      ? { alto: r.alto ?? 0, medio: r.medio ?? 0, bajo: r.bajo ?? 0, enRevision: r.en_revision ?? 0, descartado: r.descartado ?? 0 }
      : null,
    regiones: regiones?.length
      ? [...regiones].sort((a, b) => b.total - a.total).slice(0, 5).map((z) => ({ nombre: z.nombre, n: z.total }))
      : null,
  };

  const [casoPrincipal, ...otrosCasos] = elegirCasos(alertas, 4);

  return (
    <>
      <HeroLupa />

      {publicados > 0 && montoTotal > 0 && (
        <EscalaDinero montoTotal={montoTotal} publicados={publicados} leidos={leidos} senalAlta={senalAlta} />
      )}

      {casoPrincipal && <CasoLeido caso={casoPrincipal} />}

      <PipelineAgentes />

      <FuentesSection cifras={cifrasFuentes} />

      {regiones && regiones.length > 0 && <MapaRegiones zonas={regiones} />}

      <CasosReales casos={otrosCasos} />

      <Aliados />

      <Participar />

      {/* La misma cuenta que el gráfico de señales del mapa de fuentes (resumen de
          contratos). El estado global contaba otro universo y la portada decía 12
          en una sección y 14 en otra. */}
      <ConfianzaSection enRevision={r ? (r.en_revision ?? 0) : null} />

      <ExpansionSection />

      <CierreLanding enCola={estado?.colaGlobal ?? null} />
    </>
  );
}

/**
 * Los cinco tipos de contrato más comunes y una última barra con lo que falta
 * para llegar al total: los otros tipos y los que no tienen tipo. Así
 * las barras suman el número del título ("N contratos publicados, por tipo").
 */
function tiposConResto(total: number, porTipo: Partial<Record<string, number>>): NonNullable<CifrasFlujo["porTipo"]> {
  const top = TIPOS.map((t) => ({ etiqueta: t.label, n: porTipo[t.value] ?? 0 }))
    .filter((t) => t.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const resto = total - top.reduce((s, t) => s + t.n, 0);
  if (resto <= 0) return top;
  const sinClasificar = porTipo.sin_clasificar ?? 0;
  const etiqueta =
    sinClasificar <= 0 ? "Otros tipos" : sinClasificar >= resto ? "Sin clasificar" : "Otros tipos o sin clasificar";
  return [...top, { etiqueta, n: resto, resto: true }];
}

/**
 * El cierre: una cifra real y las dos acciones que importan. Es el momento de
 * marca de la portada (DESIGN_SYSTEM.md §3.8 y §14): granate profundo, y la
 * llamita en maíz, de pie sobre el borde de la placa y mirando hacia el texto
 * —hacia adelante, como manda §2.4—. Acá la llama no acompaña ninguna señal ni
 * ningún nombre: acompaña la invitación.
 *
 * Sin franja textil propia: el pie abre con la suya ochenta píxeles más abajo,
 * y son una por pantalla (§6).
 */
function CierreLanding({ enCola }: { enCola: number | null }) {
  return (
    <section aria-labelledby="cierre-titulo" className="container-page pt-16">
      <div className="sobre-oscuro relative isolate overflow-hidden rounded-2xl bg-granate-deep text-paper">
        <div className="grid items-end gap-8 px-6 pb-10 pt-12 sm:px-12 sm:pt-16 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-14 lg:px-14">
          {/* La llama, decorativa: en el celular va chica arriba del titular;
              desde lg, grande a la izquierda, con las patas en el borde de la
              placa (baja exactamente el pb-10 de la grilla). */}
          <Llamita className="w-14 text-maiz sm:w-16 lg:w-40 lg:translate-y-10" />
          <div className="lg:pb-6">
            <h2 id="cierre-titulo" className="max-w-[20ch] text-balance font-display text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              {enCola != null && enCola > 0
                ? `Hay ${numero(enCola)} contratos esperando que alguien los lea.`
                : "Empieza por los contratos de tu región."}
            </h2>
            <p className="mt-5 max-w-[48ch] text-pretty text-lg leading-relaxed text-paper/80">
              Mira qué se contrata donde vives, financia la lectura de algunos o denuncia la obra que tienes enfrente.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <EnlaceAccion href="/app/financiar" variante="oscuro" tamano="lg">
                Financiar una auditoría
              </EnlaceAccion>
              <EnlaceAccion href="/app/mapa" variante="contornoOscuro" tamano="lg" flecha={false}>
                Ver mi región
              </EnlaceAccion>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
