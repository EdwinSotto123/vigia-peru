import { Suspense } from "react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, FuenteDato, Nota, PieDetalle, type DatoClave } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaNumero,
  CeldaPrincipal,
  Indicadores,
  IndicadoresSkeleton,
  Listado,
  Tabla,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type FiltroSecundario,
  type Fila,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { Paginacion } from "@/components/ui/Paginacion";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { personalPte } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { etiquetasUnicas } from "@/lib/personas";
import {
  ANTIGUEDAD_PLANILLA,
  REGIMEN,
  SENAL_PLANILLA,
  SUELDOS_PLANILLA,
  TIPOS_PLANILLA,
  getPlanilla,
  getPlanillaMensual,
  mes,
  rutaPlanilla,
  type FacetasPlanilla,
  type PaginaPlanilla,
  type PersonaPlanilla, GRUPO_PLANILLA, GRUPOS_PLANILLA } from "@/lib/planilla";
import { SenalesPlanillaLista } from "./SenalesPlanilla";
import { uno } from "@/lib/utils";

const TAM = 20;
type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** Los filtros de la planilla en la URL: con `l` delante (no chocan con los de los contratos ni los de las personas). */
export const P_PLANILLA = {
  senal: "lsenal", severidad: "lsev", regimen: "lreg", orden: "lord", page: "lpag", q: "lq", dudoso: "ldud",
  sueldo: "lsueldo", oficina: "lofi", cargo: "lcargo", pariente: "lpar", jefatura: "ljef", antiguedad: "lant", situacion: "lsit",
} as const;

/**
 * Declaró en su DJI a un pariente que es locador de su misma entidad (el lado del funcionario del nepotismo): una bandera
 * más de la fila, con la severidad de esa señal del locador. La evidencia (el pariente, tapado, y sus órdenes) va en la ficha.
 */
const PARIENTE = "pariente_locador";
const EXPLICA_PARIENTE =
  "Declaró en su Declaración Jurada de Intereses a un pariente que es locador (proveedor) de esta misma entidad. Es un indicio de posible nepotismo para revisión, no una acusación.";

/** La etiqueta corta de cada señal para la celda (`CrucesCelda`, una línea con su ícono de severidad). */
const CORTO_PLANILLA = { ...Object.fromEntries(TIPOS_PLANILLA.map((t) => [t, SENAL_PLANILLA[t].corto])), [PARIENTE]: "Pariente locador" };
/** Y su explicación (title del chip): la de la señal de planilla, no la del catálogo de cruces de empresas. */
const EXPLICA_PLANILLA = { ...Object.fromEntries(TIPOS_PLANILLA.map((t) => [t, SENAL_PLANILLA[t].explica])), [PARIENTE]: EXPLICA_PARIENTE };

/**
 * La planilla de un alcance (una entidad, una región o todo el país): el personal que publican las entidades en su
 * Portal de Transparencia, con sus señales por fila. Cada fila abre su panel (sus datos, sus sueldos mes a mes y sus
 * señales); con ficha propia, el panel es su vista previa y lleva «Abrir la ficha». Server component.
 *
 * Privacidad (docs/PRIVACIDAD.md): el nombre llega con el apellido materno tapado y se ve en la fila y en el panel, pero
 * nunca va a un `title`, a un `aria-label` ni al `id` de la fila.
 */
