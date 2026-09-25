import { Ayuda } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { ESTADO_LABEL, ESTADO_PUNTO, type Zona } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las zonas como filas de listado (DESIGN_SYSTEM.md §14.1), con la anatomía de todos:
 *   estado · zona (nombre + estado en palabras y financiados) · en cola · costo · ›
 * La misma tabla en /app/financiar (regiones o resultados de la búsqueda) y en la
 * ficha de una zona (sus provincias o distritos).
 *
 * El estado va como punto en su columna y en palabras en la meta: una píldora con
 * "Parcialmente financiada" pedía ~190 px y, junto al formulario, dejaba al nombre sin
 * lugar. Color y palabra juntos, nunca el color solo.
 *
 * Cada fila es el enlace a /app/financiar/[ubigeo]. Las provincias de una región se ven
 * en su ficha: antes se desplegaban dentro de la lista con un segundo botón por fila.
 */

export type ZonaListada = Pick<Zona, "ubigeo" | "nombre" | "pendientes" | "financiados" | "estado"> & {
  /** Dónde queda, antes del estado: "Provincia en Cusco". */
  lugar?: string;
};

function columnas(precioPen: number | null): Columna[] {
  return [
    { clave: "estado", titulo: "", ancho: "10px" },
    { clave: "zona", titulo: "Zona", ancho: "minmax(0,1fr)" },
    {
      clave: "cola",
      titulo: "En cola",
      ancho: "92px",
      alinear: "der",
      ayuda: (
        <Ayuda titulo="¿Qué es “en cola”?">
          Contratos de la zona que esperan financiamiento para leerse. La zona es la sede de la entidad que contrata.
        </Ayuda>
      ),
    },
    {
      clave: "costo",
      titulo: "Costo",
      ancho: "112px",
      alinear: "der",
      desde: "md",
      ayuda: (
        <Ayuda titulo="¿Qué es el costo?">
          Lo que cuesta leer todos los contratos en cola{precioPen != null ? `, a ${soles(precioPen)} cada uno` : ""}.
        </Ayuda>
      ),
    },
  ];
}

function filas(zonas: ZonaListada[], precioPen: number | null): Fila[] {
  return zonas.map((z) => ({
    id: z.ubigeo,
    href: `/app/financiar/${z.ubigeo}`,
    celdas: {
      estado: <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", ESTADO_PUNTO[z.estado])} aria-hidden />,
      zona: (
        <CeldaPrincipal
          titulo={z.nombre}
          meta={[z.lugar, ESTADO_LABEL[z.estado], z.financiados > 0 ? `${numero(z.financiados)} financiados` : null]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
      cola: <CeldaNumero>{numero(z.pendientes)}</CeldaNumero>,
      costo: <CeldaNumero>{soles(precioPen != null ? z.pendientes * precioPen : null)}</CeldaNumero>,
    },
  }));
}

export function ListaZonas({
  zonas,
  precioPen,
  etiqueta,
}: {
  zonas: ZonaListada[];
  /** Tarifa por contrato. Sin tarifa, el costo dice "Sin dato" (nunca S/ 0). */
  precioPen: number | null;
  etiqueta: string;
}) {
  return <Tabla columnas={columnas(precioPen)} filas={filas(zonas, precioPen)} etiqueta={etiqueta} />;
}
