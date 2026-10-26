import { HandCoins } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, Tabla, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { ESTADO_LABEL, ESTADO_PUNTO, type Zona, type ZonaEstado } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las zonas como filas de listado (DESIGN_SYSTEM.md §14.1), con la anatomía de todos:
 *   estado (chip) · zona (nombre + dónde queda y financiados) · en cola · costo · ›
 * La misma tabla en /app/financiar (regiones o resultados de la búsqueda) y en la
 * ficha de una zona (sus provincias o distritos).
 *
 * El estado es un chip CORTO (punto + una palabra, el nombre completo para el lector de pantalla y en el `title`):
 * en la meta, «Parcialmente financiada» junto al lugar y los financiados se cortaba en el celular, y una píldora con
 * la frase entera pedía ~190 px. En el celular el chip y el costo van bajo el nombre (`apilar`), el costo con su
 * rótulo: antes la columna del costo desaparecía sin aviso.
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
  pendiente: "Por financiar",
  parcial: "Parcial",
  financiada: "Financiada",
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

function columnas(precioPen: number | null): Columna[] {
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
          Contratos de la zona que esperan financiamiento para leerse. La zona es la sede de la entidad que contrata.
        </Ayuda>
      ),
    },
    {
      clave: "costo",
      titulo: "Costo",
      ancho: "88px",
      alinear: "der",
      desde: "md",
      apilar: "con-rotulo",
      corto: "Leerlos cuesta",
      ayuda: (
        <Ayuda titulo="¿Qué es el costo?">
          Lo que cuesta leer todos los contratos en cola{precioPen != null ? `, a ${soles(precioPen)} cada uno` : ""}.
        </Ayuda>
      ),
    },
  ];
}

function filas(zonas: ZonaListada[], precioPen: number | null): Fila[] {
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
            z.financiados > 0 && <Dato key="f" icono={HandCoins} nombre="Financiados">{numero(z.financiados)} financiados</Dato>,
          ]}
        />
      ),
      barra: <CeldaBarra parte={z.pendientes / mayor} resumen={`${numero(z.pendientes)} contratos en cola, de ${numero(mayor)} en la zona con más`} />,
      cola: <CeldaNumero>{numero(z.pendientes)}</CeldaNumero>,
      costo: <CeldaNumero>{soles(precioPen != null ? z.pendientes * precioPen : null)}</CeldaNumero>,
    },
  }));
}

export function ListaZonas({
  zonas,
  precioPen,
  etiqueta,
  buscar,
}: {
  zonas: ZonaListada[];
  /** Tarifa por contrato. Sin tarifa, el costo dice "Sin dato" (nunca S/ 0). */
  precioPen: number | null;
  etiqueta: string;
  /** La lista llega entera: se pagina y se busca acá (el texto del buscador). */
  buscar?: string;
}) {
  if (buscar) {
    return (
      <TablaPaginada
        columnas={columnas(precioPen)}
        filas={filas(zonas, precioPen)}
        etiqueta={etiqueta}
        tam={15}
        nombre="zonas"
        buscar={{ placeholder: buscar, etiqueta: `Buscar en ${etiqueta.toLowerCase()}` }}
        densidad="compacta"
        medida="contenedor"
      />
    );
  }
  return <Tabla columnas={columnas(precioPen)} filas={filas(zonas, precioPen)} etiqueta={etiqueta} densidad="compacta" medida="contenedor" />;
}
