import { FranjaTextil, Medalla, OjoVivo } from "@/components/marca";
import { AliadoAbrir } from "@/components/aliados/AliadoAbrir";
import type { FilaRanking } from "@/components/aliados/ranking";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";
import { HeartHandshake } from "lucide-react";
import { PUESTO_POR_EL_EQUIPO_PEN } from "@/lib/costoCorrupcion";

/**
 * La portada (identidad Píxel): qué es Vigía, en cinco segundos, y un ojo hecho de puntos que mira.
 *
 * 2026-11-13 (auditoría visual: «bandas vacías», 15 pantallas en escritorio): la escena ya no se fija con el scroll. El
 * ojo se agrandaba y la pantalla se disolvía en píxeles durante 1,3 pantallas de scroll en las que no aparecía nada
 * nuevo; en una captura de página entera, y para quien baja rápido, era una banda vacía. Tampoco ocupa la pantalla
 * entera: la portada mide lo que dice, y la banda de cifras asoma debajo del pliegue.
 *
 * Lo que sigue igual: el titular no tiene entrada (es el LCP y nunca llega con `opacity: 0`), y el ojo entra con su
 * animación CSS (cada punto crece desde el centro), sólo con `transform`: si el CSS no corre, el ojo está completo igual.
 */

/** Los tres del podio, ya en la primera pantalla: quién hace posible la lectura, y un toque para ver quién es. */
function LoHacenPosible({ aliados }: { aliados: FilaRanking[] }) {
  if (aliados.length === 0) return null;
  return (
    // El rótulo va en la misma fila que los aliados y en letra normal: en versalitas encima era un antetítulo (prohibido).
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <p className="text-meta font-semibold text-inkSoft">Lo hacen posible</p>
      <ul className="flex flex-wrap gap-2.5" aria-label="Lo hacen posible">
        {/* recorte: tres aliados en la portada; todos, en /app/apoyar?seccion=aliados */}
        {aliados.slice(0, 3).map((f) => (
          <li key={f.id}>
            <AliadoAbrir
              fila={f}
              className="group/mini flex items-center gap-2.5 rounded-full border border-paperEdge bg-paperSoft/80 py-1.5 pl-1.5 pr-4 transition-colors hover:border-granate hover:bg-paperDeep"
            >
              <Medalla puesto={Math.min(f.puesto, 3) as 1 | 2 | 3} tamano={30} corona={false} />
              <span className="flex flex-col leading-tight">
                <span className="max-w-[11rem] truncate text-dato font-semibold text-ink">{f.nombre}</span>
                <span className="text-rotulo text-mute">
                  {numero(f.meses ?? 0)} {f.meses === 1 ? "mes" : "meses"} sosteniendo
                </span>
              </span>
            </AliadoAbrir>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeroPixel({ aliados = [], piso = null }: { aliados?: FilaRanking[]; /** Lo que cuesta mantener Vigía al mes (S/). */ piso?: number | null }) {
  return (
    <section id="inicio" aria-labelledby="hero-titulo" className="relative isolate overflow-hidden bg-paper">
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0 -z-10" />

      <div className="container-page grid w-full max-w-7xl items-center gap-x-10 gap-y-5 py-8 sm:py-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:py-14">
        <header className="relative z-10 min-w-0">
          <h1
            id="hero-titulo"
            className="max-w-[20ch] text-balance font-display text-titulo font-bold leading-[1.06] tracking-tight text-ink sm:text-portada lg:text-vitrina"
          >
            ¿En qué se gasta el dinero de tu <span className="text-granate">región?</span>
          </h1>
          <p className="mt-4 max-w-[52ch] text-pretty text-cuerpo leading-relaxed text-inkSoft sm:text-bloque">
            Agentes de inteligencia artificial leen los contratos del Estado y los cruzan con registros oficiales
            para detectar indicios de corrupción. Tú ves cuáles merecen una segunda mirada.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <EnlaceAccion href="/app/mapa" className="px-4 sm:px-6">
              Ver mi región
            </EnlaceAccion>
            <EnlaceAccion href="/app/apoyar" variante="secundario" flecha={false} className="px-4 sm:px-6">
              Aportar mi granito
            </EnlaceAccion>
          </div>
          {/* Cómo se sostiene, debajo de los botones y como contexto de «Aportar mi granito». */}
          <div className="mt-5 flex max-w-[52ch] items-start gap-3">
            <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-paperDeep text-granate">
              <HeartHandshake size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-dato font-semibold text-ink">Nos sostenemos con aportes ciudadanos.</p>
              <p className="mt-0.5 flex flex-wrap gap-x-5 gap-y-1 text-meta text-inkSoft">
                <span>
                  {/* «Casi»: es la cifra que dio el equipo, no un cálculo (lib/costoCorrupcion.ts). */}
                  Casi <strong className="font-mono font-semibold tabular-nums text-ink">{`S/ ${numero(PUESTO_POR_EL_EQUIPO_PEN)}`}</strong> puso el
                  equipo hasta hoy
                </span>
                {piso != null && (
                  <span>
                    {/* «Cerca de»: el piso es la cifra redonda del equipo (backend/api/src/lib/vigilancia.ts). */}
                    Cerca de <strong className="font-mono font-semibold tabular-nums text-ink">{`S/ ${numero(piso)}`}</strong> al mes
                    para seguir encendida
                  </span>
                )}
              </p>
            </div>
          </div>
          <LoHacenPosible aliados={aliados} />
          {/* Quién la hace: Vigía es un producto de Gobserva, GovTech (pedido del usuario, 2026-10-29). Hasta 2026-11-21 iba en
              una píldora encima del titular (un antetítulo); ahora cierra la primera pantalla, en una línea. */}
          <p className="mt-6 text-meta text-mute">
            <span className="font-mono font-bold text-inkSoft">
              vigía<span className="text-granate">_</span>
            </span>{" "}
            es un proyecto de <strong className="font-semibold text-inkSoft">Gobserva</strong>, GovTech para vigilar el gasto público.
          </p>
        </header>

        {/* El ojo: la marca. En el celular, chico y arriba del titular (antes, 300 px debajo de los botones, empujaba la
            primera cifra fuera de la pantalla); desde lg, a la derecha. */}
        <div className="order-first w-28 sm:w-40 lg:order-none lg:mx-auto lg:w-full lg:max-w-[24rem]">
          <OjoVivo tamano={560} titulo="El símbolo de Vigía: un ojo hecho de puntos que mira" className="h-auto w-full" />
        </div>
      </div>

      <FranjaTextil alto={12} />
    </section>
  );
}
