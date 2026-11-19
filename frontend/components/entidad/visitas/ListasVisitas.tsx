import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { BarraFiltros, Listado, Tabla, TablaSkeleton, ZonaResultados, type Columna, type Fila, type FiltroSecundario, type OpcionFaceta, type Parametros } from "@/components/listado";
import { Ayuda, AyudaTermino, CabeceraPestana, EstadoError, EstadoVacio } from "@/components/patrones";
import { PaginadorHayMas, hrefPagina } from "@/components/ordenes/ListaOrdenes";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { Paginacion } from "@/components/ui/Paginacion";
import { tituloNatural } from "@/lib/landing";
import { uno } from "@/lib/utils";
import { P_VISITAS, getListaVisitas, type FilaDe, type ListaVisitas, type PaginaVisitas, type RespuestaLista } from "@/lib/visitas";
import {
  COLUMNAS_AREAS,
  COLUMNAS_EMPRESAS,
  COLUMNAS_ORGANIZACIONES,
  COLUMNAS_PARIENTES,
  COLUMNAS_VISITAS,
  ROLES,
  TIPO_DESPUES,
  filaArea,
  filaEmpresa,
  filaOrganizacion,
  filaPariente,
  filaVisita,
} from "../VisitasTablas";

/**
 * Las cinco listas de la pestaña «Visitas» de una entidad, cada una ENTERA y paginada en el servidor (GET
 * /visitas/entidad/:ruc/lista): su búsqueda, sus filtros y su orden van a la URL con su prefijo (`P_VISITAS`), como toda
 * lista de la ficha (§14.1: el enlace comparte la vista, el botón atrás la deshace). Antes llegaban recortadas a las 1,000
 * primeras y filtraban en el navegador. Cada una: su cabecera (h3, una línea, la ⓘ y el paginador de arriba), la barra de
 * filtros y la tabla compacta con el paginador de abajo. Server components.
 */

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Lo que una lista lee de la URL: sus parámetros con el nombre de la API, los de la ficha para sus enlaces y su página. */
function leer(sp: Busqueda, que: ListaVisitas): { api: Record<string, string | undefined>; parametros: Parametros; actual: number; filtrada: boolean } {
  const P = P_VISITAS[que] as Record<string, string>;
  const api: Record<string, string | undefined> = {};
  const parametros: Parametros = { seccion: "visitas", [P_VISITAS.sub]: que };
  for (const [k, param] of Object.entries(P)) {
    if (k === "page") continue;
    const v = uno(sp?.[param])?.slice(0, 200);
    api[k] = v;
    parametros[param] = v;
  }
  const actual = Math.max(1, Math.floor(Number(uno(sp?.[P.page]))) || 1);
  const filtrada = Object.entries(api).some(([k, v]) => k !== "orden" && !!v);
  return { api, parametros, actual, filtrada };
}

interface Config<L extends ListaVisitas> {
  que: L;
  columnas: Columna[];
  fila: (x: FilaDe[L], i: number) => Fila;
  /** La barra de filtros con lo que trajo la página (sus conteos), o sin ella mientras llega. */
  barra: (p: PaginaVisitas<L> | null, api: Record<string, string | undefined>) => ReactNode;
  /** Sustantivo plural del paginador («empresas») y nombre de la tabla para el lector de pantalla. */
  nombre: string;
  etiqueta: string;
  /** Sin ninguna fila y sin filtros. */
  vacia: { titulo: string; texto: string };
}

