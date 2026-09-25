import { notFound } from "next/navigation";
import { Ayuda, EstadoVacio, Pestanas, Volver } from "@/components/patrones";
import { Indicadores } from "@/components/listado";
import { AvisoMaqueta } from "@/components/aliados/AvisoMaqueta";
import { CadenaAliado } from "@/components/aliados/CadenaAliado";
import { insigniasDe, mesesDesde } from "@/components/aliados/IdentidadAliado";
import { RegionesDeAliado, TablaSenales, indicadoresAliado, senalesDeComprobantes } from "@/components/aliados/PerfilAliado";
import { PortadaAliado } from "@/components/aliados/PortadaAliado";
import { PruebaIndependencia } from "@/components/aliados/ReglasIndependencia";
import { ResumenDelPerfil } from "@/components/aliados/ResumenPerfil";
import { esFundador } from "@/components/aliados/TarjetaAliado";
import { getComprobanteDe, getPerfilAliado, resumirContribuciones } from "@/components/aliados/perfil";
import { puestoDe } from "@/components/aliados/ranking";
import { getEstadoGlobal, type Comprobante } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { numero, plural } from "@/lib/formato";
import { hrefSinMaqueta, maquetaActiva, queryMaqueta } from "@/lib/maqueta-aliados";

export const revalidate = 30;

/**
 * Perfil público de un aliado (DESIGN_SYSTEM.md §14.6): la página que quien financia
 * quiere mostrar y compartir, como un perfil social. Portada con su logo, su puesto en
 * el ranking y lo que publicó de sí; compartir y financiar; sus cifras; y todo lo demás
 * en pestañas (§14.3) en vez de cuatro secciones apiladas: Resumen | Señales | Zonas |
 * Aportes. El Resumen se entiende en una pantalla; cada pestaña va a la URL.
 *
 * Sigue siendo trazabilidad, no agradecimiento: aporte → contratos asignados → señal,
 * con la prueba de independencia junto a los contratos. Sin montos en soles.
 *
 * Son ~1 + N fetches (perfil + comprobante por aporte). Pasado el tope, la fila del
 * aporte enlaza a su comprobante en vez de traerlo.
 */

/** Aportes cuyo comprobante se trae para abrir en el panel. Más allá, se enlaza. */
const MAX_DETALLE = 12;
/** Filas de la pestaña Señales. */
const MAX_SENALES = 60;
const SECCIONES = ["resumen", "senales", "zonas", "aportes"] as const;
type Seccion = (typeof SECCIONES)[number];

