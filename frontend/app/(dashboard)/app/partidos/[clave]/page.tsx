import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange, ChevronRight } from "lucide-react";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { GraficoMeses } from "@/components/partidos/GraficoMeses";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda, EncabezadoPagina, EstadoError, Pagina, Volver } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { AVISO_PARTIDO, anioDeUrl, getDetallePartido, periodoTexto } from "@/lib/partidosApi";

export const revalidate = 120;

export async function generateMetadata({ params, searchParams }: { params: { clave: string }; searchParams?: { anio?: string } }) {
  const d = await getDetallePartido(params.clave, anioDeUrl(searchParams?.anio));
  return { title: d ? `${d.partido.nombre}, contratos de sus gobiernos` : "Partido" };
}

/** "2023-01-01" → "enero de 2023". */
const mesLargo = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };

/**
 * /app/partidos/[clave]?anio=2022: los contratos de los gobiernos que ganó un partido en un período.
 * Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó. Se asocia al
 * GANADOR de la elección: una vacancia o un reemplazo dentro del período no está registrado.
 */
export default async function PartidoPage({ params, searchParams }: { params: { clave: string }; searchParams?: { anio?: string | string[] } }) {
  const anio = anioDeUrl(searchParams?.anio);
  const d = await getDetallePartido(params.clave, anio);
  // Sin respuesta: puede ser un partido que no gobernó nada ese período o un servidor caído. Desde el cliente no
  // se distinguen (ambos son `null`), así que se dice con esas dos palabras y no se muestra nada inventado.
  if (!d) return <NoDisponible clave={params.clave} anio={anio} />;
  if (!d.partido) notFound();

  const { partido, totales: t, porMes, entidades, regiones } = d;
  const esperando = t.enCola + t.documentosListos;
  const indicadores: Indicador[] = [
    {
      valor: numero(t.contratos),
      etiqueta: "contratos de sus gobiernos",
      contexto: `${solesCompacto(t.montoPen)} de valor referencial convocado, no lo pagado`,
      ayuda: <Ayuda titulo="¿Qué suma el monto?">La suma del valor referencial de las convocatorias del período. No es lo adjudicado ni lo pagado.</Ayuda>,
    },
    { valor: numero(t.leidos), etiqueta: "ya leídos por Vigía", contexto: t.contratos > 0 ? `${porcentaje((t.leidos / t.contratos) * 100, { decimales: 1 })} del total` : "ninguno" },
    { valor: numero(t.conSenales), etiqueta: "con señal para revisar", contexto: "una señal no es una acusación" },
    {
      valor: numero(esperando),
      etiqueta: "esperando lectura",
      contexto: `${numero(t.documentosListos)} ya con sus documentos`,
      ayuda: <Ayuda titulo="¿Qué es “esperando lectura”?">Contratos que se leen cuando alguien financia su lectura.</Ayuda>,
    },
  ];

  const columnas: Columna[] = [
    { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)" },
    { clave: "contratos", titulo: "Contratos", ancho: "92px", alinear: "der" },
    { clave: "leidos", titulo: "Leídos", ancho: "84px", alinear: "der", desde: "md" },
    { clave: "senales", titulo: "Con señal", ancho: "92px", alinear: "der", desde: "lg" },
    { clave: "cola", titulo: "En cola", ancho: "84px", alinear: "der", desde: "lg" },
  ];
  const filas: Fila[] = entidades.map((e) => ({
    id: e.ruc,
    href: `/entidad/${e.ruc}`,
    celdas: {
      entidad: <CeldaPrincipal titulo={e.nombre} textoCompleto={e.nombre} meta={[NIVEL[e.nivel] ?? null, e.lugar, e.autoridad ? `Autoridad: ${e.autoridad}` : null]} />,
      contratos: <CeldaNumero>{numero(e.contratos)}</CeldaNumero>,
      leidos: <CeldaNumero>{numero(e.leidos)}</CeldaNumero>,
      senales: <CeldaNumero>{numero(e.conSenales)}</CeldaNumero>,
      cola: <CeldaNumero>{numero(e.enCola)}</CeldaNumero>,
    },
  }));

  return (
    <Pagina className="space-y-8">
      <Volver href={`/app/partidos?anio=${anio}`}>Partidos y gobiernos</Volver>

      <div className="space-y-4">
        <EncabezadoPagina
          titulo={partido.nombre}
          bajada={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden /> Gobiernos de {mesLargo(d.desde)} a {mesLargo(d.hasta)}
              </span>
              <span>
                {numero(partido.gobiernos.regional)} {partido.gobiernos.regional === 1 ? "región" : "regiones"}, {numero(partido.gobiernos.provincial)}{" "}
                {partido.gobiernos.provincial === 1 ? "provincia" : "provincias"}, {numero(partido.gobiernos.distrital)}{" "}
                {partido.gobiernos.distrital === 1 ? "distrito" : "distritos"}
              </span>
            </span>
          }
          acciones={
            <EnlaceAccion href={`/app/financiar/partido/${partido.clave}?anio=${anio}`}>
              Financiar la lectura de contratos de este partido en este período
            </EnlaceAccion>
          }
        />
        <Aviso tono="neutro">{AVISO_PARTIDO}</Aviso>
        <Indicadores items={indicadores} />
      </div>

      <section aria-labelledby="meses-titulo" className="space-y-3">
        <div>
          <h2 id="meses-titulo" className="font-display text-xl font-bold text-ink">Contratos por mes</h2>
          <p className="text-[14px] text-inkSoft">Cada contrato cuenta en el mes en que se convocó, con el partido que gobernaba la entidad ese mes.</p>
        </div>
        <GraficoMeses porMes={porMes} etiqueta={`Contratos de los gobiernos de ${partido.nombre} por mes, ${periodoTexto(anio)}`} />
      </section>

      <section aria-labelledby="entidades-titulo" className="space-y-3">
        <h2 id="entidades-titulo" className="font-display text-xl font-bold text-ink">Las entidades con más contratos</h2>
        {filas.length > 0 ? (
          <Tabla columnas={columnas} filas={filas} etiqueta={`Entidades gobernadas por ${partido.nombre} con más contratos`} />
        ) : (
          <p className="text-sm text-inkSoft">Ninguna de sus entidades tiene contratos en la base de Vigía en este período.</p>
        )}
      </section>

      {regiones.length > 0 && (
        <section aria-labelledby="regiones-titulo" className="space-y-3">
          <h2 id="regiones-titulo" className="font-display text-xl font-bold text-ink">Dónde gobernó</h2>
          <ul className="flex flex-wrap gap-2">
            {regiones.map((r) => (
              <li key={r.ubigeo}>
                <Link
                  href={`/app/financiar/${r.ubigeo}`}
                  className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-line bg-paper px-3.5 text-[13.5px] text-ink transition-colors hover:border-granate/40 hover:bg-granate-50"
                >
                  <span className="font-medium">{r.nombre ?? r.ubigeo}</span>
                  <span className="font-mono text-[12.5px] tabular-nums text-granate">{numero(r.contratos)}</span>
                  <ChevronRight size={13} className="text-mute" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-mute">Por la región de cada gobierno. El número es de contratos convocados en el período.</p>
        </section>
      )}
    </Pagina>
  );
}

function NoDisponible({ clave, anio }: { clave: string; anio: 2014 | 2018 | 2022 }) {
  return (
    <Pagina>
      <Volver href="/app/partidos">Partidos y gobiernos</Volver>
      <EncabezadoPagina titulo="Contratos de un partido" />
      <EstadoError
        titulo="No pudimos leer este partido"
        accion={<EnlaceAccion href={`/app/partidos/${encodeURIComponent(clave)}?anio=${anio}`}>Reintentar</EnlaceAccion>}
      >
        Puede que no haya gobernado nada en {periodoTexto(anio)} o que el servidor no respondiera. No mostramos nada en su lugar.
      </EstadoError>
    </Pagina>
  );
}
