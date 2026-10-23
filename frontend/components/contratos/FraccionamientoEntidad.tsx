/**
 * Ficha de entidad, pestaña "Cuánto gasta" (compras por orden): días en que la entidad le emitió a una misma empresa
 * varias órdenes "hasta 8 UIT" que juntas pasan el tope (GET /entidades/:ruc/fraccionamiento, CONOSCE).
 * Cada fila abre el panel con las órdenes de ese día.
 */

import { CeldaFecha, CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { Receipt } from "lucide-react";
import type { FraccionamientoEntidad } from "@/lib/contratos";
import { numero, soles, solesCompacto } from "@/lib/formato";

const COLUMNAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa y órdenes", ancho: "minmax(0,1fr)" },
  { clave: "patron", titulo: "Patrón", ancho: "minmax(0,0.7fr)", desde: "md", apilar: true },
  { clave: "total", titulo: "Suman", ancho: "130px", alinear: "der" },
  { clave: "fecha", titulo: "Emitidas", ancho: "96px", desde: "lg" },
];

const capital = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "");

export function FraccionamientoEntidadTabla({ casos, nombre }: { casos: FraccionamientoEntidad["casos"]; nombre: string }) {
  const filas: Fila[] = casos.map((c) => ({
    id: `${c.rucProveedor}-${c.fecha}-${c.objeto}`,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={c.proveedor ?? c.rucProveedor}
          meta={[
            <Dato key="ordenes" icono={Receipt} nombre="Órdenes">
              {numero(c.ordenes)} órdenes {c.objeto ? `de ${c.objeto.toLowerCase()}` : ""}
            </Dato>,
            <Dato key="ruc" tipo="ruc">
              RUC <span className="font-mono tabular-nums" translate="no">{c.rucProveedor}</span>
            </Dato>,
          ]}
        />
      ),
      patron: (
        <ul className="flex flex-wrap gap-1.5" aria-label="Patrón">
          <li>
            <Badge variant={c.severidad === "alta" ? "crimson" : "amber"}>Mismo día</Badge>
          </li>
          {c.mismaDescripcion && (
            <li>
              <Badge variant="crimson">Misma descripción</Badge>
            </li>
          )}
        </ul>
      ),
      total: <CeldaNumero sub={`tope ${solesCompacto(c.topeSoles)}`}>{solesCompacto(c.totalSoles)}</CeldaNumero>,
      fecha: <CeldaFecha fecha={c.fecha} />,
    },
    detalle: {
      titulo: c.proveedor ?? c.rucProveedor,
      etiqueta: "Órdenes del mismo día",
      descripcion: (
        <>
          {numero(c.ordenes)} órdenes {c.objeto ? `de ${c.objeto.toLowerCase()} ` : ""}emitidas el mismo día por{" "}
          <b>{soles(c.totalSoles)}</b>. Cada una entra en el régimen de hasta 8 UIT, sin procedimiento de selección; juntas
          pasan el tope de {soles(c.topeSoles)}.
        </>
      ),
      contenido: (
        <ol className="space-y-3">
          {c.detalle.map((o, i) => (
            <li key={`${o.orden}-${i}`} className="rounded-xl border border-line bg-paperSoft px-3 py-2.5 text-meta leading-relaxed">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-rotulo text-mute" translate="no">
                  {o.orden}
                </span>
                <span className="font-mono tabular-nums text-ink">{soles(o.montoSoles)}</span>
              </div>
              {o.descripcion && <p className="mt-1 text-ink">{o.descripcion}</p>}
              {o.estado && <p className="mt-0.5 text-rotulo text-mute">{capital(o.estado)}</p>}
            </li>
          ))}
        </ol>
      ),
      pie: (
        <p className="text-rotulo text-mute">
          Fuente:{" "}
          <a href="https://conosce.osce.gob.pe/buscador/" target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            Órdenes de compra y de servicio de CONOSCE
          </a>
          . Es un patrón en los registros, no la prueba de un fraccionamiento.
        </p>
      ),
    },
    // La empresa y lo que se compró; un RUC 10 (persona natural) no se busca (docs/PRIVACIDAD.md).
    buscable: [c.rucProveedor.startsWith("10") ? null : c.proveedor, c.rucProveedor.startsWith("10") ? null : c.rucProveedor, c.objeto, ...c.detalle.map((o) => o.descripcion)]
      .filter(Boolean)
      .join(" "),
  }));
  // Todas, de a 10: antes eran "Ver más / Ver menos" sobre las 50 primeras.
  return (
    <TablaPaginada
      columnas={COLUMNAS}
      filas={filas}
      etiqueta={`Órdenes menores del mismo día de ${nombre} que juntas pasan 8 UIT`}
      nombre="días"
      buscar={{ placeholder: "Buscar por empresa, RUC o lo que se compró…", etiqueta: "Buscar en las órdenes del mismo día" }}
    />
  );
}
