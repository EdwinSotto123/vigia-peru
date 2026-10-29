"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CircleDot, Coins, Loader2, Receipt, RotateCw } from "lucide-react";
import { CuentaGrupo, ListaPaginada } from "@/components/listado";
import { TablaEvidencia } from "@/components/contratos/TablaEvidencia";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { baseApiNavegador } from "@/lib/api-client";
import type { DiaFraccionado } from "@/lib/contratos";
import type { EvidenciaAntecedente } from "@/lib/empresas";
import { fecha, numero, oracion, soles, solesCompacto } from "@/lib/formato";

/**
 * Los registros oficiales de UN antecedente de la empresa, pedidos al abrir su panel: los mismos que la ficha del contrato
 * muestra bajo cada antecedente (los aportes en la ONPE, el cargo en el JNE, cada penalidad, la resolución del Tribunal,
 * los otros procesos que le ganó a la entidad, la obra en INFOBRAS…) y, en «Órdenes que pasan 8 UIT», cada día con sus
 * órdenes. La tabla de casos no los trae: una empresa grande tiene cientos. El panel monta sólo la fila abierta
 * (DetalleFilas), así que se pide uno a la vez. Sin DNI ni nombres de personas naturales: así los da la API.
 */
export function EvidenciaDelAntecedente({ ruc, tipo, clave }: { ruc: string; tipo: string; clave: string }) {
  const [estado, setEstado] = useState<{ datos: EvidenciaAntecedente | null; error: boolean; cambio: boolean }>({ datos: null, error: false, cambio: false });
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setEstado({ datos: null, error: false, cambio: false });
    fetch(`${baseApiNavegador()}/empresas/${ruc}/antecedentes/evidencia?tipo=${encodeURIComponent(tipo)}&clave=${encodeURIComponent(clave)}`, { signal: ctl.signal })
      .then((r) => {
        // 404: el caso ya no está como se cargó (los cruces se refrescaron después de armar esta página); reintentar no sirve.
        if (r.status === 404) {
          setEstado({ datos: null, error: false, cambio: true });
          return null;
        }
        return r.ok ? (r.json() as Promise<EvidenciaAntecedente>) : Promise.reject(new Error(String(r.status)));
      })
      .then((datos) => {
        if (datos) setEstado({ datos, error: false, cambio: false });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setEstado({ datos: null, error: true, cambio: false });
      });
    return () => ctl.abort();
  }, [ruc, tipo, clave, intento]);

  if (estado.cambio) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft" role="status">
        Este antecedente se actualizó después de cargar la página.
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          <RotateCw size={14} aria-hidden />
          Recargar la página
        </button>
      </div>
    );
  }
  if (estado.error) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft" role="status">
        No pudimos traer los registros ahora.
        <button
          type="button"
          onClick={() => setIntento((i) => i + 1)}
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          <RotateCw size={14} aria-hidden />
          Reintentar
        </button>
      </div>
    );
  }
  if (!estado.datos) {
    return (
      <p className="flex items-center gap-2 text-meta text-mute" role="status">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Trayendo los registros de la fuente…
      </p>
    );
  }
  const { evidencia, dias } = estado.datos;
  if (!evidencia.length && !dias.length) {
    return <p className="text-meta text-mute">La fuente no trae más registros que los datos de arriba: su enlace va al pie.</p>;
  }
  return (
    <div className="space-y-5">
      {dias.length > 0 && <DiasConOrdenes dias={dias} />}
      {evidencia.map((e) => (
        <section key={e.titulo} data-evidencia className="space-y-2">
          <h4 className="flex flex-wrap items-center gap-1.5 text-dato font-semibold text-ink">
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
                <a
                  href={e.enlace.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                >
                  {e.enlace.texto} <ArrowUpRight size={11} aria-hidden className="inline align-baseline" />
                </a>
              )}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * «Órdenes que pasan 8 UIT»: cada día con lo que suman sus órdenes contra el tope (la barra y su marca) y cada orden con su
 * descripción, su número, su estado y su monto a la vista. La ficha del contrato abre cada orden en un cajón que sólo
 * existe en esa página (OrdenesFraccionadas): aquí rompía el panel.
 */
function DiasConOrdenes({ dias }: { dias: DiaFraccionado[] }) {
  const bloques = dias.map((d, i) => ({
    id: `${d.fecha}-${i}`,
    contenido: <UnDia d={d} />,
    buscable: [fecha(d.fecha), ...d.detalle.map((o) => `${o.orden} ${o.descripcion ?? ""}`)].join(" "),
  }));
  return (
    <div className="space-y-3">
      <p className="text-rotulo text-mute">Cada barra es lo que suman las órdenes de ese día; la marca, el tope de 8 UIT de ese año.</p>
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
  );
}

function UnDia({ d }: { d: DiaFraccionado }) {
  // La barra es lo que suman; la marca, dónde queda el tope (siempre adentro: suman más que el tope).
  const marca = d.totalSoles > 0 ? Math.min(100, (d.topeSoles / d.totalSoles) * 100) : 100;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta">
        <span className="font-semibold text-ink">{fecha(d.fecha)}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-inkSoft">
          <Dato icono={Receipt} nombre="Órdenes">{`${numero(d.ordenes)} órdenes`}</Dato>
          <Dato icono={Coins} nombre="Suman">
            Suman <b className="font-mono tabular-nums text-ink">{soles(d.totalSoles)}</b>
          </Dato>
          <span className="text-mute">{`Tope ${solesCompacto(d.topeSoles)}`}</span>
          {d.mismaDescripcion && <Badge variant="amber">Misma descripción</Badge>}
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-granate/70" role="img" aria-label={`Suman ${soles(d.totalSoles)}; el tope es ${soles(d.topeSoles)}`}>
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-0.5 bg-ink" style={{ left: `${marca}%` }} />
      </div>
      <ol className="divide-y divide-line rounded-lg border border-line bg-paper">
        {d.detalle.map((o, i) => (
          <li key={`${o.orden}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-meta">
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
          </li>
        ))}
      </ol>
    </div>
  );
}
