"use client";

/**
 * La pestaña Actividad de /app/auditoria: dos tarjetas lado a lado con lo que antes se
 * apilaba arriba de la página en líneas de texto gris — cuántos análisis terminaron cada
 * día y cómo va la descarga de documentos. Cada una con su título, su ⓘ y sus números a la
 * vista. En qué etapa está cada financiado no se repite acá: es la barra del avance, en el
 * pie de las cifras de arriba (`EstadoAuditoria`).
 *
 * Todo el Perú: el resumen no acepta zona (lo dice la primera línea de la pestaña).
 * Lee el mismo sondeo que las cifras de arriba (`ResumenAuditoria`).
 */

import type { ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { diaCorto, fechaLima, haceCuanto, tipoContratoHumano } from "@/lib/auditoria";
import type { LoteIngesta } from "@/lib/contratos";
import { Indicadores, IndicadoresSkeleton, type Indicador } from "@/components/listado";
import { Ayuda, CabeceraPestana, EstadoError, EstadoVacio } from "@/components/patrones";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { cuentasAuditoria } from "./cuentasAuditoria";
import { DIAS_RITMO, useResumenAuditoria } from "./ResumenAuditoria";

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function ActividadAuditoria() {
  const { data, fallo, ahora, ritmo, ultimoFin } = useResumenAuditoria();

  const cabecera = (
    <CabeceraPestana
      ayuda={
        <Ayuda titulo="¿Y el filtro de zona?">
          Estas cifras son de todos los contratos financiados del país y se actualizan solas cada pocos segundos. El filtro de
          zona acota las pestañas En curso y Ya leídos.
        </Ayuda>
      }
    >
      {fallo ? (
        <span className="inline-flex items-center gap-1 text-crimsonTexto">
          <WifiOff size={13} aria-hidden /> Sin conexión con el servicio; reintentando…
        </span>
      ) : (
        "Todo el Perú, al día."
      )}
    </CabeceraPestana>
  );

  if (!data) {
    return (
      <>
        {cabecera}
        {fallo ? (
          <EstadoError titulo="No pudimos leer la actividad">Se vuelve a intentar solo, cada pocos segundos.</EstadoError>
        ) : (
          <IndicadoresSkeleton n={4} />
        )}
      </>
    );
  }

  const c = cuentasAuditoria(data);
  const pedidos = data.pedidos ?? null;
  const lote = data.lote ?? null;
  const catalogo = data.documentosDescargados7d ?? null;
  const tipos = (data.procesamientoActivo?.tipos_activos ?? []).map((t) => tipoContratoHumano(t)).filter((t): t is string => !!t);

  const descargas: Indicador[] = [
    {
      valor: pedidos ? numero(pedidos.descargando) : null,
      etiqueta: pedidos?.descargando === 1 ? "descarga en curso" : "descargas en curso",
      contexto: "ahora mismo",
    },
    {
      valor: pedidos ? numero(pedidos.pendientes) : null,
      etiqueta: pedidos?.pendientes === 1 ? "descarga pendiente" : "descargas pendientes",
      contexto: pedidos ? (pedidos.fallidos > 0 ? plural(pedidos.fallidos, "fallida", "fallidas") : "ninguna fallida") : undefined,
    },
    {
      valor: pedidos ? numero(pedidos.listos24h) : null,
      etiqueta: pedidos?.listos24h === 1 ? "descarga lista" : "descargas listas",
      contexto: "en las últimas 24 h",
    },
    {
      valor: catalogo ? numero(catalogo.n) : null,
      etiqueta: "documentos del catálogo",
      contexto: catalogo ? `en 7 días, de ${plural(catalogo.contratos, "contrato", "contratos")}` : "en 7 días",
      ayuda: (
        <Ayuda titulo="¿Qué es el catálogo?">
          Documentos del SEACE bajados para contratos que todavía nadie financió. No son contratos financiados: es material para
          lecturas futuras.
        </Ayuda>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {cabecera}

      {c.financiados === 0 && (
        <EstadoVacio compacto titulo="Todavía no hay contratos financiados">
          Cuando se confirme un aporte, aquí verás cuántos se leen cada día.
        </EstadoVacio>
      )}

      {/* Lado a lado: el ritmo (lo que ya pasó) y la descarga (lo que viene). La etapa de
          cada financiado no va acá: es la barra del avance, arriba, junto a sus cifras. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Tarjeta
          titulo="Análisis terminados por día"
          meta={`últimos ${DIAS_RITMO} días`}
          ayuda={
            <Ayuda titulo="¿Qué cuenta cada barra?">
              Los análisis que terminaron ese día, en hora de Lima, por cualquier vía: publicados o en revisión. Los días en cero
              también se dibujan.
            </Ayuda>
          }
        >
          {ritmo?.length ? <Ritmo ritmo={ritmo} ultimoFin={ultimoFin} ahora={ahora} /> : <p className="text-[13px] text-mute">Sin dato</p>}
        </Tarjeta>

        <Tarjeta
          titulo="Descarga de documentos del SEACE"
          ayuda={
            <Ayuda titulo="¿Por qué se descargan aparte?">
              El SEACE bloquea los servidores en la nube: los documentos de cada contrato financiado se bajan desde una conexión en
              Perú. Cuando llegan, el contrato pasa a la cola.
            </Ayuda>
          }
        >
          {/* Dos por fila también en escritorio: la tarjeta ocupa media página. */}
          <Indicadores items={descargas} className="lg:grid-cols-2" />
          {lote && <Lote lote={lote} />}
          {tipos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
              <span className="text-mute">Se analizan hoy</span>
              {tipos.map((t) => (
                <span key={t} className="pill border-line bg-paperSoft text-inkSoft">
                  {mayuscula(t)}
                </span>
              ))}
              {data.procesamientoActivo?.nota && <Ayuda titulo="¿Qué contratos se analizan?">{data.procesamientoActivo.nota}</Ayuda>}
            </div>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}

/** Un bloque del tablero: título (h3) con su ⓘ, una nota corta a la derecha y el contenido. */
function Tarjeta({ titulo, meta, ayuda, children }: { titulo: string; meta?: ReactNode; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="flex items-center gap-1 font-display text-[15px] font-bold text-ink">
          {titulo}
          {ayuda}
        </h3>
        {meta && <span className="text-[12.5px] tabular-nums text-mute">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/** El lote de documentos en curso: una barra de avance con sus números al lado. */
function Lote({ lote }: { lote: LoteIngesta }) {
  const hechos = lote.completados ?? 0;
  const pct = lote.total ? Math.min(100, (hechos / lote.total) * 100) : null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" title={`Lote ${lote.id}${lote.tipo ? ` de tipo ${lote.tipo}` : ""}`}>
      <span className="text-mute">Lote de documentos</span>
      {pct != null && (
        <span className="h-2 w-32 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
          <span className="block h-full rounded-full bg-inkSoft" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="tabular-nums text-ink">
        {numero(hechos)} de {lote.total != null ? numero(lote.total) : "Sin dato"}
      </span>
      {(lote.fallidos ?? 0) > 0 && <span className="text-crimsonTexto">{plural(lote.fallidos ?? 0, "fallido", "fallidos")}</span>}
    </div>
  );
}

/**
 * Barras por día, sin eje inventado: la altura es n / máximo de la ventana, con el máximo
 * rotulado. Los días en cero se ven como un trazo en la base: son la parte más importante
 * del dato cuando la cola se detiene. Rótulo directo sólo en el día más alto y en hoy.
 */
function Ritmo({ ritmo, ultimoFin, ahora }: { ritmo: { dia: string; n: number }[]; ultimoFin: number | null; ahora: number }) {
  const max = Math.max(1, ...ritmo.map((d) => d.n));
  const total = ritmo.reduce((s, d) => s + d.n, 0);
  const iMax = ritmo.findIndex((d) => d.n === max);
  const conAnalisis = ritmo.filter((d) => d.n > 0);
  const resumen = conAnalisis.length
    ? `En los últimos ${ritmo.length} días terminaron ${total} análisis: ${conAnalisis.map((d) => `${d.n} el ${diaCorto(d.dia)}`).join(", ")}. Ningún otro día.`
    : `Ningún análisis terminó en los últimos ${ritmo.length} días.`;
  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <span className="font-display text-[24px] font-bold leading-none tabular-nums text-ink">{numero(total)}</span>
        <span className="text-[13px] text-inkSoft">{total === 1 ? "análisis terminado" : "análisis terminados"}</span>
        <span className="text-[12px] text-mute" suppressHydrationWarning>
          {ultimoFin == null ? "ninguno todavía" : `último ${ahora > 0 ? haceCuanto(ahora - ultimoFin) : `el ${fechaLima(ultimoFin, { hora: true })}`}`}
        </span>
      </div>
      <div className="flex h-24 items-end gap-[3px] border-b border-line pt-4" role="img" aria-label={resumen}>
        {ritmo.map((d, i) => {
          const esHoy = i === ritmo.length - 1;
          const rotulo = d.n > 0 && (i === iMax || esHoy);
          return (
            // La columna entera es el blanco del `title`: más grande que la barra.
            <span key={d.dia} className="relative flex h-full flex-1 items-end" title={`${diaCorto(d.dia)}${esHoy ? " (hoy)" : ""}: ${plural(d.n, "análisis", "análisis")}`}>
              <span
                className={cn("block w-full rounded-t", d.n > 0 ? "bg-moss" : "bg-line", esHoy && "outline outline-1 outline-offset-1 outline-paperEdge")}
                style={{ height: d.n > 0 ? `${Math.max(8, (d.n / max) * 100)}%` : 2 }}
              />
              {rotulo && (
                <span
                  className="absolute inset-x-0 text-center text-[11px] font-semibold tabular-nums text-ink"
                  style={{ bottom: `calc(${Math.max(8, (d.n / max) * 100)}% + 2px)` }}
                  aria-hidden
                >
                  {d.n}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-mute" aria-hidden>
        <span>{diaCorto(ritmo[0].dia)}</span>
        <span>hoy</span>
      </figcaption>
    </figure>
  );
}
