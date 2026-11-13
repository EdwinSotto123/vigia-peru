import { Suspense } from "react";
import Link from "next/link";
import { ChevronDown, ClipboardList, FileSearch, FileText, History, Package, Users, Wallet } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { Skeleton } from "@/components/ui/Skeleton";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  getConteosPartido,
  getGastoPartido,
  getSalientesPartido,
  periodoTexto,
  type AnioGobierno,
  type DetallePartido,
  type GastoPartido,
  type SalientesPartido,
} from "@/lib/partidosApi";
import { getCorrupcionPartido } from "@/lib/corrupcion";
import { PARAMS_EN_FICHA, getPersonas } from "@/lib/personas";
import { BarrasMonto, SinRespuesta } from "./BloquesInicio";
import { BarraPartes, type ParteBarra } from "./BarraPartes";
import { motivoSinGasto } from "./GastoGobiernos";
import { hallazgosContratos, hallazgosPersonas } from "./hallazgos";
import { CajaResumen, HallazgosClave, ListaMas, RejillaResumen, elegirHallazgos, type FilaMas } from "./ResumenFicha";

/**
 * Inicio de un partido (/app/partidos/[clave], primera pestaña) en un período, en UNA pantalla de escritorio (pedido del
 * dueño del 2026-11-13), con la forma de las demás fichas (components/inicio/ResumenFicha.tsx):
 *
 *   las cifras: contratos adjudicados, monto, gobiernos ganados, lo que leyó Vigía
 *   ┌ Señales para revisar ┐ ┌ Dónde gobierna ─────┐ ┌ Ver más ─────────────────┐
 *   │ las tres que más     │ │ sus gobiernos por   │ │ contratos, en qué        │
 *   │ pesan                │ │ nivel y dónde más   │ │ contrataron (panel),     │
 *   │                      │ │ contrataron         │ │ personas, gasto, control │
 *   └──────────────────────┘ └──────────────────────┘ └─────────────────────────┘
 *
 * Antes: «Qué se encontró», «Dinero» y la tabla entera de la Contraloría uno debajo del otro (~9 pantallas de celular), y
 * cuando la Contraloría no respondía, una tarjeta entera con «Sin dato: el servicio no respondió» pintado como contenido.
 * Ahora la tabla está en la pestaña «Control» y lo que no responde es una fila con «Reintentar». Las señales y «Ver más»
 * llegan cada uno con su `Suspense`: lo lento (los conteos de sus contratos, la Contraloría) no detiene lo demás.
 */
export function InicioPartido({
  clave,
  anio,
  ruta,
  d,
  gasto,
  cifras,
}: {
  clave: string;
  anio: AnioGobierno;
  ruta: string;
  d: DetallePartido;
  /** El mismo pedido que la pestaña Gobiernos (Next lo hace una sola vez). */
  gasto?: Promise<GastoPartido | null>;
  /** Las cifras del partido en el período (`Indicadores`). */
  cifras: Indicador[];
}) {
  const procesos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "procesos", ...f })}`;
  const reintentar = `${ruta}?anio=${anio}`;
  return (
    <div className="space-y-4">
      <h2 className="sr-only">Resumen del partido en {periodoTexto(anio)}</h2>
      <Indicadores items={cifras} />
      <RejillaResumen>
        <Suspense fallback={<CajaEspera titulo="Señales para revisar" />}>
          <SenalesPartido clave={clave} anio={anio} ruta={ruta} procesos={procesos} reintentar={reintentar} />
        </Suspense>
        <DondeGobierna d={d} anio={anio} ruta={ruta} procesos={procesos} />
        <Suspense fallback={<CajaEspera titulo="Ver más" className="lg:col-span-2 xl:col-span-1" />}>
          <VerMasPartido clave={clave} anio={anio} ruta={ruta} d={d} gasto={gasto} procesos={procesos} reintentar={reintentar} />
        </Suspense>
      </RejillaResumen>
    </div>
  );
}

/** Una caja mientras llega lo suyo: su título y la forma de las filas (nunca «Sin dato» provisional). */
function CajaEspera({ titulo, className }: { titulo: string; className?: string }) {
  return (
    <CajaResumen titulo={titulo} className={className}>
      <span className="sr-only">Cargando…</span>
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </CajaResumen>
  );
}

/**
 * Las tres señales que más pesan entre los contratos de sus gobiernos que están en la base de Vigía (los únicos que se
 * leen y se cruzan) y las personas que contrataron. Los conteos de sus contratos tienen tiempo límite y un reintento
 * (getConteosPartido): si aun así no responden, una línea con «Reintentar» y lo demás igual.
 */
async function SenalesPartido({
  clave,
  anio,
  ruta,
  procesos,
  reintentar,
}: {
  clave: string;
  anio: AnioGobierno;
  ruta: string;
  procesos: (f?: Record<string, string>) => string;
  reintentar: string;
}) {
  const [conteos, personas] = await Promise.all([getConteosPartido(clave, anio), getPersonas({ partido: clave, periodo: anio, size: 0 })]);
  const f = conteos?.facetas ?? null;
  const l: Record<string, number> = f?.porLectura ?? {};
  // Cuántos de sus procesos están en la base de Vigía: el total de los antecedentes (no los de CONOSCE, más o menos el doble).
  const enBase = Object.values(l).reduce((s, n) => s + (n ?? 0), 0);
  const enPersonas = (x: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "personas", ...x })}`;
  const hallazgos = elegirHallazgos([
    f ? hallazgosContratos({ porRiesgo: f.porRiesgo, porCruces: f.porCruces, total: enBase }, procesos, { unidad: "En los contratos de sus gobiernos" }) : [],
    hallazgosPersonas(personas?.resumen ?? null, enPersonas, PARAMS_EN_FICHA, { sinSenales: [] }),
  ]);
  return (
    <CajaResumen
      titulo="Señales para revisar"
      flush
      ayuda={
        <Ayuda titulo="¿Qué señales son?">
          <span className="block">
            Las tres que más pesan entre los contratos de sus gobiernos y las personas que contrataron, lo grave primero. Sólo cuentan
            los contratos que también están en la base de Vigía (más o menos la mitad).
          </span>
          <span className="mt-2 block">Son motivos para revisar: no prueban una irregularidad ni acusan al partido.</span>
        </Ayuda>
      }
      enlace={f?.porCruces?.con ? { href: procesos({ cruces: "con" }), texto: "Todos los antecedentes" } : undefined}
    >
      <HallazgosClave filas={hallazgos} vacio="Sin señales en los contratos de sus gobiernos ni en las personas que contrataron." />
      {!f && (
        <div className="px-4 pt-2">
          <SinRespuesta href={reintentar}>Las señales de sus contratos no respondieron ahora.</SinRespuesta>
        </div>
      )}
    </CajaResumen>
  );
}

