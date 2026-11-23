"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchX } from "lucide-react";
import { nombreDepartamento } from "@/components/mapa/region-match";
import { rutaRegion } from "@/lib/regiones";
import { CLASE_ENLACE_CELDA, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado/Tabla";
import { BarraFiltros, type FiltroSecundario } from "@/components/listado/BarraFiltros";
import { Listado, ZonaResultados, useListado, type Parametros } from "@/components/listado/Listado";
import { Vistas, type Vista as OpcionVista } from "@/components/listado/Vistas";
import { Medidor } from "@/components/charts/BarraSegmentada";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { Ayuda, EnlaceFuente, Nota } from "@/components/patrones";
import { CeldaTasa } from "@/components/grafo/indicios";
import { Paginacion } from "@/components/ui/Paginacion";
import { SuperficiePestana } from "@/components/fichas/SuperficiePestana";
import { Skeleton } from "@/components/ui/Skeleton";
import { listaY, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { CONTRATACIONES_ABIERTAS, INFOGOB_JNE } from "@/lib/fuentes";
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
 * Lo que llega del servidor son datos planos y el nodo ya armado del mapa (`mapaNode`), nunca funciones.
 *
 * «Partidos» es UNA tabla (2026-11-13, auditoría visual: «la lista de partidos en tres páginas»): antes «Todos los
 * partidos» (cuántos gobiernos) y «Contratos por partido» (procesos y monto) eran dos listas de los mismos 103 partidos,
 * y el mapa de poder tenía una tercera. Ahora cada fila trae sus gobiernos, sus procesos, lo adjudicado, lo que hay en
 * Vigía y, en el período vigente, cuántas de sus entidades tienen contratos con indicio; el orden se elige arriba.
 * `?vista=contratos` sigue funcionando: abre la misma tabla ordenada por lo adjudicado.
 */

export type Vista = "gobiernos" | "partidos" | "mapa";

export interface ContratosDeUnPartido {
  contratos: number;
  leidos: number;
  enCola: number;
  /** Procesos adjudicados de sus gobiernos en el período (OECE, migraciones 65 y 68) y lo adjudicado en soles. */
  procesos?: number;
  montoAdjudicadoPen?: number;
}

/** Del mapa de poder (período vigente): de las entidades que gobierna, cuántas tienen contratos con indicio. */
export interface IndicioDeUnPartido {
  con: number;
  de: number;
  /** Contratos con indicio y su monto. */
  contratos: number;
  monto: number;
  /** Su página en el mapa de poder (dónde gobierna). */
  ruta: string;
}

// Listas de 10 (páginas cortas, pedido del usuario del 2026-11-23); el paginador lleva al resto.
const TAM = 10;

/** El orden de la tabla de partidos (`?orden=`). «indicio» sólo con los datos del mapa de poder (período vigente). */
const ORDENES_PARTIDOS = [
  { valor: "gobiernos", etiqueta: "Gobiernos" },
  { valor: "monto", etiqueta: "Adjudicado" },
  { valor: "procesos", etiqueta: "Procesos" },
  { valor: "indicio", etiqueta: "Con indicio" },
  { valor: "nombre", etiqueta: "Nombre" },
] as const;
type OrdenPartidos = (typeof ORDENES_PARTIDOS)[number]["valor"];

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
  { v: "partidos", texto: "Partidos" },
  { v: "mapa", texto: "En el mapa" },
];

/** Colores por organización para TODO el período: las 8 con más gobiernos, el resto «Otras» en gris. */
function coloresDelPeriodo(d: AutoridadesDatos, modo: Modo) {
  return coloresDeFilas([...d.regional, ...d.provincial, ...d.distrital], modo);
}

/**
 * El nombre de la organización con su color. En el celular va en DOS líneas: recortado en una, ocho «Movimiento
 * Regional…» distintos se veían iguales; desde md, una línea (el nombre entero en el `title`).
 *
 * Con `href` es el enlace a la ficha del partido (pedido del usuario del 2026-11-05: el chip parecía un enlace y no lo
 * era). `relative z-[1]`: queda por encima del enlace del lugar, que se estira sobre toda la fila.
 */
function ChipPartido({ nombre, tipo, color, href }: { nombre: string; tipo: TipoOrg; color: string; href?: string }) {
  const clase = "inline-flex max-w-full items-start gap-1.5 rounded-2xl border px-2.5 py-0.5 text-meta font-medium leading-snug text-ink";
  const estilo = { backgroundColor: `${color}22`, borderColor: `${color}66` };
  const titulo = `${nombre}, ${TIPO_ORG_LABEL[tipo].toLowerCase()}`;
  const cuerpo = (
    <>
      <span aria-hidden className="mt-[0.35rem] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 line-clamp-2 md:line-clamp-1">{nombre}</span>
    </>
  );
  if (!href) {
    return (
      <span className={clase} style={estilo} title={titulo}>
        {cuerpo}
      </span>
    );
  }
  return (
    <Link
      href={href}
      prefetch={false}
      title={`${titulo}: ver su ficha`}
      className={cn(
        clase,
        "relative z-[1] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
      )}
      style={estilo}
    >
      {cuerpo}
    </Link>
  );
}

/** La parte de los votos: «51 %» y, al lado, un medidor chico contra el total (una proporción contra su tope). */
function Votos({ p }: { p: number | null }) {
  const texto = pct(p);
  if (p == null || texto == null) return <span className="font-mono text-meta tabular-nums text-inkSoft">Sin dato</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-meta tabular-nums text-inkSoft">{texto}</span>
      <Medidor parte={p} etiqueta={`${texto} de los votos`} className="h-1.5 w-12 shrink-0" />
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
  indicios = null,
  mapaNode,
}: {
  anio: number;
  periodos: { anio: number; texto: string }[];
  vista: Vista;
  /** Contratos asociados a cada partido del período, por clave. `null`: la API no respondió. */
  contratos: Record<string, ContratosDeUnPartido> | null;
  /** Del mapa de poder, por clave (sólo el período vigente). `null`: otro período o la API no respondió. */
  indicios?: Record<string, IndicioDeUnPartido> | null;
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
  // El orden de la tabla de partidos. Un enlace viejo a «Contratos por partido» (`?vista=contratos`) abre por lo adjudicado.
  const ordenPartidos = (ORDENES_PARTIDOS.find((o) => o.valor === params.get("orden") && (o.valor !== "indicio" || indicios))?.valor ??
    (params.get("vista") === "contratos" ? "monto" : "gobiernos")) as OrdenPartidos;

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
  // Cambiar de período conserva la vista, el nivel y el orden de la tabla de partidos (el de «Con indicio» sólo existe
  // en el período vigente: en otro, vuelve al de siempre).
  const hrefPeriodo = (a: number) =>
    urlCon(pathname, {
      anio: String(a),
      vista: vista !== "gobiernos" ? vista : undefined,
      nivel: vista === "gobiernos" && nivel !== "regional" ? nivel : undefined,
      orden: vista === "partidos" && ordenPartidos !== "gobiernos" && ordenPartidos !== "indicio" ? ordenPartidos : undefined,
    });

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
  // Gobiernos | Adjudicado | Procesos | Con indicio | Nombre: el orden de la tabla de partidos, en la misma fila (§14.1).
  // Cambiarlo conserva la búsqueda.
  const ordenesPartidos: OpcionVista[] | null =
    vista === "partidos"
      ? ORDENES_PARTIDOS.filter((o) => o.valor !== "indicio" || indicios).map((o) => ({
          href: urlCon(pathname, { anio: String(anio), vista: "partidos", orden: o.valor === "gobiernos" ? undefined : o.valor, q: q || undefined }),
          etiqueta: o.etiqueta,
          activa: o.valor === ordenPartidos,
        }))
      : null;

  return (
    <div className="space-y-4">
      {/* Qué mirar: la decisión principal, en granate. Debajo, lo que la acota (período y nivel, o el orden), un escalón
          abajo y con su rótulo también en el celular; la fila se parte en renglones si no entra. El período, una sola vez
          en la página (también en el mapa: antes el mapa tenía su propio selector de elección debajo de éste). */}
      <Vistas vistas={vistas} etiqueta="Qué mirar" />
      {/* El período, el nivel y la tabla en UNA tarjeta (2026-11-23, «secciones sin fondo ni forma»): antes los selectores, el
          reparto, el buscador y la tabla flotaban cada uno por su lado sobre el fondo. El mapa trae su propio marco. */}
      <Marco conMarco={vista !== "mapa"}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <ConRotulo rotulo="Gobiernos de">
            <Vistas vistas={vistasPeriodo} etiqueta="Período de gobierno" variante="secundaria" />
          </ConRotulo>
          {niveles && (
            <ConRotulo rotulo="Nivel">
              <Vistas vistas={niveles} etiqueta="Nivel de gobierno" variante="secundaria" />
            </ConRotulo>
          )}
          {ordenesPartidos && (
            <ConRotulo rotulo="Ordenar por">
              <Vistas vistas={ordenesPartidos} etiqueta="Orden de la tabla de partidos" variante="secundaria" />
            </ConRotulo>
          )}
        </div>

      {(vista === "gobiernos" || vista === "partidos") && (
        <>
          {fallo && <VacioEnLinea tono="error">No pudimos leer los resultados de {anio}. Recarga la página para reintentar.</VacioEnLinea>}

          {datos && resumen && vista === "gobiernos" && (
            <Gobiernos datos={datos} nivel={nivel} q={q} region={region} org={org} orden={orden} pagina={pagina} anio={anio} claves={resumen.claves} />
          )}
          {datos && resumen && vista === "partidos" && (
            <TodosLosPartidos
              datos={datos}
              resumen={resumen}
              q={q}
              pagina={pagina}
              anio={anio}
              periodo={periodos.find((p) => p.anio === anio)?.texto ?? String(anio)}
              orden={ordenPartidos}
              contratos={contratos}
              indicios={indicios}
            />
          )}
          {!datos && !fallo && <TablaCargando />}
        </>
      )}

      {vista === "mapa" && mapaNode}
      </Marco>
    </div>
  );
}

/** La tarjeta de la vista (`SuperficiePestana`); con el mapa, sin marco: el mapa trae el suyo. */
function Marco({ conMarco, children }: { conMarco: boolean; children: ReactNode }) {
  return conMarco ? <SuperficiePestana className="space-y-4">{children}</SuperficiePestana> : <div className="space-y-4">{children}</div>;
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
    { clave: "votos", titulo: "Votos", ancho: "8rem", alinear: "der", desde: "lg" },
  ];
  const filas: Fila[] = visibles.map((f) => {
    const o = orgDe(datos, f.o);
    const color = colores.get(f.o) ?? otras;
    // La región abre su ficha; una provincia o un distrito, la de su región con su nombre ya buscado.
    const hrefLugar = nivel === "regional" ? rutaRegion(f.region) : rutaRegion(f.region, "territorio", f.lugar);
    return {
      id: f.id,
      // Sin `href` de fila (una fila-enlace no puede llevar otro enlace adentro): el nombre del lugar es el enlace y se
      // estira sobre la fila entera (cada `li` es `relative`, por la clase de la tabla), y el chip del partido, el suyo,
      // por encima. Así toda la fila sigue abriendo el lugar y el partido abre su ficha.
      celdas: {
        lugar: (
          <span className="block min-w-0">
            <Link
              href={hrefLugar}
              prefetch={false}
              className="block truncate text-dato font-semibold text-ink after:absolute after:inset-0 group-hover:text-granate focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate"
            >
              {f.lugar}
            </Link>
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
        partido: <ChipPartido nombre={o.n} tipo={o.t} color={color} href={`/app/partidos/${encodeURIComponent(claveOrg(o.n))}?anio=${anio}`} />,
        votos: <Votos p={f.p} />,
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
          <VacioEnLinea
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
          </VacioEnLinea>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">{pag(false)}</div>
            {/* `[&_li]:relative`: cada fila es el borde del enlace estirado de su lugar (ver `filas`). */}
            <Tabla columnas={columnas} filas={filas} etiqueta={`Gobiernos ${plural} ${anio}`} densidad="compacta" className="[&_li]:relative" />
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
    <section
      aria-label={`Reparto de ${etiqueta} entre organizaciones`}
      // Dentro de la tarjeta de la vista, en su franja hundida y sin borde (no una caja dentro de la caja).
      className="rounded-2xl border border-line bg-paper p-3 sm:p-4 [.tarjeta_&]:rounded-xl [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft"
    >
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
              className={cn("inline-flex max-w-[16rem] items-start gap-1.5 rounded-lg py-0.5 pr-1 text-left leading-snug text-inkSoft hover:text-ink", orgIndice === i && "font-semibold text-ink")}
            >
              <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colores.get(i) ?? otrasReparto }} />
              {/* El nombre entero, en dos renglones si no entra («Alianza Gobierno Unidad y Acci…», 2026-11-23). */}
              <span className="min-w-0">{orgDe(datos, i).n}</span>
              <span className="shrink-0 self-start font-mono tabular-nums text-mute">{numero(n)}</span>
            </button>
          </li>
        ))}
        {enEsteNivel.length > grandes.length && <li className="py-0.5 text-mute">y otras {numero(enEsteNivel.length - grandes.length)} organizaciones</li>}
      </ul>
    </section>
  );
}

