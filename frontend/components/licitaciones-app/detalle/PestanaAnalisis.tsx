import { ShieldCheck, Users } from "lucide-react";
import { limpiar } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { fechaCortaLima, pct } from "@/lib/licitaciones-app/formato";
import type { DetalleOportunidad, Parecido, ProveedorTop } from "@/lib/licitaciones-app/tipos";
import { numero, soles, solesCompacto } from "@/lib/formato";
import { Caja } from "@/components/gobserva/app/Caja";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { InsigniaSenal } from "@/components/gobserva/ui/Insignia";
import { TablaDatos } from "@/components/gobserva/ui/TablaDatos";

/**
 * El análisis: las señales de riesgo con su evidencia, el comprador en cifras (12 meses de CONOSCE), a quién le compra y
 * cuánto se pagó en procesos parecidos. Todo sale de datos públicos; las señales son señales, no acusaciones.
 */
export function PestanaAnalisis({ o }: { o: DetalleOportunidad }) {
  const c = o.comprador;
  return (
    <div className="grid gap-4 sm:gap-6">
      <Caja id="senales" titulo="Señales de riesgo" descripcion="Calculadas con el historial del comprador y lo que publicó el proceso">
        {o.senales.length === 0 ? (
          <EstadoVacio
            Icono={ShieldCheck}
            titulo="Nada que marcar"
            texto="Con al menos 5 procesos del comprador en 12 meses medimos cuántos tuvieron un solo postor, si un proveedor concentra lo adjudicado y si adjudica casi al tope. Aquí no salta ninguna."
            className="py-6 sm:py-8"
          />
        ) : (
          <ul className="divide-y divide-line">
            {o.senales.map((s) => (
              <li key={s.clave} className="py-3 first:pt-0 last:pb-0">
                <InsigniaSenal senal={s} />
                <p className="mt-1.5 max-w-[72ch] text-dato leading-relaxed text-ink">{s.evidencia}</p>
              </li>
            ))}
          </ul>
        )}
      </Caja>

      {c ? (
        <>
          <Caja id="comprador" titulo="El comprador en 12 meses" descripcion="Adjudicaciones con buena pro y postores registrados en CONOSCE (OECE)" relleno={false}>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-line lg:grid-cols-5">
              <Dato etiqueta="Procesos adjudicados" valor={numero(c.procesos)} />
              <Dato etiqueta="Adjudicado" valor={solesCompacto(c.monto)} />
              <Dato etiqueta="Postores por proceso" valor={c.postoresPromedio != null ? c.postoresPromedio.toLocaleString("es-PE", { maximumFractionDigits: 1 }) : "Sin dato"} />
              <Dato etiqueta="Con un solo postor" valor={c.conPostores ? pct(c.unSoloPostor / c.conPostores) : "Sin dato"} detalle={c.conPostores ? `${numero(c.unSoloPostor)} de ${numero(c.conPostores)}` : undefined} />
              <Dato etiqueta="Adjudicado sobre referencial" valor={c.adjSobreRef != null ? pct(c.adjSobreRef) : "Sin dato"} />
            </dl>
          </Caja>

          <Caja id="proveedores" titulo="A quién le compra" descripcion="Las empresas que más le adjudicaron en 12 meses" relleno={false}>
            {c.proveedores.length === 0 ? (
              <EstadoVacio Icono={Users} titulo="Sin empresas registradas" className="py-6 sm:py-8" />
            ) : (
              <TablaDatos<ProveedorTop>
                titulo="Proveedores del comprador"
                filas={c.proveedores}
                claveFila={(p) => p.ruc}
                columnas={[
                  { clave: "nombre", titulo: "Empresa", celda: (p) => <span className="text-dato font-semibold text-ink">{p.nombre ? tituloNatural(p.nombre) : "Sin nombre"}</span> },
                  { clave: "ruc", titulo: "RUC", desde: "lg", className: "w-36", celda: (p) => <span className="font-mono text-meta text-inkSoft">{p.ruc}</span> },
                  { clave: "procesos", titulo: "Procesos", alinear: "derecha", className: "w-24", celda: (p) => <span className="tabular-nums">{numero(p.procesos)}</span> },
                  { clave: "monto", titulo: "Adjudicado", alinear: "derecha", className: "w-32", celda: (p) => <span className="font-semibold tabular-nums text-ink">{solesCompacto(p.monto)}</span> },
                  {
                    clave: "parte",
                    titulo: "Parte",
                    alinear: "derecha",
                    className: "w-24",
                    celda: (p) => <span className="tabular-nums text-inkSoft">{c.monto > 0 && p.monto != null ? parte(p.monto / c.monto) : "Sin dato"}</span>,
                  },
                ]}
                tarjeta={(p) => (
                  <div className="px-4 py-3.5">
                    <p className="text-dato font-semibold text-ink">{p.nombre ? tituloNatural(p.nombre) : "Sin nombre"}</p>
                    <p className="mt-1 text-meta text-inkSoft">
                      {numero(p.procesos)} {p.procesos === 1 ? "proceso" : "procesos"}, {solesCompacto(p.monto)}
                      {c.monto > 0 && p.monto != null ? ` (${parte(p.monto / c.monto)})` : ""}
                    </p>
                  </div>
                )}
              />
            )}
          </Caja>
        </>
      ) : (
        <Caja id="comprador" titulo="El comprador en 12 meses">
          <EstadoVacio Icono={Users} titulo="Sin historial del comprador" texto="Esta entidad no tiene adjudicaciones registradas en CONOSCE en los últimos 12 meses." className="py-6 sm:py-8" />
        </Caja>
      )}

      <Caja id="parecidos" titulo="Procesos parecidos ya adjudicados" descripcion="Para estimar tu precio: lo que se pagó por algo parecido" relleno={false}>
        {o.parecidos.length === 0 ? (
          <EstadoVacio titulo="Sin procesos parecidos con precio" texto="No encontramos adjudicaciones con un objeto parecido y precio unitario publicado." className="py-6 sm:py-8" />
        ) : (
          <TablaDatos<Parecido>
            titulo="Procesos parecidos adjudicados"
            filas={o.parecidos}
            claveFila={(p) => `${p.id}-${p.descripcion}`}
            columnas={[
              {
                clave: "desc",
                titulo: "Qué se compró",
                celda: (p) => (
                  <div className="min-w-0 max-w-[32rem]">
                    <p className="line-clamp-2 text-dato text-ink">{limpiar(p.descripcion) || "Sin descripción"}</p>
                    <p className="mt-0.5 text-meta text-mute">
                      {p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre"}
                      {p.fecha ? `, ${fechaCortaLima(p.fecha)}` : ""}
                    </p>
                  </div>
                ),
              },
              { clave: "cant", titulo: "Cantidad", desde: "lg", alinear: "derecha", className: "w-32", celda: (p) => <span className="whitespace-nowrap tabular-nums">{p.cantidad != null ? `${numero(p.cantidad)} ${p.unidad ?? ""}` : "Sin dato"}</span> },
              { clave: "ref", titulo: "Unit. referencial", alinear: "derecha", className: "w-32", celda: (p) => <span className="tabular-nums text-inkSoft">{soles(p.unitRef)}</span> },
              { clave: "adj", titulo: "Unit. adjudicado", alinear: "derecha", className: "w-32", celda: (p) => <span className="font-semibold tabular-nums text-ink">{soles(p.unitAdj)}</span> },
              { clave: "prov", titulo: "Ganó", desde: "xl", className: "w-48", celda: (p) => <span className="line-clamp-2 text-meta text-inkSoft">{p.proveedor ? tituloNatural(p.proveedor) : "Persona natural"}</span> },
            ]}
            tarjeta={(p) => (
              <div className="px-4 py-3.5">
                <p className="line-clamp-2 text-dato text-ink">{limpiar(p.descripcion) || "Sin descripción"}</p>
                <p className="mt-1 text-meta text-inkSoft">
                  Unitario adjudicado <b className="font-semibold text-ink">{soles(p.unitAdj)}</b> (referencial {soles(p.unitRef)})
                </p>
                <p className="mt-0.5 truncate text-meta text-mute">{p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre"}</p>
              </div>
            )}
          />
        )}
      </Caja>
    </div>
  );
}

/** Una parte del total: «menos de 1 %» en vez de un «0 %» que no es cero. */
const parte = (x: number) => (x < 0.005 ? "menos de 1\u202f%" : pct(x));

function Dato({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <dt className="text-meta text-inkSoft">{etiqueta}</dt>
      <dd className="mt-1.5 font-display text-seccion font-bold leading-none tabular-nums text-ink">{valor}</dd>
      {detalle && <dd className="mt-1 text-meta text-mute">{detalle}</dd>}
    </div>
  );
}
