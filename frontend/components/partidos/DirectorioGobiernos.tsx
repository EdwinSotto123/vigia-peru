"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, SearchX } from "lucide-react";
import { nombreDepartamento } from "@/components/mapa/region-match";
import { rutaRegion } from "@/lib/regiones";
import { Tabla, type Columna, type Fila } from "@/components/listado/Tabla";
import { BarraFiltros, type FiltroSecundario } from "@/components/listado/BarraFiltros";
import { Listado, ZonaResultados, useListado, type Parametros } from "@/components/listado/Listado";
import { Vistas, type Vista as OpcionVista } from "@/components/listado/Vistas";
import { Dato } from "@/components/ui/Dato";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { EnlaceFuente, Nota } from "@/components/patrones";
import { Partes } from "@/components/ui/Partes";
import { Paginacion } from "@/components/ui/Paginacion";
import { Skeleton } from "@/components/ui/Skeleton";
import { listaY, numero, solesCompacto } from "@/lib/formato";
import { INFOGOB_JNE } from "@/lib/fuentes";
import {
  PALETA_ORG,
  TIPO_ORG_LABEL,
  cargarAutoridades,
  claveOrg,
  coloresDeFilas,
  conteos,
  normalizar,
  orgDe,
  pct,
  type Anio,
  type AutoridadesDatos,
  type Nivel,
  type TipoOrg,
  paletaOrg,
} from "@/lib/partidos";
import { cn } from "@/lib/utils";
import { useModo, type Modo } from "@/lib/modo";

/**
 * El directorio de TODOS los gobiernos del país en un período (Elecciones Regionales y Municipales, JNE):
 * quién gobierna cada región, provincia y distrito, con su partido, y todas las organizaciones, no solo las
 * más grandes. Los datos llegan del archivo público /data/autoridades-<año>.json (179 KB), se piden al
 * montar y se filtran y paginan acá, en el navegador.
 *
 * Con las piezas del kit, como todo listado (§14.1): `Vistas` en granate para qué mirar y, debajo, en una fila con su
 * rótulo, el período y el nivel en su variante secundaria (cada barra se desliza en el celular, con su conteo: antes
 * eran tres barras granate iguales, una encima de otra), `BarraFiltros` (buscar, región, partido, orden; cada filtro activo con su × y «Quitar todo») y
 * `Paginacion` arriba y abajo. El estado vive en la URL (`?nivel=&q=&region=&org=&orden=&pagina=`): se comparte, y el
 * botón atrás lo deshace. Cuenta quién ganó, no qué hizo: nada acá acusa a nadie.
 *
 * Lo que llega del servidor son datos planos y nodos ya armados (`contratosNode`, `mapaNode`), nunca funciones.
 */

export type Vista = "gobiernos" | "partidos" | "contratos" | "mapa";

export interface ContratosDeUnPartido {
  contratos: number;
  leidos: number;
  enCola: number;
  /** Procesos adjudicados de sus gobiernos en el período (OECE, migraciones 65 y 68) y lo adjudicado en soles. */
  procesos?: number;
  montoAdjudicadoPen?: number;
}

const TAM = 25;

const NIVELES: { id: Nivel; etiqueta: string; plural: string }[] = [
  { id: "regional", etiqueta: "Regiones", plural: "regiones" },
  { id: "provincial", etiqueta: "Provincias", plural: "provincias" },
  { id: "distrital", etiqueta: "Distritos", plural: "distritos" },
];

const ORDENES = [
  { valor: "lugar", etiqueta: "Lugar, de la A a la Z" },
  { valor: "partido", etiqueta: "Partido" },
  { valor: "votos", etiqueta: "Más votos primero" },
] as const;
type Orden = (typeof ORDENES)[number]["valor"];

const VISTAS: { v: Vista; texto: string }[] = [
  { v: "gobiernos", texto: "Quién gobierna" },
  { v: "partidos", texto: "Todos los partidos" },
  { v: "contratos", texto: "Contratos por partido" },
  { v: "mapa", texto: "En el mapa" },
];

