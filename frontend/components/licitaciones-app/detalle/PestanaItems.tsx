import { limpiar } from "@/lib/licitaciones";
import type { DetalleOportunidad, Item, PrecioRef } from "@/lib/licitaciones-app/tipos";
import { numero, soles } from "@/lib/formato";
import { Caja } from "@/components/gobserva/app/Caja";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { TablaDatos } from "@/components/gobserva/ui/TablaDatos";
import { Package } from "lucide-react";

/** Los ítems con su CUBSO, cantidad y valor; abajo, los precios de referencia de esos CUBSO (lo que pagó el Estado). */
export function PestanaItems({ o }: { o: DetalleOportunidad }) {
  const total = o.itemsDetalle.reduce((s, i) => s + (i.valor ?? 0), 0);
  return (
    <div className="grid gap-4 sm:gap-6">
      <Caja
        id="items"
        titulo={`${numero(o.itemsDetalle.length)} ${o.itemsDetalle.length === 1 ? "ítem" : "ítems"}`}
        descripcion={total > 0 ? `Suman ${soles(total)} de valor estimado` : undefined}
        relleno={false}
      >
        {o.itemsDetalle.length === 0 ? (
          <EstadoVacio Icono={Package} titulo="Sin ítems en los datos abiertos" texto="La entidad no los publicó en el OCDS: están en las bases del proceso (pestaña Documentos)." />
        ) : (
          <TablaDatos<Item>
            titulo="Ítems del proceso"
            filas={o.itemsDetalle}
            claveFila={(i) => String(i.posicion)}
            columnas={[
              { clave: "n", titulo: "N.º", className: "w-14", celda: (i) => <span className="font-mono text-meta text-mute">{i.posicion}</span> },
              {
                clave: "desc",
                titulo: "Descripción",
                celda: (i) => (
                  <div className="min-w-0 max-w-[40rem]">
                    <p className="text-dato text-ink">{limpiar(i.descripcion) || "Sin descripción"}</p>
                    {i.cubso && (
                      <p className="mt-0.5 text-meta text-mute">
                        CUBSO <span className="font-mono">{i.cubso}</span>
                        {i.cubsoNombre ? `, ${limpiar(i.cubsoNombre)}` : ""}
                      </p>
                    )}
                  </div>
                ),
              },
              {
                clave: "cant",
                titulo: "Cantidad",
                alinear: "derecha",
                className: "w-36",
                celda: (i) => <span className="whitespace-nowrap tabular-nums text-ink">{i.cantidad != null ? `${numero(i.cantidad)} ${i.unidad ?? ""}` : "Sin dato"}</span>,
              },
              { clave: "valor", titulo: "Valor", alinear: "derecha", className: "w-36", celda: (i) => <span className="whitespace-nowrap font-semibold tabular-nums text-ink">{i.valor != null ? soles(i.valor) : "Sin dato"}</span> },
              { clave: "estado", titulo: "Estado", desde: "lg", className: "w-32", celda: (i) => (i.estado ? <Insignia>{limpiar(i.estado)}</Insignia> : null) },
            ]}
            tarjeta={(i) => (
              <div className="px-4 py-3.5">
                <p className="text-dato text-ink">
                  <span className="mr-2 font-mono text-meta text-mute">{i.posicion}</span>
                  {limpiar(i.descripcion) || "Sin descripción"}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-x-4 text-meta text-inkSoft">
                  <span className="tabular-nums">{i.cantidad != null ? `${numero(i.cantidad)} ${i.unidad ?? ""}` : "Cantidad sin dato"}</span>
                  <span className="font-semibold tabular-nums text-ink">{i.valor != null ? soles(i.valor) : "Valor sin dato"}</span>
                </p>
              </div>
            )}
          />
        )}
      </Caja>

      {o.precios.length > 0 && (
        <Caja id="precios" titulo="Precios de referencia" descripcion="Lo que pagaron las entidades por cada CUBSO: el cuartil bajo, la mediana y el alto" relleno={false}>
          <TablaDatos<PrecioRef>
            titulo="Precios de referencia por CUBSO"
            filas={o.precios}
            claveFila={(p) => `${p.cubso}-${p.unidad}-${p.anio}`}
            columnas={[
              { clave: "cubso", titulo: "CUBSO y unidad", celda: (p) => <span className="text-dato text-ink"><span className="font-mono">{p.cubso}</span> <span className="text-inkSoft">por {p.unidad}</span></span> },
              { clave: "anio", titulo: "Año", className: "w-20", celda: (p) => <span className="tabular-nums">{p.anio}</span> },
              { clave: "p25", titulo: "P25", alinear: "derecha", className: "w-28", celda: (p) => <span className="tabular-nums">{soles(p.p25)}</span> },
              { clave: "med", titulo: "Mediana", alinear: "derecha", className: "w-28", celda: (p) => <span className="font-semibold tabular-nums text-ink">{soles(p.mediana)}</span> },
              { clave: "p75", titulo: "P75", alinear: "derecha", className: "w-28", celda: (p) => <span className="tabular-nums">{soles(p.p75)}</span> },
              { clave: "n", titulo: "Base", desde: "lg", alinear: "derecha", className: "w-36", celda: (p) => <span className="text-meta text-inkSoft">{numero(p.n)} compras, {numero(p.entidades)} entidades</span> },
            ]}
            tarjeta={(p) => (
              <div className="px-4 py-3.5">
                <p className="text-dato text-ink">
                  <span className="font-mono">{p.cubso}</span> por {p.unidad}, {p.anio}
                </p>
                <p className="mt-1 text-meta text-inkSoft">
                  Mediana <b className="font-semibold text-ink">{soles(p.mediana)}</b>, de {soles(p.p25)} a {soles(p.p75)} ({numero(p.n)} compras)
                </p>
              </div>
            )}
          />
        </Caja>
      )}
    </div>
  );
}
