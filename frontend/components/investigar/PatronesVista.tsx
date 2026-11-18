"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Briefcase, Building2, Coins, CopyCheck, FileSearch, Sprout, FlaskConical, Handshake, ScanSearch, SearchX, ShoppingCart, TrendingUp, Users, UsersRound } from "lucide-react";
import { Ayuda, CabeceraPestana, Nota, Pestanas } from "@/components/patrones";
import { EVENTO_ACTIVA } from "@/components/patrones/Pestanas";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { EstadoCarga, usePoder } from "@/components/grafo/vista";
import { InformeEnPanel } from "@/components/control/InformeEnPanel";
import { detalleCompraFamilia, detalleConsorcio, detalleControl, detalleDoble, detalleDueno, detalleGrupo, detalleInhabilitada, detalleObservacion, detalleObservado, detalleRecien, detalleRelleno, detalleRenovacion, detalleRepetida, detalleSenal } from "./DetallePatron";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dato } from "@/components/ui/Dato";
import { MARGEN_LISTA, Paginacion } from "@/components/ui/Paginacion";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { reglaLabel } from "@/lib/auditoria-reglas";
import { decimal, fechaConAnio, numero, oracion, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  codigoDeOcid,
  rutaAcompanantes,
  rutaConsorcios,
  rutaComprasFamilia,
  rutaControl,
  rutaDoble,
  rutaDuenos,
  rutaGrupos,
  rutaInhabilitadas,
  rutaObservacion,
  rutaObservados,
  rutaPatrones,
  rutaRecien,
  rutaRenovaciones,
  rutaRepetidas,
  SECCIONES_PATRONES,
  TAM_PATRONES,
  type AlcancePatron,
  type PatronAcompanante,
  type PatronConsorcio,
  type PatronControl,
  type PatronCompraFamilia,
  type PatronesComprasFamilia,
  type PatronDoble,
  type PatronRecien,
  type PatronesRecien,
  type PatronesDoble,
  type PatronDueno,
  type PatronGrupo,
  type PatronesGrupos,
  type PatronRepetida,
  type PatronesRepetidas,
  type PatronesControl,
  type PatronObservacion,
  type PatronesObservacion,
  type PatronObservado,
  type PatronesObservados,
  type PatronInhabilitada,
  type PatronesInhabilitadas,
  type PatronesDuenos,
  type PatronesAcompanantes,
  type PatronesConsorcios,
  type PatronesRenovaciones,
  type PatronRenovacion,
  type PatronesSenal,
  type PatronSenal,
  type SeccionPatrones,
} from "@/lib/patrones";
import { esRucEnClaro, esRucPersonaNatural } from "@/lib/privacidad";
import { cn } from "@/lib/utils";

/**
 * Las cinco listas de /app/patrones en las pestañas del kit (`?seccion=`). Cada pestaña pide lo suyo a la API la primera
 * vez que se abre (`Pestanas` la monta recién entonces), así una visita hace UNA consulta y no cinco. La página y la
 * señal elegida de cada lista van a la URL (`?page=`, `?regla=`) sin recargar, como la pestaña: el enlace comparte la
 * vista exacta, y al cambiar de pestaña la URL lleva lo de la que se ve.
 *
 * Cada fila abre su panel lateral (`DetallePatron`): el patrón en una frase, sus cifras, los contratos que lo sostienen y
 * qué conviene revisar. Los nombres y los contratos de ejemplo de la fila siguen siendo enlaces propios a su ficha.
 */

/** Lo que pide la URL al cargar: vale sólo para la pestaña abierta. */
export interface InicialPatrones {
  page: number;
  regla?: string;
  /** `?ruc=`: el RUC con que abre filtrada la lista (las banderas de una entidad enlazan así a sus grupos y sus casos). */
  ruc?: string;
}

export function PatronesVista({ activa, inicial, etiquetas }: { activa?: string; inicial: InicialPatrones; etiquetas: Record<string, string> }) {
  const abierta: SeccionPatrones = activa && activa in SECCIONES_PATRONES ? (activa as SeccionPatrones) : "entidades";
  const de = (clave: SeccionPatrones): InicialPatrones => (clave === abierta ? inicial : { page: 1 });
  return (
    <Pestanas
      activa={abierta}
      etiqueta="Tipos de patrón"
      pestanas={[
        {
          clave: "entidades",
          etiqueta: SECCIONES_PATRONES.entidades,
          titulo: "Señales que se repiten en una entidad",
          icono: <Building2 size={15} aria-hidden />,
          contenido: <ListaSenales alcance="entidad" clave="entidades" inicial={de("entidades")} etiquetas={etiquetas} />,
        },
        {
          clave: "proveedores",
          etiqueta: SECCIONES_PATRONES.proveedores,
          titulo: "Señales que se repiten en una empresa",
          icono: <Briefcase size={15} aria-hidden />,
          contenido: <ListaSenales alcance="proveedor" clave="proveedores" inicial={de("proveedores")} etiquetas={etiquetas} />,
        },
        {
          clave: "relleno",
          etiqueta: SECCIONES_PATRONES.relleno,
          titulo: "Postores que acompañan siempre al mismo ganador",
          icono: <Users size={15} aria-hidden />,
          contenido: <ListaRelleno inicial={de("relleno")} />,
        },
        {
          clave: "consorcios",
          etiqueta: SECCIONES_PATRONES.consorcios,
          titulo: "Socias de consorcio que después compiten",
          icono: <Handshake size={15} aria-hidden />,
          contenido: <ListaConsorcios inicial={de("consorcios")} />,
        },
        {
          clave: "duenos",
          etiqueta: SECCIONES_PATRONES.duenos,
          titulo: "El mismo dueño gana con varias empresas en una entidad",
          icono: <UsersRound size={15} aria-hidden />,
          contenido: <ListaDuenos inicial={de("duenos")} />,
        },
        {
          clave: "grupos",
          etiqueta: SECCIONES_PATRONES.grupos,
          titulo: "Proveedores unidos por dueño o familia en una entidad",
          icono: <UsersRound size={15} aria-hidden />,
          contenido: <ListaGrupos inicial={de("grupos")} />,
        },
        {
          clave: "repetidas",
          etiqueta: SECCIONES_PATRONES.repetidas,
          titulo: "La misma compra, repetida en pocas semanas",
          icono: <CopyCheck size={15} aria-hidden />,
          contenido: <ListaRepetidas inicial={de("repetidas")} />,
        },
        {
          clave: "doble",
          etiqueta: SECCIONES_PATRONES.doble,
          titulo: "En planilla de una entidad y con órdenes de servicio de otra",
          icono: <Coins size={15} aria-hidden />,
          contenido: <ListaDoble inicial={de("doble")} />,
        },
        {
          clave: "compras",
          etiqueta: SECCIONES_PATRONES.compras,
          titulo: "Trabaja en compras y un familiar recibe órdenes de su entidad",
          icono: <ShoppingCart size={15} aria-hidden />,
          contenido: <ListaComprasFamilia inicial={de("compras")} />,
        },
        {
          clave: "recien",
          etiqueta: SECCIONES_PATRONES.recien,
          titulo: "Empresas que reciben órdenes a pocos días de crearse",
          icono: <Sprout size={15} aria-hidden />,
          contenido: <ListaRecien inicial={de("recien")} />,
        },
        {
          clave: "inhabilitadas",
          etiqueta: SECCIONES_PATRONES.inhabilitadas,
          titulo: "Ganan mientras otra empresa del mismo socio está inhabilitada",
          icono: <Ban size={15} aria-hidden />,
          contenido: <ListaInhabilitadas inicial={de("inhabilitadas")} />,
        },
        {
          clave: "control",
          etiqueta: SECCIONES_PATRONES.control,
          titulo: "Ganan con un socio comprendido en un informe de control",
          icono: <FileSearch size={15} aria-hidden />,
          contenido: <ListaControl inicial={de("control")} />,
        },
        {
          clave: "observados",
          etiqueta: SECCIONES_PATRONES.observados,
          titulo: "Proveedores con procesos que la Contraloría observó",
          icono: <ScanSearch size={15} aria-hidden />,
          contenido: <ListaObservados inicial={de("observados")} />,
        },
        {
          clave: "renovaciones",
          etiqueta: SECCIONES_PATRONES.renovaciones,
          titulo: "El mismo servicio, más caro al renovarlo",
          icono: <TrendingUp size={15} aria-hidden />,
          contenido: <ListaRenovaciones inicial={de("renovaciones")} />,
        },
        {
          clave: "observacion",
          etiqueta: SECCIONES_PATRONES.observacion,
          titulo: "Indicadores nuevos que todavía se están midiendo",
          icono: <FlaskConical size={15} aria-hidden />,
          contenido: <ListaObservacion inicial={de("observacion")} />,
        },
      ]}
    />
  );
}

// ─── La página y la señal de cada lista, en la URL ───────────────────────────────

/**
 * El estado de una lista (página y señal) y su copia en la URL. Se escribe al montar la pestaña, al cambiar algo y cada
 * vez que la pestaña vuelve a abrirse (`Pestanas` avisa con un evento): si no, al pasar de una pestaña en la página 3 a
 * otra, la URL seguiría diciendo `page=3`.
 */
function useListaEnUrl(clave: SeccionPatrones, inicial: InicialPatrones) {
  const [estado, setEstado] = useState<InicialPatrones>(inicial);
  const actual = useRef(estado);
  actual.current = estado;
  const escribir = useCallback((e: InicialPatrones) => {
    try {
      const url = new URL(window.location.href);
      if (e.page > 1) url.searchParams.set("page", String(e.page));
      else url.searchParams.delete("page");
      if (e.regla) url.searchParams.set("regla", e.regla);
      else url.searchParams.delete("regla");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL no se comparte la vista, pero la lista cambia igual */
    }
  }, []);
  useEffect(() => escribir(estado), [escribir, estado]);
  useEffect(() => {
    const alAbrir = (ev: Event) => {
      const d = (ev as CustomEvent<{ param: string; clave: string }>).detail;
      if (d?.param === "seccion" && d.clave === clave) escribir(actual.current);
    };
    window.addEventListener(EVENTO_ACTIVA, alAbrir);
    return () => window.removeEventListener(EVENTO_ACTIVA, alAbrir);
  }, [clave, escribir]);
  const irAPagina = useCallback((page: number) => setEstado((e) => ({ ...e, page })), []);
  const elegirRegla = useCallback((regla: string) => setEstado({ page: 1, regla: regla || undefined }), []);
  return { ...estado, irAPagina, elegirRegla };
}

/** La lista con su paginador arriba y abajo (el de abajo sube al inicio de la lista) y, mientras llega otra página, atenuada. */
function ZonaLista({
  total,
  page,
  cargando,
  nombre,
  onPagina,
  filtro,
  vacio,
  children,
}: {
  total: number;
  page: number;
  cargando: boolean;
  nombre: string;
  onPagina: (n: number) => void;
  filtro?: ReactNode;
  /** Qué decir si no hay ninguna fila. */
  vacio: string;
  children: ReactNode;
}) {
  const paginas = Math.max(1, Math.ceil(total / TAM_PATRONES));
  const control = (subir: boolean) =>
    total > TAM_PATRONES ? (
      <Paginacion actual={page} paginas={paginas} total={total} tam={TAM_PATRONES} navegacion="interna" onChange={onPagina} cargando={cargando} nombre={nombre} subir={subir} />
    ) : null;
  return (
    <div data-paginado className={cn(MARGEN_LISTA, "space-y-3")}>
      {(filtro || total > TAM_PATRONES) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {filtro ?? <span aria-hidden />}
          {control(false)}
        </div>
      )}
      <div aria-busy={cargando} className={cn("transition-opacity duration-rapido", cargando && "opacity-60")}>
        {children ?? (
          <VacioEnLinea
            icono={<SearchX size={16} />}
            accion={
              page > 1 ? (
                <Button variant="secondary" onClick={() => onPagina(1)}>
                  Volver a la primera página
                </Button>
              ) : undefined
            }
          >
            {page > 1 ? "Esta página ya no tiene filas." : vacio}
          </VacioEnLinea>
        )}
      </div>
      {control(true)}
    </div>
  );
}

