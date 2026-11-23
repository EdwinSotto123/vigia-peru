import { ScanSearch } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, Tabla, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { ESTADO_LABEL, ESTADO_PUNTO, type Zona, type ZonaEstado } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las zonas como filas de listado (DESIGN_SYSTEM.md §14.1), con la anatomía de todos:
 *   estado (chip) · zona (nombre + dónde queda y asignados a lectura) · en cola · ›
 * La misma tabla en /app/financiar (regiones o resultados de la búsqueda) y en la
 * ficha de una zona (sus provincias o distritos).
 *
 * El estado es un chip CORTO (punto + una palabra, el nombre completo para el lector de pantalla y en el `title`):
 * en la meta, el nombre largo junto al lugar y los asignados se cortaba en el celular, y una píldora con la frase
 * entera pedía ~190 px. En el celular el chip va bajo el nombre (`apilar`). La columna «Costo» (lo que costaba leer la
 * cola a «S/ X por contrato») se quitó el 2026-10-30: ya no se paga la lectura por contrato.
 *
 * Cada fila es el enlace a /app/financiar/[ubigeo]. Las provincias de una región se ven
 * en su ficha: antes se desplegaban dentro de la lista con un segundo botón por fila.
 *
 * `buscar`: la lista llega entera (las provincias o distritos de una zona) y se pagina y se busca en el navegador.
 * Sin `buscar`, la página la pagina y la busca el servidor (/app/financiar).
 */

export type ZonaListada = Pick<Zona, "ubigeo" | "nombre" | "pendientes" | "financiados" | "estado"> & {
  /** Dónde queda, antes del estado: "Provincia en Cusco". */
  lugar?: string;
};

/** El estado en una palabra, para el chip (el nombre completo es `ESTADO_LABEL`). */
const ESTADO_CORTO: Record<ZonaEstado, string> = {
  sin_datos: "Sin contratos",
  pendiente: "Por leer",
  parcial: "Parcial",
  financiada: "En lectura",
  procesada: "Completada",
};

function ChipEstado({ estado }: { estado: ZonaEstado }) {
  return (
    <span className="pill border-line bg-paper text-inkSoft" title={ESTADO_LABEL[estado]}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", ESTADO_PUNTO[estado])} aria-hidden />
      <span aria-hidden>{ESTADO_CORTO[estado]}</span>
      <span className="sr-only">{ESTADO_LABEL[estado]}</span>
    </span>
  );
}

function columnas(): Columna[] {
  return [
    { clave: "estado", titulo: "Estado", ancho: "116px", desde: "md", apilar: true },
    { clave: "zona", titulo: "Zona", ancho: "minmax(0,2.2fr)" },
    // El peso de su cola frente a la mayor de la lista: llena el hueco entre el nombre y las cifras.
    { clave: "barra", titulo: "", ancho: "minmax(0,0.5fr)", desde: "lg" },
    {
      clave: "cola",
      titulo: "En cola",
      ancho: "76px",
      alinear: "der",
      ayuda: (
        <Ayuda titulo="¿Qué es “en cola”?">
          Contratos de la zona que esperan su lectura a fondo. La zona es la sede de la entidad que contrata.
        </Ayuda>
      ),
    },
  ];
}

function filas(zonas: ZonaListada[]): Fila[] {
  const mayor = Math.max(1, ...zonas.map((z) => z.pendientes));
  return zonas.map((z) => ({
    id: z.ubigeo,
    href: `/app/financiar/${z.ubigeo}`,
    buscable: [z.nombre, z.lugar, ESTADO_LABEL[z.estado]].filter(Boolean).join(" "),
    celdas: {
      estado: <ChipEstado estado={z.estado} />,
      zona: (
        <CeldaPrincipal
          enLinea
          titulo={z.nombre}
          meta={[
            z.lugar && <Dato key="l" tipo="lugar">{z.lugar}</Dato>,
            z.financiados > 0 && <Dato key="f" icono={ScanSearch} nombre="Asignados a lectura">{numero(z.financiados)} asignados</Dato>,
          ]}
        />
      ),
      barra: <CeldaBarra parte={z.pendientes / mayor} resumen={`${numero(z.pendientes)} contratos en cola, de ${numero(mayor)} en la zona con más`} />,
      cola: <CeldaNumero>{numero(z.pendientes)}</CeldaNumero>,
    },
  }));
}

export function ListaZonas({
  zonas,
  etiqueta,
  buscar,
}: {
  zonas: ZonaListada[];
  etiqueta: string;
  /** La lista llega entera: se pagina y se busca acá (el texto del buscador). */
  buscar?: string;
}) {
  if (buscar) {
    return (
      <TablaPaginada
        columnas={columnas()}
        filas={filas(zonas)}
        etiqueta={etiqueta}
        tam={10}
        nombre="zonas"
        buscar={{ placeholder: buscar, etiqueta: `Buscar en ${etiqueta.toLowerCase()}` }}
        densidad="compacta"
        medida="contenedor"
      />
    );
  }
  return <Tabla columnas={columnas()} filas={filas(zonas)} etiqueta={etiqueta} densidad="compacta" medida="contenedor" />;
}
