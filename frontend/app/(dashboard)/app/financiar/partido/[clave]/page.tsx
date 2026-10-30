import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Landmark, ShieldCheck } from "lucide-react";
import { ApoyarAlcance } from "@/components/financiar/ApoyarAlcance";
import { Ayuda, EncabezadoPagina, FichaNoLeida, Migas, Pagina } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { getEstadoGlobal, getPago, mediosAbiertos } from "@/lib/financiamiento";
import { listaY, numero } from "@/lib/formato";
import { EXPLICACION_PARTIDO, anioDeUrl, getDetallePartido, getRankingPartidos, periodoTexto } from "@/lib/partidosApi";

export const revalidate = 60;

export async function generateMetadata({ params, searchParams }: { params: { clave: string }; searchParams?: { anio?: string } }) {
  const anio = anioDeUrl(searchParams?.anio);
  const d = await getDetallePartido(params.clave, anio);
  if (!d) return { title: "Lo que falta leer de un partido" };
  return { title: `Lo que falta leer de los gobiernos de ${d.partido.nombre}, ${periodoTexto(anio)}` };
}

/**
 * /app/financiar/partido/[clave]?anio=2022: lo que falta leer de los contratos de un PARTIDO y período: los de las
 * entidades que gobernó en ese período (por la fecha en que se convocaron), asociados al ganador de la elección.
 * Desde el 2026-10-30 no se paga su lectura («S/ X por contrato» era una venta): a la derecha va el aporte al fondo
 * común (ApoyarAlcance). Un partido no queda como destino sugerido: la base guarda sólo un RUC o un ubigeo.
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
  const alcance = { tipo: "partido" as const, clave: params.clave, anio, nombre };
  const gobiernos = detalle?.partido.gobiernos ?? fila?.gobiernos;

  const indicadores: Indicador[] = [
    {
      valor: numero(enCola),
      etiqueta: enCola === 1 ? "espera lectura a fondo" : "esperan lectura a fondo",
      contexto: enCola === 0 ? "ninguno en la cola" : "con el fondo común, lo más grave primero",
      ayuda: (
        <Ayuda titulo="¿Qué espera lectura a fondo?">
          Contratos de las entidades que {nombre} gobernó en {periodoTexto(anio)}, convocados en esos años, que Vigía todavía
          no lee completos. Se leen con el fondo común, de lo más grave a lo menos grave; ningún aporte elige cuáles.
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
  // Todas las entidades que gobernó con contratos en la base (antes, las 8 primeras), de la que más tiene a la que menos.
  const filas: Fila[] = (detalle?.entidades ?? []).map((e) => ({
    id: e.ruc,
    href: `/app/financiar/entidad/${e.ruc}`,
    buscable: [e.nombre, e.ruc, e.lugar, e.autoridad].filter(Boolean).join(" "),
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={e.nombre}
          textoCompleto={e.nombre}
          meta={[
            e.lugar && <Dato key="l" tipo="lugar">{e.lugar}</Dato>,
            // Autoridad electa: completa (docs/PRIVACIDAD.md).
            e.autoridad && <Dato key="a" tipo="cargo" nombre="Autoridad">{e.autoridad}</Dato>,
          ]}
        />
      ),
      contratos: <CeldaNumero>{numero(e.contratos)}</CeldaNumero>,
      cola: <CeldaNumero>{numero(e.enCola)}</CeldaNumero>,
    },
  }));

  return (
    <Pagina className="space-y-6">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Lo que falta leer", href: "/app/financiar" },
          { etiqueta: "Por partido", href: `/app/financiar?por=partido&anio=${anio}` },
          { etiqueta: nombre },
        ]}
      />

      <div className="space-y-4">
        <EncabezadoPagina
          titulo={<>¿Cómo contrataron los gobiernos de {nombre}?</>}
          bajada={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Landmark size={14} className="shrink-0 text-mute" aria-hidden /> Período {periodoTexto(anio)}
              </span>
              {gobiernos && (
                <Dato tipo="lugar" nombre="Gobernó">
                  {listaY([
                    `${numero(gobiernos.regional)} ${gobiernos.regional === 1 ? "región" : "regiones"}`,
                    `${numero(gobiernos.provincial)} ${gobiernos.provincial === 1 ? "provincia" : "provincias"}`,
                    `${numero(gobiernos.distrital)} ${gobiernos.distrital === 1 ? "distrito" : "distritos"}`,
                  ])}
                </Dato>
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
              <h2 id="entidades-partido" className="font-display text-bloque leading-7 font-bold text-ink">
                Las entidades que gobernó, de la que más contratos tiene a la que menos
              </h2>
              <TablaPaginada
                columnas={columnas}
                filas={filas}
                tam={10}
                nombre="entidades"
                etiqueta={`Entidades que gobernó ${nombre}`}
                buscar={{ placeholder: "Buscar una entidad, un lugar o un RUC…", etiqueta: "Buscar en sus entidades" }}
              />
            </section>
          )}

          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>Tu aporte va al fondo común: no decide qué se lee.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              Lo más grave se lee primero, sea del gobierno que sea, y los resultados se publican aunque señalen a quien
              aportó.
            </Ayuda>
            <Link href="/app/financiar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>
          </p>
          <Aviso tono="neutro">
            Estos contratos se asocian al partido que ganó la elección de ese período. Una señal es un motivo para revisar un
            contrato, nunca una acusación contra un partido ni una persona.
          </Aviso>
        </div>

        <section
          aria-label={`Ayuda a vigilar a los gobiernos de ${nombre}`}
          className="order-first w-full max-w-2xl xl:order-last xl:sticky xl:top-6 xl:max-w-none xl:self-start"
          id="aportar"
        >
          <ApoyarAlcance alcance={alcance} medios={mediosAbiertos(pago)} lote={{ precioPen, restantes: enCola }} />
        </section>
      </div>
    </Pagina>
  );
}

function NoSePudoLeer({ clave, anio }: { clave: string; anio: number }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Lo que falta leer", href: "/app/financiar" }, { etiqueta: "Por partido", href: `/app/financiar?por=partido&anio=${anio}` }]}
      titulo="¿Cómo contrataron los gobiernos de este partido?"
      error="No pudimos leer la cola de este partido"
      reintentar={{ href: `/app/financiar/partido/${encodeURIComponent(clave)}?anio=${anio}` }}
    />
  );
}