const esSeccion = (v: string | undefined): v is Seccion => !!v && (SECCIONES as readonly string[]).includes(v);

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { maqueta?: string };
}) {
  const maqueta = maquetaActiva(searchParams?.maqueta);
  const [data, puesto] = await Promise.all([getPerfilAliado(params.slug, maqueta), puestoDe(params.slug, maqueta)]);
  if (!data) return { title: "Aliado no encontrado" };
  if (data.esMaqueta) {
    return {
      title: `${data.aliado.nombre} (maqueta)`,
      description: "Aliado inventado para probar el diseño. No existe y sus cifras no son reales.",
      robots: { index: false, follow: false },
    };
  }
  const r = resumirContribuciones(data.contribuciones);
  const title = `${data.aliado.nombre}, aliado de transparencia`;
  const description = [
    `${data.aliado.nombre} financió la lectura de ${plural(r.financiados, "contrato público", "contratos públicos")}; ${numero(r.leidos)} ya se leyeron.`,
    puesto ? `Puesto ${puesto.puesto} de ${numero(puesto.de)} en el ranking de aliados de Vigía Perú.` : null,
    "No eligió cuáles: se asignan por antigüedad.",
  ]
    .filter(Boolean)
    .join(" ");
  // La imagen la pone opengraph-image.tsx (cifras y puesto, con la marca de Vigía).
  return {
    title,
    description,
    openGraph: { type: "profile", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AliadoPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { maqueta?: string; seccion?: string };
}) {
  const maqueta = maquetaActiva(searchParams?.maqueta);
  // Sin el interruptor, un slug de maqueta es un 404 igual que cualquier slug inexistente.
  const data = await getPerfilAliado(params.slug, maqueta);
  if (!data) notFound();
  const { aliado, contribuciones, esMaqueta } = data;

  const r = resumirContribuciones(contribuciones);
  const conDetalle = contribuciones.slice(0, MAX_DETALLE);
  const [estado, resumen, puesto, comprobantes] = await Promise.all([
    getEstadoGlobal(),
    getResumenContratos(),
    puestoDe(aliado.slug, maqueta),
    Promise.all(conDetalle.map((c) => getComprobanteDe(c.codigo, esMaqueta))),
  ]);
  const porCodigo = new Map<string, Comprobante | null>(conDetalle.map((c, i) => [c.codigo, comprobantes[i] ?? null]));
  const items = contribuciones.map((contribucion) => ({ contribucion, comprobante: porCodigo.get(contribucion.codigo) ?? null }));
  const senales = senalesDeComprobantes(items);
  // Parcial (§10.5): sólo se leyó el detalle de los aportes más recientes.
  const parcial = contribuciones.length > MAX_DETALLE || comprobantes.some((c) => c == null);
  const entidades = parcial
    ? null
    : new Set(comprobantes.flatMap((c) => (c?.detalle ?? []).filter((d) => d.procesadaAt && d.entidad).map((d) => d.entidad))).size;

  const publicados = resumen?.total ?? 0;
  const regionesConCola = estado?.regionesConCola ?? 0;

  // Las pestañas van a la URL; el interruptor de maqueta viaja con ellas.
  const ruta = `/aliado/${aliado.slug}`;
  const mq = searchParams?.maqueta;
  const conMaqueta = mq === "0" || mq === "1" ? `&maqueta=${mq}` : esMaqueta ? "&maqueta=1" : "";
  const hrefSeccion = (s: Seccion) => `${ruta}?seccion=${s}${conMaqueta}`;
  const pedida = searchParams?.seccion;
  const seccion: Seccion = esSeccion(pedida) ? pedida : "resumen";

  const insignias = insigniasDe({
    esFundador: esFundador(aliado),
    financiados: r.financiados,
    leidos: r.leidos,
    regiones: r.regionesDistintas,
    regionesConCola,
    mesesAportando: mesesDesde(aliado.desde),
  });

  const sinComprobante = comprobantes.filter((c) => c == null).length;
  const avisoParcial = parcial ? (
    <p className="text-[12.5px] text-mute">
      {contribuciones.length > MAX_DETALLE
        ? `Señales de sus ${numero(MAX_DETALLE)} aportes más recientes; las de los anteriores están en el comprobante de cada aporte (pestaña Aportes).`
        : `Faltan las señales de ${plural(sinComprobante, "aporte cuyo comprobante no respondió", "aportes cuyos comprobantes no respondieron")}; vuelve a intentarlo en unos minutos.`}
    </p>
  ) : null;

  return (
    <div className="container-page space-y-6 py-6 sm:py-8">
      <Volver href={`/app/aliados${queryMaqueta(esMaqueta)}`}>Ranking de aliados</Volver>

      {esMaqueta && <AvisoMaqueta volverHref={hrefSinMaqueta("/app/aliados")} />}

      <PortadaAliado
        aliado={aliado}
        puesto={puesto}
        insignias={insignias}
        aportes={r.aportes}
        ruta={ruta}
        hrefRanking={`/app/aliados${queryMaqueta(esMaqueta)}`}
        esMaqueta={esMaqueta}
      />

      {/* Lo que hizo leer, cada cifra con su denominador. */}
      <Indicadores items={indicadoresAliado(r, publicados > 0 ? { total: publicados, texto: "publicados" } : null, regionesConCola)} />

      {/* `key`: un enlace del Resumen a otra pestaña (?seccion=) vuelve a montar la barra en esa pestaña. */}
      <Pestanas
        key={seccion}
        etiqueta={`Secciones del perfil de ${aliado.nombre}`}
        activa={seccion}
        pestanas={[
          {
            clave: "resumen",
            etiqueta: "Resumen",
            contenido: (
              <ResumenDelPerfil
                nombre={aliado.nombre}
                r={r}
                senales={senales}
                contribuciones={contribuciones}
                entidades={entidades}
                hrefs={{ senales: hrefSeccion("senales"), zonas: hrefSeccion("zonas"), aportes: hrefSeccion("aportes") }}
                esMaqueta={esMaqueta}
              />
            ),
          },
          {
            clave: "senales",
            etiqueta: "Señales encontradas",
            conteo: r.conSenal,
            contenido: (
              <div className="space-y-3">
                <p className="flex flex-wrap items-center gap-1 text-[13px] text-mute">
                  Ordenadas por puntaje: la más fuerte primero.
                  <Ayuda titulo="¿Una señal es una acusación?">
                    No: cada señal se publica con la norma citada y el documento oficial que la sostiene, y se publicó sin
                    consultar a {aliado.nombre}.
                  </Ayuda>
                </p>
                {senales.length > 0 ? (
                  <TablaSenales senales={senales.slice(0, MAX_SENALES)} nombre={aliado.nombre} esMaqueta={esMaqueta} />
                ) : (
                  <EstadoVacio compacto conLlamita={false} titulo={r.leidos > 0 ? "Sin señales publicadas" : "Todavía sin contratos leídos"}>
                    {r.leidos > 0
                      ? `Ninguno de sus ${numero(r.leidos)} contratos leídos tiene una señal publicada.`
                      : "Cada contrato aparece aquí en cuanto su dictamen se publica."}
                  </EstadoVacio>
                )}
                {senales.length > MAX_SENALES && (
                  <p className="text-[12.5px] text-mute">
                    Mostrando {numero(MAX_SENALES)} de {numero(senales.length)}: el resto, dentro del aporte que pagó cada una.
                  </p>
                )}
                {avisoParcial}
              </div>
            ),
          },
          {
            clave: "zonas",
            etiqueta: "Zonas",
            conteo: r.regiones.length,
            contenido: (
              <div className="space-y-3">
                <p className="flex flex-wrap items-center gap-1 text-[13px] text-mute">
                  Cada zona abre su cola, donde se puede financiar.
                  <Ayuda titulo="¿La zona se elige?">
                    Sí: al aportar se elige la zona y la cantidad. Los contratos concretos, no: salen de la cola por
                    antigüedad. La zona es la sede de la entidad que contrata.
                  </Ayuda>
                </p>
                {r.regiones.length > 0 ? (
                  <RegionesDeAliado regiones={r.regiones} financiados={r.financiados} />
                ) : (
                  <EstadoVacio compacto conLlamita={false} titulo="Todavía sin zonas">
                    Aparecen con su primer aporte confirmado.
                  </EstadoVacio>
                )}
              </div>
            ),
          },
          {
            clave: "aportes",
            etiqueta: "Aportes",
            conteo: r.aportes,
            contenido:
              contribuciones.length > 0 ? (
                <div className="space-y-3">
                  <PruebaIndependencia nombre={aliado.nombre} />
                  <CadenaAliado nombre={aliado.nombre} items={items} esMaqueta={esMaqueta} />
                  {contribuciones.length > MAX_DETALLE && (
                    <p className="text-[12.5px] text-mute">
                      Desde el aporte {numero(MAX_DETALLE + 1)}, la fila abre su comprobante público en vez del panel.
                    </p>
                  )}
                </div>
              ) : (
                <EstadoVacio compacto conLlamita={false} titulo="Todavía sin aportes confirmados">
                  Cuando el primero se confirme, cada contrato que haga leer aparece aquí con su entidad y su dictamen.
                </EstadoVacio>
              ),
          },
        ]}
      />
    </div>
  );
}
