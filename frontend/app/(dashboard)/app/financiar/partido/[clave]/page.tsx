import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Landmark, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { TarjetaConfirmacion } from "@/components/financiar/TarjetaConfirmacion";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda, EncabezadoPagina, EstadoError, Pagina, Volver } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { getEstadoGlobal, getPago, tiposEnPalabras } from "@/lib/financiamiento";
import { numero, plural, soles } from "@/lib/formato";
import { EXPLICACION_PARTIDO, anioDeUrl, getDetallePartido, getRankingPartidos, periodoTexto } from "@/lib/partidosApi";

export const revalidate = 60;

export async function generateMetadata({ params, searchParams }: { params: { clave: string }; searchParams?: { anio?: string } }) {
  const anio = anioDeUrl(searchParams?.anio);
  const d = await getDetallePartido(params.clave, anio);
  if (!d) return { title: "Financiar contratos de un partido" };
  return { title: `Financiar la lectura de contratos de ${d.partido.nombre}, ${periodoTexto(anio)}` };
}

/**
 * /app/financiar/partido/[clave]?anio=2022: financiar la lectura de contratos POR PARTIDO y período.
 * Se leen contratos de las entidades que el partido gobernó en ese período (por la fecha en que se
 * convocaron). Quien financia elige el partido y el período, nunca los contratos: se asignan al azar,
 * primero los que ya tienen documentos. Se asocia al ganador de la elección.
 */
