import { CuentaGrupo, CeldaFecha, Tabla, type Columna, type Fila } from "@/components/listado";
import { IrAPestana } from "@/components/personas/IrAPestana";
import { numero } from "@/lib/formato";
import type { Procesamiento } from "@/lib/auditoria";
import { CeldaContrato, EstadoProcesamiento, hrefProcesamiento } from "./CeldasProcesamiento";

/**
 * Las lecturas que vinieron antes de "Lo último que se leyó": hasta cinco, en la `Tabla` del kit con las mismas piezas
 * que Ya leídos (el resultado en su chip: el peso del riesgo, «Sin señales» o «En revisión»; el contrato con su entidad y
 * su zona; cuándo terminó). Va en la pestaña En curso cuando no hay nada en análisis, que es su estado normal: en vez de
 * una pantalla a medio llenar, la persona ve que el trabajo existe y puede abrir cualquiera. Antes eran filas sueltas
 * sobre el fondo con el estado como texto («2 señales», «sin señales»). Datos reales de
 * /financiamiento/procesamientos (los mismos de Ya leídos). Una lectura en revisión humana dice solo eso (§10.4).
 * «Ver todas» cambia a la pestaña Ya leídos sin recargar: con los mismos filtros. Server-safe.
 */
const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Resultado", ancho: "124px", desde: "md", apilar: true },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "leido", titulo: "Leído", ancho: "88px", desde: "md" },
];

export function LecturasAnteriores({ items, total }: { items: Procesamiento[]; total: number | null }) {
  if (items.length === 0) return null;
  // Las lecturas fuera de "Lo último que se leyó": todas menos esa (o, sin el total, las que hay a la vista).
  const antes = total != null ? Math.max(total - 1, items.length) : null;
  const filas: Fila[] = items.map((p) => ({
    id: p.ocid,
    href: hrefProcesamiento(p.ocid),
    celdas: {
      estado: <EstadoProcesamiento p={p} />,
      contrato: <CeldaContrato p={p} />,
      leido: <CeldaFecha fecha={p.finalizadoAt} />,
    },
  }));
  return (
    <section aria-labelledby="lecturas-anteriores" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id="lecturas-anteriores" className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
          Lecturas anteriores
          {antes != null && <CuentaGrupo>{numero(antes)}</CuentaGrupo>}
        </h3>
        <IrAPestana clave="leidos">Ver todas en Ya leídos</IrAPestana>
      </div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Las últimas lecturas antes de la más reciente" />
    </section>
  );
}