/** Colores por organización para TODO el período: las 8 con más gobiernos, el resto «Otras» en gris. */
function coloresDelPeriodo(d: AutoridadesDatos, modo: Modo) {
  return coloresDeFilas([...d.regional, ...d.provincial, ...d.distrital], modo);
}

/**
 * El nombre de la organización con su color. En el celular va en DOS líneas: recortado en una, ocho «Movimiento
 * Regional…» distintos se veían iguales; desde md, una línea (el nombre entero en el `title`).
 */
function ChipPartido({ nombre, tipo, color }: { nombre: string; tipo: TipoOrg; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-start gap-1.5 rounded-2xl border px-2.5 py-0.5 text-meta font-medium leading-snug text-ink"
      style={{ backgroundColor: `${color}22`, borderColor: `${color}66` }}
      title={`${nombre}, ${TIPO_ORG_LABEL[tipo].toLowerCase()}`}
    >
      <span aria-hidden className="mt-[0.35rem] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 line-clamp-2 md:line-clamp-1">{nombre}</span>
    </span>
  );
}

interface FilaGobierno {
  id: string;
  lugar: string;
  /** Provincia y región, para que dos distritos con el mismo nombre se distingan. */
  sub: string | null;
  region: string;
  autoridad: string;
  o: number;
  p: number | null;
}

function filasDe(d: AutoridadesDatos, nivel: Nivel): FilaGobierno[] {
  if (nivel === "regional") {
    return d.regional.map((g) => ({ id: g.u, lugar: nombreDepartamento(g.u), sub: null, region: g.u, autoridad: g.g, o: g.o, p: g.p }));
  }
  if (nivel === "provincial") {
    return d.provincial.map((g) => ({ id: g.u, lugar: g.n, sub: nombreDepartamento(g.u), region: g.u.slice(0, 2), autoridad: g.a, o: g.o, p: g.p }));
  }
  return d.distrital.map((g, i) => ({
    id: `${g.u}-${i}`,
    lugar: g.n,
    sub: `${g.pv}, ${nombreDepartamento(g.u)}`,
    region: g.u.slice(0, 2),
    autoridad: g.a,
    o: g.o,
    p: g.p,
  }));
}

const alfabetico = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

/** Una URL de esta página con estos parámetros (los vacíos fuera). */
function urlCon(ruta: string, p: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();
  return qs ? `${ruta}?${qs}` : ruta;
}

