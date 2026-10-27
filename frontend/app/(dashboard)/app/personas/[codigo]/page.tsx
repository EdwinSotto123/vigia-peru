import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarRange, Flag, ListOrdered, Receipt, Wallet } from "lucide-react";
import {
  Ayuda,
  BloqueDetalle,
  CabeceraPestana,
  ChipsDetalle,
  CuerpoDetalle,
  DatosClave,
  BanderasFicha,
  EncabezadoPagina,
  EstadoVacio,
  SinSenalesEstado,
  FichaNoLeida,
  Migas,
  Pagina,
  Pestanas,
  PieDetalle,
} from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, CuentaGrupo, Indicadores, Tabla, TablaPaginada, type Columna, type Fila, type GrupoFilas, type Indicador } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { SenalesBrevesEntidad, SenalesPorEntidad, senalesDeEntidad } from "@/components/personas/SenalesFicha";
import { PestanaOrdenes, TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fechaCorta, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  SENAL,
  TIPOS_SENAL,
  aniosTexto,
  filtrosOrdenesDeUrl,
  getFichaPersona,
  getOrdenesPersona,
  hayFiltrosOrdenes,
  banderasPersona,
  senalesDistintas,
  type AnioDePersona,
  type EntidadDePersona,
  type FichaPersona,
} from "@/lib/personas";
import { peorSeveridad } from "@/lib/severidad";
import { uno } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaPersona(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, persona contratada` : "Persona contratada", robots: { index: false } };
}

/** La etiqueta corta de cada señal para la celda de una fila (`CrucesCelda`, una línea con su ícono de severidad). */
const CORTO_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [t, SENAL[t].corto]));

/**
 * /app/personas/[codigo] — una persona que recibe órdenes de servicio del Estado (código al azar: nunca el RUC ni el
 * DNI; un apellido tapado). Pestañas (?seccion=):
 *   · Señales: en cada entidad, qué registro público coincide (candidatura, aporte, autoridad, apellidos, meses,
 *     pago), lo grave primero, con su evidencia plegada y su fuente. La entidad elegida va en `?sent=<RUC>`.
 *   · Lo que cobró: por entidad y año, cuánto por mes frente a la mediana de la entidad y del país para el mismo
 *     tipo de servicio.
 *   · Órdenes: todas, paginadas, por entidad y año.
 *   · Entidades: dónde trabajó; cada una abre su panel con lo que le pagó, sus años y sus señales.
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
  const cuenta = senalesDistintas(f.entidades);
  // Sus banderas, fijas bajo el nombre en todas las pestañas (el nepotismo ya no se queda en la de señales).
  const banderas = banderasPersona(cuenta.lista, `${ruta}?seccion=senales`);
  const filtrosOrdenes = filtrosOrdenesDeUrl(searchParams);
  const seccionUrl = uno(searchParams?.seccion);
  const seccion = seccionUrl ?? (hayFiltrosOrdenes(filtrosOrdenes) ? "ordenes" : undefined);
  const sentUrl = uno(searchParams?.sent);
  const sent = sentUrl && f.entidades.some((e) => e.entidadRuc === sentUrl) ? sentUrl : undefined;
  const ordenesP = getOrdenesPersona(params.codigo, { ...filtrosOrdenes, size: TAM_ORDENES });

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
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta persona" banderas={banderas} todas={`${ruta}?seccion=senales`} /> : undefined}
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
      <Indicadores items={indicadores(f, cuenta, ruta)} />
      {p.dudosas?.ordenes ? (
        <AvisoDato motivo={motivoDudoso(p.dudosas.motivos?.[0]) ?? "mayor_100m"} fuente="conosce_ordenes">
          {p.dudosas.ordenes === 1
            ? `Una de sus órdenes trae ${soles(p.dudosas.monto ?? 0)}. `
            : `${p.dudosas.ordenes} de sus órdenes traen ${soles(p.dudosas.monto ?? 0)} en total. `}
          <Link href={`${ruta}?seccion=ordenes`} className="font-semibold text-granate underline-offset-2 hover:underline">
            Están en la pestaña Órdenes, con su bandera
          </Link>
          .
        </AvisoDato>
      ) : null}

      <Pestanas
        fija
        // La entidad elegida también: «Ver su evidencia» (panel de Entidades) vuelve a Señales con esa entidad abierta.
        key={`${seccion ?? ""}|${sent ?? ""}`}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={[
          {
            clave: "senales",
            icono: <Flag size={15} aria-hidden />,
            etiqueta: "Señales",
            conteo: cuenta.total,
            contenido: (
              <div>
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Cómo se cuentan las señales?">
                      <span className="block">
                        Cada señal dice qué otro registro público coincide con esta persona en una entidad que la contrató: una
                        candidatura, un aporte, un cargo, sus apellidos, lo que cobra. No prueba un delito ni un parentesco.
                      </span>
                      <span className="mt-2 block">
                        Lo que es de la persona y no de una entidad (un aporte, una candidatura) vale en cada entidad que la
                        contrató: se cuenta una vez, y por eso las señales de cada entidad suman más que el total.
                      </span>
                    </Ayuda>
                  }
                >
                  {cuenta.total ? lineaSenales(cuenta, f.entidades) : "Qué dicen de esta persona otros registros públicos, en cada entidad que la contrató."}
                </CabeceraPestana>
                {cuenta.total ? (
                  <SenalesPorEntidad entidades={f.entidades} codigo={params.codigo} elegida={sent} />
                ) : (
                  <SinSenalesEstado titulo="Sin señales: ningún otro registro coincide">
                    No figura como candidato, aportante, autoridad ni inhabilitado, no comparte apellidos con autoridades de sus
                    entidades, y lo que cobra no se aparta de lo que pagan por lo mismo.
                  </SinSenalesEstado>
                )}
              </div>
            ),
          },
          {
            clave: "pagos",
            icono: <Wallet size={15} aria-hidden />,
            etiqueta: "Lo que cobró",
            contenido: <Pagos ficha={f} nombre={nombre} ruta={ruta} />,
          },
          {
            clave: "ordenes",
            icono: <Receipt size={15} aria-hidden />,
            etiqueta: "Órdenes",
            conteo: p.ordenes,
            contenido: <PestanaOrdenes ruta={ruta} pagina={ordenesP} filtros={filtrosOrdenes} ficha={f} />,
          },
          {
            clave: "entidades",
            icono: <Building2 size={15} aria-hidden />,
            etiqueta: "Entidades",
            conteo: p.entidades,
            contenido: (
              <div>
                <CabeceraPestana>Las entidades que le dieron órdenes: toca una para ver lo que le pagó cada año y sus señales ahí.</CabeceraPestana>
                <TablaPaginada
                  columnas={COLUMNAS_ENTIDADES}
                  filas={filasEntidades(f, cuenta, ruta)}
                  etiqueta="Entidades que lo contrataron"
                  nombre="entidades"
                  tam={20}
                  buscar={{ placeholder: "Buscar por entidad, servicio o región…", etiqueta: "Buscar en sus entidades" }}
                />
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

type Cuenta = ReturnType<typeof senalesDistintas>;

/** "8 señales en 5 entidades; 3 valen en varias de ellas." — el mismo total de la cifra, la pestaña y el índice. */
function lineaSenales(c: Cuenta, entidades: EntidadDePersona[]): string {
  const con = entidades.filter((e) => e.senalesDetalle.length > 0).length;
  const base = `${plural(c.total, "señal", "señales")} en ${plural(con, "entidad", "entidades")}`;
  if (!c.enVarias) return `${base}.`;
  return `${base}; ${c.enVarias === 1 ? "1 vale" : `${numero(c.enVarias)} valen`} en varias de ellas.`;
}

function indicadores(f: FichaPersona, c: Cuenta, ruta: string): Indicador[] {
  const p = f.persona;
  const contextoSenales = [
    c.altas > 0 ? plural(c.altas, "alta", "altas") : c.total ? "ninguna alta" : null,
    c.enVarias > 0 ? `${numero(c.enVarias)} en varias entidades` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    {
      valor: solesCompacto(p.monto),
      etiqueta: "cobrados por órdenes",
      contexto: p.dudosas?.ordenes
        ? `en ${plural(p.ordenes, "orden", "órdenes")}; aparte, ${soles(p.dudosas.monto ?? 0)} en ${plural(p.dudosas.ordenes, "orden", "órdenes")} con posible error de CONOSCE`
        : `en ${plural(p.ordenes, "orden", "órdenes")}`,
      href: `${ruta}?seccion=ordenes`,
    },
    { valor: numero(p.meses), etiqueta: "meses con órdenes", contexto: "sumados por año y entidad", href: `${ruta}?seccion=pagos` },
    { valor: numero(p.entidades), etiqueta: p.entidades === 1 ? "entidad" : "entidades", contexto: "que lo contrataron", href: `${ruta}?seccion=entidades` },
    {
      valor: numero(c.total),
      etiqueta: c.total === 1 ? "señal" : "señales",
      contexto: contextoSenales || "ningún otro registro coincide",
      tono: c.altas > 0 ? "alta" : "neutro",
      href: `${ruta}?seccion=senales`,
    },
  ];
}

// ─── Lo que cobró ─────────────────────────────────────────────────────────────────────────────────

// La primera columna que se ve en el celular es el servicio: el año, la mediana y la diferencia se apilan bajo él con
// su rótulo (antes en el celular sólo quedaba «Por mes», sin con qué compararlo).
const COLUMNAS_PAGOS: Columna[] = [
  { clave: "anio", titulo: "Año", ancho: "56px", desde: "md", apilar: "con-rotulo" },
  { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1.3fr)" },
  { clave: "meses", titulo: "Meses", ancho: "64px", alinear: "der", desde: "lg" },
  { clave: "pormes", titulo: "Por mes", ancho: "104px", alinear: "der" },
  {
    clave: "entidadMed",
    titulo: "Mediana entidad",
    corto: "Mediana",
    ancho: "136px",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Qué es la mediana?">
        De todas las personas a las que esa entidad pagó ese año el mismo tipo de servicio, lo que cobra por mes la del medio:
        la mitad cobra menos y la otra mitad más. «Por mes» es lo cobrado en el año dividido entre los meses con órdenes.
      </Ayuda>
    ),
  },
  { clave: "paisMed", titulo: "Mediana país", ancho: "128px", alinear: "der", desde: "xl" },
  { clave: "veces", titulo: "Diferencia", ancho: "104px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

function filaPago(a: AnioDePersona, ruta: string): Fila {
  const med = a.enLaEntidad?.mediana ?? null;
  const veces = a.personal && a.porMes != null && med ? a.porMes / med : null;
  return {
    id: `${a.anio}-${a.entidadRuc}`,
    // Desde el agregado del año se baja a las órdenes de ESA entidad y año, donde cada una dice qué se pagó (su motivo).
    href: `${ruta}?seccion=ordenes&oent=${a.entidadRuc}&oanio=${a.anio}`,
    celdas: {
      anio: <span className="font-mono text-meta tabular-nums text-ink">{a.anio}</span>,
      servicio: (
        <CeldaPrincipal
          titulo={a.servicio ?? "Servicio sin clasificar"}
          meta={[<Dato key="ordenes" tipo="documento" nombre="Órdenes">{`${plural(a.ordenes, "orden", "órdenes")} en ${plural(a.meses, "mes", "meses")}`}</Dato>]}
        />
      ),
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
          {veces == null ? (
            <span className="font-sans text-mute">Sin comparar</span>
          ) : (
            <span className={veces >= 2.5 ? "font-semibold text-crimsonTexto" : undefined}>{`${veces.toFixed(1).replace(".", ",")} veces`}</span>
          )}
        </CeldaNumero>
      ),
    },
  };
}

function Pagos({ ficha: f, nombre, ruta }: { ficha: FichaPersona; nombre: string; ruta: string }) {
  const mensual = f.mensual ?? [];
  // Un grupo por entidad (la que más le pagó primero), con su total en el rótulo; dentro, del año más reciente al más viejo.
  const porEntidad = new Map<string, AnioDePersona[]>();
  for (const a of f.anual) porEntidad.set(a.entidadRuc, [...(porEntidad.get(a.entidadRuc) ?? []), a]);
  const grupos: GrupoFilas[] = [...porEntidad.entries()]
    .map(([ruc, anios]) => ({ ruc, anios, monto: anios.reduce((t, a) => t + a.monto, 0), ordenes: anios.reduce((t, a) => t + a.ordenes, 0) }))
    .sort((a, b) => b.monto - a.monto)
    .map((g) => {
      const nombreEnt = g.anios[0]?.entidad ? tituloNatural(g.anios[0].entidad) : g.ruc;
      return {
        clave: g.ruc,
        titulo: (
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="min-w-0">{nombreEnt}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-meta font-normal text-mute">
              <CuentaGrupo>{soles(g.monto)}</CuentaGrupo>
              {`en ${plural(g.ordenes, "orden", "órdenes")}`}
            </span>
          </span>
        ),
        filas: [...g.anios].sort((a, b) => b.anio - a.anio).map((a) => filaPago(a, ruta)),
      };
    });
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Cómo se compara lo que cobró?">
            <span className="block">
              «Por mes» es lo que cobró en el año dividido entre los meses con órdenes. Se compara con la mediana de lo que la
              misma entidad, y todo el país, pagan por mes a quienes hacen el mismo tipo de servicio.
            </span>
            <span className="mt-2 block">
              El tipo de servicio sale de las palabras de la descripción de sus órdenes. No se compara lo que no es el trabajo
              de una persona (alquileres, comida, impresiones, transporte): ahí dice «No aplica».
            </span>
          </Ayuda>
        }
      >
        Lo que cobró por mes en cada entidad y año, frente a lo que esa entidad y el país pagan por el mismo servicio. Toca un
        año para ver sus órdenes.
      </CabeceraPestana>
      {mensual.length > 1 && (
        <section aria-labelledby="mes-a-mes" className="tarjeta space-y-2 rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <h3 id="mes-a-mes" className="font-display text-bloque font-bold text-ink">Mes a mes</h3>
          <LineaMeses
            puntos={mensual.map((m) => ({ mes: m.mes, base: m.monto, aparte: m.dudoso || null }))}
            nombres={{ base: "Cobrado por órdenes" }}
            huecos="cero"
            quienCarga="de CONOSCE"
            etiqueta={`Lo que cobró por órdenes mes a mes, ${nombre}`}
          />
        </section>
      )}
      {grupos.length ? (
        <Tabla columnas={COLUMNAS_PAGOS} grupos={grupos} etiqueta="Lo que cobró por entidad y año" />
      ) : (
        <EstadoVacio compacto titulo="Sin lo cobrado por año">Todavía no hay órdenes sumadas por año para esta persona.</EstadoVacio>
      )}
    </div>
  );
}

// ─── Entidades ────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_ENTIDADES: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.4fr)" },
  { clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  { clave: "ordenes", titulo: "Órdenes", ancho: "76px", alinear: "der", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "108px", alinear: "der" },
];

const COLUMNAS_ANIOS: Columna[] = [
  { clave: "anio", titulo: "Año", ancho: "3.5rem" },
  { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1fr)", desde: "md" },
  { clave: "monto", titulo: "Cobró", ancho: "7rem", alinear: "der" },
];

/**
 * Cada entidad abre su panel (no saca de la persona): lo que le pagó, cada año (que lleva a esas órdenes), quién la
 * gobernaba y sus señales en una línea; al pie, la ficha de la entidad y sus órdenes.
 */
function filasEntidades(f: FichaPersona, cuenta: Cuenta, ruta: string): Fila[] {
  return f.entidades.map((e) => {
    const nombre = e.entidad ? tituloNatural(e.entidad) : `Entidad ${e.entidadRuc}`;
    const anios = aniosTexto(e.anios);
    const peor = peorSeveridad(e.senalesDetalle);
    // Lo mismo que cuenta el índice de la pestaña Señales para esta entidad.
    const nSenales = senalesDeEntidad(e, cuenta.porClave).length;
    const filasAnio: Fila[] = f.anual
      .filter((a) => a.entidadRuc === e.entidadRuc)
      .sort((a, b) => b.anio - a.anio)
      .map((a) => ({
        id: String(a.anio),
        href: `${ruta}?seccion=ordenes&oent=${e.entidadRuc}&oanio=${a.anio}`,
        celdas: {
          anio: <span className="font-mono text-meta tabular-nums text-ink">{a.anio}</span>,
          servicio: <span className="truncate text-meta text-inkSoft">{a.servicio ?? "Sin clasificar"}</span>,
          monto: <CeldaNumero sub={plural(a.ordenes, "orden", "órdenes")}>{soles(a.monto)}</CeldaNumero>,
        },
      }));
    return {
      id: e.entidadRuc,
      buscable: [nombre, e.servicio, e.depNombre].filter(Boolean).join(" "),
      celdas: {
        entidad: (
          <CeldaPrincipal
            titulo={nombre}
            meta={[
              e.servicio && <Dato key="servicio" tipo="servicio">{e.servicio}</Dato>,
              e.depNombre && <Dato key="lugar" tipo="lugar">{e.depNombre}</Dato>,
              anios && <Dato key="anios" tipo="fecha" nombre="Años">{anios}</Dato>,
            ]}
          />
        ),
        senales: e.senales?.length ? <CrucesCelda cruces={e.senales} etiquetas={CORTO_SENAL} /> : <span className="text-meta text-mute">Sin señales</span>,
        ordenes: <CeldaNumero>{numero(e.ordenes)}</CeldaNumero>,
        monto: <CeldaNumero>{solesCompacto(e.monto)}</CeldaNumero>,
      },
      detalle: {
        titulo: nombre,
        etiqueta: `Ver lo que le pagó ${nombre} y sus señales ahí`,
        descripcion: (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {e.depNombre && <Dato tipo="lugar">{e.depNombre}</Dato>}
            {anios && <Dato tipo="fecha" nombre="Años">{anios}</Dato>}
          </span>
        ),
        contenido: (
          <CuerpoDetalle>
            {peor && (
              <ChipsDetalle>
                <Severidad bandera={peor} />
                <span className="text-meta text-inkSoft">{`${plural(nSenales, "señal", "señales")} en esta entidad`}</span>
              </ChipsDetalle>
            )}
            <DatosClave
              items={[
                { etiqueta: "Le pagó", valor: soles(e.monto), mono: true },
                { etiqueta: "Órdenes", valor: numero(e.ordenes), mono: true },
                { etiqueta: "Meses con órdenes", valor: numero(e.meses), mono: true },
                { etiqueta: "Años", valor: anios, mono: true },
                { etiqueta: "Tipo de servicio", valor: e.servicio },
                { etiqueta: "Región", valor: e.depNombre },
                {
                  etiqueta: "Partido que gobernaba",
                  valor: e.gobiernos?.length
                    ? [...e.gobiernos].sort((a, b) => b.anio - a.anio).map((g) => (
                        <Link key={`${g.clave}-${g.anio}`} href={`/app/partidos/${g.clave}?anio=${g.anio}`} className="mr-3 inline-block text-granate underline-offset-2 hover:underline">
                          {g.nombre}
                        </Link>
                      ))
                    : null,
                },
              ]}
            />
            {filasAnio.length > 0 && (
              <BloqueDetalle titulo="Lo que cobró cada año">
                <Tabla columnas={COLUMNAS_ANIOS} filas={filasAnio} etiqueta={`Lo que le pagó ${nombre} cada año (toca uno para ver sus órdenes)`} medida="contenedor" densidad="compacta" />
              </BloqueDetalle>
            )}
            <BloqueDetalle
              titulo="Sus señales aquí"
              acciones={
                e.senalesDetalle.length ? (
                  <Link href={`${ruta}?seccion=senales&sent=${e.entidadRuc}`} className="shrink-0 text-meta font-medium text-granate underline-offset-2 hover:underline">
                    Ver su evidencia
                  </Link>
                ) : undefined
              }
            >
              <SenalesBrevesEntidad entidad={e} entidades={f.entidades} />
            </BloqueDetalle>
          </CuerpoDetalle>
        ),
        pie: (
          <PieDetalle
            principal={
              <EnlaceAccion href={`/entidad/${e.entidadRuc}`} flecha>
                <Building2 size={14} aria-hidden /> Abrir la ficha de la entidad
              </EnlaceAccion>
            }
            secundarias={
              <EnlaceAccion href={`${ruta}?seccion=ordenes&oent=${e.entidadRuc}`} variante="secundario">
                <ListOrdered size={14} aria-hidden /> {e.ordenes === 1 ? "Ver su orden" : `Ver sus ${numero(e.ordenes)} órdenes`}
              </EnlaceAccion>
            }
          />
        ),
      },
    };
  });
}

function NoSePudoLeer({ codigo }: { codigo: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: "/app/personas" }]}
      titulo="Persona contratada"
      error="No pudimos leer esta ficha"
      reintentar={{ href: `/app/personas/${codigo}` }}
    >
      Puede que el código no exista o que el servidor no respondiera. No mostramos nada en su lugar.
    </FichaNoLeida>
  );
}