// ── Partidos: una sola tabla ───────────────────────────────────────────────────────────────────

/**
 * Todas las organizaciones que gobernaron algo en el período, en UNA tabla: sus gobiernos (del archivo del JNE), los
 * procesos adjudicados y lo adjudicado bajo esos gobiernos (OECE), sus contratos en la base de Vigía y, en el período
 * vigente, la parte de sus entidades con contratos con indicio (mapa de poder). Arriba, las cifras del período; el
 * orden, en la fila del período (`DirectorioGobiernos`).
 */
function TodosLosPartidos({
  datos,
  resumen,
  q,
  pagina,
  anio,
  periodo,
  orden,
  contratos,
  indicios,
}: {
  datos: AutoridadesDatos;
  resumen: Resumen;
  q: string;
  pagina: number;
  anio: number;
  periodo: string;
  orden: OrdenPartidos;
  contratos: Record<string, ContratosDeUnPartido> | null;
  indicios: Record<string, IndicioDeUnPartido> | null;
}) {
  const pathname = usePathname();
  const parametros: Parametros = { anio: String(anio), vista: "partidos", orden: orden === "gobiernos" ? undefined : orden, q: q || undefined };
  return (
    <div className="space-y-3">
      <CifrasPartidos resumen={resumen} periodo={periodo} contratos={contratos} indicios={indicios} />
      <Listado ruta={pathname} parametros={parametros}>
        <ListaPartidos datos={datos} resumen={resumen} q={q} pagina={pagina} anio={anio} orden={orden} contratos={contratos} indicios={indicios} parametros={parametros} />
      </Listado>
      <Nota>
        Cuenta quién ganó la elección de {anio}, no qué hizo cada gobierno: una vacancia, una revocatoria o un reemplazo dentro del período no está registrado.
        Cada proceso se asocia al partido que gobernaba la entidad el día en que se convocó. Una señal es un motivo para revisar un contrato, nunca una
        acusación contra un partido ni una persona. Fuentes: <EnlaceFuente href={INFOGOB_JNE}>JNE, Plataforma Electoral (Infogob)</EnlaceFuente> y{" "}
        <EnlaceFuente href={CONTRATACIONES_ABIERTAS}>OECE (SEACE)</EnlaceFuente>.
      </Nota>
    </div>
  );
}

