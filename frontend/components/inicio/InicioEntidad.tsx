import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, Flag, Info, MapPin } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Indicadores, type Indicador } from "@/components/listado";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmpresasLigadas, QuienGobierna, TIPOS_CAPTURA, filaCaptura } from "@/components/entidad/CapturaEntidad";
import { QuienDecide } from "@/components/entidad/QuienDecide";
import { getEstructuraEntidad, getGastoEntidad, type ConteosEntidad, type NepotismoEntidad } from "@/lib/api-client";
import { getCorrupcionEntidad } from "@/lib/corrupcion";
import { TIPOS, type ResumenContratos } from "@/lib/contratos";
import { plural, solesCompacto } from "@/lib/formato";
import { getPersonas, PARAMS_EN_FICHA, SENAL, type ResumenPersonas } from "@/lib/personas";
import { getPoderEntidad, getPoderGrafoEntidad } from "@/lib/poder";
import { rutaRegion } from "@/lib/regiones";
import { Banderas, BarrasGasto, BloqueInicio, Fichas, LineasSinDato, ListaConteos, SubseccionInicio, TarjetaInicio, type FilaConteo } from "./BloquesInicio";
import { ResumenContraloria } from "./CasosCorrupcion";
import { NepotismoInicio } from "./NepotismoInicio";

/**
 * Inicio de una entidad (/entidad/[ruc], primera pestaña), con la plantilla de ficha (DESIGN_SYSTEM.md §14.2) y el
 * molde de la del contrato (ContratoDetalle: columna lateral fija):
 *
 *   columna principal                                   columna lateral (fija al bajar)
 *   ├─ Qué se encontró   banderas de sus contratos      ├─ Quién la gobierna (partido, autoridad, período)
 *   │                    (con la captura política),     ├─ Quién aprueba sus contratos (la AGA y quién la ocupa)
 *   │                    las empresas ligadas a la      └─ Ver también
 *   │                    gestión y las de las personas
 *   ├─ Dinero            en qué gasta (MEF) y sus contratos
 *   ├─ Control           la Contraloría (4 cifras, los 3 últimos informes, "Ver los N") y, en una línea, dónde
 *   │                    están los casos de la Procuraduría (son de su región, no de la entidad)
 *   └─ lo que no tiene dato, una línea cada uno
 *
 * Antes: diez bloques del mismo peso en dos columnas, lo que explica el poder al final (a 3,500 px), ~600 px de
 * cifras de la Procuraduría que "no son de esta entidad" y "En qué gasta" vacío en el primer lugar (evaluación
 * 2026-10-26). Las cifras de la ficha (contratos desde 2015, antecedentes, órdenes, presupuesto) van arriba, sólo aquí:
 * en las otras pestañas eran media pantalla del celular antes de la lista (como en la ficha de una empresa).
 *
 * Dos columnas desde xl, no desde lg: con la barra lateral del sitio (256 px), a 1024 px la columna principal quedaba
 * en ~316 px. Entre sm y xl, lo lateral va debajo, en dos columnas; salvo quién la gobierna, que va justo después de las
 * cifras (en el celular quedaba al final, a 6.8 pantallas).
 */