/** Las series de los gráficos para los tres niveles de gobierno (clases enteras: Tailwind no ve las armadas). */
const SERIE_NIVEL = { regional: "bg-[rgb(var(--serie-1))]", provincial: "bg-[rgb(var(--serie-2))]", distrital: "bg-[rgb(var(--serie-3))]" } as const;

/**
 * «Dónde gobierna»: sus gobiernos por nivel en una barra (cada parte abre la pestaña Gobiernos con ese nivel) y las
 * regiones donde más contrataron, en barras de monto (cada una abre sus contratos de esa región).
 */
function DondeGobierna({ d, anio, ruta, procesos }: { d: DetallePartido; anio: AnioGobierno; ruta: string; procesos: (f?: Record<string, string>) => string }) {
  const g = d.partido.gobiernos;
  const gobiernos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "gobiernos", ...f })}`;
  const partes: ParteBarra[] = (
    [
      ["regional", "Regiones", g.regional],
      ["provincial", "Provincias", g.provincial],
      ["distrital", "Distritos", g.distrital],
    ] as const
  )
    .filter(([, , n]) => n > 0)
    .map(([nivel, etiqueta, n]) => ({ clave: nivel, etiqueta, n, clase: SERIE_NIVEL[nivel], href: gobiernos({ gnivel: nivel }) }));
  const porRegion = regiones(d);
  return (
    <CajaResumen
      titulo="Dónde gobierna"
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          Del JNE: los gobiernos regionales, provinciales y distritales que ganó en las elecciones de este período. Lo contratado, del
          OECE: lo adjudicado por las entidades de esos gobiernos, por región.
        </Ayuda>
      }
      enlace={{ href: gobiernos(), texto: "Sus gobiernos" }}
    >
      {partes.length ? (
        <div className="space-y-4">
          <BarraPartes leyenda="en-linea" etiqueta={`Gobiernos que ganó para ${periodoTexto(anio)}, por nivel`} partes={partes} />
          {porRegion.length > 0 && (
            <div>
              <p className="mb-2 text-rotulo font-semibold text-mute">Dónde más contrataron</p>
              <BarrasMonto
                maximo={4}
                items={porRegion.map((r) => ({ nombre: r.nombre, monto: r.monto, detalle: plural(r.procesos, "contrato", "contratos"), href: procesos({ region: r.ubigeo }) }))}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="text-meta text-mute">No ganó gobiernos regionales, provinciales ni distritales para {periodoTexto(anio)}.</p>
      )}
    </CajaResumen>
  );
}

/** «Ver más»: cada pestaña o lista con la cifra que la resume, y en un panel lo que no tiene pestaña propia. */
async function VerMasPartido({
  clave,
  anio,
  ruta,
  d,
  gasto: gastoP,
  procesos,
  reintentar,
}: {
  clave: string;
  anio: AnioGobierno;
  ruta: string;
  d: DetallePartido;
  gasto?: Promise<GastoPartido | null>;
  procesos: (f?: Record<string, string>) => string;
  reintentar: string;
}) {
  const [corrupcion, gasto, personas, salientes] = await Promise.all([
    getCorrupcionPartido(clave, anio),
    gastoP ?? getGastoPartido(clave, anio),
    getPersonas({ partido: clave, periodo: anio, size: 0 }),
    getSalientesPartido(clave, anio),
  ]);
  const enSeccion = (seccion: string, f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion, ...f })}`;
  const h = d.historia;
  const p = personas?.resumen ?? null;
  const porObjeto = [...(h?.porObjeto ?? [])].sort((a, b) => b.montoAdjudicadoPen - a.montoAdjudicadoPen);
  const totalObjeto = porObjeto.reduce((s, o) => s + o.montoAdjudicadoPen, 0);
  const t = gasto?.disponible ? gasto.totales : null;
  const sinGasto = motivoSinGasto(gasto);
  const filas: FilaMas[] = [
    ...(h
      ? [
          {
            clave: "contratos",
            icono: FileText,
            titulo: "Sus contratos",
            // Sin cifra: cuántos y por cuánto ya son las dos primeras cifras de arriba.
            texto: "Con su ganador y su monto, mes a mes",
            href: procesos(),
          },
        ]
      : []),
    ...(porObjeto.length && totalObjeto > 0
      ? [
          {
            clave: "objeto",
            icono: Package,
            titulo: "En qué contrataron",
            texto: `Lo mayor, ${tituloNatural(porObjeto[0].objeto)}: ${porcentaje((porObjeto[0].montoAdjudicadoPen / totalObjeto) * 100)} del monto`,
            panel: {
              titulo: `En qué contrataron sus gobiernos (${periodoTexto(anio)})`,
              descripcion: "Lo adjudicado por las entidades que gobernó, por objeto (OECE). Cada barra abre esos contratos.",
              contenido: (
                <BarrasMonto
                  maximo={12}
                  items={porObjeto.map((o) => ({ nombre: o.objeto, monto: o.montoAdjudicadoPen, detalle: plural(o.procesos, "contrato", "contratos"), href: procesos({ objeto: o.objeto }) }))}
                />
              ),
            },
          },
        ]
      : []),
    ...(p && p.filas > 0
      ? [
          {
            clave: "personas",
            icono: Users,
            titulo: "Personas contratadas",
            cifra: numero(p.personas),
            texto: p.alta > 0 ? `${numero(p.alta)} con una señal grave` : `${solesCompacto(p.monto)} en órdenes de servicio`,
            tono: p.alta > 0 ? ("alta" as const) : undefined,
            href: enSeccion("personas"),
          },
        ]
      : !p
        ? [{ clave: "personas", icono: Users, titulo: "Personas contratadas", texto: "El servicio no respondió ahora", sinRespuesta: true, href: reintentar }]
        : []),
    t
      ? {
          clave: "gasto",
          icono: Wallet,
          titulo: gasto?.mef ? `En qué gastan (MEF ${gasto.mef})` : "En qué gastan",
          cifra: solesCompacto(t.pim),
          texto: `${porcentaje(t.pim > 0 ? (t.devengado / t.pim) * 100 : 0)} ya gastado`,
          href: enSeccion("gobiernos", { gvista: "gasto" }),
        }
      : gasto === null
        ? { clave: "gasto", icono: Wallet, titulo: "En qué gastan", texto: "El servicio no respondió ahora", sinRespuesta: true, href: reintentar }
        : { clave: "gasto", icono: Wallet, titulo: "En qué gastan", texto: sinGasto ?? "Sin el detalle del MEF para este período" },
    corrupcion
      ? {
          clave: "control",
          icono: FileSearch,
          titulo: "Informes de la Contraloría",
          cifra: numero(corrupcion.informes.total),
          texto: corrupcion.informes.total ? `${numero(corrupcion.informes.penal)} con responsabilidad penal` : "Ninguno sobre sus entidades en este período",
          tono: corrupcion.informes.penal > 0 ? ("media" as const) : undefined,
          href: enSeccion("control"),
        }
      : { clave: "control", icono: FileSearch, titulo: "Informes de la Contraloría", texto: "El servicio no respondió ahora", sinRespuesta: true, href: reintentar },
    ...(salientes && salientes.total.plazas > 0
      ? [
          {
            clave: "salientes",
            icono: ClipboardList,
            titulo: "Plazas de sus gestiones salientes",
            cifra: numero(salientes.total.plazas),
            texto: `En ${plural(salientes.entidades.length, "entidad", "entidades")}`,
            tono: "media" as const,
            panel: {
              titulo: "Plazas de sus gestiones salientes",
              descripcion: "Plazas CAS que publicaron sus entidades después de las elecciones y antes de entregar el cargo. No es una falta: es para revisar.",
              contenido: <PlazasSalientes s={salientes} />,
            },
          },
        ]
      : []),
    { clave: "historia", icono: History, titulo: "Su historia", texto: "Desde 2015, y sus campañas", href: enSeccion("historia") },
  ];
  return (
    <CajaResumen titulo="Ver más" flush className="lg:col-span-2 xl:col-span-1">
      <ListaMas filas={filas} columnas={2} />
    </CajaResumen>
  );
}

