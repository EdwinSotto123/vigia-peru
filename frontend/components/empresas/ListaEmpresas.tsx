import { Suspense } from "react";
import { BarraFiltros, Indicadores, IndicadoresSkeleton, Listado, ZonaResultados, type FiltroSecundario, type Indicador, type Parametros } from "@/components/listado";
import { hoyLima, listaY, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { QUIEN_CARGA } from "@/lib/datoDudoso";
import { BanderaAparte } from "@/components/ui/BanderaAparte";
import { tituloNatural } from "@/lib/landing";
import { GRUPOS_CRUCE, TIPO_CRUCE } from "@/lib/cruces";
import {
  ACTIVIDADES,
  CORTO_EMPRESA,
  MONTOS_MIN,
  OBJETO_TEXTO,
  ORDENES_EMPRESAS,
  TRAMOS_EMPRESA,
  filtrosEmpresasDeUrl,
  getEmpresas,
  ultimasVentas,
  type FiltrosEmpresas,
  type PaginaEmpresas,
  type ResumenEmpresas,
  type TramoEmpresa,
} from "@/lib/empresas";
import { TablaEmpresas, TablaEmpresasSkeleton } from "./TablaEmpresas";

const TAM = 20;

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/**
 * El directorio de empresas: cifras, barra de filtros y la tabla. A la vista, el buscador (nombre o RUC), la gravedad de
 * sus antecedentes, cuál, lo que vende y dónde; en «Filtros», lo que dicen otros registros (Tribunal, visitas,
 * vinculadas, datos con posible error), desde cuándo existe en la SUNAT, cómo le vende al Estado (a cuántas entidades,
 * cómo le va cuando postula), cuánto recibió y su última venta. Los filtros van en la URL. Server component: cifras,
 * barra y tabla esperan la misma página (`Suspense`).
 */
export function ListaEmpresas({ sp, ruta }: { sp: Busqueda; ruta: string }) {
  const f = filtrosEmpresasDeUrl(sp);
  const paginaP = getEmpresas({ ...f, size: TAM });
  const parametros: Parametros = {
    q: f.q, antecedentes: f.antecedentes, tipo: f.tipo, departamento: f.departamento, objeto: f.objeto, inhabilitada: f.inhabilitada, visitas: f.visitas,
    montoMin: f.montoMin, actividad: f.actividad, vinculadas: f.vinculadas, antiguedad: f.antiguedad, clientes: f.clientes, exito: f.exito,
    ultima: f.ultima, dudoso: f.dudoso, entidad: f.entidad, orden: f.orden,
  };
  const filtrada = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);
  return (
    <div className="space-y-4">
      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras pagina={paginaP} ruta={ruta} f={f} />
      </Suspense>
      <Listado ruta={ruta} parametros={parametros} paramPagina="page">
        <Suspense fallback={<Barra resumen={null} f={f} entidad={f.entidad ? { ruc: f.entidad, nombre: null } : null} />}>
          <BarraConConteos pagina={paginaP} f={f} />
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

async function BarraConConteos({ pagina, f }: { pagina: Promise<PaginaEmpresas | null>; f: FiltrosEmpresas }) {
  const pg = await pagina;
  return <Barra resumen={pg?.resumen ?? null} f={f} entidad={f.entidad ? { ruc: f.entidad, nombre: pg?.entidad ?? null } : null} />;
}

function Barra({ resumen: r, f, entidad }: { resumen: ResumenEmpresas | null; f: FiltrosEmpresas; entidad: { ruc: string; nombre: string | null } | null }) {
  // Cada opción de un tramo con cuántas empresas caen en él (sobre los demás filtros). Con ese mismo filtro ya puesto, sin
  // números: las otras opciones contarían 0, que no es lo que darían al elegirlas.
  const conConteo = (t: TramoEmpresa, opciones: readonly { valor: string; etiqueta: string }[], activo: string | undefined) =>
    opciones.map((o) => ({ ...o, conteo: activo || !r?.tramos ? null : r.tramos[t]?.[o.valor] ?? 0 }));
  const anio = Number(hoyLima().slice(0, 4));
  // Sin nombre corto (`corta`): el desplegable y su chip dicen lo mismo ("Donde más vende: Lima"), y ninguno se llama
  // casi igual que la faceta de al lado (antes, chips «Antecedentes» junto al desplegable «Antecedente»; «Región» y
  // «Rubro» en el control y «Donde más vende» y «Lo que más vende» en el chip).
  const visibles: FiltroSecundario[] = [
    {
      param: "tipo",
      etiqueta: "Tipo de antecedente",
      todas: "Todos",
      // Segmentado por familia (Política, En el proceso, Registro SUNAT…), como en la lista de contratos: cada opción
      // lleva su `grupo` y el filtro las agrupa. Sólo los tipos que aparecen en estas empresas.
      opciones: (() => {
        const conteo = new Map((r?.porTipo ?? []).map((t) => [t.tipo, t.n]));
        return GRUPOS_CRUCE.flatMap((g) =>
          g.tipos
            .filter((t) => conteo.has(t.tipo))
            .map((t) => ({ valor: t.tipo, etiqueta: CORTO_EMPRESA[t.tipo] ?? t.corto, grupo: g.titulo, conteo: conteo.get(t.tipo) ?? 0 })));
      })(),
    },
    {
      param: "objeto",
      etiqueta: "Lo que más vende",
      todas: "Todo",
      opciones: (r?.porObjeto ?? []).map((o) => ({ valor: o.objeto, etiqueta: OBJETO_TEXTO[o.objeto] ?? o.objeto, conteo: o.n })),
    },
    {
      param: "departamento",
      etiqueta: "Donde más vende",
      todas: "Todo el Perú",
      opciones: [...(r?.porDepartamento ?? [])]
        .sort((a, b) => a.departamento.localeCompare(b.departamento, "es"))
        .map((d) => ({ valor: d.departamento, etiqueta: tituloNatural(d.departamento), conteo: d.n })),
    },
  ];
  // En «Filtros», por tema: lo que dicen otros registros, la empresa misma, cómo le vende al Estado, cuánto y cuándo.
  const filtros: FiltroSecundario[] = [
    { param: "inhabilitada", etiqueta: "Tribunal de Contrataciones", todas: "Todas", seccion: "Antecedentes", opciones: [{ valor: "si", etiqueta: "Inhabilitadas hoy", conteo: r?.inhabilitadas ?? null }] },
    {
      param: "visitas", etiqueta: "Registro de visitas", todas: "Todas", seccion: "Antecedentes",
      opciones: [
        { valor: "si", etiqueta: "Con visitas de su gente", conteo: f.visitas ? null : r?.conVisitas ?? null },
        { valor: "clientes", etiqueta: "Con visitas a entidades que le compraron", conteo: f.visitas ? null : r?.conVisitasClientes ?? null },
      ],
    },
    { param: "vinculadas", etiqueta: "Empresas vinculadas", todas: "Todas", seccion: "Antecedentes", opciones: [{ valor: "si", etiqueta: "Comparte socio o representante con otra" }] },
    { param: "dudoso", etiqueta: "Calidad del dato", todas: "Todos los datos", seccion: "Antecedentes", opciones: [{ valor: "si", etiqueta: "Con posible error de carga", conteo: r?.conDudosos ?? null }] },
    { param: "antiguedad", etiqueta: "Desde su alta en la SUNAT", todas: "Cualquier antigüedad", seccion: "La empresa", opciones: conConteo("antiguedad", TRAMOS_EMPRESA.antiguedad, f.antiguedad) },
    { param: "actividad", etiqueta: "Cómo le vende al Estado", todas: "De cualquier forma", seccion: "Cómo vende", opciones: ACTIVIDADES.map((m) => ({ valor: m.valor, etiqueta: m.etiqueta })) },
    { param: "clientes", etiqueta: "Entidades que le compraron", todas: "Cualquier número", seccion: "Cómo vende", opciones: conConteo("clientes", TRAMOS_EMPRESA.clientes, f.clientes) },
    { param: "exito", etiqueta: "Si postuló 5 veces o más", todas: "Gane o no", seccion: "Cómo vende", opciones: conConteo("exito", TRAMOS_EMPRESA.exito, f.exito) },
    { param: "montoMin", etiqueta: "Lo que recibió del Estado", todas: "Cualquier monto", seccion: "Cuánto y cuándo", opciones: MONTOS_MIN.map((m) => ({ valor: m.valor, etiqueta: m.etiqueta })) },
    { param: "ultima", etiqueta: "Su última venta al Estado", todas: "En cualquier año", seccion: "Cuánto y cuándo", opciones: conConteo("ultima", ultimasVentas(anio), f.ultima) },
    // Desde la ficha de una entidad (?entidad=<RUC>): el chip «Le vendió a…» y cómo quitarlo.
    ...(entidad
      ? [{ param: "entidad", etiqueta: "Le vendió a", todas: "Cualquier entidad", seccion: "Cliente", opciones: [{ valor: entidad.ruc, etiqueta: entidad.nombre ? tituloNatural(entidad.nombre) : `RUC ${entidad.ruc}` }] }]
      : []),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar por nombre o RUC…", etiqueta: "Buscar empresas por nombre o RUC", min: 3 }}
      faceta={{
        param: "antecedentes",
        etiqueta: "Antecedentes",
        todas: "Todas",
        conteoTodas: r?.empresas ?? null,
        nombreEnChip: false,
        opciones: [
          { valor: "con", etiqueta: "Con antecedentes", conteo: r?.conAntecedentes ?? null },
          { valor: "grave", etiqueta: "Con alguno grave", conteo: r?.conGrave ?? null, tono: "alta", icono: "alerta" },
          // El más grave que tiene es de gravedad media (ninguno grave).
          { valor: "media", etiqueta: "Con alguno medio", conteo: r?.conMedia ?? null, tono: "media", icono: "atencion" },
          { valor: "sin", etiqueta: "Sin antecedentes", conteo: r ? r.empresas - r.conAntecedentes : null },
        ],
      }}
      visibles={visibles}
      filtros={filtros}
      orden={{ param: "orden", porDefecto: "monto", opciones: ORDENES_EMPRESAS.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
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
  // Qué registros van aparte y quién los cargó: los contratos, del SEACE; las órdenes, de CONOSCE.
  const registros = listaY([d.procesos > 0 ? plural(d.procesos, "contrato", "contratos") : "", d.ordenes > 0 ? plural(d.ordenes, "orden", "órdenes") : ""].filter(Boolean));
  const quien =
    d.procesos > 0 && d.ordenes > 0
      ? `${QUIEN_CARGA.oece_ocds} o ${QUIEN_CARGA.conosce_ordenes}`
      : d.procesos > 0 ? QUIEN_CARGA.oece_ocds : QUIEN_CARGA.conosce_ordenes;
  return [
    { valor: numero(r.empresas), etiqueta: "empresas", contexto: "que ganaron, postularon o recibieron órdenes desde 2018" },
    {
      valor: solesCompacto(r.adjMonto + r.ordMonto),
      etiqueta: "recibidos del Estado",
      // Lo que el Estado publicó con posibles errores no se borra: se nombra aparte, sin sumarlo, como bandera chica
      // debajo del primer dato y con su explicación al tocarla (antes era la cola de la frase, «…; aparte, S/ X en N
      // registros con posible error de carga»: un párrafo de cuatro renglones dentro de la tarjeta).
      contexto: aparte ? (
        <>
          en contratos y órdenes
          <BanderaAparte monto={solesCompacto(d.monto + d.montoOrdenes)} titulo="Posible error de carga" className="mt-1.5">
            {`${registros} ${aparte === 1 ? "trae" : "traen"} ${soles(d.monto + d.montoOrdenes)}${aparte === 1 ? "" : " en total"}. Puede ser un error ${quien} al subir el dato: Vigía no lo borra, pero lo deja fuera de este total para que no infle la cifra.`}
          </BanderaAparte>
        </>
      ) : (
        "en contratos y órdenes"
      ),
    },
    {
      valor: numero(r.conAntecedentes),
      etiqueta: "con antecedentes",
      contexto: `en otros registros públicos; ${numero(r.conGrave)} con alguno grave`,
      href: href({ antecedentes: "con" }),
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