/** Las cifras del período: sus gobiernos, los procesos y lo adjudicado bajo ellos y, en el vigente, las entidades con indicio. */
function CifrasPartidos({
  resumen,
  periodo,
  contratos,
  indicios,
}: {
  resumen: Resumen;
  periodo: string;
  contratos: Record<string, ContratosDeUnPartido> | null;
  indicios: Record<string, IndicioDeUnPartido> | null;
}) {
  const nivel = { regional: 0, provincial: 0, distrital: 0 };
  for (const c of resumen.porOrg) {
    nivel.regional += c.regional;
    nivel.provincial += c.provincial;
    nivel.distrital += c.distrital;
  }
  const gobiernos = nivel.regional + nivel.provincial + nivel.distrital;
  const ks = contratos ? Object.values(contratos) : null;
  const procesos = ks ? ks.reduce((s, k) => s + (k.procesos ?? 0), 0) : null;
  const monto = ks ? ks.reduce((s, k) => s + (k.montoAdjudicadoPen ?? 0), 0) : null;
  const is = indicios ? Object.values(indicios) : null;
  const con = is ? is.reduce((s, i) => s + i.con, 0) : 0;
  const de = is ? is.reduce((s, i) => s + i.de, 0) : 0;
  const items: Cifra[] = [
    {
      valor: numero(gobiernos),
      etiqueta: "gobiernos",
      contexto: `${numero(nivel.regional)} regiones, ${numero(nivel.provincial)} provincias y ${numero(nivel.distrital)} distritos`,
    },
    { valor: procesos != null ? numero(procesos) : null, etiqueta: "procesos adjudicados", contexto: `bajo esos gobiernos, de ${periodo}` },
    { valor: monto != null ? solesCompacto(monto) : null, etiqueta: "adjudicado", contexto: "en soles, según el OECE" },
  ];
  if (is && de > 0) {
    items.push({
      valor: `${numero(con)} de ${numero(de)}`,
      etiqueta: "entidades con indicio",
      contexto: `${porcentaje((con / de) * 100)} de las que gobierna hoy algún partido`,
      parte: con / de,
      tono: "media",
      href: "/app/poder?seccion=entidades",
    });
  }
  return <CifrasEnFila items={items} />;
}