export function InicioEntidad({
  ruc,
  ruta,
  cifras,
  resumen,
  enCola,
  conteos,
  region,
  ubigeo,
  regionDenuncias,
  nepotismo,
  fueraDelMef = false,
}: {
  ruc: string;
  ruta: string;
  /** Las cifras de la ficha (`Indicadores`). */
  cifras: Indicador[];
  resumen: ResumenContratos | null;
  enCola: number;
  /** Cuántas órdenes y contratos menores tiene (GET /entidades/:ruc/conteos); null si no respondió. */
  conteos: ConteosEntidad | null;
  /** Su departamento, por nombre ("Lima"). */
  region: string | null;
  /** Su ubigeo ("150101"): los dos primeros dígitos son su región (la ficha de la región, la Procuraduría). */
  ubigeo: string | null;
  /** El nombre de su región como lo usa /app/denuncias, si se reconoce. */
  regionDenuncias?: string;
  /** Parientes declarados en la DJI que son locadores de esta entidad (indicio). Va con las banderas de las personas. */
  nepotismo: NepotismoEntidad | null;
  /** Fuera del SIAF o empresa del Estado: su presupuesto no está en los datos abiertos del MEF (no es que falte). */
  fueraDelMef?: boolean;
}) {
  return (
    <div className="space-y-8">
      <Indicadores items={cifras} />
      <div className="grid items-start gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Hasta xl, quién la gobierna antes que todo lo demás; desde xl, en la columna lateral (Lateral). */}
        <Suspense fallback={null}>
          <GobiernaArriba ruc={ruc} />
        </Suspense>
        <div className="min-w-0 space-y-10">
          <Suspense fallback={<EsqueletoPrincipal />}>
            <Principal ruc={ruc} ruta={ruta} resumen={resumen} enCola={enCola} conteos={conteos} region={region} ubigeo={ubigeo} nepotismo={nepotismo} fueraDelMef={fueraDelMef} />
          </Suspense>
        </div>
        {/* Fija al bajar, con su propio scroll si no entra (un ministerio con muchos funcionarios). */}
        <aside
          aria-label="Quién la gobierna y quién decide"
          className="grid min-w-0 items-start gap-4 sm:grid-cols-2 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:grid-cols-1 xl:overflow-y-auto xl:overscroll-contain"
        >
          <Suspense fallback={<Skeleton className="h-48 rounded-2xl" />}>
            <Lateral ruc={ruc} region={region} ubigeo={ubigeo} regionDenuncias={regionDenuncias} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}

/** Quién la gobierna, primero, hasta xl (después va en la columna lateral). Sin autoridad electa (un ministerio), nada. */
async function GobiernaArriba({ ruc }: { ruc: string }) {
  // El mismo `fetch` que la columna principal y la lateral: Next lo hace una sola vez.
  const poder = await getPoderEntidad(ruc);
  if (!poder?.partido) return null;
  return (
    <div className="min-w-0 xl:hidden">
      <QuienGobierna poder={poder} />
    </div>
  );
}

function EsqueletoPrincipal() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

// ─── Columna principal ───────────────────────────────────────────────────────

async function Principal({
  ruc,
  ruta,
  resumen,
  enCola,
  conteos,
  region,
  ubigeo,
  nepotismo,
  fueraDelMef,
}: {
  ruc: string;
  ruta: string;
  resumen: ResumenContratos | null;
  enCola: number;
  conteos: ConteosEntidad | null;
  region: string | null;
  ubigeo: string | null;
  nepotismo: NepotismoEntidad | null;
  fueraDelMef: boolean;
}) {
  // Todo a la vez. El poder lo pide también la columna lateral: es el mismo `fetch` y Next lo hace una sola vez.
  const [gasto, corrupcion, personas, poder, grafo] = await Promise.all([
    getGastoEntidad(ruc),
    getCorrupcionEntidad(ruc),
    getPersonas({ entidad: ruc, size: 0 }),
    getPoderEntidad(ruc),
    getPoderGrafoEntidad(ruc),
  ]);
  // Los enlaces a la lista de contratos llevan su vista: si la entidad no tiene contratos, la primera vista es otra.
  const contratos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: "contratos", vista: "contratos", ...f })}`;
  const enVista = (vista: "ordenes" | "menores") => `${ruta}?${new URLSearchParams({ seccion: "contratos", vista })}`;
  const enPersonas = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: "personas", ...f })}`;
  const l = resumen?.porLectura;
  const leidos = (l?.publicado ?? 0) + (l?.revision ?? 0);
  const totalGasto = (gasto?.funciones ?? []).reduce((s, f) => s + f.pim, 0);
  const hayGasto = !!gasto && totalGasto > 0;
  const r = personas?.resumen ?? null;
  const dep = ubigeo?.slice(0, 2) || corrupcion?.departamento || null;

  // Lo que no tiene dato va al final, en una línea cada uno (antes, una tarjeta vacía del mismo peso que las llenas).
  const sinDato: { titulo: string; motivo: string }[] = [];
  if (!hayGasto)
    sinDato.push({
      titulo: "En qué gasta",
      motivo: fueraDelMef
        ? "No está en el SIAF del MEF: su presupuesto no sale en los datos abiertos del MEF."
        : "Sin dato. Vigía no encontró su presupuesto en el MEF (Consulta Amigable).",
    });
  if (!r) sinDato.push({ titulo: "Personas contratadas", motivo: "Sin dato: el servicio de personas no respondió." });
  else if (!r.filas) sinDato.push({ titulo: "Personas contratadas", motivo: "No registra órdenes de servicio a personas." });
  if (!corrupcion) sinDato.push({ titulo: "Contraloría", motivo: "Sin dato: el servicio no respondió." });

  const enlace = "font-medium text-granate underline-offset-2 hover:underline";
  const datosContratos: DatoClave[] = [
    {
      etiqueta: "Por tipo",
      valor: resumen ? <Fichas items={TIPOS.map((t) => ({ etiqueta: t.label, n: resumen.porTipo[t.value] ?? 0, href: contratos({ tipo: t.value }) }))} /> : null,
    },
    {
      etiqueta: "¿Lo leyó Vigía?",
      valor: l ? (
        <Fichas
          items={[
            { etiqueta: "Con dictamen", n: l.publicado ?? 0, href: contratos({ lectura: "publicado" }), destacada: true },
            { etiqueta: "En revisión humana", n: l.revision ?? 0, href: contratos({ lectura: "revision" }) },
            { etiqueta: "Leyéndose", n: l.leyendo ?? 0, href: contratos({ lectura: "leyendo" }) },
            { etiqueta: "Aún no", n: l.sin_leer ?? 0, href: contratos({ lectura: "sin_leer" }) },
          ]}
        />
      ) : null,
    },
    {
      etiqueta: "Esperan lectura",
      valor: enCola > 0 ? <Link href={contratos({ lectura: "sin_leer" })} className={enlace}>{plural(enCola, "contrato en la cola", "contratos en la cola")}</Link> : "Ninguno en la cola",
    },
    // Sus órdenes de compra y de servicio (CONOSCE) y sus contratos menores: la pestaña Contratos los tiene en sus vistas.
    ...(conteos && conteos.ordenes !== 0
      ? [
          {
            etiqueta: "Órdenes de compra y de servicio",
            valor: (
              <Link href={enVista("ordenes")} className={enlace}>
                {conteos.ordenes == null
                  ? "Ver sus órdenes desde 2018"
                  : `${plural(conteos.ordenes, "orden", "órdenes")}${conteos.ordenesMonto ? ` por ${solesCompacto(conteos.ordenesMonto)}` : ""}`}
              </Link>
            ),
          },
        ]
      : []),
    ...(conteos && conteos.menores > 0
      ? [{ etiqueta: "Contratos menores", valor: <Link href={enVista("menores")} className={enlace}>{plural(conteos.menores, "contrato de hasta 8 UIT", "contratos de hasta 8 UIT")}</Link> }]
      : []),
    ...(r && r.filas
      ? [
          {
            etiqueta: "Órdenes a personas",
            valor: (
              <Link href={enPersonas()} className={enlace}>
                {plural(r.personas, "persona", "personas")}, {solesCompacto(r.monto)} en {plural(r.ordenes, "orden", "órdenes")}
              </Link>
            ),
          },
        ]
      : []),
    { etiqueta: "Quiénes le venden", valor: <Link href={`/app/empresas?entidad=${ruc}`} className={enlace}>Sus proveedores, con sus antecedentes</Link> },
  ];

  return (
    <>
      <SubseccionInicio
        id="inicio-hallazgos"
        titulo="Qué se encontró"
        descripcion="Cruces de datos públicos en sus contratos y en quienes contrata: son indicios para revisar, no acusaciones."
        ayuda={
          <Ayuda titulo="¿Qué es una bandera?">
            <span className="block">
              Lo que encontró Vigía al leer un contrato y al cruzar a quien lo ganó (o a quien recibió una orden) con otros
              registros públicos: sanciones, aportes de campaña, socios, parientes declarados…
            </span>
            <span className="mt-2 block">Cada fila abre esos contratos o esas personas, ya filtrados, con la evidencia de cada uno.</span>
          </Ayuda>
        }
      >
        <BloqueInicio nivel={3} titulo="En sus contratos" enlace={{ href: contratos({ cruces: "con" }), texto: "Ver los que tienen antecedentes" }}>
          <Banderas
            porRiesgo={resumen?.porRiesgo}
            porCruces={resumen?.porCruces}
            href={contratos}
            extra={poder ? [filaCaptura(poder, contratos)] : []}
            sinTipos={poder ? TIPOS_CAPTURA : []}
            conRiesgo={leidos > 0}
            // "Con algún antecedente" ya es la segunda cifra de la cabecera de la ficha: aquí, el enlace de arriba.
            conAlguno={false}
          />
        </BloqueInicio>
        {poder && <EmpresasLigadas poder={poder} grafo={grafo} entidadRuc={ruc} href={contratos} />}
        {r && r.filas > 0 && (
          <BloqueInicio nivel={3} titulo="En las personas que contrató" enlace={{ href: enPersonas(), texto: "Ver a las personas" }}>
            <ListaConteos filas={filasPersonas(r, nepotismo, enPersonas)} />
          </BloqueInicio>
        )}
        <NepotismoInicio nepotismo={nepotismo} href={enPersonas} />
      </SubseccionInicio>

      <SubseccionInicio id="inicio-dinero" titulo="Dinero" descripcion="En qué gasta según el MEF y lo que contrata.">
        {hayGasto && gasto && (
          <BloqueInicio
            nivel={3}
            titulo={gasto.anio ? `En qué gasta (${gasto.anio})` : "En qué gasta"}
            ayuda={
              <Ayuda titulo="¿De dónde sale?">
                Del MEF (Consulta Amigable): el presupuesto modificado (PIM) de cada función del Estado y la parte ya gastada
                (devengado). {gasto.cruce === "pliego" ? "Es el de todo el gobierno regional, no sólo esta sede." : ""}
              </Ayuda>
            }
            enlace={{ href: `${ruta}?seccion=presupuesto`, texto: "Todo el presupuesto" }}
          >
            <BarrasGasto rubros={gasto.funciones} total={totalGasto} />
          </BloqueInicio>
        )}
        <BloqueInicio nivel={3} titulo="Sus contratos" enlace={{ href: contratos(), texto: "Ver los contratos" }}>
          <DatosClave items={datosContratos} />
        </BloqueInicio>
      </SubseccionInicio>

      <SubseccionInicio
        id="inicio-control"
        titulo="Control"
        descripcion="Los informes de la Contraloría sobre esta entidad: responsabilidad presunta de sus funcionarios."
        ayuda={
          <Ayuda titulo="¿Qué es un informe de control?">
            <span className="block">
              La Contraloría revisa a las entidades y, cuando encuentra algo, señala una responsabilidad presunta (penal,
              civil o administrativa) de sus funcionarios y la deriva a quien corresponde. No es una condena.
            </span>
            <span className="mt-2 block">
              Lo comprobado (casos con sentencia firme) lo publica la Procuraduría Anticorrupción, pero por departamento:
              está en la ficha de la región.
            </span>
          </Ayuda>
        }
      >
        {corrupcion && corrupcion.informes.total > 0 && (
          <TarjetaInicio>
            <ResumenContraloria informes={corrupcion.informes} href={`${ruta}?seccion=control`} />
          </TarjetaInicio>
        )}
        {corrupcion && corrupcion.informes.total === 0 && (
          <p className="text-dato text-inkSoft">La Contraloría no tiene informes con responsabilidad sobre esta entidad en su buscador.</p>
        )}
        {dep && (
          <p className="flex items-start gap-2 text-meta leading-snug text-inkSoft">
            <Info size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            <span className="min-w-0">
              Los casos de la Procuraduría Anticorrupción se publican por departamento, no por entidad: los de{" "}
              {region ?? "su región"} están en{" "}
              <Link href={rutaRegion(dep)} prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">
                la ficha de {region ?? "la región"}
              </Link>
              .
            </span>
          </p>
        )}
      </SubseccionInicio>

      <LineasSinDato items={sinDato} />
    </>
  );
}