/** La lista: cabecera con su paginador, barra de filtros y resultados. `ruta` es la de la ficha. */
async function Lista<L extends ListaVisitas>({ ruc, sp, cfg, cabecera }: { ruc: string; sp: Busqueda; cfg: Config<L>; cabecera: { titulo: string; linea: string; ayuda?: ReactNode } }) {
  const ruta = `/entidad/${ruc}`;
  const { api, parametros, actual, filtrada } = leer(sp, cfg.que);
  const paginaP = getListaVisitas(ruc, cfg.que, { ...api, page: actual > 1 ? actual : undefined });
  const P = P_VISITAS[cfg.que];
  return (
    <div>
      <CabeceraPestana
        titulo={cabecera.titulo}
        ayuda={cabecera.ayuda}
        acciones={
          <Suspense fallback={null}>
            <Paginador pagina={paginaP} ruta={ruta} parametros={parametros} paramPagina={P.page} actual={actual} nombre={cfg.nombre} />
          </Suspense>
        }
      >
        {cabecera.linea}
      </CabeceraPestana>
      <Listado ruta={ruta} parametros={parametros} paramPagina={P.page}>
        <div className="space-y-3">
          <Suspense fallback={cfg.barra(null, api)}>
            <BarraAsync pagina={paginaP} cfg={cfg} api={api} />
          </Suspense>
          <ZonaResultados>
            <Suspense fallback={<TablaSkeleton columnas={cfg.columnas} filas={8} />}>
              <Resultados pagina={paginaP} cfg={cfg} ruta={ruta} parametros={parametros} actual={actual} filtrada={filtrada} />
            </Suspense>
          </ZonaResultados>
        </div>
      </Listado>
    </div>
  );
}

async function BarraAsync<L extends ListaVisitas>({ pagina, cfg, api }: { pagina: Promise<RespuestaLista<L>>; cfg: Config<L>; api: Record<string, string | undefined> }) {
  const r = await pagina;
  return <>{cfg.barra(r.ok ? r.pagina : null, api)}</>;
}

/**
 * El paginador: con el total, «1–15 de 328» y las páginas; sin él (la lista de visitas con filtros combinados), el rango y
 * anterior/siguiente. Nada si la lista cabe en una página.
 */
function Control({ p, ruta, parametros, paramPagina, actual, nombre, subir }: { p: PaginaVisitas<ListaVisitas>; ruta: string; parametros: Parametros; paramPagina: string; actual: number; nombre: string; subir: boolean }) {
  if (p.total != null) {
    if (p.total <= p.size) return null;
    return (
      <Paginacion actual={actual} paginas={Math.ceil(p.total / p.size)} total={p.total} tam={p.size} navegacion="url" hrefBase={ruta} query={parametros}
        paramPagina={paramPagina} cargando={false} nombre={nombre} subir={subir} />
    );
  }
  if (actual === 1 && !p.hayMas) return null;
  return <PaginadorHayMas ruta={ruta} parametros={parametros} paramPagina={paramPagina} actual={actual} tam={p.size} enPagina={p.filas.length} hayMas={p.hayMas} subir={subir} />;
}

async function Paginador({ pagina, ...props }: { pagina: Promise<RespuestaLista<ListaVisitas>>; ruta: string; parametros: Parametros; paramPagina: string; actual: number; nombre: string }) {
  const r = await pagina;
  if (!r.ok || !r.pagina.filas.length) return null;
  return <Control p={r.pagina} {...props} subir={false} />;
}

const MOTIVO: Record<"lenta" | "honda" | "error", { titulo: string; texto: string }> = {
  lenta: { titulo: "La lista tardó demasiado", texto: "Esta entidad tiene muchísimas visitas: elige un año o acota lo que buscas." },
  honda: { titulo: "Esa página está muy lejos", texto: "Elige un año o el orden «Lo más antiguo» para llegar a esas visitas." },
  error: { titulo: "No pudimos cargar la lista", texto: "Suele ser momentáneo: vuelve a intentarlo en unos segundos." },
};

