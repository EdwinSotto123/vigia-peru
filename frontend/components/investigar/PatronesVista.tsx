"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Briefcase, Building2, Handshake, SearchX, TrendingUp, Users, UsersRound } from "lucide-react";
import { Ayuda, CabeceraPestana, Nota, Pestanas } from "@/components/patrones";
import { EVENTO_ACTIVA } from "@/components/patrones/Pestanas";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { EstadoCarga, usePoder } from "@/components/grafo/vista";
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
  rutaDuenos,
  rutaInhabilitadas,
  rutaPatrones,
  rutaRenovaciones,
  SECCIONES_PATRONES,
  TAM_PATRONES,
  type AlcancePatron,
  type PatronAcompanante,
  type PatronConsorcio,
  type PatronDueno,
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
 * Las filas no son un enlace: cada nombre lleva a su ficha y cada contrato de ejemplo a la suya.
 */

/** Lo que pide la URL al cargar: vale sólo para la pestaña abierta. */
export interface InicialPatrones {
  page: number;
  regla?: string;
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
          clave: "inhabilitadas",
          etiqueta: SECCIONES_PATRONES.inhabilitadas,
          titulo: "Ganan mientras otra empresa del mismo socio está inhabilitada",
          icono: <Ban size={15} aria-hidden />,
          contenido: <ListaInhabilitadas inicial={de("inhabilitadas")} />,
        },
        {
          clave: "renovaciones",
          etiqueta: SECCIONES_PATRONES.renovaciones,
          titulo: "El mismo servicio, más caro al renovarlo",
          icono: <TrendingUp size={15} aria-hidden />,
          contenido: <ListaRenovaciones inicial={de("renovaciones")} />,
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