const AYUDA_VIGIA = (
  <Ayuda titulo="¿Qué es «En Vigía»?">
    <span className="block">Los contratos de sus gobiernos que están en la base de Vigía (desde 2026) y cuántos ya se leyeron a fondo.</span>
  </Ayuda>
);

const AYUDA_INDICIO = (
  <Ayuda titulo="¿Qué es «entidades con indicio»?">
    <span className="block">
      De las entidades que gobierna hoy el partido (alcaldías y gobiernos regionales, JNE), cuántas tienen al menos un contrato ganado por una empresa
      que le financió la campaña, que le vendió a la campaña o que tiene un socio contratado por la misma entidad.
    </span>
    <span className="mt-1.5 block">Son cruces de registros públicos para revisar: no son una acusación. Cada fila lleva a dónde gobierna.</span>
  </Ayuda>
);

function ListaPartidos({
  datos,
  resumen,
  q,
  pagina,
  anio,
  orden,
  contratos,
  indicios,
  parametros,
}: {
  datos: AutoridadesDatos;
  resumen: Resumen;
  q: string;
  pagina: number;
  anio: number;
  orden: OrdenPartidos;
  contratos: Record<string, ContratosDeUnPartido> | null;
  indicios: Record<string, IndicioDeUnPartido> | null;
  parametros: Parametros;
}) {
  const otrasTodos = paletaOrg(useModo()).otras;
  const pathname = usePathname();
  const hrefGobiernos = (clave: string, nivelDe: Nivel) => urlCon(pathname, { anio: String(anio), nivel: nivelDe !== "regional" ? nivelDe : undefined, org: clave });

  const filas = useMemo(() => {
    const k = normalizar(q);
    const base = resumen.porOrg.map((c) => {
      const o = orgDe(datos, c.org);
      const clave = claveOrg(o.n);
      return { ...c, o, clave, k: contratos?.[clave], ind: indicios?.[clave] };
    });
    const procesosDe = (x: (typeof base)[number]) => x.k?.procesos ?? 0;
    const montoDe = (x: (typeof base)[number]) => x.k?.montoAdjudicadoPen ?? 0;
    // El de indicio, por la PARTE de sus entidades con indicio; los que gobiernan menos de 5 van al final (con una o dos,
    // un solo municipio los lleva a 0 o a 100 %), como en el mapa de poder.
    const tasa = (x: (typeof base)[number]) => (x.ind && x.ind.de >= 5 ? x.ind.con / x.ind.de : -1);
    const nombre = (a: (typeof base)[number], b: (typeof base)[number]) => alfabetico(a.o.n, b.o.n);
    return base
      .filter((c) => !k || normalizar(c.o.n).includes(k))
      .sort((a, b) =>
        orden === "nombre"
          ? nombre(a, b)
          : orden === "monto"
            ? montoDe(b) - montoDe(a) || b.total - a.total || nombre(a, b)
            : orden === "procesos"
              ? procesosDe(b) - procesosDe(a) || b.total - a.total || nombre(a, b)
              : orden === "indicio"
                ? tasa(b) - tasa(a) || (b.ind?.de ?? 0) - (a.ind?.de ?? 0) || nombre(a, b)
                : b.total - a.total || montoDe(b) - montoDe(a) || nombre(a, b),
      );
  }, [resumen, datos, q, orden, contratos, indicios]);
  const ultima = Math.max(1, Math.ceil(filas.length / TAM));
  const actual = Math.min(pagina, ultima);
  const visibles = filas.slice((actual - 1) * TAM, actual * TAM);
  const pag = (subir: boolean) => (
    <Paginacion actual={actual} paginas={ultima} total={filas.length} tam={TAM} navegacion="url" hrefBase={pathname} query={parametros} cargando={false} nombre="organizaciones" subir={subir} />
  );

  // En el celular: el partido (con sus gobiernos en la línea de abajo) y lo adjudicado con sus procesos; desde md, una
  // columna por dato, con su barra contra el mayor de la página.
  const columnas: Columna[] = [
    { clave: "partido", titulo: "Partido u organización", ancho: "minmax(0,1.6fr)" },
    { clave: "gobiernos", titulo: "Gobiernos", ancho: "6.5rem", alinear: "der", desde: "md" },
    { clave: "procesos", titulo: "Procesos", ancho: "6.5rem", alinear: "der", desde: "lg" },
    { clave: "monto", titulo: "Adjudicado", ancho: "7.5rem", alinear: "der", desde: "md" },
    { clave: "montoCel", titulo: "Adjudicado", ancho: "6.5rem", alinear: "der", hasta: "md", igual: false },
    { clave: "vigia", titulo: "En Vigía", ancho: "7rem", alinear: "der", desde: "xl", ayuda: AYUDA_VIGIA },
    ...(indicios ? [{ clave: "indicio", titulo: "Entidades con indicio", ancho: "minmax(8.5rem,0.7fr)", desde: "lg", ayuda: AYUDA_INDICIO } satisfies Columna] : []),
  ];

  const ninguno = <span className="font-sans text-mute">Ninguno</span>;
  const tabla: Fila[] = visibles.map((c) => {
    const color = resumen.colores.get(c.org) ?? otrasTodos;
    const procesos = c.k?.procesos ?? 0;
    const monto = c.k?.montoAdjudicadoPen ?? 0;
    const nivelDe: Nivel = c.regional > 0 ? "regional" : c.provincial > 0 ? "provincial" : "distrital";
    const gobierna = listaY([
      ...(c.regional > 0 ? [`${numero(c.regional)} ${c.regional === 1 ? "región" : "regiones"}`] : []),
      ...(c.provincial > 0 ? [`${numero(c.provincial)} ${c.provincial === 1 ? "provincia" : "provincias"}`] : []),
      ...(c.distrital > 0 ? [`${numero(c.distrital)} ${c.distrital === 1 ? "distrito" : "distritos"}`] : []),
    ]);
    return {
      id: c.clave || String(c.org),
      href: `/app/partidos/${encodeURIComponent(c.clave)}?anio=${anio}`,
      enlaces: true,
      etiqueta: `Ver la ficha de ${c.o.n}`,
      celdas: {
        partido: (
          <CeldaPrincipal
            textoCompleto={c.o.n}
            metaEnVarias
            titulo={
              <>
                <span aria-hidden className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                {c.o.n}
              </>
            }
            meta={[
              <Dato key="t" tipo="tipo">{TIPO_ORG_LABEL[c.o.t]}</Dato>,
              <Dato key="g" tipo="lugar" nombre="Gobierna">
                {gobierna}
              </Dato>,
            ]}
          />
        ),
        gobiernos: (
          <CeldaNumero>
            <Link href={hrefGobiernos(c.clave, nivelDe)} prefetch={false} title={`Ver sus ${numero(c.total)} gobiernos en la lista de Quién gobierna`} className={CLASE_ENLACE_CELDA}>
              {numero(c.total)}
            </Link>
          </CeldaNumero>
        ),
        procesos: contratos ? <CeldaNumero>{procesos > 0 ? numero(procesos) : ninguno}</CeldaNumero> : null,
        monto: contratos ? <CeldaNumero>{monto > 0 ? solesCompacto(monto) : ninguno}</CeldaNumero> : null,
        montoCel: contratos ? (
          <CeldaNumero sub={procesos > 0 ? `${numero(procesos)} ${procesos === 1 ? "proceso" : "procesos"}` : undefined}>{monto > 0 ? solesCompacto(monto) : ninguno}</CeldaNumero>
        ) : null,
        vigia: contratos ? (
          <CeldaNumero sub={c.k && c.k.contratos > 0 ? `${numero(c.k.leidos)} ${c.k.leidos === 1 ? "leído" : "leídos"}` : undefined}>
            {c.k && c.k.contratos > 0 ? numero(c.k.contratos) : ninguno}
          </CeldaNumero>
        ) : null,
        indicio: c.ind ? (
          <Link href={c.ind.ruta} prefetch={false} title={`Dónde gobierna ${c.o.n} y qué contratos tienen indicio`} className="block w-full min-w-0">
            <CeldaTasa con={c.ind.con} de={c.ind.de} />
          </Link>
        ) : (
          <span className="text-meta text-mute">Sin entidades hoy</span>
        ),
      },
      magnitudes: { gobiernos: c.total, procesos: contratos ? procesos : null, monto: contratos ? monto : null },
    };
  });

  return (
    <div className="space-y-3">
      <BarraFiltros busqueda={{ param: "q", placeholder: "Buscar un partido, movimiento o alianza…", etiqueta: "Buscar un partido", min: 2 }} />
      {!contratos && (
        <VacioEnLinea tono="error">No pudimos leer los procesos de cada partido: la tabla muestra sus gobiernos y dice «Sin dato» en lo demás.</VacioEnLinea>
      )}
      <ZonaResultados>
        {visibles.length === 0 ? (
          <VacioEnLinea icono={<SearchX size={16} aria-hidden />}>Ninguna organización se llama así.</VacioEnLinea>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">{pag(false)}</div>
            <Tabla columnas={columnas} filas={tabla} etiqueta={`Partidos y organizaciones que gobiernan en ${anio}`} densidad="compacta" />
            {ultima > 1 && <div className="flex justify-end">{pag(true)}</div>}
          </div>
        )}
      </ZonaResultados>
    </div>
  );
}