/**
 * Las banderas de las personas a las que pagó por órdenes de servicio: la de nepotismo primero (si la hay), las graves,
 * las que tienen alguna y las tres señales más frecuentes, cada una con su lista ya filtrada en la pestaña Personas.
 */
function filasPersonas(r: ResumenPersonas, nepotismo: NepotismoEntidad | null, href: (f: Record<string, string>) => string): FilaConteo[] {
  const P = PARAMS_EN_FICHA;
  // La cuenta de la lista filtrada (personas con la señal); si el resumen no la trae, la de la DJI.
  const nNepotismo = r.porSenal.find((s) => s.tipo === "nepotismo")?.n ?? nepotismo?.total ?? 0;
  return [
    ...(nNepotismo > 0 ? [{ etiqueta: SENAL.nepotismo.titulo, n: nNepotismo, href: href({ [P.senal]: "nepotismo" }), grave: true }] : []),
    { etiqueta: "Con una señal grave", n: r.alta, href: href({ [P.severidad]: "alta" }), grave: true },
    { etiqueta: "Con alguna señal", n: r.conSenales, href: href({ [P.severidad]: "con" }) },
    // recorte: las 3 más frecuentes; todas, en la lista filtrable de la pestaña ("Ver a las personas")
    ...r.porSenal
      .filter((s) => s.tipo !== "nepotismo")
      .slice(0, 3)
      .map((s) => ({ etiqueta: SENAL[s.tipo]?.titulo ?? s.tipo, n: s.n, href: href({ [P.senal]: s.tipo }) })),
  ];
}