export function ListaPlanilla({
  alcance,
  sp,
  ruta,
  base,
  deEntidad = false,
  visiblesExtra = [],
}: {
  alcance: { entidad?: string; dep?: string };
  sp: Busqueda;
  ruta: string;
  base: Parametros;
  deEntidad?: boolean;
  /** Filtros del alcance a la vista (la región en /app/personas). Sus valores ya vienen en `base`. */
  visiblesExtra?: FiltroSecundario[];
}) {
  const P = P_PLANILLA;
  const senal = uno(sp?.[P.senal]);
  const sev = uno(sp?.[P.severidad]);
  const reg = Number(uno(sp?.[P.regimen]));
  const orden = uno(sp?.[P.orden]);
  const q = uno(sp?.[P.q])?.slice(0, 80);
  const sueldo = uno(sp?.[P.sueldo]);
  // La oficina y el cargo, sólo dentro de una entidad (en el país serían decenas de miles): como los agrupa la API.
  const texto = (k: string) => { const v = alcance.entidad ? uno(sp?.[k])?.slice(0, 200) : undefined; return v && v.length >= 2 ? v : undefined; };
  const f = {
    senal: senal && (TIPOS_PLANILLA as readonly string[]).includes(senal) ? senal : undefined,
    severidad: sev && ["alta", "media", "baja", "con", "sin"].includes(sev) ? sev : undefined,
    regimen: REGIMEN[reg] ? reg : undefined,
    orden: orden && ["senales", "sueldo", "meses"].includes(orden) ? orden : undefined,
    q: q && q.length >= 2 ? q : undefined,
    dudoso: uno(sp?.[P.dudoso]) === "si" ? "si" : undefined,
    sueldo: sueldo && SUELDOS_PLANILLA.some((o) => o.valor === sueldo) ? sueldo : undefined,
    oficina: texto(P.oficina),
    cargo: texto(P.cargo),
    pariente: uno(sp?.[P.pariente]) === "si" ? "si" : undefined,
    jefatura: uno(sp?.[P.jefatura]) === "si" ? "si" : undefined,
    antiguedad: ANTIGUEDAD_PLANILLA.some((o) => o.valor === uno(sp?.[P.antiguedad])) ? uno(sp?.[P.antiguedad]) : undefined,
    // Quienes ya no están («Trabajó antes», migración 202): sólo dentro de una entidad.
    situacion: alcance.entidad && uno(sp?.[P.situacion]) === "antes" ? ("antes" as const) : undefined,
    page: Math.max(1, Number(uno(sp?.[P.page])) || 1),
  };
  const paginaP = getPlanilla({ ...alcance, ...f, size: TAM });
  // En una entidad, su id en el Portal de Transparencia (lo trae su planilla mes a mes, la misma lectura que el gráfico de
  // su pestaña): la fuente de cada persona lleva a la página de personal de la entidad. En el país, la portada del portal.
  const idPteP = alcance.entidad ? getPlanillaMensual(alcance.entidad).then((m) => m?.idPte ?? null) : Promise.resolve(null);
  const parametros: Parametros = {
    ...base, [P.senal]: f.senal, [P.severidad]: f.severidad, [P.regimen]: f.regimen ? String(f.regimen) : undefined, [P.orden]: f.orden,
    [P.q]: f.q, [P.dudoso]: f.dudoso, [P.sueldo]: f.sueldo, [P.oficina]: f.oficina, [P.cargo]: f.cargo, [P.pariente]: f.pariente,
    [P.jefatura]: f.jefatura, [P.antiguedad]: f.antiguedad, [P.situacion]: f.situacion,
  };
  const filtrada = !!(f.senal || f.severidad || f.regimen || f.q || f.dudoso || f.sueldo || f.oficina || f.cargo || f.pariente || f.jefatura || f.antiguedad) || visiblesExtra.some((x) => !!base[x.param]);
  // La entidad que llega de su ficha: un chip que se quita (en la ficha de la propia entidad, no: es el alcance).
  const entidad = !deEntidad && alcance.entidad ? alcance.entidad : undefined;
  return (
    <div className="space-y-4">
      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras pagina={paginaP} ruta={ruta} base={base} />
      </Suspense>
      <Suspense fallback={null}>
        <AvisoMesParcial pagina={paginaP} />
      </Suspense>
      <Listado ruta={ruta} parametros={parametros} paramPagina={P.page}>
        <Suspense fallback={<Barra r={null} facetas={null} deUnaEntidad={!!alcance.entidad} elegidos={f} visiblesExtra={visiblesExtra} entidad={entidad ? { ruc: entidad, nombre: null } : null} />}>
          <BarraAsync pagina={paginaP} deUnaEntidad={!!alcance.entidad} elegidos={f} visiblesExtra={visiblesExtra} entidad={entidad} antes={!!f.situacion} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={columnas(deEntidad, !!f.situacion)} filas={10} />}>
            <Resultados pagina={paginaP} idPte={idPteP} parametros={parametros} ruta={ruta} actual={f.page} deEntidad={deEntidad} filtrada={filtrada} antes={!!f.situacion} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

async function Cifras({ pagina, ruta, base }: { pagina: Promise<PaginaPlanilla | null>; ruta: string; base: Parametros }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) q.set(k, String(v));
    return `${ruta}?${q.toString()}`;
  };
  const items: Indicador[] = [
    { valor: numero(r.personas), etiqueta: "personas en planilla", contexto: r.ultimoMes ? `hasta ${mes(r.ultimoMes) ?? r.ultimoMes}` : undefined },
    {
      valor: solesCompacto(r.totalMes),
      etiqueta: "al mes",
      contexto: r.dudosos
        ? `suma de su último mes publicado; aparte, ${plural(r.dudosos, "sueldo", "sueldos")} con posible error de la entidad`
        : "suma de su último mes publicado",
    },
    { valor: numero(r.conSenales), etiqueta: "con alguna señal", contexto: `de ${numero(r.personas)}; lo que dicen otros registros`, href: href({ [P_PLANILLA.severidad]: "con" }) },
    { valor: numero(r.alta), etiqueta: "con una señal alta", contexto: `de ${numero(r.personas)}; cobran también por órdenes, candidatos del que gobierna`, tono: r.alta > 0 ? "alta" : "neutro", href: href({ [P_PLANILLA.severidad]: "alta" }) },
  ];
  const salieron = (await pagina)?.salieron;
  if (salieron) {
    items.push({ valor: numero(salieron), etiqueta: "trabajaron antes", contexto: "en los meses cargados; ya no están en la planilla de hoy", href: href({ [P_PLANILLA.situacion]: "antes" }) });
  }
  return <Indicadores items={items} />;
}

