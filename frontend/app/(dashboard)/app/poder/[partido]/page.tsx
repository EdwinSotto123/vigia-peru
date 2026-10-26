import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AyudaTermino, EncabezadoPagina, Migas, Nota, Pagina, Seccion } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { AyudaIndicios } from "@/components/grafo/indicios";
import { GrafoPartido } from "@/components/entidad/GrafoPartido";
import { GrafoPartidoRegiones } from "@/components/entidad/GrafoPartidoRegiones";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { parte } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import { getPoderPartido } from "@/lib/poder";

export async function generateMetadata({ params }: { params: { partido: string } }): Promise<Metadata> {
  return { title: `${tituloNatural(decodeURIComponent(params.partido))}, mapa de poder` };
}

/**
 * Un partido en el mapa de poder: las entidades que gobierna hoy, agrupadas por departamento con sus totales (todas,
 * también las que no tienen indicios), y las empresas ligadas a él que se repiten en varias de ellas.
 */
export default async function PoderPartidoPage({ params }: { params: { partido: string } }) {
  const r = await getPoderPartido(decodeURIComponent(params.partido));
  if (!r?.partido) notFound();
  const { partido: p, entidades } = r;
  // El nombre en su forma natural, como en la ruta de navegación (antes el h1 iba en MAYÚSCULAS).
  const nombre = tituloNatural(p.partido);

  const cifras: Indicador[] = [
    {
      valor: `${numero(p.n_entidades_con_captura)} de ${numero(p.n_entidades)}`,
      etiqueta: "entidades con contratos con indicio",
      contexto: `${porcentaje(parte(p.n_entidades_con_captura, p.n_entidades) * 100)} de las que gobierna, en ${plural(p.n_departamentos, "departamento", "departamentos")}`,
    },
    { valor: numero(p.n_captura), etiqueta: "contratos con indicio", contexto: "ganados por empresas ligadas al partido" },
    { valor: solesCompacto(p.monto_captura), etiqueta: "monto de esos contratos", contexto: "lo adjudicado a esas empresas (OECE)" },
    { valor: numero(p.n_empresas), etiqueta: "empresas ligadas", contexto: "distintas, en todas sus entidades" },
  ];

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Mapa de poder", href: "/app/poder" }, { etiqueta: nombre }]} />
      <EncabezadoPagina
        titulo={nombre}
        bajada={`Las ${plural(p.n_entidades, "entidad", "entidades")} que gobierna hoy y cuántos de sus contratos ganaron empresas ligadas al partido.`}
        ayuda={<AyudaTermino clave="captura" />}
      />
      <Indicadores items={cifras} />

      <Seccion
        titulo="Dónde gobierna"
        descripcion="Por departamento, cuántas de sus entidades tienen contratos con indicio. Abre uno para ver cada entidad."
        ayuda={<AyudaIndicios />}
      >
        {entidades.length > 0 ? (
          <GrafoPartidoRegiones partido={p.partido} entidades={entidades} />
        ) : (
          <p className="text-dato text-mute">No pudimos leer las entidades que gobierna.</p>
        )}
      </Seccion>

      {/* Las empresas que se repiten en varias de sus entidades: su propia consulta, para no frenar lo de arriba. Si
          ninguna se repite, no se muestra. */}
      <Suspense fallback={null}>
        <GrafoPartido partido={p.partido} />
      </Suspense>

      <Nota>
        «Gobierna» es haber ganado la alcaldía o la gobernación de esa jurisdicción (JNE), periodo vigente. Los indicios cruzan
        la ONPE (aportes y gastos de campaña) con el RNP y el SEACE (socios y contratos): son para revisar, no una acusación.
      </Nota>
    </Pagina>
  );
}