export function DirectorioGobiernos({
  anio,
  periodos,
  vista,
  contratos,
  contratosNode,
  mapaNode,
}: {
  anio: number;
  periodos: { anio: number; texto: string }[];
  vista: Vista;
  /** Contratos asociados a cada partido del período, por clave. `null`: la API no respondió. */
  contratos: Record<string, ContratosDeUnPartido> | null;
  contratosNode: ReactNode;
  mapaNode: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [datos, setDatos] = useState<AutoridadesDatos | null>(null);
  const [fallo, setFallo] = useState(false);

  // El archivo del período: se pide al montar y al cambiar de período.
  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setFallo(false);
    cargarAutoridades(anio as Anio).then((d) => {
      if (!vivo) return;
      if (d) setDatos(d);
      else setFallo(true);
    });
    return () => {
      vivo = false;
    };
  }, [anio]);

  const nivel = (NIVELES.find((n) => n.id === params.get("nivel"))?.id ?? "regional") as Nivel;
  const q = params.get("q") ?? "";
  const region = params.get("region") ?? "";
  const org = params.get("org") ?? "";
  const orden = (ORDENES.find((o) => o.valor === params.get("orden"))?.valor ?? "lugar") as Orden;
  const pagina = Math.max(1, Number(params.get("pagina")) || 1);

  const modo = useModo();
  const resumen = useMemo(() => {
    if (!datos) return null;
    const porOrg = conteos(datos);
    return {
      colores: coloresDelPeriodo(datos, modo),
      porOrg,
      organizaciones: porOrg.length,
      claves: new Map(datos.orgs.map((o, i) => [claveOrg(o.n), i])),
    };
  }, [datos, modo]);

  const hrefVista = (v: Vista) => urlCon(pathname, { anio: String(anio), vista: v !== "gobiernos" ? v : undefined, nivel: v === "gobiernos" && nivel !== "regional" ? nivel : undefined });
  const hrefPeriodo = (a: number) => urlCon(pathname, { anio: String(a), vista: vista !== "gobiernos" ? vista : undefined, nivel: vista === "gobiernos" && nivel !== "regional" ? nivel : undefined });

  // Cada vista con su conteo (§14.3): la de partidos, cuántas organizaciones gobernaron algo (hueco mientras se cuenta).
  const vistas: OpcionVista[] = VISTAS.map(({ v, texto }) => ({
    href: hrefVista(v),
    etiqueta: texto,
    activa: vista === v,
    conteo: v === "partidos" ? (resumen ? resumen.organizaciones : fallo ? undefined : null) : undefined,
  }));
  const vistasPeriodo: OpcionVista[] = periodos.map((p) => ({ href: hrefPeriodo(p.anio), etiqueta: p.texto, activa: p.anio === anio }));
  // Regiones | Provincias | Distritos, con cuántos hay de cada uno (hueco mientras llega el archivo): el nivel es una
  // población, no un filtro (§14.1). Sólo en «Quién gobierna»; cambiarlo conserva la búsqueda, los filtros y el orden.
  const niveles: OpcionVista[] | null =
    vista === "gobiernos"
      ? NIVELES.map((n) => ({
          href: urlCon(pathname, {
            anio: String(anio),
            nivel: n.id === "regional" ? undefined : n.id,
            q: q || undefined,
            region: region || undefined,
            org: org || undefined,
            orden: orden === "lugar" ? undefined : orden,
          }),
          etiqueta: n.etiqueta,
          conteo: datos ? datos[n.id].length : fallo ? undefined : null,
          activa: n.id === nivel,
        }))
      : null;

  return (
    <div className="space-y-4">
      {/* Qué mirar: la decisión principal, en granate. Debajo, lo que la acota (período y nivel), un escalón abajo y con
          su rótulo también en el celular; la fila se parte en renglones si no entra. El período, una sola vez en la página. */}
      <div className="space-y-2.5">
        <Vistas vistas={vistas} etiqueta="Qué mirar" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <ConRotulo rotulo="Gobiernos de">
            <Vistas vistas={vistasPeriodo} etiqueta="Período de gobierno" variante="secundaria" />
          </ConRotulo>
          {niveles && (
            <ConRotulo rotulo="Nivel">
              <Vistas vistas={niveles} etiqueta="Nivel de gobierno" variante="secundaria" />
            </ConRotulo>
          )}
        </div>
      </div>

      {(vista === "gobiernos" || vista === "partidos") && (
        <>
          {fallo && <EstadoVacio tono="error">No pudimos leer los resultados de {anio}. Recarga la página para reintentar.</EstadoVacio>}

          {datos && resumen && vista === "gobiernos" && (
            <Gobiernos datos={datos} nivel={nivel} q={q} region={region} org={org} orden={orden} pagina={pagina} anio={anio} claves={resumen.claves} />
          )}
          {datos && resumen && vista === "partidos" && (
            <TodosLosPartidos datos={datos} resumen={resumen} q={q} pagina={pagina} anio={anio} contratos={contratos} />
          )}
          {!datos && !fallo && <TablaCargando />}
        </>
      )}

      {vista === "contratos" && contratosNode}
      {vista === "mapa" && mapaNode}
    </div>
  );
}

type Resumen = {
  colores: Map<number, string>;
  porOrg: ReturnType<typeof conteos>;
  organizaciones: number;
  claves: Map<string, number>;
};

/**
 * Un selector secundario con su rótulo delante, también en el celular (antes «Gobiernos de» se escondía y el período
 * quedaba sin nombre). Si no entran juntos, el selector baja bajo su rótulo.
 */
function ConRotulo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <span className="shrink-0 text-meta font-medium text-mute">{rotulo}</span>
      {children}
    </div>
  );
}