/**
 * La entidad publicó después un mes a medias (migración 202: con menos de la mitad de la gente que el mes completo de al
 * lado): la planilla de hoy es la de su último mes completo, y se dice por qué no la del mes más nuevo.
 */
async function AvisoMesParcial({ pagina }: { pagina: Promise<PaginaPlanilla | null> }) {
  const pg = await pagina;
  const parcial = pg?.mesParcial;
  if (!parcial) return null;
  return (
    <Nota>
      La entidad publicó {mes(parcial.mes) ?? parcial.mes} a medias ({plural(parcial.personas, "persona", "personas")}): esta es su planilla de{" "}
      {mes(pg?.resumen?.ultimoMes) ?? "su último mes completo"}, el último mes que publicó completo.
    </Nota>
  );
}

/** La oficina y el cargo elegidos: su filtro se queda aunque no haya opciones (si no, su chip no se podría quitar). */
type Elegidos = { oficina?: string; cargo?: string };

async function BarraAsync({
  pagina,
  deUnaEntidad,
  elegidos,
  visiblesExtra,
  entidad,
  antes = false,
}: {
  pagina: Promise<PaginaPlanilla | null>;
  deUnaEntidad: boolean;
  elegidos: Elegidos;
  visiblesExtra: FiltroSecundario[];
  entidad?: string;
  antes?: boolean;
}) {
  const pg = await pagina;
  const nombre = entidad ? pg?.data.find((x) => x.entidadRuc === entidad)?.entidad ?? null : null;
  return (
    <Barra r={pg?.resumen ?? null} facetas={pg?.facetas ?? null} deUnaEntidad={deUnaEntidad} elegidos={elegidos} visiblesExtra={visiblesExtra}
      entidad={entidad ? { ruc: entidad, nombre } : null} salieron={pg?.salieron ?? null} antes={antes} />
  );
}

