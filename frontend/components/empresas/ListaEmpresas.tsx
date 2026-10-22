import { Suspense } from "react";
import { BarraFiltros, Indicadores, IndicadoresSkeleton, Listado, ZonaResultados, type FiltroSecundario, type Indicador, type Parametros } from "@/components/listado";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { TIPO_CRUCE } from "@/lib/cruces";
import {
  ACTIVIDADES,
  CORTO_EMPRESA,
  MONTOS_MIN,
  NIVEL,
  OBJETO_TEXTO,
  ORDENES_EMPRESAS,
  filtrosEmpresasDeUrl,
  getEmpresas,
  type FiltrosEmpresas,
  type PaginaEmpresas,
  type ResumenEmpresas,
} from "@/lib/empresas";
import { TablaEmpresas, TablaEmpresasSkeleton } from "./TablaEmpresas";

const TAM = 20;

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/**
 * El directorio de empresas: cifras, barra de filtros (buscador por nombre o RUC, nivel del puntaje, antecedente, lo que
 * vende, región, inhabilitadas, con visitas) y la tabla. Los filtros van en la URL. Server component: cifras, barra y
 * tabla esperan la misma página (`Suspense`).
 */
export function ListaEmpresas({ sp, ruta }: { sp: Busqueda; ruta: string }) {
  const f = filtrosEmpresasDeUrl(sp);
  const paginaP = getEmpresas({ ...f, size: TAM });
  const parametros: Parametros = {
    q: f.q, nivel: f.nivel, tipo: f.tipo, departamento: f.departamento, objeto: f.objeto, inhabilitada: f.inhabilitada, visitas: f.visitas,
    montoMin: f.montoMin, actividad: f.actividad, vinculadas: f.vinculadas, entidad: f.entidad, orden: f.orden,
  };
  const filtrada = !!(f.q || f.nivel || f.tipo || f.departamento || f.objeto || f.inhabilitada || f.visitas || f.montoMin || f.actividad || f.vinculadas || f.entidad);
  return (
    <div className="space-y-4">
      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras pagina={paginaP} ruta={ruta} f={f} />
      </Suspense>
      <Listado ruta={ruta} parametros={parametros} paramPagina="page">
        <Suspense fallback={<Barra resumen={null} entidad={f.entidad ? { ruc: f.entidad, nombre: null } : null} />}>
          <BarraConConteos pagina={paginaP} entidad={f.entidad} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaEmpresasSkeleton />}>
            <Resultados pagina={paginaP} parametros={parametros} ruta={ruta} actual={f.page ?? 1} filtrada={filtrada} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

async function Resultados(props: { pagina: Promise<PaginaEmpresas | null>; parametros: Parametros; ruta: string; actual: number; filtrada: boolean }) {
  return <TablaEmpresas pagina={await props.pagina} parametros={props.parametros} ruta={props.ruta} actual={props.actual} filtrada={props.filtrada} />;
}

async function BarraConConteos({ pagina, entidad }: { pagina: Promise<PaginaEmpresas | null>; entidad?: string }) {
  const pg = await pagina;
  return <Barra resumen={pg?.resumen ?? null} entidad={entidad ? { ruc: entidad, nombre: pg?.entidad ?? null } : null} />;
}

function Barra({ resumen: r, entidad }: { resumen: ResumenEmpresas | null; entidad: { ruc: string; nombre: string | null } | null }) {
  const n = (k: keyof typeof NIVEL) => r?.porNivel?.[k] ?? (r ? 0 : null);
  const visibles: FiltroSecundario[] = [
    {
      param: "tipo",
      etiqueta: "Antecedente",
      corta: "Antecedente",
      todas: "Todo antecedente",
      opciones: (r?.porTipo ?? []).map((t) => ({ valor: t.tipo, etiqueta: CORTO_EMPRESA[t.tipo] ?? TIPO_CRUCE[t.tipo]?.corto ?? t.etiqueta, conteo: t.n })),
    },
    {
      param: "objeto",
      etiqueta: "Lo que más vende",
      corta: "Rubro",
      todas: "Todo rubro",
      opciones: (r?.porObjeto ?? []).map((o) => ({ valor: o.objeto, etiqueta: OBJETO_TEXTO[o.objeto] ?? o.objeto, conteo: o.n })),
    },
    {
      param: "departamento",
      etiqueta: "Donde más vende",
      corta: "Región",
      todas: "Todo el Perú",
      opciones: [...(r?.porDepartamento ?? [])]
        .sort((a, b) => a.departamento.localeCompare(b.departamento, "es"))
        .map((d) => ({ valor: d.departamento, etiqueta: tituloNatural(d.departamento), conteo: d.n })),
    },
  ];
  const filtros: FiltroSecundario[] = [
    { param: "inhabilitada", etiqueta: "Tribunal de Contrataciones", todas: "Todas", opciones: [{ valor: "si", etiqueta: "Inhabilitadas hoy", conteo: r?.inhabilitadas ?? null }] },
    { param: "visitas", etiqueta: "Registro de visitas", todas: "Todas", opciones: [{ valor: "si", etiqueta: "Con visitas de su gente", conteo: r?.conVisitas ?? null }] },
    { param: "montoMin", etiqueta: "Lo que recibió del Estado", todas: "Cualquier monto", opciones: MONTOS_MIN.map((m) => ({ valor: m.valor, etiqueta: m.etiqueta })) },
    { param: "actividad", etiqueta: "Cómo le vende al Estado", todas: "De cualquier forma", opciones: ACTIVIDADES.map((m) => ({ valor: m.valor, etiqueta: m.etiqueta })) },
    { param: "vinculadas", etiqueta: "Empresas vinculadas", todas: "Todas", opciones: [{ valor: "si", etiqueta: "Comparte socio o representante con otra" }] },
    // Desde la ficha de una entidad (?entidad=<RUC>): el chip «Le vendió a…» y cómo quitarlo.
    ...(entidad
      ? [{ param: "entidad", etiqueta: "Le vendió a", todas: "Cualquier entidad", opciones: [{ valor: entidad.ruc, etiqueta: entidad.nombre ? tituloNatural(entidad.nombre) : `RUC ${entidad.ruc}` }] }]
      : []),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar por nombre o RUC…", etiqueta: "Buscar empresas por nombre o RUC", min: 3 }}
      faceta={{
        param: "nivel",
        etiqueta: "Puntaje",
        todas: "Todas",
        conteoTodas: r?.empresas ?? null,
        nombreEnChip: false,
        opciones: [
          { valor: "alto", etiqueta: "Muchos antecedentes", conteo: n("alto"), tono: "alta", icono: "alerta" },
          { valor: "medio", etiqueta: "Para revisar", conteo: n("medio"), tono: "media", icono: "atencion" },
          { valor: "bajo", etiqueta: "Pocos", conteo: n("bajo") },
          { valor: "sin", etiqueta: "Sin antecedentes", conteo: n("sin") },
        ],
      }}
      visibles={visibles}
      filtros={filtros}
      orden={{ param: "orden", porDefecto: "puntaje", opciones: ORDENES_EMPRESAS.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

async function Cifras({ pagina, ruta, f }: { pagina: Promise<PaginaEmpresas | null>; ruta: string; f: FiltrosEmpresas }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  return <Indicadores items={cifras(r, ruta, f)} />;
}

function cifras(r: ResumenEmpresas, ruta: string, f: FiltrosEmpresas): Indicador[] {
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, tipo: f.tipo, objeto: f.objeto, departamento: f.departamento, ...extra })) if (v) q.set(k, v);
    return `${ruta}?${q.toString()}`;
  };
  const d = r.dudosos;
  const aparte = d.procesos + d.ordenes;
  return [
    { valor: numero(r.empresas), etiqueta: "empresas", contexto: "que ganaron, postularon o recibieron órdenes desde 2018" },
    {
      valor: solesCompacto(r.adjMonto + r.ordMonto),
      etiqueta: "recibidos del Estado",
      // Lo que el Estado publicó con posibles errores no se borra: se nombra aparte, sin sumarlo.
      contexto: aparte
        ? `en contratos y órdenes; aparte, ${solesCompacto(d.monto + d.montoOrdenes)} en ${plural(aparte, "registro", "registros")} con posible error de carga`
        : "en contratos y órdenes",
    },
    {
      valor: numero(r.porNivel.alto ?? 0),
      etiqueta: "con muchos antecedentes",
      contexto: `50 puntos o más; ${numero(r.porNivel.medio ?? 0)} más para revisar`,
      tono: (r.porNivel.alto ?? 0) > 0 ? "alta" : "neutro",
      href: href({ nivel: "alto" }),
    },
    {
      valor: numero(r.inhabilitadas),
      etiqueta: "inhabilitadas hoy",
      contexto: "por el Tribunal de Contrataciones del Estado",
      tono: r.inhabilitadas > 0 ? "alta" : "neutro",
      href: href({ inhabilitada: "si" }),
    },
  ];
}
