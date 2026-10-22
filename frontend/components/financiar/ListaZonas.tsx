import { CircleDot, HandCoins } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, Tabla, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
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
 *
 * `buscar`: la lista llega entera (las provincias o distritos de una zona) y se pagina y se busca en el navegador.
 * Sin `buscar`, la página la pagina y la busca el servidor (/app/financiar).
 */

export type ZonaListada = Pick<Zona, "ubigeo" | "nombre" | "pendientes" | "financiados" | "estado"> & {
  /** Dónde queda, antes del estado: "Provincia en Cusco". */
  lugar?: string;
};

function columnas(precioPen: number | null): Columna[] {
  return [
    { clave: "estado", titulo: "", ancho: "10px" },
    { clave: "zona", titulo: "Zona", ancho: "minmax(0,2.2fr)" },
    // El peso de su cola frente a la mayor de la lista: llena el hueco entre el nombre y las cifras.
    { clave: "barra", titulo: "", ancho: "minmax(0,0.5fr)", desde: "md" },
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
      estado: <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", ESTADO_PUNTO[z.estado])} aria-hidden />,
      zona: (
        <CeldaPrincipal
          enLinea
          titulo={z.nombre}
          meta={[
            z.lugar && <Dato key="l" tipo="lugar">{z.lugar}</Dato>,
            <Dato key="e" icono={CircleDot} nombre="Estado">{ESTADO_LABEL[z.estado]}</Dato>,
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