/**
 * Señales (faceta), y a la vista la región (si la hay), qué señal y el régimen; en «Filtros», dónde trabaja (la entidad
 * que llega de su ficha y, dentro de una entidad, la oficina y el cargo), cuánto gana, si declaró a un pariente locador y
 * la calidad del dato. Los conteos son del alcance, como el resumen.
 */
function Barra({
  r,
  facetas,
  deUnaEntidad,
  elegidos,
  visiblesExtra,
  entidad,
  salieron = null,
  antes = false,
}: {
  r: PaginaPlanilla["resumen"] | null;
  facetas: FacetasPlanilla | null;
  deUnaEntidad: boolean;
  elegidos: Elegidos;
  visiblesExtra: FiltroSecundario[];
  entidad: { ruc: string; nombre: string | null } | null;
  /** En una entidad: cuántos trabajaron antes (el filtro «Situación»). */
  salieron?: number | null;
  /** La lista es la de quienes ya no están: sin los filtros de señales, sueldo de hoy ni oficina. */
  antes?: boolean;
}) {
  const P = P_PLANILLA;
  // Las oficinas y los cargos con el nombre como se lee (vienen en mayúsculas, como los agrupa la API).
  const nombres = (xs: FacetasPlanilla["oficinas"]) => etiquetasUnicas((xs ?? []).map((x) => ({ valor: x.valor, etiqueta: tituloNatural(x.valor), conteo: x.n })));
  // Una entidad sin planilla (o sin oficinas ni cargos escritos) no los ofrece: no habría nada que elegir.
  const hay = (xs: FacetasPlanilla["oficinas"] | undefined, elegido: string | undefined) => !facetas || (xs?.length ?? 0) > 0 || !!elegido;
  return (
    <BarraFiltros
      busqueda={{ param: P.q, placeholder: "Buscar por nombre, cargo, oficina o entidad…", etiqueta: "Buscar en la planilla", min: 3 }}
      faceta={antes ? undefined : {
        param: P.severidad,
        etiqueta: "Señales",
        todas: "Todas",
        conteoTodas: r?.personas ?? null,
        nombreEnChip: false,
        // El vocabulario de severidad de todo el producto (`Severidad`), no «Graves / Para revisar».
        opciones: [
          { valor: "con", etiqueta: "Con señales", conteo: r?.conSenales ?? null },
          { valor: "alta", etiqueta: "Con señal alta", conteo: r?.alta ?? null, tono: "alta", icono: "alerta" },
          { valor: "media", etiqueta: "Con señal media", conteo: r?.media ?? null, tono: "media", icono: "atencion" },
          { valor: "sin", etiqueta: "Sin señales", conteo: r ? r.personas - r.conSenales : null },
        ],
      }}
      visibles={[
        ...visiblesExtra,
        // En una entidad: la planilla de hoy o quienes trabajaron en ella y ya no están (migración 202).
        ...(deUnaEntidad && (salieron || antes)
          ? [{
              param: P.situacion,
              etiqueta: "Situación",
              corta: "Situación",
              todas: "En planilla hoy",
              opciones: [{ valor: "antes", etiqueta: "Trabajó antes", conteo: salieron ?? null }],
            }]
          : []),
        ...(antes ? [] : [{
          param: P.senal,
          etiqueta: "Señal",
          corta: "Señal",
          todas: "Toda señal",
          // Por familia (Política, Familia y conflictos, Cómo se le paga) y dentro por cuántas hay.
          opciones: [...(r?.porSenal ?? [])]
            .sort((a, b) => GRUPOS_PLANILLA.indexOf(GRUPO_PLANILLA[a.tipo] ?? "Cómo se le paga") - GRUPOS_PLANILLA.indexOf(GRUPO_PLANILLA[b.tipo] ?? "Cómo se le paga") || b.n - a.n)
            .map((s) => ({ valor: s.tipo, etiqueta: SENAL_PLANILLA[s.tipo]?.corto ?? s.tipo, conteo: s.n, grupo: GRUPO_PLANILLA[s.tipo] ?? "Cómo se le paga" })),
        }]),
        {
          param: P.regimen,
          etiqueta: "Régimen",
          corta: "Régimen",
          todas: "Todo régimen",
          // Los conteos son de la planilla de hoy: en «Trabajó antes» van sin número.
          opciones: (r?.porRegimen ?? []).filter((x) => x.regimen != null).map((x) => ({ valor: String(x.regimen), etiqueta: REGIMEN[x.regimen!] ?? String(x.regimen), conteo: antes ? null : x.n })),
        },
      ]}
      filtros={antes ? [] : [
        ...(entidad
          ? [{ param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", seccion: "Dónde trabaja", opciones: [{ valor: entidad.ruc, etiqueta: entidad.nombre ? tituloNatural(entidad.nombre) : `RUC ${entidad.ruc}` }] }]
          : []),
        ...(deUnaEntidad
          ? [
              // Los 500 con más personas; los demás, con el buscador (busca también en la oficina y el cargo).
              ...(hay(facetas?.oficinas, elegidos.oficina)
                ? [{ param: P.oficina, etiqueta: "Oficina", todas: "Toda oficina", seccion: "Dónde trabaja", buscable: true, opciones: nombres(facetas?.oficinas ?? null) }]
                : []),
              ...(hay(facetas?.cargos, elegidos.cargo)
                ? [{ param: P.cargo, etiqueta: "Cargo", todas: "Todo cargo", seccion: "Dónde trabaja", buscable: true, opciones: nombres(facetas?.cargos ?? null) }]
                : []),
            ]
          : []),
        {
          // Jefe, director, gerente, coordinador, administrador… (como los cuenta el ascenso exprés).
          param: P.jefatura,
          etiqueta: "Tipo de cargo",
          todas: "Todo cargo",
          seccion: "Dónde trabaja",
          opciones: [{ valor: "si", etiqueta: "Cargo de jefatura", conteo: facetas?.jefatura ?? null }],
        },
        {
          param: P.antiguedad,
          etiqueta: "Meses en la planilla cargada",
          todas: "Cualquier tiempo",
          seccion: "Cuándo",
          opciones: ANTIGUEDAD_PLANILLA.map((o) => ({ ...o, conteo: facetas?.tramos?.antiguedad?.[o.valor] ?? null })),
        },
        {
          param: P.sueldo,
          etiqueta: "Sueldo del último mes",
          todas: "Cualquier sueldo",
          seccion: "Cuánto",
          opciones: SUELDOS_PLANILLA.map((o) => ({ ...o, conteo: facetas?.tramos?.sueldo?.[o.valor] ?? null })),
        },
        {
          // Lo que dijo en su declaración jurada de intereses: un pariente suyo es locador de su misma entidad.
          param: P.pariente,
          etiqueta: "Indicio",
          todas: "Todas",
          seccion: "Señales",
          opciones: [{ valor: "si", etiqueta: "Declaró a un pariente locador", conteo: facetas?.pariente ?? null }],
        },
        {
          param: P.dudoso,
          etiqueta: "Calidad del dato",
          todas: "Todos los datos",
          seccion: "Señales",
          opciones: [{ valor: "si", etiqueta: "Con posible error de carga", conteo: r?.dudosos ?? null }],
        },
      ]}
      orden={antes
        ? { param: P.orden, porDefecto: "senales", opciones: [{ valor: "senales", etiqueta: "Salió más reciente" }, { valor: "sueldo", etiqueta: "Mayor sueldo" }, { valor: "meses", etiqueta: "Más meses" }] }
        : { param: P.orden, porDefecto: "senales", opciones: [{ valor: "senales", etiqueta: "Más señales" }, { valor: "sueldo", etiqueta: "Mayor sueldo" }, { valor: "meses", etiqueta: "Más meses" }] }}
    />
  );
}

const columnas = (deEntidad: boolean, antes = false): Columna[] => [
  { clave: "persona", titulo: "Persona", ancho: "minmax(0,1.3fr)" },
  { clave: "tiempo", titulo: antes ? "Estuvo" : "En la planilla", ancho: "9.5rem", desde: "md", apilar: "con-rotulo" },
  {
    clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas señales?">
        Lo que otros registros dicen de esta persona: si también cobra por órdenes de servicio, si gana el doble que su mismo
        cargo, si tiene los apellidos de una autoridad o un directivo, si fue candidata del partido que gobierna. No prueban
        nada.
      </Ayuda>
    ),
  },
  { clave: "regimen", titulo: "Régimen", ancho: "112px", desde: "lg", ayuda: <AyudaTermino clave="regimen" /> },
  { clave: "total", titulo: "Sueldo", ancho: "112px", alinear: "der" },
];

async function Resultados(props: {
  pagina: Promise<PaginaPlanilla | null>;
  idPte: Promise<number | null>;
  parametros: Parametros;
  ruta: string;
  actual: number;
  deEntidad: boolean;
  filtrada: boolean;
  antes?: boolean;
}) {
  const [pagina, idPte] = await Promise.all([props.pagina, props.idPte]);
  if (!pagina) return <EstadoError titulo="No pudimos cargar la planilla">Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>;
  if (!pagina.total) {
    if (props.antes) {
      return (
        <EstadoVacio compacto titulo={props.filtrada ? "Nadie coincide con estos filtros" : "Nadie dejó esta planilla"}>
          {props.filtrada ? "Quita el filtro más restrictivo." : "En los meses cargados, todos los que figuraron siguen en su planilla de hoy."}
        </EstadoVacio>
      );
    }
    return props.filtrada ? (
      <EstadoVacio compacto titulo="Nadie coincide con estos filtros">Quita el filtro más restrictivo.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Sin planilla publicada">
        La entidad no publicó su personal en el Portal de Transparencia en los meses cargados, o aún no lo encontramos.
      </EstadoVacio>
    );
  }
  const paginas = Math.max(1, Math.ceil(pagina.total / pagina.size));
  const pag = (subir: boolean) => (
    <Paginacion actual={props.actual} paginas={paginas} total={pagina.total} tam={pagina.size}
      navegacion="url" hrefBase={props.ruta} query={props.parametros} paramPagina={P_PLANILLA.page} cargando={false} nombre="personas" subir={subir} />
  );
  // Sin la línea suelta «N personas»: el total ya lo dicen el chip «Todas» y el paginador.
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={columnas(props.deEntidad, props.antes)} filas={pagina.data.map((p, i) => fila(p, i, props.deEntidad, idPte))}
        etiqueta={props.antes ? "Quienes trabajaron antes en la entidad" : "Personal en planilla"} />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
    </div>
  );
}