// ─── Piezas de fila ──────────────────────────────────────────────────────────────

/** El nombre de una empresa, enlazado a su ficha. Una persona natural (RUC 10) o un RUC tapado va sin enlace. */
function EnlaceEmpresa({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  const texto = nombre ? tituloNatural(nombre) : "Empresa sin nombre";
  if (!esRucEnClaro(ruc) || esRucPersonaNatural(ruc)) return <>{texto}</>;
  return (
    <Link href={`/empresa/${ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {texto}
    </Link>
  );
}

function EnlaceEntidad({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  const texto = nombre ? tituloNatural(nombre) : "Entidad sin nombre";
  if (!esRucEnClaro(ruc)) return <>{texto}</>;
  return (
    <Link href={`/entidad/${ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {texto}
    </Link>
  );
}

/** «12 de 31» con su porcentaje y su barra: qué parte es, escrita y dibujada. */
function CeldaParte({ con, de, parte, que }: { con: number; de: number; parte: number; que: string }) {
  const pct = porcentaje(parte * 100);
  return (
    <span className="block w-full min-w-0">
      <span className="flex items-baseline justify-between gap-2 text-meta tabular-nums">
        <span className="min-w-0 truncate text-ink">
          <b className="font-semibold">{numero(con)}</b> <span className="text-mute">de {numero(de)}</span>
        </span>
        <span className="shrink-0 font-mono text-rotulo text-inkSoft">{pct}</span>
      </span>
      <CeldaBarra parte={parte} tono="neutro" resumen={`${numero(con)} de ${numero(de)} ${que}, ${pct}`} className="mt-1" />
    </span>
  );
}

/** Hasta tres contratos de ejemplo, cada uno a su ficha, y cuántos más hay con la señal. */
function Ejemplos({ ocids, casos }: { ocids: string[]; casos: number }) {
  const vistos = ocids.slice(0, 3);
  const resto = Math.max(casos, ocids.length) - vistos.length;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-meta">
      {vistos.map((o) => (
        <Link key={o} href={`/app/contratos/${encodeURIComponent(o)}`} prefetch={false} title={`Abrir el contrato ${o}`} className={cn(CLASE_ENLACE_CELDA, "font-mono tabular-nums")}>
          {codigoDeOcid(o)}
        </Link>
      ))}
      {resto > 0 && (
        <span className="tabular-nums text-mute" title={`${plural(resto, "contrato más", "contratos más")} con esta señal`}>
          +{numero(resto)}
        </span>
      )}
    </span>
  );
}

/** «2021 a 2025», o un solo año. */
function periodo(desde: string | null, hasta: string | null): string | null {
  const a = desde?.slice(0, 4);
  const b = hasta?.slice(0, 4);
  if (!a && !b) return null;
  return a && b && a !== b ? `${a} a ${b}` : (a ?? b)!;
}

const SIN_DATO = <span className="font-sans text-mute">Sin dato</span>;

// ─── Por entidad y por proveedor ─────────────────────────────────────────────────

const columnasSenal = (alcance: AlcancePatron): Columna[] => [
  { clave: "quien", titulo: alcance === "entidad" ? "Entidad" : "Empresa", ancho: "minmax(0,1.5fr)" },
  { clave: "senal", titulo: "Señal que se repite", ancho: "minmax(0,1fr)", desde: "md", apilar: true, igual: { texto: "Todas con la señal: {}" } },
  {
    clave: "tasa",
    titulo: "Contratos leídos con la señal",
    ancho: "minmax(8.5rem,0.8fr)",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Con la señal",
    ayuda: (
      <Ayuda titulo="¿De cuántos contratos?">
        <span className="block">
          De los contratos que los agentes de Vigía ya <b>leyeron</b>, no de todos los publicados. Vigía lee primero lo más
          riesgoso, así que la parte real sobre todos sus contratos puede ser menor.
        </span>
      </Ayuda>
    ),
  },
  ...(alcance === "proveedor" ? [{ clave: "entidades", titulo: "Entidades", ancho: "5.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" } satisfies Columna] : []),
  {
    clave: "veces",
    titulo: "Frente al país",
    ancho: "7.5rem",
    alinear: "der",
    desde: "lg",
    apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Qué es «frente al país»?">
        <span className="block">Cuántas veces más aparece la señal aquí que en los contratos leídos de todo el país. Debajo va la parte del país.</span>
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "ejemplos", titulo: "Contratos de ejemplo", ancho: "minmax(0,1fr)", desde: "xl", apilar: true },
];

const CAMPO =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

function ListaSenales({ alcance, clave, inicial, etiquetas }: { alcance: AlcancePatron; clave: SeccionPatrones; inicial: InicialPatrones; etiquetas: Record<string, string> }) {
  const lista = useListaEnUrl(clave, inicial);
  const carga = usePoder<PatronesSenal>(rutaPatrones(alcance, lista.page, lista.regla));
  const columnas = useMemo(() => columnasSenal(alcance), [alcance]);
  const nombreRegla = useCallback((regla: string) => etiquetas[regla] ?? reglaLabel(regla), [etiquetas]);
  const esEntidad = alcance === "entidad";

  // Las opciones del filtro: las de la respuesta sin filtro. Con una señal elegida, la API puede devolver sólo esa, así
  // que se conservan las últimas completas que se vieron.
  const [opciones, setOpciones] = useState<PatronesSenal["porRegla"]>([]);
  const porRegla = carga.datos?.porRegla;
  useEffect(() => {
    if (porRegla && (!lista.regla || porRegla.length > 1)) setOpciones(porRegla);
  }, [porRegla, lista.regla]);
  const vistas = useMemo(() => {
    const base = opciones.length ? opciones : porRegla ?? [];
    const todas = lista.regla && !base.some((o) => o.regla === lista.regla) ? [...base, { regla: lista.regla, n: carga.datos?.total ?? 0 }] : base;
    return [...todas].sort((a, b) => b.n - a.n);
  }, [opciones, porRegla, lista.regla, carga.datos?.total]);
  const totalSinFiltro = opciones.reduce((s, o) => s + o.n, 0);

  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          esEntidad ? (
            <Ayuda titulo="¿Cuándo es un patrón de la entidad?">
              <span className="block">
                Cuando una señal de los agentes (un solo postor, una sola oferta válida, una oferta igual al valor referencial,
                requisitos dirigidos…) aparece en una parte de los contratos leídos de la entidad que es <b>el doble o más</b> que
                en el país.
              </span>
              <span className="mt-1.5 block">Se cuenta sobre los contratos que Vigía ya leyó, y Vigía lee primero lo más riesgoso.</span>
              <span className="mt-1.5 block">Un patrón es un motivo para mirar, no una acusación.</span>
            </Ayuda>
          ) : (
            <Ayuda titulo="¿Cuándo es un patrón de la empresa?">
              <span className="block">
                Cuando la misma señal de proceso aparece en <b>3 o más contratos</b> de una empresa, en <b>2 o más entidades</b>{" "}
                distintas.
              </span>
              <span className="mt-1.5 block">Un patrón es un motivo para mirar, no una acusación.</span>
            </Ayuda>
          )
        }
      >
        {esEntidad
          ? "Entidades donde una misma señal aparece el doble o más que en el resto del país."
          : "Empresas con la misma señal de proceso en varios contratos y en más de una entidad."}
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={columnas}>
        {(d) => {
          const filas = d.data ?? [];
          const mas = vistas[0];
          const cifras: Indicador[] = [
            {
              valor: numero(d.total),
              etiqueta: lista.regla ? "patrones con esta señal" : "patrones encontrados",
              contexto: esEntidad ? "una entidad con una señal que se le repite" : "una empresa con una señal que se le repite",
              icono: esEntidad ? <Building2 size={15} strokeWidth={1.9} aria-hidden /> : <Briefcase size={15} strokeWidth={1.9} aria-hidden />,
              parte: null,
            },
            { valor: numero(vistas.length), etiqueta: "señales distintas", contexto: "elige una en el filtro para ver sólo esa", parte: null },
            ...(mas ? [{ valor: numero(mas.n), etiqueta: "veces la más repetida", contexto: nombreRegla(mas.regla), parte: null } satisfies Indicador] : []),
          ];
          return (
            <div className="space-y-4">
              <Indicadores items={cifras} franja />
              <ZonaLista
                total={d.total}
                page={lista.page}
                cargando={carga.cargando}
                nombre="patrones"
                onPagina={lista.irAPagina}
                vacio={lista.regla ? "Ningún patrón con esta señal." : "Todavía no hay patrones calculados."}
                filtro={
                  vistas.length > 1 || lista.regla ? (
                    <label className="min-w-0 sm:w-80">
                      <span className="sr-only">Filtrar por señal</span>
                      <select className={CAMPO} value={lista.regla ?? ""} onChange={(e) => lista.elegirRegla(e.target.value)}>
                        <option value="">{totalSinFiltro > 0 ? `Todas las señales (${numero(totalSinFiltro)})` : "Todas las señales"}</option>
                        {vistas.map((o) => (
                          <option key={o.regla} value={o.regla}>{`${nombreRegla(o.regla)} (${numero(o.n)})`}</option>
                        ))}
                      </select>
                    </label>
                  ) : undefined
                }
              >
                {filas.length > 0 ? (
                  <Tabla
                    columnas={columnas}
                    filas={filas.map((p, i) => filaSenal(p, i, alcance, nombreRegla))}
                    etiqueta={esEntidad ? "Señales que se repiten, por entidad" : "Señales que se repiten, por empresa"}
                  />
                ) : null}
              </ZonaLista>
              {esEntidad && (
                <Nota>
                  Las partes se calculan sobre los contratos <b>leídos</b> por los agentes, no sobre todos los publicados. Vigía lee
                  primero lo más riesgoso: una entidad con pocos contratos leídos puede salir aquí con una parte alta que baje
                  cuando se lea el resto.
                </Nota>
              )}
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaSenal(p: PatronSenal, i: number, alcance: AlcancePatron, nombreRegla: (r: string) => string): Fila {
  const senal = nombreRegla(p.regla);
  const tasa = p.tasa ?? (p.leidos > 0 ? p.casos / p.leidos : 0);
  return {
    // Nunca el RUC en el DOM como id (un proveedor puede ser persona natural).
    id: `${alcance}-${i}`,
    detalle: detalleSenal(p, alcance, senal),
    enlaces: true,
    textos: {
      senal,
      veces: p.veces == null ? null : undefined,
      monto: p.monto == null ? null : undefined,
      ejemplos: p.ejemplos?.length ? undefined : null,
    },
    celdas: {
      quien: <CeldaPrincipal titulo={alcance === "entidad" ? <EnlaceEntidad ruc={p.ruc} nombre={p.nombre} /> : <EnlaceEmpresa ruc={p.ruc} nombre={p.nombre} />} dosLineas />,
      senal: <span className="min-w-0 text-meta font-medium text-ink">{senal}</span>,
      tasa: <CeldaParte con={p.casos} de={p.leidos} parte={tasa} que="contratos leídos con la señal" />,
      entidades: p.entidades != null ? <CeldaNumero>{numero(p.entidades)}</CeldaNumero> : undefined,
      veces:
        p.veces != null ? (
          <CeldaNumero sub={p.tasaPais != null ? `país: ${porcentaje(p.tasaPais * 100, { decimales: 1 })}` : undefined}>{`${decimal(p.veces)} veces`}</CeldaNumero>
        ) : undefined,
      monto: <CeldaNumero>{p.monto != null ? solesCompacto(p.monto) : SIN_DATO}</CeldaNumero>,
      ejemplos: p.ejemplos?.length ? <Ejemplos ocids={p.ejemplos} casos={p.casos} /> : undefined,
    },
  };
}

// ─── Postores de relleno ─────────────────────────────────────────────────────────

const COLUMNAS_RELLENO: Columna[] = [
  { clave: "acompanante", titulo: "Empresa que acompaña", ancho: "minmax(0,1.3fr)" },
  { clave: "ganador", titulo: "Junto al ganador", ancho: "minmax(0,1.1fr)", desde: "md", apilar: "con-rotulo", corto: "Junto a" },
  {
    clave: "parte",
    titulo: "De sus postulaciones",
    ancho: "minmax(8.5rem,0.8fr)",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Junto a ese ganador",
    ayuda: (
      <Ayuda titulo="¿Qué parte es?">
        <span className="block">De todas las veces que la empresa postuló, en cuántas lo hizo en un proceso donde también estaba ese ganador.</span>
      </Ayuda>
    ),
  },
  { clave: "gano", titulo: "Veces que ganó", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Ganó" },
  { clave: "entidades", titulo: "Entidades", ancho: "5.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "xl", apilar: "con-rotulo" },
];

function ListaRelleno({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("relleno", inicial);
  const carga = usePoder<PatronesAcompanantes>(rutaAcompanantes(lista.page));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es un postor de relleno?">
            <span className="block">
              Una empresa que casi nunca gana (1 de cada 10 veces o menos) y que dedica <b>60 % o más</b> de sus postulaciones a
              presentarse junto al mismo ganador, en procesos de 2 a 4 postores.
            </span>
            <span className="mt-1.5 block">
              Puede ser una oferta de cobertura: alguien postula sólo para que parezca que hubo competencia. Es más grave si las
              dos empresas comparten un socio.
            </span>
            <span className="mt-1.5 block">Un patrón es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      >
        Empresas que casi nunca ganan y postulan casi siempre al lado del mismo ganador.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS_RELLENO}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: "parejas de ganador y acompañante", contexto: "con el patrón completo", icono: <Users size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "60 % o más", etiqueta: "de sus postulaciones", contexto: "junto al mismo ganador", parte: null },
                  { valor: "1 de cada 10", etiqueta: "o menos, lo que gana", contexto: "la empresa que acompaña", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={lista.page} cargando={carga.cargando} nombre="parejas" onPagina={lista.irAPagina} vacio="Todavía no hay parejas con este patrón.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_RELLENO} filas={filas.map(filaRelleno)} etiqueta="Postores que acompañan siempre al mismo ganador" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaRelleno(p: PatronAcompanante, i: number): Fila {
  const anios = periodo(p.desde, p.hasta);
  return {
    id: `relleno-${i}`,
    detalle: detalleRelleno(p),
    enlaces: true,
    textos: { periodo: anios },
    celdas: {
      acompanante: (
        <CeldaPrincipal
          titulo={<EnlaceEmpresa ruc={p.rucAcompanante} nombre={p.acompanante} />}
          dosLineas
          meta={p.vinculo === "socio_comun" ? <Badge variant="amber">Comparten un socio</Badge> : undefined}
        />
      ),
      ganador: (
        <CeldaTexto>
          <EnlaceEmpresa ruc={p.rucGanador} nombre={p.ganador} />
        </CeldaTexto>
      ),
      parte: <CeldaParte con={p.juntos} de={p.postulacionesDelAcompanante} parte={p.parte} que="postulaciones junto a ese ganador" />,
      gano: <CeldaNumero sub={`de ${numero(p.postulacionesDelAcompanante)}`}>{p.ganadasDelAcompanante > 0 ? numero(p.ganadasDelAcompanante) : <span className="font-sans">Ninguna</span>}</CeldaNumero>,
      entidades: <CeldaNumero>{numero(p.entidades)}</CeldaNumero>,
      periodo: anios ? <CeldaTexto>{anios}</CeldaTexto> : undefined,
    },
  };
}

// ─── Socias que compiten ─────────────────────────────────────────────────────────

const COLUMNAS_CONSORCIOS: Columna[] = [
  { clave: "par", titulo: "Empresas", ancho: "minmax(0,1.6fr)" },
  { clave: "consorcios", titulo: "Consorcios juntas", ancho: "8rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Consorcios" },
  {
    clave: "rivales",
    titulo: "Procesos enfrentadas",
    ancho: "9.5rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Enfrentadas",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">Procesos de pocos postores en que las dos postularon por separado. Debajo, en cuántos fueron las únicas dos.</span>
      </Ayuda>
    ),
  },
  { clave: "gano", titulo: "Quién ganó", ancho: "minmax(0,0.8fr)", desde: "lg", apilar: "con-rotulo", corto: "Ganó" },
  { clave: "entidades", titulo: "Entidades", ancho: "5.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "xl", apilar: "con-rotulo" },
];

function ListaConsorcios({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("consorcios", inicial);
  const carga = usePoder<PatronesConsorcios>(rutaConsorcios(lista.page));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué mirar a dos socias que compiten?">
            <span className="block">
              Son dos empresas que postularon juntas en un consorcio y después, por separado, se enfrentan en <b>3 o más procesos</b>{" "}
              de pocos postores que gana una sola de ellas.
            </span>
            <span className="mt-1.5 block">
              Si coinciden en más de 20 entidades (las aseguradoras, por ejemplo) es la forma de ese mercado: van marcadas como
              «Mercado nacional», al final, y no dan bandera.
            </span>
            <span className="mt-1.5 block">Un patrón es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      >
        Empresas que fueron socias en un consorcio y luego compiten entre sí en procesos de pocos postores.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS_CONSORCIOS}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: "pares de empresas", contexto: "socias en un consorcio y rivales después", icono: <Handshake size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "3 o más", etiqueta: "procesos enfrentadas", contexto: "de pocos postores, y gana una sola", parte: null },
                  { valor: "Más de 20", etiqueta: "entidades en común", contexto: "es mercado nacional: va al final, sin bandera", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={lista.page} cargando={carga.cargando} nombre="pares" onPagina={lista.irAPagina} vacio="Todavía no hay pares con este patrón.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_CONSORCIOS} filas={filas.map(filaConsorcio)} etiqueta="Socias de consorcio que después compiten" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaConsorcio(p: PatronConsorcio, i: number): Fila {
  const anios = periodo(p.desde, p.hasta);
  return {
    id: `consorcio-${i}`,
    detalle: detalleConsorcio(p),
    enlaces: true,
    textos: { periodo: anios },
    celdas: {
      par: (
        <CeldaPrincipal
          dosLineas
          titulo={
            <>
              <EnlaceEmpresa ruc={p.rucA} nombre={p.nombreA} /> <span className="font-normal text-mute">y</span> <EnlaceEmpresa ruc={p.rucB} nombre={p.nombreB} />
            </>
          }
          meta={p.mercadoNacional ? <Badge variant="neutral">Mercado nacional, no da bandera</Badge> : undefined}
        />
      ),
      consorcios: <CeldaNumero>{numero(p.consorcios)}</CeldaNumero>,
      rivales: <CeldaNumero sub={p.solas > 0 ? `solas las dos en ${numero(p.solas)}` : undefined}>{numero(p.rivales)}</CeldaNumero>,
      gano: <CeldaTexto sub={`${plural(p.ganoB, "vez", "veces")} la segunda`}>{`${plural(p.ganoA, "vez", "veces")} la primera`}</CeldaTexto>,
      entidades: <CeldaNumero>{numero(p.entidades)}</CeldaNumero>,
      periodo: anios ? <CeldaTexto>{anios}</CeldaTexto> : undefined,
    },
  };
}

// ─── Mismo dueño ─────────────────────────────────────────────────────────────────

const COLUMNAS_DUENOS: Columna[] = [
  { clave: "grupo", titulo: "Entidad y empresas", ancho: "minmax(0,1.8fr)" },
  { clave: "socio", titulo: "Socio en común", ancho: "minmax(0,1.1fr)", desde: "lg", apilar: "con-rotulo", corto: "Socio" },
  {
    clave: "contratos",
    titulo: "Contratos parecidos",
    ancho: "9rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Parecidos",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Contratos de una empresa que tienen, en la misma entidad, otro de objeto parecido ganado por una empresa del mismo socio. Debajo,
          cuántos están a 90 días o menos del otro.
        </span>
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "ejemplos", titulo: "Contratos de ejemplo", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: "con-rotulo", corto: "Ejemplos" },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "xl", apilar: "con-rotulo" },
];

function ListaDuenos({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("duenos", inicial);
  // El filtro por RUC (de la entidad o de una de las empresas) es de la vista: no viaja a la URL.
  const [ruc, setRuc] = useState("");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  // Sólo los grupos con contratos a 90 días o menos entre sí. Como el RUC, es de la vista y vuelve a la primera página.
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesDuenos>(rutaDuenos(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué mirar a un dueño con varias empresas?">
            <span className="block">
              La concentración de un proveedor se mide por su RUC. Si una persona le vende lo mismo a una entidad con dos empresas, ninguna
              parece dominante y cada compra queda bajo el tope que obligaría a un procedimiento con más competencia.
            </span>
            <span className="mt-1.5 block">
              Sólo cuenta a socios (no a directores ni representantes) de 2 a 6 empresas, según el Registro Nacional de Proveedores, y
              procesos de objeto parecido desde 2023.
            </span>
            <span className="mt-1.5 block">Un grupo familiar puede tener dos empresas legítimas. Un patrón es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      >
        Un socio que gana en la misma entidad, con dos o más empresas, procesos de objeto parecido.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la entidad o de una empresa</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo los graves: contratos parecidos a 90 días o menos entre sí
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_DUENOS}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "grupos con ese RUC" : graves ? "grupos graves" : "grupos de entidad y socio", contexto: "dos o más empresas del mismo socio", icono: <UsersRound size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "90 días", etiqueta: "o menos entre dos contratos", contexto: "es la forma grave: una compra repartida", parte: null },
                  { valor: "2 a 6", etiqueta: "empresas por socio", contexto: "quien figura en decenas no es el dueño", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="grupos" onPagina={lista.irAPagina} vacio="No hay grupos con este patrón para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_DUENOS} filas={filas.map(filaDueno)} etiqueta="Socios que ganan en una entidad con varias empresas" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaDueno(p: PatronDueno, i: number): Fila {
  const anios = periodo(p.desde, p.hasta);
  const empresas = p.empresas ?? [];
  return {
    id: `dueno-${i}`,
    detalle: detalleDueno(p),
    enlaces: true,
    textos: { periodo: anios },
    celdas: {
      grupo: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />}
          meta={
            <span className="block">
              {/* recorte: cuatro empresas caben en la celda; las demás se cuentan a continuación */}
              {empresas.slice(0, 4).map((e, k) => (
                <span key={e.ruc}>
                  {k > 0 ? ", " : ""}
                  <EnlaceEmpresa ruc={e.ruc} nombre={e.nombre} />
                </span>
              ))}
              {empresas.length > 4 ? ` y ${empresas.length - 4} más` : ""}
            </span>
          }
        />
      ),
      // El nombre entero, en las líneas que haga falta: cortado no dice quién es.
      socio: <span className="block min-w-0 whitespace-normal break-words text-dato leading-snug text-inkSoft">{p.socios?.[0]?.nombre ?? "Sin nombre publicado"}</span>,
      contratos: <CeldaNumero sub={p.seguidos > 0 ? `${numero(p.seguidos)} a 90 días o menos` : undefined}>{numero(p.contratos)}</CeldaNumero>,
      monto: <CeldaNumero>{p.monto != null ? solesCompacto(p.monto) : "Sin dato"}</CeldaNumero>,
      ejemplos: (
        <CeldaTexto>
          {(p.ejemplos ?? []).map((o, k) => (
            <span key={o}>
              {k > 0 ? ", " : ""}
              <Link href={`/app/contratos/${encodeURIComponent(o)}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {codigoDeOcid(o)}
              </Link>
            </span>
          ))}
        </CeldaTexto>
      ),
      periodo: anios ? <CeldaTexto>{anios}</CeldaTexto> : undefined,
    },
  };
}

// ─── Grupos por dueño y familia (órdenes de una entidad) ─────────────────────────

const COLUMNAS_GRUPOS: Columna[] = [
  { clave: "grupo", titulo: "Entidad e integrantes", ancho: "minmax(0,1.8fr)" },
  {
    clave: "monto",
    titulo: "Órdenes del grupo",
    ancho: "9rem",
    alinear: "der",
    corto: "Órdenes",
    ayuda: (
      <Ayuda titulo="¿Qué suma?">
        <span className="block">Las órdenes de compra y de servicio que la entidad les emitió a los integrantes desde 2018, sumadas como si fueran un solo proveedor.</span>
      </Ayuda>
    ),
  },
  { clave: "borde", titulo: "Al borde del tope", ancho: "9rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Al borde" },
  {
    clave: "juntos",
    titulo: "Juntos el mismo día",
    ancho: "9.5rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Mismo día",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Días en que la entidad le emitió órdenes a dos o más integrantes. Debajo, los pares de órdenes con números correlativos (tres o menos de diferencia):
          suelen salir del mismo lote de requerimientos.
        </span>
      </Ayuda>
    ),
  },
  { clave: "repartidos", titulo: "Objeto repartido", ancho: "8.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Repartido" },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "xl", apilar: "con-rotulo" },
];

function ListaGrupos({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("grupos", inicial);
  const [ruc, setRuc] = useState(inicial.ruc ?? "");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesGrupos>(rutaGrupos(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Cómo se arma un grupo?">
            <span className="block">
              Con los proveedores de una misma entidad unidos por un socio o representante común (Registro Nacional de Proveedores), por una persona que
              vende con su RUC y es socia de una empresa del grupo, o por socios con los mismos dos apellidos poco comunes.
            </span>
            <span className="mt-1.5 block">
              El parentesco por apellidos es probable, no comprobado: los registros no lo traen. Cada integrante, solo, puede parecer pequeño; juntos se suman.
            </span>
            <span className="mt-1.5 block">Un grupo familiar puede tener negocios legítimos. Un patrón es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      >
        Empresas y personas del mismo dueño o de una misma familia que le venden a la misma entidad por órdenes, y lo que hicieron juntas.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la entidad o de una empresa</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo los graves: órdenes correlativas u objeto repartido, con muchas al borde del tope
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_GRUPOS}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "grupos con ese RUC" : graves ? "grupos graves" : "grupos de entidad", contexto: "de 2 a 25 integrantes, S/ 50 mil o más", icono: <UsersRound size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "8 UIT", etiqueta: "el tope de una orden", contexto: "por encima hay que convocar un proceso", parte: null },
                  { valor: "3", etiqueta: "o menos entre dos números de orden", contexto: "cuenta como correlativa", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="grupos" onPagina={lista.irAPagina} vacio="No hay grupos para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_GRUPOS} filas={filas.map(filaGrupo)} etiqueta="Grupos de proveedores por dueño y familia en una entidad" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaGrupo(p: PatronGrupo, i: number): Fila {
  const anios = periodo(p.desde, p.hasta);
  const integrantes = p.miembros ?? [];
  return {
    id: `grupo-${i}`,
    detalle: detalleGrupo(p),
    enlaces: true,
    textos: { periodo: anios },
    celdas: {
      grupo: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />}
          meta={
            <span className="block">
              {/* recorte: cuatro integrantes caben en la celda; los demás se cuentan a continuación */}
              {integrantes.slice(0, 4).map((m, k) => (
                <span key={m.ruc}>
                  {k > 0 ? ", " : ""}
                  {m.persona ? <span>{m.nombre ? tituloNatural(m.nombre) : "Persona natural"}</span> : <EnlaceEmpresa ruc={m.ruc} nombre={m.nombre} />}
                </span>
              ))}
              {integrantes.length > 4 ? ` y ${integrantes.length - 4} más` : ""}
            </span>
          }
        />
      ),
      monto: (
        <CeldaNumero
          sub={[
            p.puestoGrupo && p.puestoMayor && p.puestoGrupo < p.puestoMayor ? `juntos, n.° ${numero(p.puestoGrupo)} de la entidad` : plural(p.ordenes, "orden", "órdenes"),
            p.parteEntidad != null && p.parteEntidad >= 0.5 ? `${porcentaje(p.parteEntidad * 100)} de sus ventas` : null,
          ].filter(Boolean).join("; ")}
        >
          {solesCompacto(p.monto)}
        </CeldaNumero>
      ),
      borde: <CeldaNumero sub={p.sobreTope ? `${numero(p.sobreTope)} por encima` : undefined}>{p.hasta8Uit ? `${numero(p.borde)} de ${numero(p.hasta8Uit)}` : "Ninguna"}</CeldaNumero>,
      juntos: <CeldaNumero sub={p.correlativas ? plural(p.correlativas, "par correlativo", "pares correlativos") : undefined}>{p.diasJuntos ? plural(p.diasJuntos, "día", "días") : "Ninguno"}</CeldaNumero>,
      repartidos: <CeldaNumero sub={p.repartidos ? solesCompacto(p.montoRepartido) : undefined}>{p.repartidos ? numero(p.repartidos) : "Ninguno"}</CeldaNumero>,
      periodo: anios ? <CeldaTexto>{anios}</CeldaTexto> : undefined,
    },
  };
}

// ─── La misma compra repetida en semanas (órdenes directas) ──────────────────────

const COLUMNAS_REPETIDAS: Columna[] = [
  { clave: "compra", titulo: "Entidad, proveedor y objeto", ancho: "minmax(0,1.8fr)" },
  {
    clave: "ordenes",
    titulo: "Órdenes iguales",
    ancho: "9rem",
    alinear: "der",
    corto: "Órdenes",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Órdenes de compra directas al mismo proveedor, por el mismo monto y con la misma descripción. Arriba, el monto de cada una; debajo, cuántas son.
        </span>
      </Ayuda>
    ),
  },
  { clave: "total", titulo: "Juntas, frente al tope", ancho: "9.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Juntas" },
  { clave: "dias", titulo: "Días entre ellas", ancho: "9rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Días" },
  { clave: "estado", titulo: "Devengadas", ancho: "7.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
];

function ListaRepetidas({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("repetidas", inicial);
  const [ruc, setRuc] = useState(inicial.ruc ?? "");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesRepetidas>(rutaRepetidas(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué puede ser?">
            <span className="block">
              Un fraccionamiento en el tiempo: una necesidad partida en órdenes que, cada una, queda por debajo del tope de 8 UIT, y que juntas lo pasan.
            </span>
            <span className="mt-1.5 block">
              Una orden registrada dos veces: si las dos llegaron a devengarse, pregunta si se pagó dos veces.
            </span>
            <span className="mt-1.5 block">
              Un suministro periódico legítimo (el mismo producto cada mes). El requerimiento lo dice. Cuenta cada número de orden una vez por entidad y año.
            </span>
          </Ayuda>
        }
      >
        La misma compra, al mismo proveedor y por el mismo monto, en varias órdenes directas de 7 a 90 días entre la primera y la última.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la entidad o de una empresa</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo los graves: juntas pasan el tope y cada una queda al borde
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_REPETIDAS}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "compras con ese RUC" : graves ? "compras graves" : "compras repetidas", contexto: "desde enero de hace dos años, S/ 5 mil o más", icono: <CopyCheck size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "8 UIT", etiqueta: "el tope de una orden", contexto: "por encima hay que convocar un proceso", parte: null },
                  { valor: "7 a 90", etiqueta: "días entre la primera y la última", contexto: "el mismo día ya lo cubre el fraccionamiento", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="compras" onPagina={lista.irAPagina} vacio="No hay compras repetidas para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_REPETIDAS} filas={filas.map(filaRepetida)} etiqueta="La misma compra repetida en pocas semanas" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaRepetida(p: PatronRepetida, i: number): Fila {
  const pasa = p.total > p.tope;
  return {
    id: `repetida-${i}`,
    detalle: detalleRepetida(p),
    enlaces: true,
    celdas: {
      compra: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />}
          meta={
            <span className="block">
              {esRucEnClaro(p.ruc) && !esRucPersonaNatural(p.ruc) ? <EnlaceEmpresa ruc={p.ruc} nombre={p.nombre} /> : <span>{p.nombre ? tituloNatural(p.nombre) : "Persona natural"}</span>}
              {p.objeto ? <span className="text-mute">: {oracion(p.objeto.toLowerCase())}</span> : null}
            </span>
          }
        />
      ),
      ordenes: <CeldaNumero sub={plural(p.ordenes, "orden", "órdenes")}>{solesCompacto(p.monto)}</CeldaNumero>,
      total: <CeldaNumero sub={pasa ? `pasa el tope de ${solesCompacto(p.tope)}` : `tope ${solesCompacto(p.tope)}`}>{solesCompacto(p.total)}</CeldaNumero>,
      dias: <CeldaNumero sub={fechaConAnio(p.desde)}>{plural(p.dias, "día", "días")}</CeldaNumero>,
      estado: <CeldaNumero>{p.devengadas === p.ordenes ? "Todas" : `${numero(p.devengadas)} de ${numero(p.ordenes)}`}</CeldaNumero>,
    },
  };
}

// ─── Dos ingresos del Estado: planilla y órdenes de servicio de otra entidad ─────

const COLUMNAS_DOBLE: Columna[] = [
  { clave: "persona", titulo: "Persona y su planilla", ancho: "minmax(0,1.6fr)" },
  { clave: "otra", titulo: "Le emitió órdenes de servicio", ancho: "minmax(0,1.2fr)", desde: "md", apilar: "con-rotulo", corto: "Órdenes de" },
  {
    clave: "meses",
    titulo: "Meses que coinciden",
    ancho: "8.5rem",
    alinear: "der",
    corto: "Meses",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">Los meses en que figura en la planilla de su entidad y, ese mismo mes, la otra entidad le emitió al menos una orden de servicio.</span>
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Cobró por esas órdenes", ancho: "9rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Órdenes" },
  { clave: "sueldo", titulo: "Sueldo al mes", ancho: "7.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Sueldo" },
];

const COLUMNAS_COMPRAS_FAMILIA: Columna[] = [
  { clave: "persona", titulo: "Persona, puesto y entidad", ancho: "minmax(0,1.7fr)" },
  { clave: "familiar", titulo: "Familiar que declaró", ancho: "minmax(8rem,0.8fr)", desde: "md", apilar: "con-rotulo", corto: "Familiar" },
  { clave: "monto", titulo: "Órdenes al familiar", ancho: "9rem", alinear: "der", corto: "Órdenes" },
  { clave: "anios", titulo: "Años", ancho: "minmax(8rem,0.7fr)", desde: "lg", apilar: "con-rotulo" },
];

function ListaComprasFamilia({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("compras", inicial);
  const [ruc, setRuc] = useState(inicial.ruc ?? "");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesComprasFamilia>(rutaComprasFamilia(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿De dónde sale y por qué importa?">
            <span className="block">
              El puesto y el familiar salen de la declaración jurada de intereses de la propia persona: ahí escribe dónde trabaja y con qué cargo, y
              declara a sus familiares. Las órdenes, del registro de órdenes de la entidad, a nombre del familiar.
            </span>
            <span className="mt-1.5 block">
              La ley impide contratar con la entidad al cónyuge, conviviente y parientes hasta el segundo grado de quien interviene en sus
              contrataciones (artículo 11 del TUO de la Ley 30225; artículo 30 de la Ley 32069).
            </span>
            <span className="mt-1.5 block">
              Es una señal en observación: dice que el puesto, el parentesco y las órdenes coinciden en la misma entidad, no que la persona
              intervino. El familiar nunca sale con su nombre.
            </span>
          </Ayuda>
        }
      >
        En observación: personas cuyo puesto declarado es de compras, logística o contrataciones, con un familiar que declararon y que recibió órdenes
        a su nombre de esa misma entidad.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la entidad</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo familiar cercano con órdenes que empezaron o siguieron después de asumir el puesto
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_COMPRAS_FAMILIA}>
        {(d) => {
          const filas = d.data ?? [];
          const alta = d.resumen?.alta;
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "casos en esa entidad" : graves ? "casos graves" : "casos", contexto: "puesto de compras y familiar con órdenes", icono: <ShoppingCart size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: numero(alta?.personas ?? 0), etiqueta: "personas con un caso grave", contexto: alta ? `en ${plural(alta.entidades, "entidad", "entidades")}` : "familiar cercano y fechas que coinciden", parte: null },
                  { valor: alta ? solesCompacto(alta.monto) : "S/ 0", etiqueta: "en órdenes a esos familiares", contexto: "sólo los casos graves", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="casos" onPagina={lista.irAPagina} vacio="No hay casos para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_COMPRAS_FAMILIA} filas={filas.map(filaCompraFamilia)} etiqueta="Personas con puesto de compras y un familiar con órdenes de su entidad" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaCompraFamilia(p: PatronCompraFamilia, i: number): Fila {
  const anios = p.desde && p.hasta ? (p.desde === p.hasta ? `${p.desde}` : `${p.desde} a ${p.hasta}`) : "Sin años";
  return {
    id: `compras-${i}`,
    detalle: detalleCompraFamilia(p),
    enlaces: true,
    celdas: {
      persona: (
        <CeldaPrincipal
          dosLineas
          titulo={
            p.codigo ? (
              <Link href={`/app/personas/cargo/${p.codigo}?seccion=revision`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {p.persona ?? "Persona con cargo público"}
              </Link>
            ) : (
              <>{p.persona ?? "Persona con cargo público"}</>
            )
          }
          meta={
            <span className="block">
              {`${tituloNatural(p.cargo)}, `}
              <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
            </span>
          }
        />
      ),
      familiar: <CeldaTexto sub={p.cercano ? "familiar cercano" : undefined}>{p.parentesco}</CeldaTexto>,
      monto: <CeldaNumero sub={plural(p.ordenes, "orden", "órdenes")}>{solesCompacto(p.monto)}</CeldaNumero>,
      anios: (
        <CeldaTexto sub={p.empezoDespues ? "empezaron tras asumir el puesto" : p.coincide ? "coinciden con el puesto" : "no coinciden"}>{anios}</CeldaTexto>
      ),
    },
  };
}

function ListaDoble({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("doble", inicial);
  const [ruc, setRuc] = useState(inicial.ruc ?? "");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesDoble>(rutaDoble(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué importa?">
            <span className="block">
              Ningún empleado público puede percibir del Estado más de una remuneración o retribución, salvo por la docencia y por las dietas de un
              directorio (artículo 40 de la Constitución; artículo 3 de la Ley 28175). Una orden de servicio es una retribución.
            </span>
            <span className="mt-1.5 block">
              La planilla no trae documento: Vigía une a la persona por su nombre completo, y sólo si un único RUC lo lleva en todo el registro de
              órdenes. Un homónimo exacto saldría aquí: confirma que es la misma persona.
            </span>
          </Ayuda>
        }
      >
        Personas que figuran en la planilla de una entidad y que, en esos mismos meses, recibieron órdenes de servicio de otra entidad.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de una de las dos entidades</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo los de 6 meses o más, sin docencia
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_DOBLE}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "casos con ese RUC" : graves ? "casos de 6 meses o más" : "casos", contexto: "3 meses o más y S/ 5 mil o más, desde 2023", icono: <Coins size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "1", etiqueta: "ingreso del Estado por persona", contexto: "lo que permite la ley", parte: null },
                  { valor: "2", etiqueta: "excepciones", contexto: "la docencia y las dietas de un directorio", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="casos" onPagina={lista.irAPagina} vacio="No hay casos para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_DOBLE} filas={filas.map(filaDoble)} etiqueta="Personas en planilla con órdenes de servicio de otra entidad" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaDoble(p: PatronDoble, i: number): Fila {
  return {
    id: `doble-${i}`,
    detalle: detalleDoble(p),
    enlaces: true,
    celdas: {
      persona: (
        <CeldaPrincipal
          dosLineas
          titulo={
            p.codigo ? (
              <Link href={`/app/personas/cargo/${p.codigo}?seccion=revision`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {p.persona ?? "Persona de planilla"}
              </Link>
            ) : (
              <>{p.persona ?? "Persona de planilla"}</>
            )
          }
          meta={
            <span className="block">
              {p.cargo ? `${tituloNatural(p.cargo)}, ` : ""}
              <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
            </span>
          }
        />
      ),
      otra: (
        <CeldaTexto>
          <EnlaceEntidad ruc={p.otraRuc} nombre={p.otra} />
        </CeldaTexto>
      ),
      meses: <CeldaNumero sub={p.docente ? "docencia: excepción" : undefined}>{plural(p.meses, "mes", "meses")}</CeldaNumero>,
      monto: <CeldaNumero sub={plural(p.ordenes, "orden", "órdenes")}>{solesCompacto(p.monto)}</CeldaNumero>,
      sueldo: <CeldaNumero>{p.sueldo ? solesCompacto(p.sueldo) : "Sin dato"}</CeldaNumero>,
    },
  };
}

// ─── Empresas recién creadas con órdenes directas ────────────────────────────────

const COLUMNAS_RECIEN: Columna[] = [
  { clave: "empresa", titulo: "Empresa y entidad", ancho: "minmax(0,1.7fr)" },
  {
    clave: "dias",
    titulo: "Del alta a su primera orden",
    ancho: "10rem",
    alinear: "der",
    corto: "Días",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">Los días entre su inscripción en la SUNAT y la primera orden directa (sin proceso de selección) que le emitió la entidad.</span>
      </Ayuda>
    ),
  },
  { clave: "primer", titulo: "En su primer año", ancho: "9rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Primer año" },
  { clave: "parte", titulo: "De sus ventas, de esta entidad", ancho: "9.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "De la entidad" },
];

function ListaRecien({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("recien", inicial);
  const [ruc, setRuc] = useState(inicial.ruc ?? "");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesRecien>(rutaRecien(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué mirar a una empresa nueva?">
            <span className="block">
              Una empresa que se inscribe y a los pocos días ya recibe órdenes sin proceso de selección puede haberse creado para esa compra. Sin consorcios:
              esos nacen con su RUC al ganar un proceso.
            </span>
            <span className="mt-1.5 block">
              También puede ser un negocio que ya existía con otro RUC (una persona que pasa a ser E.I.R.L.). Mira quién la creó y quién pidió la compra.
            </span>
          </Ayuda>
        }
      >
        Empresas que se inscribieron en la SUNAT y a 90 días o menos ya recibían órdenes directas de una entidad, con S/ 30 mil o más en su primer año.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la entidad o de la empresa</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo las graves: a 30 días o menos, S/ 100 mil o más y casi todo lo que vende es a esa entidad
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_RECIEN}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "casos con ese RUC" : graves ? "casos graves" : "casos", contexto: "empresas con alta desde 2019, sin consorcios", icono: <Sprout size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "90", etiqueta: "días o menos del alta a la primera orden", contexto: "30 o menos, entre lo grave", parte: null },
                  { valor: "S/ 30 mil", etiqueta: "o más en su primer año", contexto: "en órdenes sin proceso de selección", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="casos" onPagina={lista.irAPagina} vacio="No hay casos para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_RECIEN} filas={filas.map(filaRecien)} etiqueta="Empresas recién creadas que reciben órdenes directas" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaRecien(p: PatronRecien, i: number): Fila {
  return {
    id: `recien-${i}`,
    detalle: detalleRecien(p),
    enlaces: true,
    celdas: {
      empresa: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEmpresa ruc={p.ruc} nombre={p.nombre} />}
          meta={
            <span className="block">
              <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
            </span>
          }
        />
      ),
      dias: <CeldaNumero sub={`alta: ${fechaConAnio(p.fechaAlta)}`}>{plural(p.dias, "día", "días")}</CeldaNumero>,
      primer: <CeldaNumero sub={plural(p.ordenesPrimerAnio, "orden", "órdenes")}>{solesCompacto(p.montoPrimerAnio)}</CeldaNumero>,
      parte: <CeldaNumero>{p.parteEntidad != null ? porcentaje(p.parteEntidad * 100) : "Sin dato"}</CeldaNumero>,
    },
  };
}

// ─── Socio de inhabilitada ───────────────────────────────────────────────────────

const COLUMNAS_INHABILITADAS: Columna[] = [
  { clave: "gana", titulo: "Empresa que gana y socio", ancho: "minmax(0,1.5fr)" },
  { clave: "sancionada", titulo: "Empresa inhabilitada del mismo socio", ancho: "minmax(0,1.4fr)", desde: "md", apilar: "con-rotulo", corto: "Inhabilitada" },
  {
    clave: "contratos",
    titulo: "Ganados en la sanción",
    ancho: "9rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Ganados",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Procesos con buena pro para esta empresa, sola o en consorcio, entre el inicio y el fin de la inhabilitación de la otra. Debajo,
          los graves: la sanción es definitiva, o la empresa se fundó o el socio entró a ella desde seis meses antes de la sanción.
        </span>
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto de los procesos", ancho: "8rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Monto" },
  { clave: "ejemplos", titulo: "Contratos de ejemplo", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: "con-rotulo", corto: "Ejemplos" },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "xl", apilar: "con-rotulo" },
];

function ListaInhabilitadas({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("inhabilitadas", inicial);
  // El filtro por RUC (la ganadora, la inhabilitada o la entidad) y el de graves son de la vista: no viajan a la URL.
  const [ruc, setRuc] = useState("");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const filtrada = !!rucValido || graves;
  const carga = usePoder<PatronesInhabilitadas>(rutaInhabilitadas(filtrada ? 1 : lista.page, rucValido, graves));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué mirar al socio de una inhabilitada?">
            <span className="block">
              Inhabilitar a una empresa no sirve si sus dueños siguen vendiendo con otra razón social. Por eso la ley impide contratar a la
              empresa del mismo rubro cuyos socios con más de 30 % del capital formaron parte de una inhabilitada, mientras dure la sanción
              (artículo 30 de la Ley 32069, impedimento 3.E; antes, artículo 11 de la Ley 30225).
            </span>
            <span className="mt-1.5 block">
              Cruza los sancionados de la OECE con los socios del Registro Nacional de Proveedores y las buenas pro desde 2018. Sólo cuenta a
              socios (no a directores ni representantes) que ya figuraban en la inhabilitada al empezar la sanción.
            </span>
            <span className="mt-1.5 block">
              El registro no dice el porcentaje del socio ni si las dos empresas son del mismo rubro: hay que confirmarlo. Un patrón es un
              motivo para mirar, no una acusación.
            </span>
          </Ayuda>
        }
      >
        Empresas que ganaron buenas pro mientras otra empresa del mismo socio estaba inhabilitada para contratar con el Estado.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de una empresa o de la entidad</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
        <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
        Sólo los graves: sanción definitiva o empresa hecha cerca de la sanción
      </label>
      <EstadoCarga carga={carga} columnas={COLUMNAS_INHABILITADAS}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: rucValido ? "casos con ese RUC" : graves ? "casos graves" : "pares de empresa e inhabilitada", contexto: "con el mismo socio", icono: <Ban size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "30 %", etiqueta: "del capital, o más", contexto: "es lo que la ley exige del socio: falta confirmarlo", parte: null },
                  { valor: "6 meses", etiqueta: "antes de la sanción, o después", contexto: "si la empresa nació ahí, es grave", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="casos" onPagina={lista.irAPagina} vacio="No hay casos con este patrón para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_INHABILITADAS} filas={filas.map(filaInhabilitada)} etiqueta="Empresas que ganan mientras otra del mismo socio está inhabilitada" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaInhabilitada(p: PatronInhabilitada, i: number): Fila {
  const anios = periodo(p.desde, p.hasta);
  const clase = p.sancion === "definitivo" ? "Inhabilitación definitiva" : "Inhabilitación temporal";
  const rango = p.sancionDesde
    ? p.sancionHasta
      ? `del ${fechaConAnio(p.sancionDesde)} al ${fechaConAnio(p.sancionHasta)}`
      : `desde el ${fechaConAnio(p.sancionDesde)}`
    : null;
  // La fecha de fundación sólo se dice cuando es el motivo: la empresa nació desde seis meses antes de la sanción.
  const nacioCerca =
    !!p.fundada && !!p.sancionDesde && new Date(`${p.fundada}T12:00:00Z`).getTime() >= new Date(`${p.sancionDesde}T12:00:00Z`).getTime() - 180 * 86_400_000;
  return {
    id: `inhabilitada-${i}`,
    detalle: detalleInhabilitada(p),
    enlaces: true,
    textos: { periodo: anios },
    celdas: {
      gana: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEmpresa ruc={p.ruc} nombre={p.empresa} />}
          meta={<span className="block">{p.socios?.[0]?.nombre ?? "Socio sin nombre publicado"}</span>}
        />
      ),
      sancionada: (
        <span className="block min-w-0 whitespace-normal break-words text-dato leading-snug text-inkSoft">
          {p.sancionadaRuc ? <EnlaceEmpresa ruc={p.sancionadaRuc} nombre={p.sancionada} /> : (p.sancionada ?? "Sin nombre")}
          <span className="mt-0.5 block text-rotulo text-mute">
            {clase}
            {rango ? `, ${rango}` : ""}
          </span>
          {nacioCerca ? <span className="mt-0.5 block text-rotulo text-inkSoft">La empresa que gana se fundó el {fechaConAnio(p.fundada!)}</span> : null}
        </span>
      ),
      contratos: <CeldaNumero sub={p.graves > 0 ? `${numero(p.graves)} ${p.graves === 1 ? "grave" : "graves"}` : undefined}>{numero(p.contratos)}</CeldaNumero>,
      monto: <CeldaNumero>{p.monto != null ? solesCompacto(p.monto) : "Sin dato"}</CeldaNumero>,
      ejemplos: (
        <CeldaTexto>
          {(p.ejemplos ?? []).map((o, k) => (
            <span key={o}>
              {k > 0 ? ", " : ""}
              <Link href={`/app/contratos/${encodeURIComponent(o)}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {codigoDeOcid(o)}
              </Link>
            </span>
          ))}
        </CeldaTexto>
      ),
      periodo: anios ? <CeldaTexto>{anios}</CeldaTexto> : undefined,
    },
  };
}

// ─── Socio en informe de control ─────────────────────────────────────────────────

const COLUMNAS_CONTROL: Columna[] = [
  { clave: "gana", titulo: "Empresa que gana y persona", ancho: "minmax(0,1.4fr)" },
  { clave: "informe", titulo: "Informe de control anterior", ancho: "minmax(0,1.5fr)", desde: "md", apilar: "con-rotulo", corto: "Informe" },
  {
    clave: "contratos",
    titulo: "Ganados después",
    ancho: "8.5rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Ganados",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Procesos con buena pro para esta empresa, sola o en consorcio, después de emitido el informe. Debajo, los graves: la
          responsabilidad presunta es penal y el informe es de la misma entidad que contrató o de los dos años anteriores.
        </span>
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto de los procesos", ancho: "8rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Monto" },
  { clave: "ejemplos", titulo: "Contratos de ejemplo", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: "con-rotulo", corto: "Ejemplos" },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "xl", apilar: "con-rotulo" },
];

const RESPONSABILIDAD_CORTA: Record<string, string> = {
  penal: "penal", civil: "civil", administrativa_entidad: "administrativa", administrativa_pas: "sanción administrativa", administrativa: "administrativa",
};

function ListaControl({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("control", inicial);
  // Los filtros (RUC, graves, misma entidad) son de la vista: no viajan a la URL y vuelven a la primera página.
  const [ruc, setRuc] = useState("");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const [misma, setMisma] = useState(false);
  const filtrada = !!rucValido || graves || misma;
  const carga = usePoder<PatronesControl>(rutaControl(filtrada ? 1 : lista.page, rucValido, graves, misma));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué mirar al socio con un informe de control?">
            <span className="block">
              Un informe de control señala responsabilidad cuando los auditores de la Contraloría encuentran que un funcionario incumplió
              sus funciones o causó un perjuicio. Si esa persona es después dueña o representante de una empresa que le gana al Estado,
              vale leer qué observó el informe y si se parece a lo contratado.
            </span>
            <span className="mt-1.5 block">
              Cruza a los funcionarios comprendidos en los informes con los socios y representantes legales del Registro Nacional de
              Proveedores, por su documento (que no se muestra), y las buenas pro desde 2018 posteriores al informe.
            </span>
            <span className="mt-1.5 block">
              La responsabilidad es presunta: la Contraloría la identifica y la deriva; no es una condena ni un impedimento para contratar.
              Un patrón es un motivo para mirar, no una acusación.
            </span>
          </Ayuda>
        }
      >
        Empresas que ganaron buenas pro con un socio o representante comprendido, antes, en un informe de control de la Contraloría.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la empresa o de una entidad</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
          <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
          Sólo los graves: penal presunta y cercana
        </label>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
          <input type="checkbox" checked={misma} onChange={(e) => setMisma(e.target.checked)} className="size-5 rounded border-line accent-granate" />
          El informe es de la misma entidad que contrató
        </label>
      </div>
      <EstadoCarga carga={carga} columnas={COLUMNAS_CONTROL}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: filtrada ? "casos con ese filtro" : "pares de empresa y persona", contexto: "la persona figura en un informe anterior", icono: <FileSearch size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "Presunta", etiqueta: "es la responsabilidad", contexto: "la Contraloría la señala y la deriva: no es una condena", parte: null },
                  { valor: "2 años", etiqueta: "o la misma entidad", contexto: "con responsabilidad penal presunta, es grave", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="casos" onPagina={lista.irAPagina} vacio="No hay casos con este patrón para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_CONTROL} filas={filas.map(filaControl)} etiqueta="Empresas que ganan con un socio comprendido en un informe de control" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaControl(p: PatronControl, i: number): Fila {
  const anios = periodo(p.desde, p.hasta);
  const resp = (p.responsabilidades ?? []).map((r) => RESPONSABILIDAD_CORTA[r] ?? r);
  const unicas = resp.filter((r, k) => resp.indexOf(r) === k);
  const numeroInforme = p.informeNumero ?? p.informeCodigo ?? "sin número";
  const otros = Math.max(0, (p.informes ?? 1) - 1);
  return {
    id: `control-${i}`,
    detalle: detalleControl(p),
    enlaces: true,
    textos: { periodo: anios },
    celdas: {
      gana: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEmpresa ruc={p.ruc} nombre={p.empresa} />}
          meta={<span className="block">{p.socios?.[0]?.nombre ?? "Persona sin nombre publicado"}, {(p.socios?.[0]?.rol ?? "socio").toLowerCase()}</span>}
        />
      ),
      informe: (
        <span className="block min-w-0 whitespace-normal break-words text-dato leading-snug text-inkSoft">
          {p.ficha ? (
            <a href={p.ficha} target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE_CELDA}>
              {numeroInforme}
            </a>
          ) : (
            numeroInforme
          )}
          {p.informeEntidad ? <>, de {tituloNatural(p.informeEntidad)}</> : null}
          <span className="mt-0.5 block text-rotulo text-mute">
            {p.emision ? `${fechaConAnio(p.emision)}, ` : ""}responsabilidad presunta {unicas.length ? unicas.join(" y ") : "sin detalle"}
            {otros > 0 ? `; figura en ${otros} ${otros === 1 ? "informe más" : "informes más"}` : ""}
          </span>
          {p.mismaEntidad ? <span className="mt-0.5 block text-rotulo text-inkSoft">Es de una entidad que después le contrató</span> : null}
        </span>
      ),
      contratos: <CeldaNumero sub={p.graves > 0 ? `${numero(p.graves)} ${p.graves === 1 ? "grave" : "graves"}` : undefined}>{numero(p.contratos)}</CeldaNumero>,
      monto: <CeldaNumero>{p.monto != null ? solesCompacto(p.monto) : "Sin dato"}</CeldaNumero>,
      ejemplos: (
        <CeldaTexto>
          {(p.ejemplos ?? []).map((o, k) => (
            <span key={o}>
              {k > 0 ? ", " : ""}
              <Link href={`/app/contratos/${encodeURIComponent(o)}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {codigoDeOcid(o)}
              </Link>
            </span>
          ))}
        </CeldaTexto>
      ),
      periodo: anios ? <CeldaTexto>{anios}</CeldaTexto> : undefined,
    },
  };
}

// ─── Procesos observados por la Contraloría ──────────────────────────────────────

const COLUMNAS_OBSERVADOS: Columna[] = [
  { clave: "gana", titulo: "Proveedor y entidad", ancho: "minmax(0,1.4fr)" },
  {
    clave: "observados",
    titulo: "Procesos observados",
    ancho: "8rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Observados",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Procesos que este proveedor ganó en la entidad y que una observación de un informe de control nombra. Debajo, los graves: el
          informe señala responsabilidad penal presunta y la observación es de la selección, la ejecución o los pagos.
        </span>
      </Ayuda>
    ),
  },
  { clave: "informe", titulo: "Primer informe de control", ancho: "minmax(0,1.4fr)", desde: "md", apilar: "con-rotulo", corto: "Informe" },
  { clave: "perjuicio", titulo: "Perjuicio que cuantifica", ancho: "8rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Perjuicio" },
  {
    clave: "despues",
    titulo: "Le adjudicó después",
    ancho: "8.5rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Después",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        <span className="block">
          Procesos que la misma entidad le adjudicó a este proveedor después de emitido ese informe, y su monto. Sólo lo que ganó con su
          propio RUC: lo ganado dentro de un consorcio no se cuenta.
        </span>
      </Ayuda>
    ),
  },
  { clave: "ejemplos", titulo: "Contratos observados", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: "con-rotulo", corto: "Ejemplos" },
];

const TEMA_CORTO: Record<string, string> = {
  seleccion_contratacion: "selección", ejecucion_contractual: "ejecución", pagos_adelantos: "pagos", personal_planillas: "personal",
  bienes_almacen: "bienes", presupuesto_tesoreria: "presupuesto", otros: "otros",
};

function ListaObservados({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("observados", inicial);
  // Los filtros (RUC, graves, siguió ganando) son de la vista: no viajan a la URL y vuelven a la primera página.
  const [ruc, setRuc] = useState("");
  const rucValido = /^20\d{9}$/.test(ruc.trim()) ? ruc.trim() : undefined;
  const [graves, setGraves] = useState(false);
  const [siguio, setSiguio] = useState(false);
  const filtrada = !!rucValido || graves || siguio;
  const carga = usePoder<PatronesObservados>(rutaObservados(filtrada ? 1 : lista.page, rucValido, graves, siguio));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué mirar los procesos observados?">
            <span className="block">
              Un informe de control dice lo que los auditores de la Contraloría encontraron en un proceso: una buena pro mal dada, un pago sin
              sustento, una penalidad que no se cobró. Aquí cada observación se ata al contrato que nombra, y se ve si la entidad le siguió
              adjudicando al mismo proveedor después.
            </span>
            <span className="mt-1.5 block">
              Se empata por la entidad, el tipo, el número, el año y la sigla del proceso que la observación nombra, o por el código de la
              inversión de la obra. Las observaciones se leen de la Ficha Resumen de cada informe con una lectura automática (IA).
            </span>
            <span className="mt-1.5 block">
              La responsabilidad que identifica un informe es presunta y recae en funcionarios y servidores: el informe no sanciona al
              proveedor. Un patrón es un motivo para mirar, no una acusación.
            </span>
          </Ayuda>
        }
      >
        Proveedores que ganaron procesos que la Contraloría observó después en un informe de control, por entidad.
      </CabeceraPestana>
      <label className="block max-w-md">
        <span className="text-rotulo font-medium text-inkSoft">Filtrar por RUC de la empresa o de la entidad</span>
        <input
          type="search"
          inputMode="numeric"
          value={ruc}
          onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="RUC de 11 dígitos que empieza en 20"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
          <input type="checkbox" checked={siguio} onChange={(e) => setSiguio(e.target.checked)} className="size-5 rounded border-line accent-granate" />
          La entidad le volvió a adjudicar después del informe
        </label>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-dato text-ink">
          <input type="checkbox" checked={graves} onChange={(e) => setGraves(e.target.checked)} className="size-5 rounded border-line accent-granate" />
          Sólo los graves: responsabilidad penal presunta
        </label>
      </div>
      <EstadoCarga carga={carga} columnas={COLUMNAS_OBSERVADOS}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: filtrada ? "casos con ese filtro" : "pares de proveedor y entidad", contexto: "con algún proceso observado", icono: <ScanSearch size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  { valor: "Presunta", etiqueta: "es la responsabilidad", contexto: "y es de funcionarios: el informe no sanciona al proveedor", parte: null },
                  { valor: "Después", etiqueta: "del primer informe", contexto: "se cuenta lo que la entidad le volvió a adjudicar", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={filtrada ? 1 : lista.page} cargando={carga.cargando} nombre="casos" onPagina={lista.irAPagina} vacio="No hay casos con este patrón para ese filtro.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_OBSERVADOS} filas={filas.map(filaObservado)} etiqueta="Proveedores con procesos observados por la Contraloría" /> : null}
              </ZonaLista>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

function filaObservado(p: PatronObservado, i: number): Fila {
  const resp = (p.responsabilidades ?? []).map((r) => RESPONSABILIDAD_CORTA[r] ?? r);
  const unicas = resp.filter((r, k) => resp.indexOf(r) === k);
  const numeroInforme = p.informeNumero ?? p.informeCodigo ?? "sin número";
  const temas = (p.temas ?? []).map((t) => TEMA_CORTO[t] ?? t).filter((t, k, xs) => xs.indexOf(t) === k);
  const otros = Math.max(0, (p.informes ?? 1) - 1);
  return {
    id: `observado-${i}`,
    detalle: detalleObservado(p),
    enlaces: true,
    celdas: {
      gana: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEmpresa ruc={p.ruc} nombre={p.empresa} />}
          meta={<span className="block">En <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} /></span>}
        />
      ),
      observados: <CeldaNumero sub={p.graves > 0 ? `${numero(p.graves)} ${p.graves === 1 ? "grave" : "graves"}` : undefined}>{numero(p.observados)}</CeldaNumero>,
      informe: (
        <span className="block min-w-0 whitespace-normal break-words text-dato leading-snug text-inkSoft">
          {p.informeCodigo ? (
            <InformeEnPanel
              informe={{ codigo: p.informeCodigo, numero: p.informeNumero, titulo: null, fecha: p.emision, entidad: p.entidad, entidadRuc: p.entidadRuc, responsabilidades: p.responsabilidades ?? [], urlResumen: p.ficha }}
              className={CLASE_ENLACE_CELDA}
            />
          ) : (
            numeroInforme
          )}
          <span className="mt-0.5 block text-rotulo text-mute">
            {p.emision ? `${fechaConAnio(p.emision)}, ` : ""}responsabilidad presunta {unicas.length ? unicas.join(" y ") : "sin detalle"}
            {otros > 0 ? `; ${otros} ${otros === 1 ? "informe más" : "informes más"}` : ""}
          </span>
          {temas.length > 0 ? <span className="mt-0.5 block text-rotulo text-inkSoft">Observa: {temas.join(", ")}</span> : null}
        </span>
      ),
      perjuicio: <CeldaNumero>{p.perjuicio != null && p.perjuicio > 0 ? solesCompacto(p.perjuicio) : SIN_DATO}</CeldaNumero>,
      despues: (
        <CeldaNumero sub={p.despues > 0 && p.montoDespues != null ? solesCompacto(p.montoDespues) : undefined}>
          {p.despues > 0 ? numero(p.despues) : <span className="font-sans text-mute">Ninguno</span>}
        </CeldaNumero>
      ),
      ejemplos: (
        <CeldaTexto>
          {(p.ejemplos ?? []).map((o, k) => (
            <span key={o}>
              {k > 0 ? ", " : ""}
              <Link href={`/app/contratos/${encodeURIComponent(o)}?seccion=antecedentes`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {codigoDeOcid(o)}
              </Link>
            </span>
          ))}
        </CeldaTexto>
      ),
    },
  };
}

// ─── Renovaciones más caras ──────────────────────────────────────────────────────

const COLUMNAS_RENOVACIONES: Columna[] = [
  { clave: "servicio", titulo: "Servicio y entidad", ancho: "minmax(0,1.6fr)" },
  {
    clave: "costo",
    titulo: "Costo al mes",
    ancho: "7.5rem",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Cómo se calcula el costo al mes?">
        <span className="block">El monto del contrato entre los meses de su plazo. Arriba, el de ahora; debajo, el del contrato anterior.</span>
      </Ayuda>
    ),
  },
  { clave: "subida", titulo: "Subida", ancho: "5.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Subió" },
  {
    clave: "exceso",
    titulo: "De más en el plazo",
    ancho: "8.5rem",
    alinear: "der",
    desde: "lg",
    apilar: "con-rotulo",
    corto: "De más en todo el plazo",
    ayuda: (
      <Ayuda titulo="¿Qué es «de más»?">
        <span className="block">Lo que cuesta de más el contrato nuevo en todo su plazo, frente a lo que habría costado con el costo al mes de antes.</span>
      </Ayuda>
    ),
  },
  { clave: "proveedor", titulo: "Proveedor", ancho: "minmax(0,1fr)", desde: "lg", apilar: "con-rotulo" },
  { clave: "contratos", titulo: "Los dos contratos", ancho: "minmax(11rem,0.9fr)", desde: "xl", apilar: true },
];

function ListaRenovaciones({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("renovaciones", inicial);
  const carga = usePoder<PatronesRenovaciones>(rutaRenovaciones(lista.page));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es una renovación más cara?">
            <span className="block">
              Una entidad volvió a contratar el <b>mismo servicio</b> y el costo por mes (el monto entre el plazo) subió <b>30 % o más</b>{" "}
              frente al contrato anterior.
            </span>
            <span className="mt-1.5 block">
              Sólo cuenta en servicios continuos: los dos contratos duran cinco meses o más, su objeto es casi igual y el anterior
              ya había corrido la mayor parte de su plazo. No cuenta lo que es por obra o por proyecto.
            </span>
            <span className="mt-1.5 block">
              Puede explicarse por más sedes, más personal o más alcance: compara los términos de referencia de los dos contratos.
              Es un motivo para mirar, no una acusación.
            </span>
          </Ayuda>
        }
      >
        Servicios continuos que una entidad volvió a contratar con un costo al mes 30 % mayor o más.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS_RENOVACIONES}>
        {(d) => {
          const filas = d.data ?? [];
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={[
                  { valor: numero(d.total), etiqueta: "renovaciones más caras", contexto: "el mismo servicio, en la misma entidad", icono: <TrendingUp size={15} strokeWidth={1.9} aria-hidden />, parte: null },
                  ...(d.exceso != null ? [{ valor: solesCompacto(d.exceso), etiqueta: "de más en todo el plazo", contexto: "la suma de lo que subió cada una", parte: null } satisfies Indicador] : []),
                  { valor: "30 % o más", etiqueta: "sube el costo al mes", contexto: "frente al contrato anterior", parte: null },
                ]}
              />
              <ZonaLista total={d.total} page={lista.page} cargando={carga.cargando} nombre="renovaciones" onPagina={lista.irAPagina} vacio="Todavía no hay renovaciones con este patrón.">
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_RENOVACIONES} filas={filas.map(filaRenovacion)} etiqueta="Servicios renovados con un costo al mes mayor" /> : null}
              </ZonaLista>
              <Nota>
                Una subida puede tener explicación: más sedes, más personal, más alcance. Antes de afirmar algo, abre los dos
                contratos y compara sus términos de referencia.
              </Nota>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

/** Un contrato de la renovación: el enlace a su ficha y su fecha. */
function EnlaceContrato({ ocid, fecha, children }: { ocid: string; fecha: string | null; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <Link href={`/app/contratos/${encodeURIComponent(ocid)}`} prefetch={false} title={`Abrir el contrato ${ocid}`} className={CLASE_ENLACE_CELDA}>
        {children}
      </Link>
      {fecha && <span className="tabular-nums text-mute">{fechaConAnio(fecha)}</span>}
    </span>
  );
}

function filaRenovacion(p: PatronRenovacion, i: number): Fila {
  const objeto = p.objeto ? oracion(p.objeto) : "Servicio sin descripción";
  return {
    id: `renovacion-${i}`,
    detalle: detalleRenovacion(p),
    enlaces: true,
    textos: { proveedor: p.proveedor ? undefined : null, exceso: p.exceso == null ? null : undefined },
    celdas: {
      servicio: (
        <CeldaPrincipal
          titulo={objeto}
          dosLineas
          meta={[
            <Dato key="e" tipo="entidad">
              <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
            </Dato>,
          ]}
        />
      ),
      costo: (
        <CeldaNumero sub={p.costoMensualAnterior != null ? `antes ${solesCompacto(p.costoMensualAnterior)}` : undefined}>
          {p.costoMensual != null ? solesCompacto(p.costoMensual) : SIN_DATO}
        </CeldaNumero>
      ),
      subida: (
        <span className="block text-right font-mono text-dato font-semibold tabular-nums text-amberTexto" title="Cuánto subió el costo al mes frente al contrato anterior">
          +{porcentaje(p.diffPct)}
        </span>
      ),
      exceso: <CeldaNumero>{p.exceso != null ? solesCompacto(p.exceso) : SIN_DATO}</CeldaNumero>,
      proveedor: p.proveedor ? (
        <CeldaTexto sub={p.mismoProveedor === true ? <Badge variant="amber">Mismo proveedor que antes</Badge> : undefined}>
          {p.proveedorRuc ? <EnlaceEmpresa ruc={p.proveedorRuc} nombre={p.proveedor} /> : tituloNatural(p.proveedor)}
        </CeldaTexto>
      ) : undefined,
      contratos: (
        <span className="flex min-w-0 flex-col gap-y-0.5 text-meta">
          <EnlaceContrato ocid={p.ocid} fecha={p.fecha}>
            Este contrato
          </EnlaceContrato>
          <EnlaceContrato ocid={p.ocidAnterior} fecha={p.fechaAnterior}>
            Contrato anterior
          </EnlaceContrato>
        </span>
      ),
    },
  };
}

// ─── Indicadores en observación (migración 329) ──────────────────────────────────

const COLUMNAS_OBSERVACION: Columna[] = [
  { clave: "empresa", titulo: "Empresa y entidad", ancho: "minmax(0,1.5fr)" },
  { clave: "indicador", titulo: "Indicador", ancho: "minmax(0,1.1fr)", desde: "md", apilar: true },
  { clave: "evidencia", titulo: "Lo que se encontró", ancho: "minmax(0,1.3fr)", desde: "md", apilar: true },
  { clave: "fecha", titulo: "Buena pro", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "contrato", titulo: "Contrato", ancho: "6.5rem", desde: "lg", apilar: "con-rotulo" },
];

/** El nombre corto de cada indicador, para el filtro y la celda. */
const NOMBRE_OBSERVACION: Record<PatronObservacion["tipo"], string> = {
  reunion_en_evaluacion: "Reunión con quien decide, durante la evaluación",
  visita_personal_decisor: "Visitas «personales» repetidas a quien decide",
  ofertas_a_la_vez: "Ofertas casi a la vez, con un socio común",
  trabajo_en_el_ganador: "Un funcionario declaró haber trabajado en el ganador",
  firma_en_plazo_de_apelacion: "Contrato firmado antes de que se pudiera apelar",
};

/** Cuándo fue el empleo frente a la buena pro (trabajo_en_el_ganador). */
const CUANDO_EMPLEO: Record<string, string> = {
  a_la_vez: "seguía trabajando ahí el día de la buena pro",
  despues: "empezó a trabajar ahí después de la buena pro",
  hasta_2_anios: "lo dejó menos de dos años antes de la buena pro",
  antes: "lo dejó más de dos años antes de la buena pro",
  sin_fechas: "su declaración no dice cuándo",
};

/** «0,3 %», «menos del 0,1 %»: una proporción chica sin perder el orden de magnitud. */
function proporcionChica(casos: number, universo: number): string {
  const p = (100 * casos) / universo;
  if (p < 0.1) return "menos del 0,1 %";
  return `${p < 10 ? decimal(p, 1) : String(Math.round(p))} %`;
}

function ListaObservacion({ inicial }: { inicial: InicialPatrones }) {
  const lista = useListaEnUrl("observacion", inicial);
  const tipo = lista.regla && lista.regla in NOMBRE_OBSERVACION ? lista.regla : undefined;
  const carga = usePoder<PatronesObservacion>(rutaObservacion(lista.page, tipo));
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es un indicador en observación?">
            <span className="block">
              Un cruce nuevo que Vigía todavía está <b>midiendo</b>. Se muestra con su evidencia para que lo revises, pero no
              cuenta para el riesgo del contrato hasta saber, con una muestra revisada, cuántas veces acierta.
            </span>
            <span className="mt-1.5 block">
              Hoy son cuatro: una reunión de la empresa con quien decide las compras mientras se evaluaban las ofertas, visitas
              declaradas «personales» y repetidas a quien decide, dos rivales con un socio común que registran sus ofertas
              casi a la vez, y un funcionario de la entidad que declaró en su DJI haber trabajado en la empresa que ganó.
            </span>
            <span className="mt-1.5 block">De quien recibió una visita se muestra sólo el cargo. Es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      >
        Cruces nuevos, contrato por contrato, que todavía no cuentan para el riesgo: están aquí para revisarlos.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS_OBSERVACION}>
        {(d) => {
          const filas = d.data ?? [];
          const porTipo = d.porTipo ?? [];
          const todos = porTipo.reduce((s, o) => s + o.n, 0);
          return (
            <div className="space-y-4">
              <Indicadores
                franja
                items={porTipo.map((o) => ({
                  valor: numero(o.n),
                  etiqueta: NOMBRE_OBSERVACION[o.tipo as PatronObservacion["tipo"]] ?? o.etiqueta,
                  contexto: o.tasaBase && o.tasaBase.universo > 0 ? `${proporcionChica(o.tasaBase.casos, o.tasaBase.universo)} de los ${o.tasaBase.que}` : "contratos con este indicador",
                  icono: <FlaskConical size={15} strokeWidth={1.9} aria-hidden />,
                  parte: null,
                } satisfies Indicador))}
              />
              <ZonaLista
                total={d.total}
                page={lista.page}
                cargando={carga.cargando}
                nombre="contratos"
                onPagina={lista.irAPagina}
                vacio={tipo ? "Ningún contrato con este indicador." : "Todavía no hay contratos con indicadores en observación."}
                filtro={
                  porTipo.length > 1 || tipo ? (
                    <label className="min-w-0 sm:w-96">
                      <span className="sr-only">Filtrar por indicador</span>
                      <select className={CAMPO} value={tipo ?? ""} onChange={(e) => lista.elegirRegla(e.target.value)}>
                        <option value="">{todos > 0 ? `Todos los indicadores (${numero(todos)})` : "Todos los indicadores"}</option>
                        {porTipo.map((o) => (
                          <option key={o.tipo} value={o.tipo}>{`${NOMBRE_OBSERVACION[o.tipo as PatronObservacion["tipo"]] ?? o.etiqueta} (${numero(o.n)})`}</option>
                        ))}
                      </select>
                    </label>
                  ) : undefined
                }
              >
                {filas.length > 0 ? <Tabla columnas={COLUMNAS_OBSERVACION} filas={filas.map(filaObservacion)} etiqueta="Contratos con un indicador en observación" /> : null}
              </ZonaLista>
              <Nota>
                Cada uno tiene una explicación sencilla posible: una subsanación, un familiar, el mismo estudio contable. Antes de
                afirmar algo, abre el contrato y lee su evidencia en «Antecedentes».
              </Nota>
            </div>
          );
        }}
      </EstadoCarga>
    </div>
  );
}

/** Lo que se encontró, en una línea: sin nombres de personas (de quien recibió, sólo el cargo). */
function evidenciaObservacion(p: PatronObservacion): string {
  const quien = p.cargo ? p.cargo.toLowerCase() : "quien decide las compras";
  if (p.tipo === "reunion_en_evaluacion") {
    return `${plural(p.visitas ?? 1, "visita", "visitas")} a ${quien} después de presentar su oferta${p.yaProveedor ? "; ya le vendía a la entidad" : "; no le había vendido antes"}`;
  }
  if (p.tipo === "visita_personal_decisor") {
    return `${plural(p.dias ?? 3, "día distinto", "días distintos")}${p.meses != null && p.meses > 1 ? ` de ${plural(p.meses, "mes", "meses")}` : ""} de visita personal a ${quien}`;
  }
  if (p.tipo === "firma_en_plazo_de_apelacion") {
    const cuando = p.diasHabiles === 0 ? "el mismo día de la buena pro" : `${plural(p.diasHabiles ?? 1, "día hábil", "días hábiles")} después de la buena pro`;
    return `Firmado ${cuando}, con ${plural(p.ofertas ?? 2, "oferta", "ofertas")} en el ítem`;
  }
  if (p.tipo === "trabajo_en_el_ganador") {
    return `Quien tiene el cargo de ${quien} declaró un empleo en la empresa: ${CUANDO_EMPLEO[p.cuando ?? ""] ?? "sin fechas"}`;
  }
  const min = p.minutos == null ? "pocos minutos" : p.minutos < 1 ? "menos de un minuto" : plural(Math.round(p.minutos), "minuto", "minutos");
  return `Sus ofertas se registraron con ${min} de diferencia${p.horaGanador && p.horaOtro ? ` (${p.horaGanador} y ${p.horaOtro})` : ""}`;
}

function filaObservacion(p: PatronObservacion, i: number): Fila {
  return {
    // Nunca el RUC en el DOM como id.
    id: `observacion-${i}`,
    detalle: detalleObservacion(p),
    enlaces: true,
    textos: { fecha: p.buenaPro ? undefined : null },
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={<EnlaceEmpresa ruc={p.ruc} nombre={p.empresa} />}
          meta={[
            <Dato key="e" tipo="entidad">
              {p.entidadRuc ? <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} /> : tituloNatural(p.entidad ?? "Entidad sin nombre")}
            </Dato>,
          ]}
        />
      ),
      indicador: <CeldaTexto>{NOMBRE_OBSERVACION[p.tipo] ?? p.etiqueta}</CeldaTexto>,
      evidencia: (
        <CeldaTexto sub={p.tipo === "ofertas_a_la_vez" && p.otro ? <>Con {p.otroRuc ? <EnlaceEmpresa ruc={p.otroRuc} nombre={p.otro} /> : tituloNatural(p.otro)}</> : undefined}>
          {evidenciaObservacion(p)}
        </CeldaTexto>
      ),
      fecha: <span className="block text-right tabular-nums text-inkSoft">{p.buenaPro ? fechaConAnio(p.buenaPro) : SIN_DATO}</span>,
      contrato: (
        <Link href={`/app/contratos/${encodeURIComponent(p.ocid)}`} prefetch={false} title={`Abrir el contrato ${p.ocid}`} className={CLASE_ENLACE_CELDA}>
          {p.codigo ?? codigoDeOcid(p.ocid)}
        </Link>
      ),
    },
  };
}