function TablaCargando() {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <span className="sr-only">Cargando los gobiernos…</span>
      <div className="h-[34px] border-b border-line bg-paperSoft" aria-hidden />
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex h-[42px] items-center gap-4 border-b border-line/70 px-4 last:border-b-0" aria-hidden>
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="ml-auto h-5 w-1/4 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Quién gobierna: regiones, provincias o distritos ────────────────────────────────────────────

function Gobiernos({
  datos,
  nivel,
  q,
  region,
  org,
  orden,
  pagina,
  anio,
  claves,
}: {
  datos: AutoridadesDatos;
  nivel: Nivel;
  q: string;
  region: string;
  org: string;
  orden: Orden;
  pagina: number;
  anio: number;
  claves: Map<string, number>;
}) {
  const pathname = usePathname();
  const parametros: Parametros = {
    anio: String(anio),
    nivel: nivel === "regional" ? undefined : nivel,
    q: q || undefined,
    region: region || undefined,
    org: org || undefined,
    orden: orden === "lugar" ? undefined : orden,
  };
  const base = useMemo(() => filasDe(datos, nivel), [datos, nivel]);
  // El nivel (Regiones | Provincias | Distritos) se elige arriba, en la fila del período (`DirectorioGobiernos`).
  return (
    <div className="space-y-3">
      <Listado ruta={pathname} parametros={parametros}>
        <ListaGobiernos datos={datos} base={base} nivel={nivel} q={q} region={region} org={org} orden={orden} pagina={pagina} anio={anio} claves={claves} parametros={parametros} />
      </Listado>
      <Nota>
        Cuenta quién ganó la elección de {anio}, no qué hizo cada gobierno: una vacancia, una revocatoria o un reemplazo dentro del período no está registrado.
        Una señal de Vigía es un motivo para revisar un contrato, nunca una acusación contra un partido ni una persona. Fuente:{" "}
        <EnlaceFuente href={INFOGOB_JNE}>JNE, Plataforma Electoral (Infogob)</EnlaceFuente>.
      </Nota>
    </div>
  );
}

function ListaGobiernos({
  datos,
  base,
  nivel,
  q,
  region,
  org,
  orden,
  pagina,
  anio,
  claves,
  parametros,
}: {
  datos: AutoridadesDatos;
  base: FilaGobierno[];
  nivel: Nivel;
  q: string;
  region: string;
  org: string;
  orden: Orden;
  pagina: number;
  anio: number;
  claves: Map<string, number>;
  parametros: Parametros;
}) {
  const pathname = usePathname();
  const { navegar } = useListado();
  const orgIndice = org ? claves.get(org) ?? -1 : null;
  // Los colores se reparten entre las organizaciones de ESTE nivel: así las regiones, las provincias y los distritos
  // se ven coloreados por quienes de verdad gobiernan ahí (con los de todo el período, casi todo quedaba gris).
  const modo = useModo();
  const otras = paletaOrg(modo).otras;
  const colores = useMemo(() => coloresDeFilas(base, modo), [base, modo]);

  // Cuántos gobiernos tiene cada organización en ESTE nivel: para el reparto y el orden del desplegable.
  const enEsteNivel = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of base) m.set(f.o, (m.get(f.o) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }, [base]);

  // El texto en que busca el buscador, una vez por fila (lugar, provincia y región, autoridad, organización).
  const textos = useMemo(() => base.map((x) => normalizar(`${x.lugar} ${x.sub ?? ""} ${x.autoridad} ${orgDe(datos, x.o).n}`)), [base, datos]);
  const k = normalizar(q);

  // Los conteos de cada opción, sobre los OTROS filtros (ninguna opción lleva a cero): región sobre partido y búsqueda,
  // partido sobre región y búsqueda.
  const { porRegion, porOrg, filtradas } = useMemo(() => {
    const porRegion = new Map<string, number>();
    const porOrg = new Map<number, number>();
    const pasan: FilaGobierno[] = [];
    base.forEach((x, i) => {
      if (k && !textos[i].includes(k)) return;
      const enRegion = !region || x.region === region;
      const enOrg = orgIndice == null || x.o === orgIndice;
      if (enOrg) porRegion.set(x.region, (porRegion.get(x.region) ?? 0) + 1);
      if (enRegion) porOrg.set(x.o, (porOrg.get(x.o) ?? 0) + 1);
      if (enRegion && enOrg) pasan.push(x);
    });
    const orgNombre = (i: number) => orgDe(datos, i).n;
    pasan.sort((a, b) => {
      if (orden === "votos") return (b.p ?? -1) - (a.p ?? -1) || alfabetico(a.lugar, b.lugar);
      if (orden === "partido") return alfabetico(orgNombre(a.o), orgNombre(b.o)) || alfabetico(a.lugar, b.lugar);
      return alfabetico(a.lugar, b.lugar) || alfabetico(a.sub ?? "", b.sub ?? "");
    });
    return { porRegion, porOrg, filtradas: pasan };
  }, [base, textos, k, region, orgIndice, orden, datos]);

  const ultima = Math.max(1, Math.ceil(filtradas.length / TAM));
  const actual = Math.min(pagina, ultima);
  const visibles = filtradas.slice((actual - 1) * TAM, actual * TAM);
  const hayFiltros = !!q || !!region || !!org;

  const opcionesRegion = useMemo(
    () =>
      datos.regional
        .map((g) => ({ valor: g.u, etiqueta: nombreDepartamento(g.u), conteo: porRegion.get(g.u) ?? 0 }))
        .filter((o) => o.conteo > 0 || o.valor === region)
        .sort((a, b) => alfabetico(a.etiqueta, b.etiqueta)),
    [datos, porRegion, region],
  );
  const opcionesOrg = useMemo(
    () =>
      enEsteNivel
        .map(([i]) => ({ valor: claveOrg(orgDe(datos, i).n), etiqueta: orgDe(datos, i).n, conteo: porOrg.get(i) ?? 0 }))
        .filter((o) => o.conteo > 0 || o.valor === org),
    [enEsteNivel, datos, porOrg, org],
  );
  // En el nivel regional, la región sólo deja una fila: el filtro aparece si ya viene puesto (para poder quitarlo).
  const visiblesBarra: FiltroSecundario[] = [
    ...(nivel !== "regional" || region ? [{ param: "region", etiqueta: "Región", corta: "Región", todas: "Todo el Perú", opciones: opcionesRegion }] : []),
    { param: "org", etiqueta: "Partido", corta: "Partido", todas: "Todos los partidos", opciones: opcionesOrg },
  ];

  const columnas: Columna[] = [
    { clave: "lugar", titulo: nivel === "regional" ? "Región" : nivel === "provincial" ? "Provincia" : "Distrito", ancho: "minmax(0,1.1fr)" },
    { clave: "autoridad", titulo: nivel === "regional" ? "Gobernador o gobernadora" : "Alcalde o alcaldesa", ancho: "minmax(0,1.1fr)", desde: "md" },
    { clave: "partido", titulo: "Partido u organización", ancho: "minmax(0,1.3fr)" },
    { clave: "votos", titulo: "Votos", ancho: "72px", alinear: "der", desde: "lg" },
  ];
  const filas: Fila[] = visibles.map((f) => {
    const o = orgDe(datos, f.o);
    const color = colores.get(f.o) ?? otras;
    return {
      id: f.id,
      // La región abre su ficha; una provincia o un distrito, la de su región con su nombre ya buscado.
      href: nivel === "regional" ? rutaRegion(f.region) : rutaRegion(f.region, "territorio", f.lugar),
      celdas: {
        lugar: (
          <span className="block min-w-0">
            <span className="block truncate text-dato font-semibold text-ink">{f.lugar}</span>
            {f.sub && (
              <span className="block truncate text-rotulo text-mute">
                <Dato tipo="lugar">{f.sub}</Dato>
              </span>
            )}
            {/* En el celular la autoridad baja bajo el lugar: la columna propia solo aparece desde md. */}
            <span className="block truncate text-meta text-inkSoft md:hidden">{f.autoridad}</span>
          </span>
        ),
        autoridad: <span className="block min-w-0 truncate text-dato text-ink" title={f.autoridad}>{f.autoridad}</span>,
        partido: <ChipPartido nombre={o.n} tipo={o.t} color={color} />,
        votos: <span className="font-mono text-meta tabular-nums text-inkSoft">{pct(f.p) ?? "Sin dato"}</span>,
      },
    };
  });

  const plural = NIVELES.find((n) => n.id === nivel)?.plural ?? "gobiernos";
  const pag = (subir: boolean) => (
    <Paginacion actual={actual} paginas={ultima} total={filtradas.length} tam={TAM} navegacion="url" hrefBase={pathname} query={parametros} cargando={false} nombre={plural} subir={subir} />
  );

  return (
    <div className="space-y-3">
      {/* El reparto del poder en este nivel: cada tramo es una organización, con su color; tocar uno la filtra. */}
      <RepartoDelPoder
        enEsteNivel={enEsteNivel}
        datos={datos}
        colores={colores}
        total={base.length}
        nivel={nivel}
        orgIndice={orgIndice}
        onElegir={(i) => navegar({ org: i == null || i === orgIndice ? undefined : claveOrg(orgDe(datos, i).n) })}
      />

      <BarraFiltros
        busqueda={{ param: "q", placeholder: "Buscar un lugar, una autoridad o un partido…", etiqueta: "Buscar por lugar, autoridad o partido", min: 2 }}
        visibles={visiblesBarra}
        orden={{ param: "orden", porDefecto: "lugar", opciones: ORDENES.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
      />

      <ZonaResultados>
        {filas.length === 0 ? (
          <EstadoVacio
            icono={<SearchX size={16} aria-hidden />}
            accion={
              hayFiltros ? (
                <button type="button" onClick={() => navegar({ q: undefined, region: undefined, org: undefined })} className="text-dato font-semibold text-granate underline-offset-4 hover:underline">
                  Quitar los filtros
                </button>
              ) : undefined
            }
          >
            Ningún gobierno coincide con esos filtros.
          </EstadoVacio>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">{pag(false)}</div>
            <Tabla columnas={columnas} filas={filas} etiqueta={`Gobiernos ${plural} ${anio}`} densidad="compacta" />
            {ultima > 1 && <div className="flex justify-end">{pag(true)}</div>}
          </div>
        )}
      </ZonaResultados>
    </div>
  );
}

/** Una barra de 14 px dividida por organización: se ve de un vistazo quién tiene más gobiernos, y cada tramo filtra. */
function RepartoDelPoder({
  enEsteNivel,
  datos,
  colores,
  total,
  nivel,
  orgIndice,
  onElegir,
}: {
  enEsteNivel: [number, number][];
  datos: AutoridadesDatos;
  colores: Map<number, string>;
  total: number;
  nivel: Nivel;
  orgIndice: number | null;
  onElegir: (i: number | null) => void;
}) {
  const otrasReparto = paletaOrg(useModo()).otras;
  const grandes = enEsteNivel.slice(0, PALETA_ORG.length);
  const resto = enEsteNivel.slice(PALETA_ORG.length).reduce((s, [, n]) => s + n, 0);
  const etiqueta = NIVELES.find((n) => n.id === nivel)?.plural;
  return (
    <section aria-label={`Reparto de ${etiqueta} entre organizaciones`} className="rounded-2xl border border-granate/20 bg-gradient-to-br from-granate-50 via-paperSoft to-paper p-3 sm:p-4">
      <div className="flex h-3.5 w-full gap-px overflow-hidden rounded-full bg-paperDeep" role="group" aria-label="Tramos por organización">
        {grandes.map(([i, n]) => (
          <button
            key={i}
            type="button"
            onClick={() => onElegir(i)}
            aria-pressed={orgIndice === i}
            aria-label={`${orgDe(datos, i).n}: ${n} de ${total}`}
            title={`${orgDe(datos, i).n}: ${n}`}
            className={cn("h-full min-w-[3px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink", orgIndice != null && orgIndice !== i && "opacity-35")}
            style={{ width: `${(n / total) * 100}%`, backgroundColor: colores.get(i) ?? otrasReparto }}
          />
        ))}
        {resto > 0 && <span className="h-full" style={{ width: `${(resto / total) * 100}%`, backgroundColor: otrasReparto }} aria-hidden />}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-meta">
        {grandes.map(([i, n]) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onElegir(i)}
              aria-pressed={orgIndice === i}
              className={cn("inline-flex max-w-[16rem] items-center gap-1.5 rounded-full py-0.5 pr-1 text-inkSoft hover:text-ink", orgIndice === i && "font-semibold text-ink")}
            >
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colores.get(i) ?? otrasReparto }} />
              <span className="truncate">{orgDe(datos, i).n}</span>
              <span className="font-mono tabular-nums text-mute">{numero(n)}</span>
            </button>
          </li>
        ))}
        {enEsteNivel.length > grandes.length && <li className="py-0.5 text-mute">y otras {numero(enEsteNivel.length - grandes.length)} organizaciones</li>}
      </ul>
    </section>
  );
}