async function Resultados<L extends ListaVisitas>({ pagina, cfg, ruta, parametros, actual, filtrada }: {
  pagina: Promise<RespuestaLista<L>>;
  cfg: Config<L>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  filtrada: boolean;
}) {
  const r = await pagina;
  const P = P_VISITAS[cfg.que];
  if (!r.ok) {
    const m = MOTIVO[r.motivo];
    return (
      <EstadoError titulo={m.titulo} conLlamita={false} accion={<a href={hrefPagina(ruta, parametros, P.page, actual)} className={CLASE_ACCION_LISTA}>Reintentar</a>}>
        {m.texto}
      </EstadoError>
    );
  }
  const p = r.pagina;
  if (!p.filas.length) {
    if (actual > 1) {
      return (
        <EstadoVacio
          compacto
          conLlamita={false}
          titulo="Esta página de la lista ya no tiene filas"
          accion={<Link href={hrefPagina(ruta, parametros, P.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
        />
      );
    }
    return filtrada ? (
      <EstadoVacio compacto conLlamita={false} titulo="Nada coincide con estos filtros">Quita un filtro o cambia lo que buscas.</EstadoVacio>
    ) : (
      <EstadoVacio compacto conLlamita={false} titulo={cfg.vacia.titulo}>{cfg.vacia.texto}</EstadoVacio>
    );
  }
  const desde = (actual - 1) * p.size;
  const filas = p.filas.map((x, i) => cfg.fila(x, desde + i));
  const variasPaginas = p.total != null ? p.total > p.size : actual > 1 || p.hayMas;
  return (
    <div className="space-y-3">
      <Tabla columnas={cfg.columnas} filas={filas} etiqueta={cfg.etiqueta} densidad="compacta" />
      {variasPaginas && (
        <div className="flex justify-end">
          <Control p={p as PaginaVisitas<ListaVisitas>} ruta={ruta} parametros={parametros} paramPagina={P.page} actual={actual} nombre={cfg.nombre} subir />
        </div>
      )}
    </div>
  );
}

// ─── Opciones de los filtros, con sus conteos ───────────────────────────────────

/** Las opciones de un filtro con el conteo que mandó la API (null mientras llega o si no se sabe). */
const conConteo = (p: PaginaVisitas<ListaVisitas> | null, dim: string, opciones: { valor: string; etiqueta: string }[]) =>
  opciones.map((o) => ({ ...o, conteo: p?.facetas?.[dim] ? p.facetas[dim]![o.valor] ?? 0 : null }));
/** Cuántas hay en todas las opciones de un filtro (el «Todas» de la faceta). */
const sumaDe = (p: PaginaVisitas<ListaVisitas> | null, dim: string) => {
  const f = p?.facetas?.[dim];
  return f ? Object.values(f).reduce((s, n) => s + n, 0) : null;
};
const SI_NO = (si: string, no: string) => [{ valor: "si", etiqueta: si }, { valor: "no", etiqueta: no }];

// ─── Las cinco listas ───────────────────────────────────────────────────────────

export function ListaEmpresasVisita({ ruc, sp }: { ruc: string; sp: Busqueda }) {
  const P = P_VISITAS.empresas;
  return (
    <Lista
      ruc={ruc}
      sp={sp}
      cabecera={{
        titulo: "Empresas que ganaron algo después de una visita de su gente",
        linea: "Su representante, un socio, un directivo o alguien que dijo venir de ella la visitó, y después la entidad le dio un contrato o una orden.",
        ayuda: (
          <Ayuda titulo="¿Cómo se reconoce a la empresa?">
            Por el documento de quien visita: es su socio, su representante legal o un directivo en el Registro Nacional de Proveedores
            (OECE), aunque haya dicho venir de otra organización o a título personal. También cuenta quien dijo venir de la empresa.
            «Ganó después» es lo que la entidad le dio desde la primera de esas visitas: la suma de sus contratos y órdenes, y la fecha
            del primero.
          </Ayuda>
        ),
      }}
      cfg={{
        que: "empresas",
        columnas: COLUMNAS_EMPRESAS,
        fila: (x) => filaEmpresa(x, ruc),
        nombre: "empresas",
        etiqueta: "Empresas que ganaron algo después de una visita de su gente (toca una para ver el detalle)",
        vacia: { titulo: "Ninguna ganó algo después", texto: "Ninguna empresa cuya gente la visitó recibió después un contrato o una orden de esta entidad." },
        barra: (p) => (
          <BarraFiltros
            busqueda={{ param: P.q, placeholder: "Buscar una empresa o su RUC…", etiqueta: "Buscar entre las empresas que ganaron algo después", min: 2 }}
            faceta={{
              param: P.antes,
              etiqueta: "Antes de la visita",
              todas: "Todas",
              conteoTodas: sumaDe(p, "antes"),
              nombreEnChip: false,
              opciones: conConteo(p, "antes", [{ valor: "no", etiqueta: "Nunca le vendía" }, { valor: "si", etiqueta: "Ya le vendía" }]).map(
                (o): OpcionFaceta => (o.valor === "no" ? { ...o, tono: "media", icono: "atencion" } : o),
              ),
            }}
            visibles={[
              {
                param: P.via, etiqueta: "Quién la visitó", corta: "Quién", todas: "Cualquiera de su gente",
                opciones: conConteo(p, "via", ROLES.map((r) => ({ valor: r.clave === "porNombre" ? "nombre" : r.clave, etiqueta: r.filtro }))),
              },
              { param: P.decisor, etiqueta: "Visitó a quien decide las compras", corta: "A quien decide", todas: "A quien decide o no", opciones: conConteo(p, "decisor", SI_NO("Sí", "No")) },
            ]}
            filtros={[
              { param: P.declaro, etiqueta: "Dijo venir de la empresa", todas: "Lo dijera o no", opciones: conConteo(p, "declaro", SI_NO("Sí", "No: sólo se la reconoce por su gente")) },
              {
                param: P.tipo, etiqueta: "Lo primero que le dio", todas: "Contrato u orden",
                opciones: conConteo(p, "tipo", (["contrato", "consorcio", "orden"] as const).map((t) => ({ valor: t, etiqueta: TIPO_DESPUES[t] }))),
              },
            ]}
            orden={{
              param: P.orden,
              porDefecto: "nueva",
              opciones: [
                { valor: "nueva", etiqueta: "Primero las que nunca le vendían" },
                { valor: "monto", etiqueta: "Más ganado después" },
                { valor: "visitas", etiqueta: "Más visitas" },
                { valor: "dias", etiqueta: "Más cerca de una visita" },
                { valor: "reciente", etiqueta: "Lo más reciente" },
              ],
            }}
          />
        ),
      }}
    />
  );
}

export function ListaOrganizacionesVisita({ ruc, sp }: { ruc: string; sp: Busqueda }) {
  const P = P_VISITAS.organizaciones;
  return (
    <Lista
      ruc={ruc}
      sp={sp}
      cabecera={{
        titulo: "Quiénes la visitan",
        linea: "Cada organización que declaró quien visitó, con cuántas visitas y lo que la entidad le dio después a su empresa.",
      }}
      cfg={{
        que: "organizaciones",
        columnas: COLUMNAS_ORGANIZACIONES,
        fila: (x, i) => filaOrganizacion(x, ruc, i),
        nombre: "organizaciones",
        etiqueta: "Organizaciones que la visitan (toca una para ver su detalle y sus visitas)",
        vacia: { titulo: "Sin organizaciones", texto: "Quienes la visitaron no declararon venir de ninguna organización." },
        barra: (p) => (
          <BarraFiltros
            busqueda={{ param: P.q, placeholder: "Buscar una empresa, una organización o un RUC…", etiqueta: "Buscar entre quienes la visitan", min: 2 }}
            faceta={{
              param: P.despues,
              etiqueta: "Ganó algo después",
              todas: "Todas",
              conteoTodas: sumaDe(p, "despues"),
              nombreEnChip: false,
              opciones: conConteo(p, "despues", SI_NO("Ganó algo después", "Nada después")),
            }}
            visibles={[
              { param: P.tipo, etiqueta: "Tipo", corta: "Tipo", todas: "Privadas y públicas", opciones: conConteo(p, "tipo", [{ valor: "privada", etiqueta: "Privada" }, { valor: "publica", etiqueta: "Entidad pública" }]) },
              { param: P.decisor, etiqueta: "Visitó a quien decide las compras", corta: "A quien decide", todas: "A quien decide o no", opciones: conConteo(p, "decisor", SI_NO("Sí", "No")) },
            ]}
            orden={{
              param: P.orden,
              porDefecto: "visitas",
              opciones: [
                { valor: "visitas", etiqueta: "Más visitas" },
                { valor: "monto", etiqueta: "Más ganado después" },
                { valor: "reciente", etiqueta: "Visita más reciente" },
              ],
            }}
          />
        ),
      }}
    />
  );
}

export function ListaAreasVisita({ ruc, sp }: { ruc: string; sp: Busqueda }) {
  const P = P_VISITAS.areas;
  return (
    <Lista
      ruc={ruc}
      sp={sp}
      cabecera={{
        titulo: "A qué oficinas",
        linea: "El área y el cargo de quien recibe la visita (nunca su nombre), y si decide las compras.",
        ayuda: <AyudaTermino clave="visita-decisor" />,
      }}
      cfg={{
        que: "areas",
        columnas: COLUMNAS_AREAS,
        fila: (x, i) => filaArea(x, i),
        nombre: "oficinas",
        etiqueta: "Oficinas que reciben visitas",
        vacia: { titulo: "Sin oficinas", texto: "El registro no dice a qué oficinas fueron sus visitas." },
        barra: (p) => (
          <BarraFiltros
            busqueda={{ param: P.q, placeholder: "Buscar una oficina o un cargo…", etiqueta: "Buscar entre las oficinas", min: 2 }}
            faceta={{
              param: P.decisor,
              etiqueta: "Decide las compras",
              todas: "Todas",
              conteoTodas: sumaDe(p, "decisor"),
              nombreEnChip: false,
              opciones: conConteo(p, "decisor", SI_NO("Deciden las compras", "No deciden las compras")),
            }}
            orden={{ param: P.orden, porDefecto: "visitas", opciones: [{ valor: "visitas", etiqueta: "Más visitas" }, { valor: "privadas", etiqueta: "Más visitas de empresas" }] }}
          />
        ),
      }}
    />
  );
}

export function ListaParientesVisita({ ruc, sp }: { ruc: string; sp: Busqueda }) {
  const P = P_VISITAS.parientes;
  return (
    <Lista
      ruc={ruc}
      sp={sp}
      cabecera={{
        titulo: "Visitas de familiares de sus funcionarios",
        linea: "Un pariente que un funcionario de la entidad declaró en su DJI la visitó. No se dice quién es ni de quién.",
        ayuda: (
          <Ayuda titulo="¿Cómo se sabe que es un familiar?">
            Su documento es el de un pariente que un funcionario de esta misma entidad declaró en su Declaración Jurada de Intereses
            (Contraloría). No se dice quién es el pariente ni quién el funcionario. Un familiar puede ir por un trámite propio: es para
            revisar, sobre todo si además le vende a la entidad.
          </Ayuda>
        ),
      }}
      cfg={{
        que: "parientes",
        columnas: COLUMNAS_PARIENTES,
        fila: (x) => filaPariente(x),
        nombre: "visitas",
        etiqueta: "Visitas de familiares declarados de sus funcionarios",
        vacia: { titulo: "Sin visitas de familiares", texto: "Ningún familiar declarado de sus funcionarios aparece en su registro de visitas." },
        barra: (p) => (
          <BarraFiltros
            busqueda={{ param: P.q, placeholder: "Buscar un parentesco, un cargo o una oficina…", etiqueta: "Buscar entre las visitas de familiares", min: 2 }}
            faceta={{
              param: P.proveedor,
              etiqueta: "También le vende",
              todas: "Todas",
              conteoTodas: sumaDe(p, "proveedor"),
              nombreEnChip: false,
              opciones: conConteo(p, "proveedor", SI_NO("También le vende", "No le vende")).map((o): OpcionFaceta => (o.valor === "si" ? { ...o, tono: "media", icono: "atencion" } : o)),
            }}
            visibles={[{ param: P.decisor, etiqueta: "La recibió quien decide las compras", corta: "A quien decide", todas: "A quien decide o no", opciones: conConteo(p, "decisor", SI_NO("Sí", "No")) }]}
            orden={{ param: P.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Lo más reciente" }, { valor: "antiguo", etiqueta: "Lo más antiguo" }] }}
          />
        ),
      }}
    />
  );
}

const TIPOS_VISITA = [
  { valor: "privada", etiqueta: "Empresa u organización privada" },
  { valor: "publica", etiqueta: "Entidad pública" },
  { valor: "persona_natural", etiqueta: "A título personal" },
  { valor: "pariente", etiqueta: "Familiar de un funcionario" },
];

export function ListaTodasVisitas({ ruc, sp, parientes }: { ruc: string; sp: Busqueda; parientes: boolean }) {
  const P = P_VISITAS.visitas;
  return (
    <Lista
      ruc={ruc}
      sp={sp}
      cabecera={{
        titulo: "Todas sus visitas",
        linea: "Cada visita del registro. De quien visita, su nombre con un apellido tapado (entero si es autoridad electa); de quien recibe, sólo su cargo.",
        ayuda: <AyudaTermino clave="registro-visitas" />,
      }}
      cfg={{
        que: "visitas",
        columnas: COLUMNAS_VISITAS,
        fila: (x) => filaVisita(x),
        nombre: "visitas",
        etiqueta: "Visitas (toca una para ver su detalle y su fuente)",
        vacia: { titulo: "Sin visitas con fecha", texto: "Su registro no trae la fecha de sus visitas." },
        barra: (p, api) => {
          const org = api.org;
          const anios = p?.anios ?? [];
          // «Todas» con su número sólo sin ningún filtro: con uno puesto, el total de la lista ya no es el de todas.
          const libre = !Object.entries(api).some(([k, v]) => k !== "orden" && !!v);
          return (
            <BarraFiltros
              busqueda={{ param: P.q, placeholder: "Buscar la organización de quien visita…", etiqueta: "Buscar visitas por la organización de quien visita", min: 3 }}
              faceta={{
                param: P.tipo,
                etiqueta: "Quién visita",
                todas: "Todas",
                conteoTodas: libre ? p?.total ?? null : null,
                nombreEnChip: false,
                opciones: conConteo(p, "tipo", TIPOS_VISITA.filter((t) => parientes || t.valor !== "pariente")),
              }}
              visibles={[
                ...(anios.length > 1 || api.anio
                  ? [{
                      param: P.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", desplegable: true,
                      opciones: conConteo(p, "anio", (anios.length ? anios : [Number(api.anio)]).map((a) => ({ valor: String(a), etiqueta: String(a) }))),
                    } satisfies FiltroSecundario]
                  : []),
                { param: P.decisor, etiqueta: "La recibió quien decide las compras", corta: "A quien decide", todas: "A quien decide o no", opciones: conConteo(p, "decisor", SI_NO("Sí", "No")) },
                { param: P.hora, etiqueta: "Horario", corta: "Horario", todas: "Cualquier hora", opciones: conConteo(p, "hora", [{ valor: "fuera", etiqueta: "Fuera del horario" }, { valor: "dentro", etiqueta: "En horario de oficina" }]) },
              ]}
              // La organización elegida en «Ver sus visitas» (Quiénes la visitan): un chip que se quita.
              filtros={org ? [{ param: P.org, etiqueta: "Organización", todas: "Toda organización", opciones: [{ valor: org, etiqueta: tituloNatural(org) }] }] : []}
              orden={{ param: P.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Lo más reciente" }, { valor: "antiguo", etiqueta: "Lo más antiguo" }] }}
            />
          );
        },
      }}
    />
  );
}
