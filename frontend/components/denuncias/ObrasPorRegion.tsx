import Link from "next/link";
import { Seccion } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { numero, plural, solesCompacto } from "@/lib/formato";
import type { ContratoZona } from "@/lib/contratos";

/**
 * Para contrastar lo que se ve con lo que se contrató: cuántos contratos de OBRAS hay publicados por región
 * (los mismos de /app/contratos). Sirve a quien ve una obra parada y quiere saber si hay contratos de obras en su
 * región. No dice que ninguna obra esté parada: es el registro oficial, región por región.
 *
 * Una tabla compacta dentro de una sección PLEGADA (`Seccion plegable`): antes eran 25 barras abiertas que en el
 * celular empujaban «Cómo funciona una denuncia» varias pantallas abajo. Cada fila abre su región en el mapa; los
 * montos, con `solesCompacto` en su columna (no se parten en dos renglones).
 *
 * Server component: recibe ya las zonas de la API (datos planos). La región es la sede de la entidad que contrata.
 * Todas las regiones con obras, de la que más tiene a la que menos, con buscador y orden por valor (las 25 en una
 * página: es una lista entera, regla de las listas con buscador).
 */
const COLUMNAS: Columna[] = [
  { clave: "region", titulo: "Región", ancho: "minmax(0,1fr)" },
  { clave: "barra", titulo: "Frente a la región con más", ancho: "minmax(0,1.2fr)", desde: "md" },
  { clave: "obras", titulo: "Contratos de obras", ancho: "112px", alinear: "der" },
  { clave: "monto", titulo: "Valor", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

export function ObrasPorRegion({ zonas }: { zonas: ContratoZona[] }) {
  const lista = [...zonas].filter((z) => z.total > 0).sort((a, b) => b.total - a.total);
  if (lista.length === 0) return null;
  const max = Math.max(1, ...lista.map((z) => z.total));
  const filas: FilaFiltrable[] = lista.map((z) => ({
    id: z.ubigeo,
    href: `/app/mapa?region=${z.ubigeo}`,
    buscable: z.nombre,
    claves: { obras: z.total, monto: z.montoPen ?? null },
    celdas: {
      region: <span className="block truncate text-dato font-semibold text-ink">{z.nombre}</span>,
      barra: <CeldaBarra parte={z.total / max} resumen={`${plural(z.total, "contrato de obras", "contratos de obras")} en ${z.nombre}`} />,
      obras: <CeldaNumero>{numero(z.total)}</CeldaNumero>,
      monto: z.montoPen != null ? <CeldaNumero>{solesCompacto(z.montoPen)}</CeldaNumero> : null,
    },
  }));
  return (
    <Seccion
      plegable
      id="obras-por-region"
      titulo="Contratos de obras publicados por región"
      descripcion="Mira qué obras hay contratadas en tu región. Es el registro oficial: no dice si una obra está parada."
      acciones={
        <Link href="/app/contratos?tipo=obras" className="text-meta font-semibold text-granate underline-offset-4 hover:underline">
          Ver los contratos de obras
        </Link>
      }
    >
      <TablaFiltrable
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Contratos de obras por región (cada una abre su región en el mapa)"
        densidad="compacta"
        tam={25}
        nombre="regiones"
        buscar={{ placeholder: "Buscar una región…", etiqueta: "Buscar una región" }}
        ordenes={[
          { valor: "obras", etiqueta: "Más contratos de obras", clave: "obras", dir: "desc" },
          { valor: "monto", etiqueta: "Mayor valor", clave: "monto", dir: "desc" },
        ]}
      />
    </Seccion>
  );
}