// ── Todos los partidos del período ──────────────────────────────────────────────────────────────

function TodosLosPartidos({
  datos,
  resumen,
  q,
  pagina,
  anio,
  contratos,
}: {
  datos: AutoridadesDatos;
  resumen: Resumen;
  q: string;
  pagina: number;
  anio: number;
  contratos: Record<string, ContratosDeUnPartido> | null;
}) {
  const pathname = usePathname();
  const parametros: Parametros = { anio: String(anio), vista: "partidos", q: q || undefined };
  return (
    <Listado ruta={pathname} parametros={parametros}>
      <ListaPartidos datos={datos} resumen={resumen} q={q} pagina={pagina} anio={anio} contratos={contratos} parametros={parametros} />
    </Listado>
  );
}

function ListaPartidos({
  datos,
  resumen,
  q,
  pagina,
  anio,
  contratos,
  parametros,
}: {
  datos: AutoridadesDatos;
  resumen: Resumen;
  q: string;
  pagina: number;
  anio: number;
  contratos: Record<string, ContratosDeUnPartido> | null;
  parametros: Parametros;
}) {
  const otrasTodos = paletaOrg(useModo()).otras;
  const pathname = usePathname();
  const hrefGobiernos = (clave: string, nivelDe: Nivel) => urlCon(pathname, { anio: String(anio), nivel: nivelDe !== "regional" ? nivelDe : undefined, org: clave });

  const filas = useMemo(() => {
    const k = normalizar(q);
    return resumen.porOrg
      .map((c) => ({ ...c, o: orgDe(datos, c.org), clave: claveOrg(orgDe(datos, c.org).n) }))
      .filter((c) => !k || normalizar(c.o.n).includes(k));
  }, [resumen, datos, q]);
  const maximo = Math.max(1, ...resumen.porOrg.map((c) => c.total));
  const ultima = Math.max(1, Math.ceil(filas.length / TAM));
  const actual = Math.min(pagina, ultima);
  const visibles = filas.slice((actual - 1) * TAM, actual * TAM);
  const pag = (subir: boolean) => (
    <Paginacion actual={actual} paginas={ultima} total={filas.length} tam={TAM} navegacion="url" hrefBase={pathname} query={parametros} cargando={false} nombre="organizaciones" subir={subir} />
  );

  return (
    <div className="space-y-3">
      {/* Todas las que gobernaron algo en el período, de la que más gobiernos tiene a la que menos: el total, en la vista. */}
      <BarraFiltros busqueda={{ param: "q", placeholder: "Buscar un partido, movimiento o alianza…", etiqueta: "Buscar un partido", min: 2 }} />

      <ZonaResultados>
        {visibles.length === 0 ? (
          <EstadoVacio icono={<SearchX size={16} aria-hidden />}>Ninguna organización se llama así.</EstadoVacio>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">{pag(false)}</div>
            <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {visibles.map((c, i) => {
                const color = resumen.colores.get(c.org) ?? otrasTodos;
                const k = contratos?.[c.clave];
                const orden = (actual - 1) * TAM + i + 1;
                return (
                  // Toda la fila lleva a la ficha del partido (como en "Contratos por partido"): el nombre es el enlace y se
                  // estira sobre la fila; "Ver sus gobiernos" y el conteo quedan encima y siguen siendo sus propios enlaces.
                  <li key={c.org} className="relative grid min-h-[48px] items-center gap-x-4 gap-y-1 px-4 py-2 transition-colors focus-within:bg-granate-50 hover:bg-granate-50 sm:grid-cols-[1.75rem_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                    <span className="hidden font-mono text-meta tabular-nums text-mute sm:block" aria-hidden>{orden}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-3 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <Link href={`/app/partidos/${c.clave}?anio=${anio}`} prefetch={false} title={c.o.n}
                          className="line-clamp-2 text-dato font-semibold text-ink after:absolute after:inset-0 focus-visible:outline-none sm:line-clamp-1">
                          {c.o.n}
                        </Link>
                      </span>
                      <span className="block truncate pl-3.5 text-rotulo text-mute">
                        <Partes
                          partes={[
                            <Dato key="t" tipo="tipo">{TIPO_ORG_LABEL[c.o.t]}</Dato>,
                            <Dato key="g" tipo="lugar" nombre="Gobierna">
                              {listaY([
                                ...(c.regional > 0 ? [`${numero(c.regional)} ${c.regional === 1 ? "región" : "regiones"}`] : []),
                                ...(c.provincial > 0 ? [`${numero(c.provincial)} ${c.provincial === 1 ? "provincia" : "provincias"}`] : []),
                                ...(c.distrital > 0 ? [`${numero(c.distrital)} ${c.distrital === 1 ? "distrito" : "distritos"}`] : []),
                              ])}
                            </Dato>,
                          ]}
                        />
                      </span>
                    </span>
                    <span className="min-w-0" role="img" aria-label={`${c.total} gobiernos, frente a ${maximo} de la organización con más`}>
                      <span className="block h-2 overflow-hidden rounded-full bg-paperDeep">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (c.total / maximo) * 100)}%`, backgroundColor: color }} />
                      </span>
                      <span className="mt-0.5 block text-rotulo tabular-nums text-inkSoft">{numero(c.total)} {c.total === 1 ? "gobierno" : "gobiernos"}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta sm:justify-end">
                      <Link href={hrefGobiernos(c.clave, c.regional > 0 ? "regional" : c.provincial > 0 ? "provincial" : "distrital")} prefetch={false} className="relative z-10 inline-flex min-h-9 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                        Ver sus gobiernos <ChevronRight size={14} aria-hidden />
                      </Link>
                      {k && ((k.procesos ?? 0) > 0 || k.contratos > 0) ? (
                        // Sus procesos del OECE (desde 2015); antes, sólo los contratos de la base de Vigía (2026), y los
                        // períodos anteriores decían "Sin contratos en la base".
                        <Link href={`/app/partidos/${c.clave}?anio=${anio}`} prefetch={false} className="relative z-10 inline-flex min-h-9 flex-col items-end justify-center text-right leading-tight text-inkSoft underline-offset-4 hover:text-ink hover:underline">
                          <span>
                            <span className="font-mono tabular-nums text-ink">{numero(k.procesos ?? k.contratos)}</span> {(k.procesos ?? 0) > 0 ? "procesos" : "contratos"}
                          </span>
                          {(k.montoAdjudicadoPen ?? 0) > 0 && (
                            <span className="font-mono text-rotulo tabular-nums text-mute">{solesCompacto(k.montoAdjudicadoPen ?? 0)} adjudicados</span>
                          )}
                        </Link>
                      ) : (
                        contratos && <span className="text-mute">Sin procesos registrados</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            {ultima > 1 && <div className="flex justify-end">{pag(true)}</div>}
          </div>
        )}
      </ZonaResultados>
    </div>
  );
}