// ─── Columna lateral ─────────────────────────────────────────────────────────

async function Lateral({ ruc, region, ubigeo, regionDenuncias }: { ruc: string; region: string | null; ubigeo: string | null; regionDenuncias?: string }) {
  // El poder lo pide también la columna principal: el mismo `fetch`, una sola vez.
  const [poder, estructura] = await Promise.all([getPoderEntidad(ruc), getEstructuraEntidad(ruc)]);
  const dep = ubigeo?.slice(0, 2) || null;
  // Sus proveedores ya están en "Sus contratos" (Dinero); aquí, lo de su región: su ficha (con la Procuraduría) y las
  // obras denunciadas (antes, la pestaña Denuncias).
  const enlaces = [
    ...(dep ? [{ href: rutaRegion(dep), texto: `La ficha de ${region ?? "su región"}`, Icono: MapPin }] : []),
    ...(regionDenuncias ? [{ href: `/app/denuncias?region=${encodeURIComponent(regionDenuncias)}`, texto: `Obras denunciadas en ${regionDenuncias}`, Icono: Flag }] : []),
  ];
  return (
    <>
      {/* Hasta xl va arriba de todo (GobiernaArriba). */}
      {poder?.partido && (
        <div className="hidden min-w-0 xl:block">
          <QuienGobierna poder={poder} />
        </div>
      )}
      <QuienDecide estructura={estructura} />
      {enlaces.length > 0 && (
        <BloqueInicio titulo="Ver también">
          <ul className="-mx-1 divide-y divide-line/70">
            {enlaces.map(({ href, texto, Icono }) => (
              <li key={href}>
                <Link href={href} prefetch={false} className="flex min-h-11 items-center gap-2.5 rounded-lg px-1 py-2 text-dato text-ink transition-colors duration-rapido hover:bg-granate-50 hover:text-granate">
                  <Icono size={15} className="shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0 flex-1">{texto}</span>
                  <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </BloqueInicio>
      )}
    </>
  );
}