/** Procesos y monto por región, de sus gobiernos (la ficha trae cada gobierno con su ubigeo). */
function regiones(d: DetallePartido): { ubigeo: string; nombre: string; procesos: number; monto: number }[] {
  const m = new Map<string, { ubigeo: string; nombre: string; procesos: number; monto: number }>();
  for (const x of d.gobiernos ?? []) {
    const u = x.ubigeo.slice(0, 2);
    const r = m.get(u) ?? { ubigeo: u, nombre: x.region ?? u, procesos: 0, monto: 0 };
    r.procesos += x.procesos;
    r.monto += x.montoAdjudicadoPen;
    m.set(u, r);
  }
  return [...m.values()].filter((r) => r.monto > 0);
}

/**
 * Las plazas CAS que sus gobiernos convocaron después de las elecciones regionales y municipales y antes de entregar el
 * cargo (migración 183), en el panel de su fila de «Ver más»: las cifras en una franja y TODAS sus entidades, las que más
 * convocaron primero (diez a la vista y las demás en «Ver las otras N»). Cada entidad abre sus plazas con esa señal. Antes
 * era un bloque entero del Inicio; en el celular sus nombres desbordaban la pantalla (la lista era una rejilla sin
 * `grid-cols-1`, que se estira al nombre más largo).
 */
