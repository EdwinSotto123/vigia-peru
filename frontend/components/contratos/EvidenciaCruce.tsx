/**
 * La evidencia de un antecedente del ganador (CrucesProveedor, SancionesCruce): los registros de la fuente y, en el
 * fraccionamiento, las órdenes de cada día. Vivía dentro de CrucesProveedor.tsx; aparte para que ninguno pase de 800
 * líneas (DESIGN_SYSTEM.md §9.2). Server-safe: `TablaEvidencia`, `AbrirDetalle` y `ListaPaginada` son islas de cliente.
 */

import { ArrowUpRight, ChevronDown, CircleDot, Coins, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CuentaGrupo, ListaPaginada } from "@/components/listado";
import { Partes } from "@/components/ui/Partes";
import { Dato } from "@/components/ui/Dato";
import { TablaEvidencia } from "./TablaEvidencia";
import { AbrirDetalle } from "./AbrirDetalle";
import type { DiaFraccionado, EvidenciaCruce } from "@/lib/contratos";
import { fecha, fechaCorta, numero, oracion, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

/** El «Ver …» que abre lo plegado bajo un cruce: un enlace de texto con su flecha, no otra caja. */
const RESUMEN =
  "inline-flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-1.5 rounded-lg text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden";

/**
 * La evidencia de un cruce, plegada debajo de él: cada registro de la fuente en una tabla (en el teléfono, una tarjeta
 * por registro), cómo verificarlo y el enlace a la fuente. Sin DNI ni nombres de personas: los trae así la API.
 */
export function EvidenciaDelCruce({ evidencia }: { evidencia: EvidenciaCruce[] }) {
  const n = evidencia.reduce((s, e) => s + (e.total ?? e.filas.length), 0);
  const despues = evidencia.reduce((s, e) => s + e.filas.filter((f) => f.posterior).length, 0);
  return (
    // Sin caja propia: va dentro de la tarjeta de los antecedentes (una caja dentro de otra era el «bordes en todo»).
    <details className="group/ev mt-1">
      <summary className={RESUMEN}>
        Ver la evidencia
        <CuentaGrupo>{n === 1 ? "1 registro" : `${numero(n)} registros`}</CuentaGrupo>
        {despues > 0 && <span className="text-rotulo font-normal text-mute">{numero(despues)} después de este proceso</span>}
        <ChevronDown size={14} aria-hidden className="shrink-0 transition-transform duration-rapido group-open/ev:rotate-180" />
      </summary>
      <div className="mt-2 space-y-4">
        {evidencia.map((e) => (
          <section key={e.titulo} data-evidencia className="space-y-2">
            <h4 className="flex flex-wrap items-center gap-1.5 text-meta font-semibold text-ink">
              {e.titulo}
              <CuentaGrupo>{numero(e.total ?? e.filas.length)}</CuentaGrupo>
            </h4>
            {e.total != null && e.total > e.filas.length && (
              <p className="text-rotulo text-mute">
                Aquí van los {numero(e.filas.length)} más recientes; la fuente tiene los {numero(e.total)}.
              </p>
            )}
            <TablaEvidencia columnas={e.columnas} filas={e.filas} titulo={e.titulo} fuente={e.enlace} />
            {(e.verificar || e.enlace) && (
              <p className="text-rotulo leading-relaxed text-mute">
                {e.verificar}{" "}
                {e.enlace && (
                  <a href={e.enlace.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                    {e.enlace.texto} <ArrowUpRight size={11} aria-hidden className="inline align-baseline" />
                  </a>
                )}
              </p>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * Fraccionamiento: las órdenes de cada día, que el texto sólo cuenta. Plegado debajo del cruce; cada día con lo que
 * suman contra el tope (una barra con la marca del tope) y sus órdenes: descripción, número, estado y monto. Con más
 * de cuatro días, paginado.
 */
export function OrdenesFraccionadas({ dias }: { dias: DiaFraccionado[] }) {
  const total = dias.reduce((s, d) => s + d.ordenes, 0);
  const bloques = dias.map((d, i) => ({
    id: `${d.fecha}-${i}`,
    contenido: <DiaOrdenes d={d} />,
    buscable: [fecha(d.fecha), ...d.detalle.map((o) => `${o.orden} ${o.descripcion ?? ""}`)].join(" "),
  }));
  return (
    <details className="group/ord mt-1">
      <summary className={RESUMEN}>
        Ver {total === 1 ? "la orden" : `las ${numero(total)} órdenes`}
        {dias.length === 1 ? ` del ${fechaCorta(dias[0].fecha)}` : ` de los ${numero(dias.length)} días`}
        <ChevronDown size={14} aria-hidden className="shrink-0 transition-transform duration-rapido group-open/ord:rotate-180" />
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-rotulo text-mute">
          Cada barra es lo que suman las órdenes de ese día; la marca, el tope de 8 UIT de ese año.
        </p>
        {bloques.length > 4 ? (
          <ListaPaginada items={bloques} tam={4} nombre="días" className="space-y-4" buscar={{ placeholder: "Buscar por descripción u orden…", etiqueta: "Buscar en las órdenes de esos días" }} />
        ) : (
          <ul className="space-y-4">
            {bloques.map((b) => (
              <li key={b.id}>{b.contenido}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function DiaOrdenes({ d }: { d: DiaFraccionado }) {
  // La barra es lo que suman; la marca, dónde queda el tope (siempre adentro: suman más que el tope).
  const marca = d.totalSoles > 0 ? Math.min(100, (d.topeSoles / d.totalSoles) * 100) : 100;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta">
        <span className="font-semibold text-ink">{fecha(d.fecha)}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-inkSoft">
          <Dato icono={Receipt} nombre="Órdenes">{numero(d.ordenes)} órdenes</Dato>
          <Dato icono={Coins} nombre="Suman">
            Suman <b className="font-mono tabular-nums text-ink">{soles(d.totalSoles)}</b>
          </Dato>
          <span className="text-mute">Tope {solesCompacto(d.topeSoles)}</span>
          {d.mismaDescripcion && <Badge variant="amber">Misma descripción</Badge>}
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-granate/70" role="img" aria-label={`Suman ${soles(d.totalSoles)}; el tope es ${soles(d.topeSoles)}`}>
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-0.5 bg-ink" style={{ left: `${marca}%` }} />
      </div>
      <ol className="divide-y divide-line rounded-lg border border-line bg-paper">
        {d.detalle.map((o, i) => (
          <li key={`${o.orden}-${i}`}>
            {/* La orden no tiene ficha propia, pero al hacer clic se abre el drawer con su detalle en la misma pestaña. */}
            <AbrirDetalle
              etiqueta={`Ver la orden ${o.orden}`}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-left text-meta transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              detalle={{
                titulo: `Orden ${o.orden}`,
                descripcion: o.estado ? o.estado.charAt(0) + o.estado.slice(1).toLowerCase() : undefined,
                filas: [
                  { k: "Descripción", v: o.descripcion ? oracion(o.descripcion) : "Sin descripción" },
                  ...(d.entidad ? [{ k: "Entidad", v: tituloNatural(d.entidad) }] : []),
                  ...(d.objeto ? [{ k: "Rubro", v: d.objeto }] : []),
                  { k: "Monto", v: soles(o.montoSoles) },
                  { k: "Fecha", v: fecha(d.fecha) },
                ],
              }}
            >
              <span className="min-w-0">
                <span className="block text-ink">{o.descripcion ? oracion(o.descripcion) : "Sin descripción"}</span>
                <span className="mt-0.5 block text-rotulo text-mute">
                  <Partes
                    partes={[
                      <Dato key="orden" tipo="codigo" nombre="Orden" mono>
                        <span translate="no">{o.orden}</span>
                      </Dato>,
                      o.estado && <Dato key="estado" icono={CircleDot} nombre="Estado">{o.estado.charAt(0) + o.estado.slice(1).toLowerCase()}</Dato>,
                    ]}
                  />
                </span>
              </span>
              <span className="self-start font-mono tabular-nums text-ink">{soles(o.montoSoles)}</span>
            </AbrirDetalle>
          </li>
        ))}
      </ol>
    </div>
  );
}
