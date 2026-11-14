"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Briefcase, Building2, Handshake, SearchX, Users } from "lucide-react";
import { Ayuda, CabeceraPestana, Nota, Pestanas } from "@/components/patrones";
import { EVENTO_ACTIVA } from "@/components/patrones/Pestanas";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { EstadoCarga, usePoder } from "@/components/grafo/vista";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MARGEN_LISTA, Paginacion } from "@/components/ui/Paginacion";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { reglaLabel } from "@/lib/auditoria-reglas";
import { decimal, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  codigoDeOcid,
  rutaAcompanantes,
  rutaConsorcios,
  rutaPatrones,
  SECCIONES_PATRONES,
  TAM_PATRONES,
  type AlcancePatron,
  type PatronAcompanante,
  type PatronConsorcio,
  type PatronesAcompanantes,
  type PatronesConsorcios,
  type PatronesSenal,
  type PatronSenal,
  type SeccionPatrones,
} from "@/lib/patrones";
import { esRucEnClaro, esRucPersonaNatural } from "@/lib/privacidad";
import { cn } from "@/lib/utils";

/**
 * Las cuatro listas de /app/patrones en las pestañas del kit (`?seccion=`). Cada pestaña pide lo suyo a la API la primera
 * vez que se abre (`Pestanas` la monta recién entonces), así una visita hace UNA consulta y no cuatro. La página y la
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
