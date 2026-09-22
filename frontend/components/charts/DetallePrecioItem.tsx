"use client";

import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilaPrecio } from "./mercado";

/**
 * El detalle de un ítem del gráfico de precios, y la tabla completa que le
 * sirve de equivalente textual.
 *
 * Los dos viven acá, al lado del gráfico, porque son su profundidad: el
 * renglón contesta *cuánto*, y esto contesta *contra qué precios reales, de
 * qué proveedor, con qué URL*. Antes esto era una pila de tarjetas siempre
 * abiertas debajo de la tabla — 584 líneas de página para una evidencia que
 * se consulta de a un ítem por vez. Ahora se abre en el panel lateral, que
 * no destruye el contexto del gráfico.
 *
 * Nada de tarjeta dentro de tarjeta: acá las secciones se separan con reglas
 * y encabezados, no con cajas anidadas.
 */

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5">
      <dt className="shrink-0 text-[11px] text-mute">{etiqueta}</dt>
      <dd className="text-right font-mono text-[12px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-widest text-mute">{children}</h3>
  );
}

export function DetallePrecioItem({ fila, fmtMoney }: { fila: FilaPrecio; fmtMoney: (n: any) => string }) {
  const f = fila.finding || {};
  const ancla = f.ancla_regional || {};
  const referencias: any[] = Array.isArray(f.referencias_internas) ? f.referencias_internas : [];
  const observados: any[] = Array.isArray(f.precios_observados) ? f.precios_observados : [];
  const caracs: string[] = Array.isArray(f.caracteristicas_solicitadas_clave)
    ? f.caracteristicas_solicitadas_clave
    : [];
  const proveedores: any[] = Array.isArray(f.proveedores_potenciales) ? f.proveedores_potenciales : [];
  const queries: string[] = Array.isArray(f.queries_realizadas) ? f.queries_realizadas : [];
  const porUnidad = fila.cantidad !== null ? `${fila.cantidad.toLocaleString("es-PE")} ${fila.unidad}` : null;

  return (
    <div className="text-[13px] leading-relaxed text-ink">
      <dl className="mt-0">
        <Dato etiqueta="Cantidad del requerimiento">{porUnidad ?? "no consta en el expediente"}</Dato>
        <Dato etiqueta={`Precio ${fila.baseOfertado === "ofertado" ? "ofertado" : "referencial"} por unidad`}>
          {fila.ofertadoUnit !== null ? fmtMoney(fila.ofertadoUnit) : "sin precio unitario en el expediente"}
        </Dato>
        <Dato
          etiqueta={fila.tipoReferencia === "mediana" ? "Mediana de mercado por unidad" : "Estimación del modelo por unidad"}
        >
          {fila.referenciaUnit !== null
            ? `${fila.tipoReferencia === "mediana" ? "" : "≈ "}${fmtMoney(fila.referenciaUnit)}`
            : "sin precio de mercado"}
        </Dato>
        {fila.rangoMinUnit !== null && fila.rangoMaxUnit !== null && (
          <Dato etiqueta={`Rango observado (${fila.nPrecios} precio(s) con fuente)`}>
            {fmtMoney(fila.rangoMinUnit)} – {fmtMoney(fila.rangoMaxUnit)}
          </Dato>
        )}
        {fila.ofertado !== null && porUnidad && (
          <Dato etiqueta="Total de la línea, ofertado">
            {fmtMoney(fila.ofertado)} <span className="font-sans font-normal text-mute">({porUnidad})</span>
          </Dato>
        )}
        {fila.referencia !== null && porUnidad && (
          <Dato etiqueta={`Total de la línea, ${fila.tipoReferencia === "mediana" ? "a precio de mercado" : "estimado"}`}>
            {fmtMoney(fila.referencia)} <span className="font-sans font-normal text-mute">({porUnidad})</span>
          </Dato>
        )}
        {fila.diffMonto !== null && fila.diffPct !== null && (
          <Dato etiqueta="Diferencia contra la mediana">
            <span className={cn(fila.sobreElRango && "text-rust")}>
              {fila.diffMonto > 0 ? "+" : "−"}
              {fmtMoney(Math.abs(fila.diffMonto))} ({fila.diffPct > 0 ? "+" : ""}
              {fila.diffPct.toFixed(1)} %)
            </span>
          </Dato>
        )}
        {typeof f.oferta_vs_referencial_pct === "number" && (
          <Dato etiqueta="La oferta contra el valor referencial de la entidad">
            {f.oferta_vs_referencial_pct > 0 ? "+" : ""}
            {f.oferta_vs_referencial_pct.toFixed(1)} %
          </Dato>
        )}
      </dl>

      {!fila.medido && (
        <p className="mt-3 border-l-2 border-line pl-3 text-[12px] text-mute">
          <strong className="font-semibold text-ink">{fila.veredicto.etiqueta}.</strong>{" "}
          {fila.motivo
            ? `Sin veredicto de precio porque ${fila.motivo}.`
            : "Este ítem no tiene una medición de mercado, así que no entra en el sobreprecio del lote."}
          {fila.tipoReferencia === "estimacion_ia" && (
            <>
              {" "}
              La cifra de mercado que se muestra es una estimación del modelo desde su conocimiento previo
              {f.confianza_estimacion_ia ? ` (confianza ${f.confianza_estimacion_ia})` : ""} — no es una búsqueda
              con fuentes y, por regla del proyecto, nunca mueve el sobreprecio.
            </>
          )}
        </p>
      )}

      {f.nota_base && <p className="mt-3 text-[12px] text-mute">{f.nota_base}</p>}

      {f.comentario && <p className="mt-3">{f.comentario}</p>}

      {f.spec_restrictiva && (
        <p className="mt-3 flex items-start gap-1.5 border-l-2 border-rust pl-3 text-[12px] text-rust">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Especificación restrictiva: </strong>
            {f.spec_restrictiva}
          </span>
        </p>
      )}

      {fila.ocdsItem?.requerimiento && observados.length === 0 && (
        <>
          <Titulo>Lo que pide el requerimiento</Titulo>
          <p className="text-[12px] text-mute">{String(fila.ocdsItem.requerimiento).slice(0, 700)}</p>
        </>
      )}

      {caracs.length > 0 && (
        <>
          <Titulo>Características exigidas en el requerimiento</Titulo>
          <ul className="grid gap-1 sm:grid-cols-2">
            {caracs.map((c, j) => (
              <li key={j} className="flex items-start gap-1.5 text-[12px]">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {observados.length > 0 && (
        <>
          <Titulo>
            Precios encontrados en el mercado · {observados.length} referencia(s), {fila.nFuentes} con enlace
          </Titulo>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-line text-left text-mute">
                  <th className="py-1.5 pr-2 font-semibold">Producto / proveedor</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Precio</th>
                  <th className="py-1.5 font-semibold">Cumple lo pedido</th>
                </tr>
              </thead>
              <tbody>
                {observados.map((p, j) => (
                  <tr key={j} className="border-b border-line/50 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium text-ink">{p.producto || p.producto_titulo || "—"}</div>
                      <div className="text-mute">
                        {p.proveedor || p.dominio || "—"}
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-0.5 text-heroViolet hover:underline"
                          >
                            ver fuente <ExternalLink size={9} aria-hidden />
                          </a>
                        )}
                      </div>
                      {Array.isArray(p.caracteristicas_no_cumplidas) && p.caracteristicas_no_cumplidas.length > 0 && (
                        <div className="mt-0.5 text-[10px] text-rust">
                          no cumple: {p.caracteristicas_no_cumplidas.join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono font-semibold text-ink">
                      {typeof (p.precio ?? p.valor) === "number" ? fmtMoney(p.precio ?? p.valor) : "—"}
                      {p.moneda_origen === "USD" && <div className="text-[9px] font-normal text-mute">convertido de USD</div>}
                    </td>
                    <td className="py-1.5">
                      {p.cumple_caracteristicas === true && (
                        <span className="inline-flex items-center gap-0.5 text-moss">
                          <CheckCircle2 size={11} aria-hidden /> sí
                        </span>
                      )}
                      {p.cumple_caracteristicas === false && (
                        <span className="inline-flex items-center gap-0.5 text-rust">
                          <AlertTriangle size={11} aria-hidden /> no
                        </span>
                      )}
                      {p.cumple_caracteristicas == null && <span className="text-mute">sin evaluar</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {referencias.length > 0 && (
        <>
          <Titulo>
            Contratos comparables en la BD del propio SEACE · {referencias.length}
            {ancla?.estado === "hallado" && typeof ancla.mediana === "number"
              ? ` · mediana regional ${fmtMoney(ancla.mediana)}`
              : ""}
          </Titulo>
          <ul className="space-y-1">
            {referencias.slice(0, 8).map((r, j) => (
              <li key={j} className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1 text-[11px]">
                <span className="min-w-0">
                  <span className="truncate text-ink">{String(r.descripcion || "—").slice(0, 70)}</span>
                  <span className="text-mute">
                    {" "}
                    · {r.entidad || "entidad s/n"} {r.region ? `· ${r.region}` : ""}
                  </span>
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1.5 inline-flex items-center gap-0.5 text-heroViolet hover:underline"
                    >
                      {r.ocid || "ver"} <ExternalLink size={9} aria-hidden />
                    </a>
                  )}
                </span>
                <span className="shrink-0 font-mono font-semibold text-ink">
                  {typeof (r.precio_unitario ?? r.precio_unitario_adjudicado ?? r.precio_unitario_referencial) === "number"
                    ? fmtMoney(r.precio_unitario ?? r.precio_unitario_adjudicado ?? r.precio_unitario_referencial)
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {proveedores.length > 0 && (
        <>
          <Titulo>Proveedores donde la entidad podría haber cotizado</Titulo>
          <ul className="space-y-0.5 text-[12px]">
            {proveedores.map((p, j) => (
              <li key={j}>
                <span className="font-medium">{p.nombre || "—"}</span>
                {p.linea && <span className="text-mute"> · línea {p.linea}</span>}
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1.5 inline-flex items-center gap-0.5 text-heroViolet hover:underline"
                  >
                    ver <ExternalLink size={9} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {queries.length > 0 && (
        <details className="mt-4 text-[11px] text-mute">
          <summary className="cursor-pointer font-semibold uppercase tracking-widest hover:text-ink">
            Qué buscó el agente · {queries.length} consulta(s)
          </summary>
          <ul className="mt-1 space-y-0.5">
            {queries.map((q, j) => (
              <li key={j} className="font-mono">
                {q}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Equivalente textual del gráfico: todos los ítems, todas las cifras, sin
 * recortar por presupuesto de pantalla. Es densa a propósito — el periodista
 * y el auditor la quieren así — y vive en un panel, no en la página.
 */
export function TablaPrecios({ filas, fmtMoney }: { filas: FilaPrecio[]; fmtMoney: (n: any) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <caption className="pb-2 text-left text-[11px] text-mute">
          Los {filas.length} ítems desglosados del requerimiento con sus precios. Mismos datos del gráfico, en texto.
        </caption>
        <thead>
          <tr className="border-b border-line text-left align-bottom text-mute">
            <th className="px-2 py-1.5 font-semibold">#</th>
            <th className="px-2 py-1.5 font-semibold">Producto</th>
            <th className="px-2 py-1.5 text-right font-semibold">Cantidad</th>
            <th className="px-2 py-1.5 text-right font-semibold">Ofertado c/u</th>
            <th className="px-2 py-1.5 text-right font-semibold">Mercado c/u</th>
            <th className="px-2 py-1.5 text-right font-semibold">Rango observado</th>
            <th className="px-2 py-1.5 text-right font-semibold">Línea ofertada</th>
            <th className="px-2 py-1.5 text-right font-semibold">Línea a mercado</th>
            <th className="px-2 py-1.5 text-right font-semibold">Δ %</th>
            <th className="px-2 py-1.5 font-semibold">Veredicto</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.key} className="border-b border-line/50 align-top">
              <td className="px-2 py-1.5 font-mono font-bold text-heroViolet">{fila.numero}</td>
              <td className="px-2 py-1.5 text-ink">{fila.descripcion.slice(0, 80)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-ink">
                {fila.cantidad !== null ? fila.cantidad.toLocaleString("es-PE") : "—"}
                <div className="text-[9px] text-mute">{fila.unidad}</div>
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink">
                {fila.ofertadoUnit !== null ? fmtMoney(fila.ofertadoUnit) : "—"}
                {fila.baseOfertado === "referencial" && <div className="text-[9px] text-mute">referencial</div>}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink">
                {fila.referenciaUnit !== null
                  ? `${fila.tipoReferencia === "mediana" ? "" : "≈ "}${fmtMoney(fila.referenciaUnit)}`
                  : "—"}
                {fila.tipoReferencia === "estimacion_ia" && fila.referenciaUnit !== null && (
                  <div className="text-[9px] text-mute">estimado, sin medir</div>
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-mute">
                {fila.rangoMinUnit !== null && fila.rangoMaxUnit !== null
                  ? `${fmtMoney(fila.rangoMinUnit)} – ${fmtMoney(fila.rangoMaxUnit)}`
                  : "—"}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink">
                {fila.ofertado !== null ? fmtMoney(fila.ofertado) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink">
                {fila.referencia !== null ? fmtMoney(fila.referencia) : "—"}
              </td>
              <td className={cn("px-2 py-1.5 text-right font-mono font-bold", fila.sobreElRango ? "text-rust" : "text-ink")}>
                {fila.diffPct !== null ? `${fila.diffPct > 0 ? "+" : ""}${fila.diffPct.toFixed(1)} %` : "—"}
              </td>
              <td className={cn("px-2 py-1.5", fila.veredicto.ui.texto)}>
                {fila.veredicto.etiqueta}
                {!fila.medido && fila.motivo && <div className="text-[9px] text-mute">{fila.motivo}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
