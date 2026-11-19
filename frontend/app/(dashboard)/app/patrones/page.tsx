import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import { Ayuda, EncabezadoPagina, Migas, Nota, Pagina } from "@/components/patrones";
import { PatronesVista } from "@/components/investigar/PatronesVista";
import { paginaDe, SECCIONES_PATRONES } from "@/lib/patrones";
import { etiquetaRegla, getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { uno } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Patrones",
  description:
    "Lo que se repite en la contratación pública: señales que vuelven en una misma entidad o empresa, postores que acompañan siempre al mismo ganador, socias de consorcio que después compiten y servicios que se renuevan más caros.",
  alternates: canonica("/app/patrones"),
};

// El catálogo de señales se cachea (lib/revision); la página lee `?seccion=`, `?page=` y `?regla=`, así que se arma por pedido.
export const revalidate = 600;

/**
 * Patrones: lo que SE REPITE, para quien investiga. Cinco listas en pestañas (`?seccion=`): una señal que vuelve en una
 * entidad, en una empresa, el postor de relleno, las socias de consorcio que después compiten y las renovaciones más caras.
 *
 * El servidor no pide ninguna lista: sólo el catálogo de señales (para nombrarlas) y lo que dice la URL. Cada pestaña
 * pide lo suyo a la API al abrirse (components/investigar/PatronesVista.tsx), así una visita es una consulta y no cinco.
 */
export default async function PatronesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const pedida = uno(searchParams?.seccion);
  const activa = pedida && pedida in SECCIONES_PATRONES ? pedida : undefined;
  const regla = uno(searchParams?.regla);

  // El nombre legible de cada señal, como en el resto de la app. Sin catálogo, la vista arma el nombre del identificador.
  const cat = await getCatalogoReglas().catch(() => ({}) as CatalogoReglas);
  const etiquetas: Record<string, string> = {};
  for (const id of [...Object.keys(cat), "red_flag_documental"]) etiquetas[id] = etiquetaRegla(id, cat);

  return (
    <Pagina>
      <Migas
        items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Patrones", href: "/app/patrones" }]}
        pestanas={{ primera: "entidades", activa, etiquetas: SECCIONES_PATRONES }}
      />
      <EncabezadoPagina
        titulo="Patrones"
        bajada="Lo que se repite: la misma señal una y otra vez en una entidad o una empresa, y las empresas que siempre aparecen juntas."
        ayuda={
          <Ayuda titulo="¿Qué es un patrón?">
            <span className="block">
              Una señal sola puede ser casualidad. Aquí está lo que <b>vuelve</b>: la misma señal en muchos contratos de una
              entidad o de una empresa, el postor que siempre acompaña al mismo ganador, las socias que después compiten, el servicio que se renueva más caro.
            </span>
            <span className="mt-1.5 block">Un patrón es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      />

      <PatronesVista
        activa={activa}
        inicial={{
          page: paginaDe(uno(searchParams?.page)),
          regla,
          ruc: /^20\d{9}$/.test(uno(searchParams?.ruc) ?? "") ? uno(searchParams?.ruc) : undefined,
          // La clave de una persona del comité (comite_mismo_ganador, migración 396): sus contratos, sin su nombre.
          integrante: /^[0-9a-f]{10}$/.test(uno(searchParams?.integrante) ?? "") ? uno(searchParams?.integrante) : undefined,
        }}
        etiquetas={etiquetas}
      />

      <Nota>
        Los patrones salen de cruzar los procesos publicados en el SEACE con lo que los agentes de Vigía leyeron en sus
        documentos. Dicen dónde conviene mirar primero: un patrón es un motivo para revisar, no una acusación. Antes de
        afirmar algo, abre los contratos de ejemplo y lee su evidencia.
      </Nota>
    </Pagina>
  );
}
