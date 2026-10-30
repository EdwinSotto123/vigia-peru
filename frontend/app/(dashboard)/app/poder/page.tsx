import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import { Ayuda, EncabezadoPagina, EnlaceFuente, EstadoError, Migas, Nota, Pagina } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { PoderVista } from "@/components/entidad/PoderVista";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { BUSCADOR_RNP, CLARIDAD_ONPE, CONTRATACIONES_ABIERTAS, DATASET_AUTORIDADES_JNE } from "@/lib/fuentes";
import { parte, VISTAS_PODER } from "@/lib/grafo";
import { getPoderPartidos } from "@/lib/poder";
import { uno } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Mapa de poder",
  description: "Qué partido gobierna cada entidad y cuánta de su contratación fue a empresas ligadas a ese partido.",
  alternates: canonica("/app/poder"),
};

// Los datos se cachean 10 minutos (`next.revalidate` en lib/poder); la página lee `?vista=`, así que se arma por pedido.
export const revalidate = 600;

/**
 * Mapa de poder: de las entidades que gobierna cada partido (alcaldías y gobiernos regionales, periodo vigente, JNE),
 * cuántas tienen contratos ganados por empresas que le financiaron, le vendieron a la campaña o tienen un socio
 * contratado por la misma entidad. Son INDICIOS agregados para revisar.
 *
 * El servidor pide sólo el ranking de partidos (la primera pestaña y las cifras de arriba); cada otra pestaña pide lo
 * suyo al abrirse (components/entidad/PoderVista.tsx). Antes eran cinco consultas en cada visita.
 */
export default async function PoderPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const vista = uno(searchParams?.vista);
  const activa = vista && Object.keys(VISTAS_PODER).includes(vista) ? vista : undefined;
  const r = await getPoderPartidos();
  const partidos = r?.data ?? [];

  // Las cifras de arriba: la suma de entidades con indicio sobre las gobernadas (antes, «98 de 103 partidos tienen
  // indicios», que no distinguía a nadie).
  const gobernadas = partidos.reduce((s, p) => s + p.n_entidades, 0);
  const conIndicio = partidos.reduce((s, p) => s + p.n_entidades_con_captura, 0);
  const contratos = partidos.reduce((s, p) => s + p.n_captura, 0);
  const monto = partidos.reduce((s, p) => s + p.monto_captura, 0);
  const cifras: Indicador[] = [
    {
      valor: `${numero(conIndicio)} de ${numero(gobernadas)}`,
      etiqueta: "entidades con contratos con indicio",
      contexto: `${porcentaje(parte(conIndicio, gobernadas) * 100)} de las alcaldías y gobiernos regionales que hoy gobierna algún partido`,
    },
    { valor: numero(contratos), etiqueta: "contratos con indicio", contexto: "ganados por empresas ligadas al partido que gobierna la entidad" },
    { valor: solesCompacto(monto), etiqueta: "monto de esos contratos", contexto: "lo adjudicado a esas empresas (OECE)" },
  ];

  return (
    <Pagina>
      <Migas
        items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Mapa de poder", href: "/app/poder" }]}
        pestanas={{ param: "vista", primera: "partidos", activa, etiquetas: VISTAS_PODER }}
      />
      <EncabezadoPagina
        titulo="Mapa de poder"
        bajada="Qué partido gobierna cada alcaldía y gobierno regional, y cuántos de sus contratos ganaron empresas ligadas a él."
        ayuda={
          <Ayuda titulo="¿Qué mide la «captura»?">
            <span className="block">
              De las entidades que un partido gobierna hoy (alcaldías y gobiernos regionales, según el JNE), cuántos de sus
              contratos los ganaron empresas que <b>le financiaron</b> la campaña, que <b>le vendieron</b> a la campaña o que
              tienen un <b>socio contratado por la misma entidad</b>.
            </span>
            <span className="mt-1.5 block">Son cruces de registros públicos: señalan dónde mirar.</span>
          </Ayuda>
        }
      />

      {r ? (
        <>
          <Indicadores items={cifras} />
          <PoderVista partidos={partidos} activa={activa} entidadesConIndicio={conIndicio} />
        </>
      ) : (
        <EstadoError titulo="No pudimos leer el mapa de poder">Suele ser momentáneo. Vuelve a cargar la página en unos segundos.</EstadoError>
      )}

      <Nota>
        Fuentes: <EnlaceFuente href={DATASET_AUTORIDADES_JNE}>JNE</EnlaceFuente> (quién gobierna cada entidad),{" "}
        <EnlaceFuente href={CLARIDAD_ONPE}>ONPE</EnlaceFuente> (aportes y gastos de campaña), <EnlaceFuente href={BUSCADOR_RNP}>RNP</EnlaceFuente> y{" "}
        <EnlaceFuente href={CONTRATACIONES_ABIERTAS}>SEACE</EnlaceFuente> (socios y contratos). Cada indicio es un cruce de registros públicos para
        revisar: no es una acusación.
      </Nota>
    </Pagina>
  );
}
