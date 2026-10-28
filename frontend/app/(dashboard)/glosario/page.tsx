import type { Metadata } from "next";
import { EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { GLOSARIO, nombreTermino } from "@/lib/glosario";

export const metadata: Metadata = {
  title: "Glosario",
  description:
    "Cada término que usa Vigía Perú, en palabras simples: órdenes de servicio, CAS, buena pro, PIM, la declaración jurada de intereses, las visitas y las señales.",
};

/**
 * Glosario (fase 5 del plan del 2026-10-27): todos los términos de lib/glosario.ts, los mismos que abre cada «?» de un
 * término en la app, en una sola lista con buscador y filtro por tema. `?q=` llega ya buscado (el enlace del «?»).
 */
const COLUMNAS: Columna[] = [
  { clave: "termino", titulo: "Término", ancho: "minmax(0,0.8fr)" },
  { clave: "definicion", titulo: "Qué es", ancho: "minmax(0,2fr)", desde: "md", apilar: true },
];

const TEMAS = [...new Set(Object.values(GLOSARIO).map((t) => t.tema))];

export default function GlosarioPage({ searchParams }: { searchParams?: { q?: string | string[] } }) {
  const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q;
  const filas: FilaFiltrable[] = Object.entries(GLOSARIO).map(([clave, t]) => {
    const nombre = nombreTermino(t.termino);
    return {
      id: clave,
      buscable: `${nombre} ${t.definicion} ${t.tema}`,
      valores: { tema: t.tema },
      claves: { nombre: nombre.toLocaleLowerCase("es"), tema: `${TEMAS.indexOf(t.tema)} ${nombre.toLocaleLowerCase("es")}` },
      celdas: {
        termino: <CeldaPrincipal titulo={nombre} meta={t.tema} />,
        definicion: (
          <span className="block text-dato text-inkSoft">
            {t.definicion}
            {t.fuente ? <span className="mt-1 block text-meta text-mute">Fuente: {t.fuente}</span> : null}
          </span>
        ),
      },
    };
  });
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Glosario", href: "/glosario" }]} />
      <EncabezadoPagina
        titulo="Glosario"
        bajada="Cada término que usa Vigía, explicado en palabras simples. Es la misma explicación que se abre con el «?» junto a cada dato."
      />
      <TablaFiltrable
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Términos del glosario"
        nombre="términos"
        tam={100}
        buscar={{ placeholder: "Buscar un término: PIM, CAS, buena pro…", etiqueta: "Buscar en el glosario", inicial: q ?? undefined }}
        filtros={[{ clave: "tema", etiqueta: "Tema del término", corta: "Tema", opciones: TEMAS.map((t) => ({ valor: t, etiqueta: t })) }]}
        ordenes={[
          { valor: "alfabetico", etiqueta: "De la A a la Z", clave: "nombre", dir: "asc" },
          { valor: "tema", etiqueta: "Por tema", clave: "tema", dir: "asc" },
        ]}
      />
    </Pagina>
  );
}