export default async function FinanciarPartidoPage({
  params,
  searchParams,
}: {
  params: { clave: string };
  searchParams?: { anio?: string | string[] };
}) {
  const anio = anioDeUrl(searchParams?.anio);
  const [ranking, detalle, estado, pago] = await Promise.all([
    getRankingPartidos(anio),
    getDetallePartido(params.clave, anio),
    getEstadoGlobal(),
    getPago(),
  ]);
  if (!ranking || !estado) return <NoSePudoLeer clave={params.clave} anio={anio} />;
  const fila = ranking.data.find((f) => f.clave === params.clave);
  if (!fila && !detalle) notFound();
  const nombre = detalle?.partido.nombre ?? fila?.nombre ?? params.clave;
  const enCola = fila?.enCola ?? 0;
  const listos = fila?.documentosListos ?? 0;
  const precioPen = estado.tarifa.precioPen;
  const metodos = pago ? ([pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[]) : [];
  const alcance = { tipo: "partido" as const, clave: params.clave, anio, nombre };
  const tipos = tiposEnPalabras(estado.alcance?.tipos_activos ?? []);
  const gobiernos = detalle?.partido.gobiernos ?? fila?.gobiernos;

  const indicadores: Indicador[] = [
    {
      valor: numero(enCola),
      etiqueta: enCola === 1 ? "se puede auditar hoy" : "se pueden auditar hoy",
      contexto: enCola === 0 ? "ninguno en la cola" : `${soles(enCola * precioPen)} leerlos, a ${soles(precioPen)} cada uno`,
      ayuda: (
        <Ayuda titulo="¿Qué se puede auditar hoy?">
          Contratos de las entidades que {nombre} gobernó en {periodoTexto(anio)}, convocados en esos años, que esperan
          financiamiento para leerse. Se asignan al azar, primero los que ya tienen sus documentos.
        </Ayuda>
      ),
    },
    { valor: numero(listos), etiqueta: "listos para leerse", contexto: enCola > 0 ? `de ${numero(enCola)} en cola, ya con sus documentos` : "ninguno en la cola" },
    {
      valor: numero(fila?.leidos ?? 0),
      etiqueta: "ya leídos",
      contexto: `de ${numero(fila?.contratos ?? 0)} contratos de sus gobiernos en ese período`,
    },
    {
      valor: numero(fila?.conSenales ?? 0),
      etiqueta: "con señal para revisar",
      contexto: "una señal no es una acusación",
    },
  ];

  const columnas: Columna[] = [
    { clave: "entidad", titulo: "Entidad que gobernó", ancho: "minmax(0,1fr)" },
    { clave: "contratos", titulo: "Contratos", ancho: "96px", alinear: "der" },
    { clave: "cola", titulo: "En cola", ancho: "84px", alinear: "der", desde: "md" },
  ];
  const filas: Fila[] = (detalle?.entidades ?? []).slice(0, 8).map((e) => ({
    id: e.ruc,
    href: `/app/financiar/entidad/${e.ruc}`,
    celdas: {
      entidad: <CeldaPrincipal titulo={e.nombre} textoCompleto={e.nombre} meta={[e.lugar, e.autoridad ? `Autoridad: ${e.autoridad}` : null]} />,
      contratos: <CeldaNumero>{numero(e.contratos)}</CeldaNumero>,
      cola: <CeldaNumero>{numero(e.enCola)}</CeldaNumero>,
    },
  }));

  return (
    <Pagina className="space-y-6">
      <Volver href={`/app/financiar?por=partido&anio=${anio}`}>Financiar por partido</Volver>

      <div className="space-y-4">
        <EncabezadoPagina
          titulo={<>¿Cómo contrataron los gobiernos de {nombre}?</>}
          bajada={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Landmark size={14} className="shrink-0 text-mute" aria-hidden /> Período {periodoTexto(anio)}
              </span>
              {gobiernos && (
                <span>
                  {numero(gobiernos.regional)} {gobiernos.regional === 1 ? "región" : "regiones"}, {numero(gobiernos.provincial)}{" "}
                  {gobiernos.provincial === 1 ? "provincia" : "provincias"}, {numero(gobiernos.distrital)}{" "}
                  {gobiernos.distrital === 1 ? "distrito" : "distritos"}
                </span>
              )}
              <Link
                href={`/app/partidos/${params.clave}?anio=${anio}`}
                prefetch={false}
                className="inline-flex min-h-[24px] items-center gap-0.5 font-medium text-granate underline-offset-2 hover:underline"
              >
                Ver todos sus contratos <ChevronRight size={14} aria-hidden />
              </Link>
            </span>
          }
        />
        <CifrasEnFila items={indicadores} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-6">
          <Aviso>{EXPLICACION_PARTIDO}</Aviso>

          {filas.length > 0 && (
            <section aria-labelledby="entidades-partido" className="space-y-2">
              <h2 id="entidades-partido" className="font-display text-lg font-bold text-ink">Las entidades con más contratos</h2>
              <Tabla columnas={columnas} filas={filas} etiqueta={`Entidades que gobernó ${nombre} con más contratos`} />
            </section>
          )}

          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>Financias capacidad de lectura, no resultados.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              Eliges el partido y el período, no los contratos: se asignan al azar entre los de sus gobiernos en cola, y los
              resultados se publican aunque señalen a quien financió.
            </Ayuda>
            <Link href="/app/financiar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>
          </p>
          <Aviso tono="neutro">
            Estos contratos se asocian al partido que ganó la elección de ese período. Una señal es un motivo para revisar un
            contrato, nunca una acusación contra un partido ni una persona.
          </Aviso>
        </div>

        <section
          aria-label={`Financiar la lectura de contratos de ${nombre}`}
          className="order-first w-full max-w-2xl xl:order-last xl:sticky xl:top-6 xl:max-w-none xl:self-start"
          id="aportar"
        >
          {enCola > 0 ? (
            <ContribuirForm
              alcance={alcance}
              precioPen={precioPen}
              restantes={enCola}
              metodos={metodos}
              pagoConfigurado={!!pago?.configurado}
              financiados={0}
            />
          ) : (
            <TarjetaConfirmacion
              titulo="Hoy no hay contratos de este partido para auditar"
              acciones={<EnlaceAccion href={`/app/financiar?por=partido&anio=${anio}`}>Elegir otro partido</EnlaceAccion>}
            >
              {tipos
                ? `Por ahora Vigía audita solo contratos de ${tipos}, y ninguno de los gobiernos de este partido en ${periodoTexto(anio)} espera en la cola.`
                : `Ninguno de los contratos de sus gobiernos en ${periodoTexto(anio)} espera en la cola.`}{" "}
              Podrás financiar su lectura cuando entre uno.
            </TarjetaConfirmacion>
          )}
        </section>
      </div>
    </Pagina>
  );
}

function NoSePudoLeer({ clave, anio }: { clave: string; anio: number }) {
  return (
    <Pagina>
      <Volver href={`/app/financiar?por=partido&anio=${anio}`}>Financiar por partido</Volver>
      <EncabezadoPagina titulo="¿Cómo contrataron los gobiernos de este partido?" />
      <EstadoError
        titulo="No pudimos leer la cola de este partido"
        accion={<EnlaceAccion href={`/app/financiar/partido/${encodeURIComponent(clave)}?anio=${anio}`}>Reintentar</EnlaceAccion>}
      >
        El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
      </EstadoError>
    </Pagina>
  );
}