function PlazasSalientes({ s }: { s: SalientesPartido }) {
  const t = s.total;
  // recorte: diez a la vista; las demás (todas las que trae la API) en «Ver las otras N», debajo
  const primeras = s.entidades.slice(0, 10);
  const resto = s.entidades.slice(10);
  const fila = (e: SalientesPartido["entidades"][number]) => (
    <li key={e.entidadRuc} className="min-w-0 border-t border-line/70">
      <Link
        href={`/entidad/${e.entidadRuc}?seccion=plazas&zsenal=gestion_saliente`}
        prefetch={false}
        className="group/entidad flex min-h-11 min-w-0 items-center justify-between gap-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        <span className="min-w-0 truncate text-dato font-medium text-granate underline-offset-2 group-hover/entidad:underline" title={tituloNatural(e.entidad)}>
          {tituloNatural(e.entidad)}
        </span>
        <span className="shrink-0 text-meta text-mute">
          <span className="font-mono font-semibold tabular-nums text-ink">{numero(e.plazas)}</span> {e.plazas === 1 ? "plaza" : "plazas"}
        </span>
      </Link>
    </li>
  );
  return (
    <div className="space-y-4">
      <CifrasEnFila
        items={[
          { valor: numero(t.plazas), etiqueta: t.plazas === 1 ? "plaza" : "plazas", contexto: `con ${plural(t.vacantes, "vacante", "vacantes")}` },
          { valor: solesCompacto(t.alMes), etiqueta: "al mes en sueldos" },
          ...(t.aLaMedida
            ? [{ valor: numero(t.aLaMedida), etiqueta: t.aLaMedida === 1 ? "pide experiencia en la propia entidad o ya tiene locadores" : "piden experiencia en la propia entidad o ya tienen locadores" }]
            : []),
        ]}
      />
      <div>
        <p className="pb-1 text-rotulo font-semibold text-mute">
          {s.entidades.length === 1 ? "En una entidad" : `En ${numero(s.entidades.length)} entidades, de más a menos plazas`}
        </p>
        <ul className="grid grid-cols-1">{primeras.map(fila)}</ul>
        {resto.length > 0 && (
          <details className="group/resto mt-1">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-granate hover:underline [&::-webkit-details-marker]:hidden">
              <span className="group-open/resto:hidden">{resto.length === 1 ? "Ver la otra entidad" : `Ver las otras ${numero(resto.length)} entidades`}</span>
              <span className="hidden group-open/resto:inline">Ver menos</span>
              <ChevronDown size={14} className="shrink-0 transition-transform group-open/resto:rotate-180" aria-hidden />
            </summary>
            <ul className="grid grid-cols-1" aria-label="Las otras entidades">
              {resto.map(fila)}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