/**
 * Las señales en UNA línea (la más grave primero, «+n»), con la bandera de un posible error de carga delante; si declaró
 * a un pariente locador, esa bandera va con las demás.
 */
function Senales({ senales, dudoso, pariente }: { senales: PersonaPlanilla["senales"]; dudoso: PersonaPlanilla["dudoso"]; pariente: boolean }) {
  const motivo = motivoDudoso(dudoso?.motivo);
  // Desde la migración 179 el pariente locador es una señal más («pariente_locador»): la marca aparte, sólo con la API vieja.
  const yaEsSenal = (senales ?? []).some((x) => x.tipo === "pariente_locador");
  const todas = [...(pariente && !yaEsSenal ? [{ tipo: PARIENTE, severidad: "alta" as const }] : []), ...(senales ?? [])];
  if (!todas.length && !motivo) return <span className="text-meta text-mute">Sin señales</span>;
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1">
      {motivo && <BanderaDato motivo={motivo} fuente="pte_personal" className="shrink-0" />}
      {todas.length > 0 && <CrucesCelda cruces={todas} etiquetas={CORTO_PLANILLA} explicaciones={EXPLICA_PLANILLA} etiquetaLista="Señales de la persona" />}
    </span>
  );
}

/** `idPte`: el id de la entidad en el Portal de Transparencia (su página de personal), si la lista es de una entidad. */
function fila(p: PersonaPlanilla, i: number, deEntidad: boolean, idPte: number | null): Fila {
  const entidad = p.entidad ? tituloNatural(p.entidad) : null;
  const motivo = motivoDudoso(p.dudoso?.motivo);
  const cargoTexto = p.cargo ? tituloNatural(p.cargo) : null;
  const cargo = cargoTexto ? <Dato key="cargo" tipo="cargo">{cargoTexto}</Dato> : null;
  const oficina = p.dependencia ? <Dato key="oficina" tipo="dependencia" nombre="Oficina">{tituloNatural(p.dependencia)}</Dato> : null;
  const datos: DatoClave[] = [
    { etiqueta: "Cargo", valor: cargoTexto },
    { etiqueta: "Oficina", valor: p.dependencia ? tituloNatural(p.dependencia) : null },
    { etiqueta: "Régimen", valor: p.regimen ? REGIMEN[p.regimen] ?? String(p.regimen) : null },
    { etiqueta: p.salio ? "Su último sueldo" : "Sueldo del último mes", valor: p.base != null ? soles(p.base) : null, mono: true },
    ...(p.salio ? [] : [{ etiqueta: "Total cobrado ese mes", valor: p.total != null ? soles(p.total) : null, mono: true }]),
    ...(p.extra ? [{ etiqueta: "Fuera del sueldo", valor: `${soles(p.extra)} (otros beneficios, gratificación, incentivo)` }] : []),
    { etiqueta: "Meses en planilla", valor: `${numero(p.meses)} (${[p.primerMes, p.ultimoMes].filter(Boolean).join(" a ")})` },
    ...(!deEntidad && entidad ? [{ etiqueta: "Entidad", valor: entidad }] : []),
  ];
  // La señal "tambien_ordenes" trae los meses en que además cobró por órdenes de servicio y su monto total.
  const det = p.senales.find((s) => s.tipo === "tambien_ordenes")?.detalle;
  const mesesOrden = Array.isArray(det?.meses) ? (det!.meses as unknown[]).map(String) : [];
  const montoOrden = typeof det?.monto === "number" ? (det!.monto as number) : null;
  const ficha = p.ficha ? rutaPlanilla(p.ficha) : null;
  return {
    // El id va al DOM (`data-fila`): nunca el nombre. La posición en la página y la entidad bastan.
    id: `pl-${i}-${p.entidadRuc}`,
    celdas: {
      persona: (
        <CeldaPrincipal
          // Un nodo y no el texto: así el nombre no va al `title` de la celda.
          titulo={<>{p.nombre}</>}
          meta={deEntidad ? [cargo, oficina] : [cargo, entidad ? <Dato key="entidad" tipo="entidad">{entidad}</Dato> : null]}
        />
      ),
      // Desde cuándo está (o desde y hasta cuándo estuvo, si ya no está): la «Situación» de cada fila.
      tiempo: (
        <span className="text-meta text-inkSoft">
          {p.salio
            ? `De ${mes(p.primerMes) ?? "sin dato"} a ${mes(p.ultimoMes) ?? "sin dato"}`
            : p.primerMes
              ? `Desde ${mes(p.primerMes) ?? p.primerMes}`
              : "Sin dato"}
        </span>
      ),
      senales: p.salio
        ? <span className="text-meta text-mute">Ya no está en la planilla</span>
        : <Senales senales={p.senales} dudoso={p.dudoso} pariente={!!p.parienteLocador} />,
      regimen: <span className="text-meta text-inkSoft">{p.regimen ? REGIMEN[p.regimen] ?? p.regimen : "Sin dato"}</span>,
      total: motivo ? (
        <CeldaNumero sub="posible error de la entidad">{p.base != null ? soles(p.base) : p.total != null ? soles(p.total) : "Sin dato"}</CeldaNumero>
      ) : (
        <CeldaNumero sub={p.extra && p.total != null && p.total > (p.base ?? 0) ? `${solesCompacto(p.total)} con todo` : p.ultimoMes ?? undefined}>
          {p.base != null ? soles(p.base) : p.total != null ? soles(p.total) : "Sin dato"}
        </CeldaNumero>
      ),
    },
    // Todas las filas abren el mismo panel; con ficha propia es su vista previa (antes unas filas navegaban y otras no).
    detalle: {
      // Ni el título ni la etiqueta llevan el nombre: van a `title` y `aria-label` (docs/PRIVACIDAD.md).
      titulo: cargoTexto ?? "Persona en planilla",
      etiqueta: `Detalle en planilla: ${cargoTexto ?? "persona sin cargo registrado"}${entidad && !deEntidad ? `, ${entidad}` : ""}`,
      descripcion: <span className="font-medium text-inkSoft">{p.nombre}</span>,
      contenido: (
        <CuerpoDetalle>
          {motivo && (
            <AvisoDato motivo={motivo} fuente="pte_personal">
              {`Su planilla de ${p.ultimoMes ?? "su último mes"} trae ${p.dudoso?.total != null ? soles(p.dudoso.total) : "un monto"} en total.`}
            </AvisoDato>
          )}
          {p.parienteLocador && (
            <ChipsDetalle>
              <Severidad bandera="alta" />
              <span className="text-meta text-inkSoft">
                {EXPLICA_PARIENTE}
                {ficha ? " Su ficha muestra al pariente, con un apellido tapado, y las órdenes que recibió." : ""}
              </span>
            </ChipsDetalle>
          )}
          <DatosClave items={datos} />
          {(p.historia?.length ?? 0) > 1 && (
            <BloqueDetalle titulo="Cobros al Estado, mes a mes">
              <LineaMeses
                puntos={(p.historia ?? []).map((h) => ({ mes: h.mes, base: h.base, extra: h.extra, dudoso: h.dudoso }))}
                etiqueta="Cobros al Estado mes a mes"
                ordenes={mesesOrden.length ? { meses: mesesOrden, monto: montoOrden } : undefined}
              />
            </BloqueDetalle>
          )}
          {p.senales.length > 0 && (
            <>
              <SenalesPlanillaLista senales={p.senales} entidadRuc={p.entidadRuc} idPte={idPte} />
              <p className="text-rotulo leading-relaxed text-mute">Cada señal es un indicio de registros públicos para revisar, no una acusación ni prueba de un delito.</p>
            </>
          )}
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <>
              {ficha && <EnlaceAccion href={ficha} flecha>Abrir la ficha</EnlaceAccion>}
              {p.codigo && (
                <EnlaceAccion href={`/app/personas/${p.codigo}`} variante={ficha ? "secundario" : "primario"} flecha={!ficha}>
                  Ver sus órdenes de servicio
                </EnlaceAccion>
              )}
            </>
          }
          secundarias={
            <FuenteDato
              fuente={idPte != null ? "Portal de Transparencia Estándar de la entidad, rubro Personal" : "Portal de Transparencia Estándar, rubro Personal"}
              href={personalPte(idPte)}
            />
          }
        />
      ),
    },
  };
}
