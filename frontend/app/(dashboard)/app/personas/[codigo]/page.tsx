import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Building2, CalendarRange } from "lucide-react";
import { Ayuda, CabeceraPestana, EncabezadoPagina, EstadoError, EstadoVacio, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Indicadores,
  Listado,
  Tabla,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type Fila,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { SenalesCelda } from "@/components/personas/SenalesPersona";
import { SenalesPorEntidad } from "@/components/personas/SenalesFicha";
import { Paginacion } from "@/components/ui/Paginacion";
import { fechaCorta, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getFichaPersona, getOrdenesPersona, type AnioDePersona, type FichaPersona, type OrdenesPersona } from "@/lib/personas";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaPersona(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, persona contratada` : "Persona contratada", robots: { index: false } };
}

const TAM_ORDENES = 20;
const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * /app/personas/[codigo] — una persona que recibe órdenes de servicio del Estado (código al azar: nunca el RUC ni el
 * DNI; un apellido tapado). Pestañas (?seccion=):
 *   · Señales: en cada entidad, qué registro público coincide (candidatura, aporte, autoridad, apellidos, meses,
 *     pago), con su detalle y su fuente.
 *   · Lo que cobró: cada año y entidad, cuánto por mes frente a la mediana de la entidad y del país para el mismo
 *     tipo de servicio.
 *   · Órdenes: todas, paginadas, por entidad y año.
 *   · Entidades: dónde trabajó, con sus señales.
 * No se indexa en buscadores (robots): es una persona privada.
 */
export default async function PersonaPage({ params, searchParams }: { params: { codigo: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const f = await getFichaPersona(params.codigo);
  if (!f) {
    if (!/^[0-9a-f]{12}$/.test(params.codigo)) notFound();
    return <NoSePudoLeer codigo={params.codigo} />;
  }
  const ruta = `/app/personas/${params.codigo}`;
  const p = f.persona;
  const nombre = p.nombre ?? "Persona contratada";
  const conSenales = f.entidades.filter((e) => e.senalesDetalle.length > 0);
  const graves = f.entidades.reduce((n, e) => n + e.senalesDetalle.filter((s) => s.severidad === "alta").length, 0);
  const filtrosOrdenes = {
    entidad: /^\d{11}$/.test(uno(searchParams?.oent) ?? "") ? uno(searchParams?.oent) : undefined,
    anio: Number(uno(searchParams?.oanio)) >= 2018 ? Number(uno(searchParams?.oanio)) : undefined,
    page: Math.max(1, Number(uno(searchParams?.opag)) || 1),
  };
  const seccion = uno(searchParams?.seccion) ?? (filtrosOrdenes.entidad || filtrosOrdenes.anio || filtrosOrdenes.page > 1 ? "ordenes" : undefined);
  const ordenesP = getOrdenesPersona(params.codigo, { ...filtrosOrdenes, size: TAM_ORDENES });
  const parametrosOrdenes: Parametros = { seccion: "ordenes", oent: filtrosOrdenes.entidad, oanio: filtrosOrdenes.anio ? String(filtrosOrdenes.anio) : undefined };

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Personas contratadas", href: "/app/personas" },
          { etiqueta: nombre, href: ruta },
        ]}
        pestanas={{ primera: "senales", activa: seccion ?? "senales", etiquetas: { pagos: "Lo que cobró", ordenes: "Órdenes", entidades: "Entidades" } }}
      />
      <EncabezadoPagina
        titulo={nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> Órdenes de servicio de {plural(p.entidades, "entidad", "entidades")}
            </span>
            {p.primera && p.ultima && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden />
                {p.primera === p.ultima ? `El ${fechaCorta(p.primera)}` : `Del ${fechaCorta(p.primera)} al ${fechaCorta(p.ultima)}`}
              </span>
            )}
          </span>
        }
        ayuda={
          <Ayuda titulo="¿Por qué está esta persona aquí?">
            <span className="block">
              Porque recibió órdenes de servicio del Estado como persona natural: el OECE (CONOSCE) las publica con su nombre y lo
              que se le pagó. Vigía no muestra su DNI ni su RUC y tapa uno de sus apellidos.
            </span>
            <span className="mt-2 block">
              Las señales dicen qué otro registro público coincide con esta persona. Ninguna prueba un delito ni un parentesco.{" "}
              <Link href="/privacidad" className="text-granate underline-offset-2 hover:underline">¿Eres tú? Pide una corrección</Link>
            </span>
          </Ayuda>
        }
      />
      <Indicadores items={indicadores(f, graves, ruta)} />

      <Pestanas
        key={seccion ?? "senales"}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={[
          {
            clave: "senales",
            etiqueta: "Señales",
            conteo: p.nSenales,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>En cada entidad que lo contrató, qué dicen de esta persona otros registros públicos.</CabeceraPestana>
                {conSenales.length ? (
                  <SenalesPorEntidad entidades={f.entidades} />
                ) : (
                  <EstadoVacio compacto titulo="Ningún otro registro coincide">
                    No figura como candidato, aportante, autoridad ni inhabilitado, no comparte apellidos con autoridades de sus
                    entidades, y lo que cobra no se aparta de lo que pagan por lo mismo.
                  </EstadoVacio>
                )}
              </div>
            ),
          },
          {
            clave: "pagos",
            etiqueta: "Lo que cobró",
            contenido: <Pagos anual={f.anual} />,
          },
          {
            clave: "ordenes",
            etiqueta: "Órdenes",
            conteo: p.ordenes,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Todas sus órdenes de servicio, de la más reciente a la más antigua.</CabeceraPestana>
                <Listado ruta={ruta} parametros={parametrosOrdenes} paramPagina="opag">
                  <BarraFiltros
                    visibles={[
                      {
                        param: "oent",
                        etiqueta: "Entidad",
                        corta: "Entidad",
                        todas: "Toda entidad",
                        opciones: f.entidades.map((e) => ({ valor: e.entidadRuc, etiqueta: e.entidad ? tituloNatural(e.entidad) : e.entidadRuc, conteo: e.ordenes })),
                      },
                      {
                        param: "oanio",
                        etiqueta: "Año",
                        corta: "Año",
                        todas: "Todos los años",
                        opciones: [...new Set(f.anual.map((a) => a.anio))].sort((a, b) => b - a).map((a) => ({
                          valor: String(a),
                          etiqueta: String(a),
                          conteo: f.anual.filter((x) => x.anio === a).reduce((n, x) => n + x.ordenes, 0),
                        })),
                      },
                    ]}
                  />
                  <ZonaResultados>
                    <Suspense fallback={<TablaSkeleton columnas={COLUMNAS_ORDENES} filas={10} />}>
                      <Ordenes pagina={ordenesP} parametros={parametrosOrdenes} ruta={ruta} actual={filtrosOrdenes.page} />
                    </Suspense>
                  </ZonaResultados>
                </Listado>
              </div>
            ),
          },
          {
            clave: "entidades",
            etiqueta: "Entidades",
            conteo: p.entidades,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Las entidades que le dieron órdenes, con lo que le pagaron y sus señales en cada una.</CabeceraPestana>
                <Tabla columnas={COLUMNAS_ENTIDADES} filas={filasEntidades(f)} etiqueta="Entidades que lo contrataron" />
              </div>
            ),
          },
        ]}
      />
      <Aviso tono="neutro">
        Una señal no es una acusación ni prueba un parentesco. El título, la edad y la experiencia de esta persona no están en
        datos abiertos: Vigía no puede decir si cumple el perfil del servicio.
      </Aviso>
    </Pagina>
  );
}

function indicadores(f: FichaPersona, graves: number, ruta: string): Indicador[] {
  const p = f.persona;
  return [
    { valor: solesCompacto(p.monto), etiqueta: "cobrados por órdenes", contexto: `en ${plural(p.ordenes, "orden", "órdenes")}`, href: `${ruta}?seccion=ordenes` },
    { valor: numero(p.meses), etiqueta: "meses con órdenes", contexto: "sumados por año y entidad", href: `${ruta}?seccion=pagos` },
    { valor: numero(p.entidades), etiqueta: p.entidades === 1 ? "entidad" : "entidades", contexto: "que lo contrataron", href: `${ruta}?seccion=entidades` },
    { valor: numero(p.nSenales), etiqueta: "señales", contexto: graves > 0 ? plural(graves, "grave", "graves") : "ninguna grave", tono: graves > 0 ? "alta" : "neutro", href: ruta },
  ];
}

// ─── Lo que cobró ─────────────────────────────────────────────────────────────

const COLUMNAS_PAGOS: Columna[] = [
  { clave: "anio", titulo: "Año", ancho: "60px" },
  { clave: "entidad", titulo: "Entidad y servicio", ancho: "minmax(0,1.4fr)" },
  { clave: "meses", titulo: "Meses", ancho: "64px", alinear: "der", desde: "lg" },
  { clave: "pormes", titulo: "Por mes", ancho: "100px", alinear: "der" },
  {
    clave: "entidadMed", titulo: "Mediana entidad", ancho: "136px", alinear: "der", desde: "md",
    ayuda: (
      <Ayuda titulo="¿Qué es la mediana?">
        De todas las personas a las que esa entidad pagó ese año el mismo tipo de servicio, lo que cobra por mes la del medio:
        la mitad cobra menos y la otra mitad más. «Por mes» es lo cobrado en el año dividido entre los meses con órdenes.
      </Ayuda>
    ),
  },
  { clave: "paisMed", titulo: "Mediana país", ancho: "128px", alinear: "der", desde: "xl" },
  { clave: "veces", titulo: "Diferencia", ancho: "104px", alinear: "der", desde: "md" },
];

function Pagos({ anual }: { anual: AnioDePersona[] }) {
  const filas: Fila[] = anual.map((a) => {
    const med = a.enLaEntidad?.mediana ?? null;
    const veces = a.personal && a.porMes != null && med ? a.porMes / med : null;
    return {
      id: `${a.anio}-${a.entidadRuc}`,
      celdas: {
        anio: <span className="font-mono text-[13px] tabular-nums">{a.anio}</span>,
        entidad: <CeldaPrincipal titulo={a.entidad ? tituloNatural(a.entidad) : a.entidadRuc} meta={[a.servicio, plural(a.ordenes, "orden", "órdenes")]} />,
        meses: <CeldaNumero>{numero(a.meses)}</CeldaNumero>,
        pormes: <CeldaNumero sub={`${soles(a.monto)} en el año`}>{a.porMes != null ? soles(a.porMes) : "Sin dato"}</CeldaNumero>,
        entidadMed: (
          <CeldaNumero sub={a.enLaEntidad ? plural(a.enLaEntidad.personas, "persona", "personas") : undefined}>
            {a.personal && med != null ? soles(med) : <span className="font-sans text-mute">No aplica</span>}
          </CeldaNumero>
        ),
        paisMed: (
          <CeldaNumero sub={a.enElPais ? plural(a.enElPais.personas, "persona", "personas") : undefined}>
            {a.personal && a.enElPais?.mediana != null ? soles(a.enElPais.mediana) : <span className="font-sans text-mute">No aplica</span>}
          </CeldaNumero>
        ),
        veces: (
          <CeldaNumero>
            {veces == null ? <span className="font-sans text-mute">Sin comparar</span> : <span className={veces >= 2.5 ? "font-semibold text-crimsonTexto" : undefined}>{`${veces.toFixed(1).replace(".", ",")} veces`}</span>}
          </CeldaNumero>
        ),
      },
    };
  });
  return (
    <div className="space-y-4">
      <CabeceraPestana>
        Lo que cobró por mes cada año, junto a lo que la misma entidad y todo el país pagan a quienes hacen el mismo tipo de
        servicio.
      </CabeceraPestana>
      <Tabla columnas={COLUMNAS_PAGOS} filas={filas} etiqueta="Lo que cobró por año y entidad" />
      <p className="max-w-prose text-[12.5px] text-mute">
        El tipo de servicio sale de las palabras de la descripción de sus órdenes. No se compara lo que no es el trabajo de una
        persona (alquileres, comida, impresiones, transporte): ahí dice «No aplica».
      </p>
    </div>
  );
}

// ─── Órdenes ──────────────────────────────────────────────────────────────────

const COLUMNAS_ORDENES: Columna[] = [
  { clave: "fecha", titulo: "Emitida", ancho: "92px" },
  { clave: "orden", titulo: "Orden", ancho: "minmax(0,1.8fr)" },
  { clave: "estado", titulo: "Estado", ancho: "104px", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "108px", alinear: "der" },
];

async function Ordenes({ pagina: p, parametros, ruta, actual }: { pagina: Promise<OrdenesPersona | null>; parametros: Parametros; ruta: string; actual: number }) {
  const pagina = await p;
  if (!pagina) return <EstadoError titulo="No pudimos cargar sus órdenes">Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Quita el filtro de entidad o de año.</EstadoVacio>;
  const pag = (
    <Paginacion
      actual={actual}
      paginas={Math.max(1, Math.ceil(pagina.total / pagina.size))}
      total={pagina.total}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina="opag"
      cargando={false}
      nombre="órdenes"
    />
  );
  const filas: Fila[] = pagina.data.map((o, i) => ({
    id: `${o.orden ?? i}-${o.fecha}`,
    celdas: {
      fecha: <CeldaFecha fecha={o.fecha} />,
      orden: (
        <CeldaPrincipal
          titulo={o.descripcion ? oracion(o.descripcion) : "Sin descripción"}
          dosLineas
          meta={[o.entidad ? tituloNatural(o.entidad) : null, o.servicio, o.numero ? `N.° ${o.numero}` : null]}
        />
      ),
      estado: <span className="text-[13px] text-inkSoft">{o.estado ?? "Sin dato"}</span>,
      monto:
        o.monto == null && o.montoDudoso != null ? (
          <CeldaNumero sub="monto dudoso, no se suma">
            <span className="text-mute line-through" title="CONOSCE trae este monto, imposible para la modalidad de la orden: se muestra, no se suma.">
              {soles(o.montoDudoso)}
            </span>
          </CeldaNumero>
        ) : (
          <CeldaNumero>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>
        ),
    },
  }));
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS_ORDENES} filas={filas} etiqueta="Órdenes de servicio" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

// ─── Entidades ────────────────────────────────────────────────────────────────

const COLUMNAS_ENTIDADES: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.4fr)" },
  { clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md" },
  { clave: "ordenes", titulo: "Órdenes", ancho: "76px", alinear: "der", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "108px", alinear: "der" },
];

function filasEntidades(f: FichaPersona): Fila[] {
  return f.entidades.map((e) => ({
    id: e.entidadRuc,
    href: `/entidad/${e.entidadRuc}`,
    celdas: {
      entidad: <CeldaPrincipal titulo={e.entidad ? tituloNatural(e.entidad) : e.entidadRuc} meta={[e.servicio, e.depNombre, e.anios.length > 1 ? `${e.anios[0]} a ${e.anios[e.anios.length - 1]}` : String(e.anios[0] ?? "")]} />,
      senales: <SenalesCelda senales={e.senales} />,
      ordenes: <CeldaNumero>{numero(e.ordenes)}</CeldaNumero>,
      monto: <CeldaNumero>{solesCompacto(e.monto)}</CeldaNumero>,
    },
  }));
}

function NoSePudoLeer({ codigo }: { codigo: string }) {
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: "/app/personas" }]} />
      <EncabezadoPagina titulo="Persona contratada" />
      <EstadoError titulo="No pudimos leer esta ficha" accion={<Link href={`/app/personas/${codigo}`} className="text-granate hover:underline">Reintentar</Link>}>
        Puede que el código no exista o que el servidor no respondiera. No mostramos nada en su lugar.
      </EstadoError>
    </Pagina>
  );
}
