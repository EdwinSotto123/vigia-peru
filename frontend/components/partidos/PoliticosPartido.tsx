import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, HandCoins, Hourglass, Scale, UserRoundX } from "lucide-react";
import { Ayuda, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, Nota, PieDetalle, type DatoClave } from "@/components/patrones";
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
  cuotaDe,
  paletaGravedad,
  type Columna,
  type Fila,
  type FiltroSecundario,
  type Indicador,
  type Parametros,
} from "@/components/listado";
import { BarraSegmentada, MuestraSerie, type ParteBarra } from "@/components/charts/BarraSegmentada";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { Paginacion } from "@/components/ui/Paginacion";
import { Severidad } from "@/components/ui/Severidad";
import { urlDesde } from "@/lib/desde";
import { rutaEmpresa } from "@/lib/empresas";
import { fecha, listaY, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona } from "@/lib/personas";
import {
  DJI_POLITICO,
  ESTADO_DJI,
  ORDENES_POLITICOS,
  PAPELES_POLITICO,
  P_POLITICOS,
  SENALES_POLITICO,
  SENAL_POLITICO,
  filtrosPoliticosDeUrl,
  getPoliticos,
  papelTexto,
  parametrosPoliticos,
  type PaginaPoliticos,
  type Politico,
  type ResumenPoliticos,
} from "@/lib/politicos";
import { peorSeveridad } from "@/lib/severidad";
import { CrucesDelPolitico } from "./DetallePolitico";

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** De a 10 filas (páginas cortas, pedido del usuario): eran 20 filas de dos o tres renglones cada una. */
const TAM = 10;

/**
 * La pestaña «Políticos» de la ficha de un partido (pedido del dueño del 2026-11-16): sus candidatos que ganaron, los
 * que no ganaron y sus aportantes, de todos sus años, y lo que otros registros dicen de cada uno. De arriba abajo:
 *
 *   cifras (cuántos de cada papel) con el reparto de sus cruces por gravedad
 *   → barra: buscador, papel (faceta), cruces, qué cruce, elección y orden
 *   → tabla de a 20: quién, su papel, sus banderas (la más grave entera y «+n»), lo que aportó y lo que vendieron sus empresas
 *   → cada fila abre su panel: lo que trae la fila y, pedida al abrirlo, la evidencia de cada cruce (`CrucesDelPolitico`).
 *
 * Los filtros van en la URL con «k» delante (`P_POLITICOS`). Server component: las cifras, la barra y la tabla esperan la
 * misma página.
 *
 * Privacidad (docs/PRIVACIDAD.md): el nombre llega de la API con un apellido tapado (quien no ganó) o completo (quien ganó
 * una elección) y nunca va a un `title` ni a un `aria-label`; no hay documentos; el buscador mira lo que se ve.
 */
export function PoliticosPartido({ clave, partido, sp, ruta, base }: { clave: string; partido: string; sp: Busqueda; ruta: string; base: Parametros }) {
  const f = filtrosPoliticosDeUrl(sp);
  const paginaP = getPoliticos(clave, f, TAM);
  const parametros: Parametros = { ...base, ...parametrosPoliticos(f) };
  const filtrada = !!(f.papel || f.cruces || f.senal || f.dji || f.eleccion || f.q);
  return (
    <div className="space-y-4">
      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras pagina={paginaP} ruta={ruta} base={base} />
      </Suspense>
      <Listado ruta={ruta} parametros={parametros} paramPagina={P_POLITICOS.page}>
        <Suspense fallback={<Barra resumen={null} />}>
          <BarraConConteos pagina={paginaP} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={COLUMNAS} filas={10} />}>
            <Resultados pagina={paginaP} clave={clave} partido={partido} parametros={parametros} ruta={ruta} actual={f.page ?? 1} filtrada={filtrada} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

// ─── Cifras ─────────────────────────────────────────────────────────────────────────────────────

async function Cifras({ pagina, ruta, base }: { pagina: Promise<PaginaPoliticos | null>; ruta: string; base: Parametros }) {
  const r = (await pagina)?.resumen;
  if (!r) return null;
  const a = (cambio: Record<string, string>) => urlDesde(ruta, { ...base, ...cambio });
  const items: Indicador[] = [
    {
      valor: numero(r.gano),
      etiqueta: "ganaron una elección",
      contexto: `de ${plural(r.gano + r.noGano, "candidato", "candidatos")} del partido`,
      icono: <BadgeCheck size={15} strokeWidth={1.9} aria-hidden />,
      href: a({ [P_POLITICOS.papel]: "gano" }),
    },
    {
      valor: numero(r.noGano),
      etiqueta: "postularon y no ganaron",
      contexto: r.porEleccion.length ? `en ${plural(r.porEleccion.length, "elección", "elecciones")} desde ${Math.min(...r.porEleccion.map((e) => e.anio))}` : undefined,
      icono: <UserRoundX size={15} strokeWidth={1.9} aria-hidden />,
      parte: null,
      href: a({ [P_POLITICOS.papel]: "no_gano" }),
    },
    {
      valor: numero(r.aportantes),
      etiqueta: "aportantes",
      contexto: `${solesCompacto(r.aportesMonto)} en ${plural(r.aportesN, "aporte", "aportes")}${r.empresas ? `; ${plural(r.empresas, "es una empresa", "son empresas")}` : ""}`,
      icono: <HandCoins size={15} strokeWidth={1.9} aria-hidden />,
      parte: null,
      href: a({ [P_POLITICOS.papel]: "aportante" }),
    },
    {
      valor: numero(r.conCruces),
      etiqueta: "con cruces para revisar",
      contexto: `de ${numero(r.cruzables ?? r.conDocumento)} que se pudieron cruzar`,
      ayuda: (
        <Ayuda titulo="¿A quién se cruza?">
          Sólo a quien el JNE o la ONPE publican con su documento: {numero(r.conDocumento)} de {numero(r.total)}. Del resto se sabe su candidatura, pero
          no se le busca en otros registros: cruzar por nombre le pondría a una persona las empresas de un homónimo. La excepción es la declaración jurada
          de quien ganó desde 2022, que se empata por su nombre y la entidad que gobierna.{(r.cruzables ?? r.conDocumento) > r.conDocumento
            ? ` Así se suman ${numero((r.cruzables ?? r.conDocumento) - r.conDocumento)} sin documento.`
            : ""}
        </Ayuda>
      ),
      icono: <Scale size={15} strokeWidth={1.9} aria-hidden />,
      href: a({ [P_POLITICOS.cruces]: "con" }),
    },
  ];
  return (
    <Indicadores
      items={items}
      pie={
        <div className="space-y-3">
          <Reparto r={r} />
          <RepartoDji r={r} ruta={ruta} base={base} />
        </div>
      }
    />
  );
}

/** Cómo se reparten por su cruce más grave quienes se pudieron cruzar; y, aparte, cuántos no llevan documento. */
function Reparto({ r }: { r: ResumenPoliticos }) {
  const cruzables = r.cruzables ?? r.conDocumento;
  const sin = Math.max(0, cruzables - r.conCruces);
  const unidad = (n: number) => plural(n, "persona", "personas");
  const partes: ParteBarra[] = [
    { clave: "alta", nombre: "Con un cruce alto", valor: r.alta, texto: unidad(r.alta) },
    { clave: "media", nombre: "Con un cruce medio", valor: r.media, texto: unidad(r.media) },
    { clave: "baja", nombre: "Con un cruce bajo", valor: r.baja, texto: unidad(r.baja) },
  ].filter((p) => p.valor > 0);
  const otros: ParteBarra = { clave: "sin", nombre: "Sin cruces", valor: sin, texto: unidad(sin) };
  if (!cruzables) return null;
  return (
    <div style={paletaGravedad(partes)}>
      <BarraSegmentada partes={partes} otros={otros} etiqueta="Quienes se pudieron cruzar, por su cruce más grave" />
      <ul aria-hidden className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-rotulo text-inkSoft">
        {[...partes.map((p, i) => ({ p, i: i as number | "otros" })), ...(sin > 0 ? [{ p: otros, i: "otros" as const }] : [])].map(({ p, i }) => (
          <li key={p.clave} className="inline-flex items-center gap-1.5">
            <MuestraSerie i={i} />
            {p.nombre}
            <span className="font-mono font-semibold tabular-nums text-ink">{cuotaDe(p.valor, cruzables)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * La pregunta del dueño (2026-11-16): «¿estamos considerando todas las declaraciones juradas? ¿hay algún político que no
 * la tenga?». Las autoridades elegidas desde 2022 de esta lista, por su DJI: ya leída (con sus familiares), sólo en el
 * registro de la Contraloría (todavía sin leer) o no encontrada. Cada parte filtra la lista.
 */
function RepartoDji({ r, ruta, base }: { r: ResumenPoliticos; ruta: string; base: Parametros }) {
  const d = r.dji;
  if (!d?.alcance) return null;
  const unidad = (n: number) => plural(n, "autoridad", "autoridades");
  const partes: (ParteBarra & { filtro: string })[] = [
    { clave: "leida", nombre: "Su DJI leída", valor: d.leida, texto: unidad(d.leida), filtro: "leida" },
    { clave: "registro", nombre: "En el registro, sin leer", valor: d.registro, texto: unidad(d.registro), filtro: "con" },
  ].filter((p) => p.valor > 0);
  const otros = { clave: "sin", nombre: "No encontrada", valor: d.sinDji, texto: unidad(d.sinDji), filtro: "sin" };
  const enlace = (filtro: string) => urlDesde(ruta, { ...base, [P_POLITICOS.dji]: filtro });
  return (
    <div>
      <p className="mb-1 flex items-center gap-1 text-rotulo font-medium text-inkSoft">
        {plural(d.alcance, "autoridad elegida", "autoridades elegidas")} desde 2022, por su declaración jurada de intereses
        <Ayuda titulo="¿Cómo se encuentra su DJI?">
          La Contraloría publica las declaraciones sin documento: se empata por el nombre completo y la entidad que gobierna (su municipalidad, la sede de
          su gobierno regional o el Congreso), así que hay que confirmar que es la misma persona. «En el registro» quiere decir que está obligada a
          declarar y su DJI todavía no se leyó; «No encontrada», que no aparece en esa entidad. {numero(d.conFamiliares)} declaran familiares.
        </Ayuda>
      </p>
      <BarraSegmentada partes={partes} otros={otros} etiqueta="Autoridades elegidas desde 2022, por su declaración jurada" />
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-rotulo text-inkSoft">
        {[...partes.map((p, i) => ({ p, i: i as number | "otros" })), ...(otros.valor > 0 ? [{ p: otros, i: "otros" as const }] : [])].map(({ p, i }) => (
          <li key={p.clave}>
            <Link href={enlace(p.filtro)} prefetch={false} className="inline-flex min-h-6 items-center gap-1.5 hover:text-ink hover:underline">
              <MuestraSerie i={i} />
              {p.nombre}
              <span className="font-mono font-semibold tabular-nums text-ink">{numero(p.valor)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Barra de filtros ───────────────────────────────────────────────────────────────────────────

async function BarraConConteos({ pagina }: { pagina: Promise<PaginaPoliticos | null> }) {
  return <Barra resumen={(await pagina)?.resumen ?? null} />;
}

/** El papel (faceta), los cruces, qué cruce y la elección; sin resumen, sin números. */
function Barra({ resumen: r }: { resumen: ResumenPoliticos | null }) {
  const porSenal = new Map((r?.porSenal ?? []).map((s) => [s.tipo, s.n]));
  const conteoPapel = { gano: r?.gano, no_gano: r?.noGano, pendiente: r?.pendientes, aportante: r?.aportantes } as const;
  const visibles: FiltroSecundario[] = [
    {
      param: P_POLITICOS.cruces,
      etiqueta: "Cruces con otros registros",
      corta: "Cruces",
      todas: "Con o sin cruces",
      opciones: [
        { valor: "con", etiqueta: "Con algún cruce", conteo: r?.conCruces ?? null },
        { valor: "alta", etiqueta: "Con un cruce alto", conteo: r?.alta ?? null },
        { valor: "sin", etiqueta: "Se cruzó y no salió nada", conteo: r ? Math.max(0, (r.cruzables ?? r.conDocumento) - r.conCruces) : null },
        { valor: "sin_documento", etiqueta: "Sin documento: no se cruzó", conteo: r ? r.total - (r.cruzables ?? r.conDocumento) : null },
      ],
    },
    {
      param: P_POLITICOS.senal,
      etiqueta: "Qué cruce",
      corta: "Cruce",
      todas: "Cualquier cruce",
      desplegable: true,
      etiquetas: Object.fromEntries(SENALES_POLITICO.map((s) => [s, SENAL_POLITICO[s].corto])),
      opciones: SENALES_POLITICO.filter((s) => !r || (porSenal.get(s) ?? 0) > 0).map((s) => ({ valor: s, etiqueta: SENAL_POLITICO[s].corto, conteo: r ? porSenal.get(s) ?? 0 : null })),
    },
    {
      param: P_POLITICOS.eleccion,
      etiqueta: "Elección en que postuló",
      corta: "Elección",
      todas: "Todas las elecciones",
      desplegable: true,
      opciones: (r?.porEleccion ?? []).map((e) => ({ valor: String(e.anio), etiqueta: String(e.anio), conteo: e.n })),
    },
  ];
  const d = r?.dji;
  // Su DJI, dentro de «Filtros»: sólo de quien ganó desde 2022.
  const filtros: FiltroSecundario[] =
    r && !d?.alcance
      ? []
      : [{
          param: P_POLITICOS.dji,
          etiqueta: "Su DJI",
          todas: "Con o sin DJI",
          seccion: "Declaración jurada",
          opciones: DJI_POLITICO.map((o) => ({
            valor: o.valor,
            etiqueta: o.etiqueta,
            conteo: d ? { con: d.leida + d.registro, leida: d.leida, familiares: d.conFamiliares, sin: d.sinDji }[o.valor] : null,
          })),
        }];
  return (
    <BarraFiltros
      busqueda={{ param: P_POLITICOS.q, placeholder: "Buscar por apellido, cargo o lugar…", etiqueta: "Buscar en los políticos del partido", min: 3 }}
      faceta={{ enBotones: true,
        param: P_POLITICOS.papel,
        etiqueta: "Papel en el partido",
        todas: "Todos",
        conteoTodas: r?.total ?? null,
        nombreEnChip: false,
        opciones: PAPELES_POLITICO.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta, conteo: conteoPapel[p.valor] ?? null })),
      }}
      visibles={visibles}
      filtros={filtros}
      orden={{ param: P_POLITICOS.orden, porDefecto: "cruces", opciones: ORDENES_POLITICOS.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

// ─── Tabla ──────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS: Columna[] = [
  {
    clave: "persona",
    titulo: "Persona",
    ancho: "minmax(0,1.4fr)",
    ayuda: (
      <Ayuda titulo="¿Por qué algunos nombres van tapados?">
        Quien ganó una elección es una autoridad: su nombre va completo. A los demás candidatos y a los aportantes se les tapa un apellido, y de nadie
        se muestra el documento. El buscador mira sólo lo que se ve.
      </Ayuda>
    ),
  },
  { clave: "papel", titulo: "En el partido", ancho: "minmax(0,0.7fr)", desde: "lg", apilar: true, igual: false },
  {
    clave: "cruces",
    titulo: "Cruces",
    // Un piso de 13 rem: más angosta, «Recibió órdenes de gobiernos del partido» iba en tres renglones.
    ancho: "minmax(13rem,1fr)",
    desde: "md",
    apilar: true,
    igual: false,
    ayuda: (
      <Ayuda titulo="¿Qué es un cruce?">
        Lo que otros registros públicos dicen de esta persona: si una empresa suya le vendió al Estado o ganó en gobiernos de este partido, si recibió
        órdenes de servicio, si un funcionario la declaró como familiar, si tiene sanciones, si los familiares que declara en su DJI contratan con el
        Estado y si un informe de control le señala responsabilidad presunta. Es un hecho para revisar, no una acusación.
      </Ayuda>
    ),
  },
  { clave: "aportes", titulo: "Aportó", ancho: "104px", alinear: "der", desde: "lg" },
  { clave: "empresas", titulo: "Sus empresas", ancho: "124px", alinear: "der", desde: "xl", ayuda: <Ayuda titulo="¿Qué suma?">Lo que sus empresas (RNP) le vendieron al Estado, en procesos y órdenes de compra, en cualquier entidad y año.</Ayuda> },
];

const CORTO = Object.fromEntries(SENALES_POLITICO.map((s) => [`politico:${s}`, SENAL_POLITICO[s].corto]));
const EXPLICA = Object.fromEntries(SENALES_POLITICO.map((s) => [`politico:${s}`, SENAL_POLITICO[s].explica]));

async function Resultados({
  pagina: paginaP,
  clave,
  partido,
  parametros,
  ruta,
  actual,
  filtrada,
}: {
  pagina: Promise<PaginaPoliticos | null>;
  clave: string;
  partido: string;
  parametros: Parametros;
  ruta: string;
  actual: number;
  filtrada: boolean;
}) {
  const pagina = await paginaP;
  if (!pagina) {
    const aqui = urlDesde(ruta, { ...parametros, [P_POLITICOS.page]: actual > 1 ? String(actual) : undefined });
    return (
      <EstadoError titulo="No pudimos cargar los políticos del partido" accion={<a href={aqui} className={CLASE_ACCION_LISTA}>Reintentar</a>}>
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  if (!pagina.disponible) {
    return (
      <EstadoVacio compacto titulo="Esta lista todavía se está preparando">
        Los candidatos y aportantes de cada partido se cargan con el próximo refresco de datos. Mientras tanto, sus gobiernos y sus contratos están en las
        otras pestañas.
      </EstadoVacio>
    );
  }
  if (pagina.total === 0) {
    return filtrada ? (
      <EstadoVacio compacto titulo="Nadie coincide con estos filtros">Quita el filtro más restrictivo o busca por el primer apellido.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Sin candidatos ni aportantes registrados">
        El JNE y la ONPE no traen candidaturas ni aportes de esta organización con este nombre.
      </EstadoVacio>
    );
  }
  const paginas = Math.max(1, Math.ceil(pagina.total / pagina.size));
  const pag = (subir: boolean) => (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={pagina.total}
      tam={pagina.size || TAM}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina={P_POLITICOS.page}
      cargando={false}
      nombre="personas"
      subir={subir}
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={pagina.politicos.map((p) => filaDe(p, clave, partido))} etiqueta="Candidatos y aportantes del partido" />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
      <Nota>
        Un cruce es un hecho para revisar, no una acusación: tener una empresa, trabajar para el Estado o aportar a un partido es legal. Los informes de
        control se cruzan por el DNI de cada funcionario comprendido, y su responsabilidad es presunta, no una condena. La DJI de una autoridad se
        empata por su nombre y su entidad: confirma que es la misma persona. La Procuraduría no publica nombres: sus casos van en la pestaña Control.
      </Nota>
    </div>
  );
}

/** El papel de la persona, con su ícono: ganó, postuló y no ganó, aportó. */
function Papel({ p }: { p: Politico }) {
  const cls = "inline-flex items-center gap-1 whitespace-nowrap text-meta text-inkSoft";
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {p.gano && (
        <span className={`${cls} font-semibold text-ink`}>
          <BadgeCheck size={13} className="shrink-0 text-mossTexto" aria-hidden />
          Ganó
        </span>
      )}
      {!p.gano && p.pendiente && (
        <span className={cls}>
          <Hourglass size={13} className="shrink-0 text-mute" aria-hidden />
          Resultado pendiente
        </span>
      )}
      {!p.gano && !p.pendiente && p.candidato && (
        <span className={cls}>
          <UserRoundX size={13} className="shrink-0 text-mute" aria-hidden />
          No ganó
        </span>
      )}
      {p.aportante && (
        <span className={cls}>
          <HandCoins size={13} className="shrink-0 text-mute" aria-hidden />
          Aportó
        </span>
      )}
    </span>
  );
}

/** Se pudo cruzar: con su documento o, sin él, por su DJI empatada (su nombre y la entidad que gobierna). */
const cruzable = (p: Politico) => p.conDocumento || p.dji === "leida" || p.dji === "registro";

const nombreDe = (p: Politico) => (p.tipo === "empresa" ? (p.razonSocial ? tituloNatural(p.razonSocial) : "Empresa sin nombre") : p.nombre ?? "Persona sin nombre");

/** «2018 y 2022», o «3 elecciones, de 2014 a 2022» si son más de dos. */
function eleccionesTexto(anios: number[]): string | null {
  if (!anios.length) return null;
  if (anios.length <= 2) return listaY(anios.map(String));
  return `${anios.length} elecciones, de ${anios[0]} a ${anios[anios.length - 1]}`;
}

function filaDe(p: Politico, clave: string, partido: string): Fila {
  const nombre = nombreDe(p);
  const u = p.ultimaCandidatura;
  const elecciones = eleccionesTexto(p.elecciones);
  const e = p.cruces.empresas;
  return {
    id: p.codigo,
    magnitudes: { aportes: p.aportes.monto || null, empresas: e.vendido || null },
    celdas: {
      persona: (
        <CeldaPrincipal
          // Un nodo y no el texto: así el nombre no va al `title` de la celda (privacidad).
          titulo={<>{nombre}</>}
          meta={[
            u?.puesto ? <Dato key="cargo" tipo="cargo" nombre="Postuló a">{tituloNatural(u.puesto)}</Dato> : null,
            u?.lugar ? <Dato key="lugar" tipo="lugar">{tituloNatural(u.lugar)}</Dato> : null,
            elecciones ? <Dato key="anios" tipo="fecha" nombre="Elecciones">{elecciones}</Dato> : null,
            p.tipo === "empresa" && p.ruc ? <Dato key="ruc" tipo="ruc" mono>{p.ruc}</Dato> : null,
          ]}
        />
      ),
      papel: <Papel p={p} />,
      cruces: p.senales.length ? (
        <CrucesCelda
          cruces={p.senales.map((s) => ({ tipo: `politico:${s.tipo}`, severidad: s.severidad }))}
          etiquetas={CORTO}
          explicaciones={EXPLICA}
          etiquetaLista="Cruces de la persona con otros registros"
        />
      ) : (
        <span className="text-meta text-mute">{cruzable(p) ? "Sin cruces" : "Sin documento: no se cruzó"}</span>
      ),
      aportes: p.aportes.n ? (
        <CeldaNumero sub={plural(p.aportes.n, "aporte", "aportes")}>{solesCompacto(p.aportes.monto)}</CeldaNumero>
      ) : (
        <span className="block text-right text-meta text-mute">No aportó</span>
      ),
      empresas: e.n ? (
        <CeldaNumero sub={p.tipo === "empresa" ? "ella misma" : plural(e.n, "empresa", "empresas")}>{solesCompacto(e.vendido)}</CeldaNumero>
      ) : (
        <span className="block text-right text-meta text-mute">{p.conDocumento ? "Ninguna" : "Sin dato"}</span>
      ),
    },
    detalle: {
      // Ni el título ni la etiqueta llevan el nombre: van a `title` y `aria-label` (docs/PRIVACIDAD.md).
      titulo: p.tipo === "empresa" ? "Empresa que aportó al partido" : "Político del partido",
      etiqueta: `Ver los cruces de ${p.tipo === "empresa" ? "una empresa que aportó" : "una persona del partido"}: ${papelTexto(p).toLowerCase()}${u?.puesto ? `, ${tituloNatural(u.puesto)}` : ""}${u?.lugar ? `, ${tituloNatural(u.lugar)}` : ""}`,
      descripcion: <span className="font-medium text-inkSoft">{nombre}</span>,
      contenido: <VistaPolitico p={p} clave={clave} partido={partido} elecciones={elecciones} />,
      pie: <PiePolitico p={p} />,
    },
  };
}

/** El panel de una fila: lo que la fila ya trae y, debajo, la evidencia de cada cruce (se pide al abrirlo). */
function VistaPolitico({ p, clave, partido, elecciones }: { p: Politico; clave: string; partido: string; elecciones: string | null }) {
  const peor = peorSeveridad(p.senales);
  const u = p.ultimaCandidatura;
  const datos: DatoClave[] = [
    { etiqueta: "En el partido", valor: papelTexto(p) },
    ...(u?.puesto ? [{ etiqueta: "Última candidatura", valor: [tituloNatural(u.puesto), u.lugar ? tituloNatural(u.lugar) : null].filter(Boolean).join(", ") }] : []),
    ...(elecciones ? [{ etiqueta: "Elecciones", valor: elecciones, mono: true }] : []),
    ...(p.aportes.n
      ? [{
          etiqueta: "Aportó al partido",
          valor: `${soles(p.aportes.monto)} en ${plural(p.aportes.n, "aporte", "aportes")}${p.aportes.desde ? `, ${p.aportes.desde === p.aportes.hasta ? `el ${fecha(p.aportes.desde)}` : `del ${fecha(p.aportes.desde)} al ${fecha(p.aportes.hasta)}`}` : ""}`,
        }]
      : []),
    // Su DJI, si ganó desde 2022 (la de los demás no existe: la presenta quien ejerce un cargo).
    ...(p.dji ? [{ etiqueta: "Su declaración jurada", valor: ESTADO_DJI[p.dji] }] : []),
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        {peor ? (
          <>
            <Severidad bandera={peor} />
            <span className="text-meta text-inkSoft">{plural(p.senales.length, "cruce", "cruces")} con otros registros</span>
          </>
        ) : (
          <span className="text-meta text-inkSoft">{cruzable(p) ? "Se cruzó con los otros registros y no salió nada" : "Sin documento en su fuente: no se cruzó"}</span>
        )}
      </ChipsDetalle>
      <DatosClave items={datos} />
      <CrucesDelPolitico clave={clave} codigo={p.codigo} partido={partido} senales={p.senales} conDocumento={p.conDocumento} dji={p.dji ?? null} />
    </CuerpoDetalle>
  );
}

function PiePolitico({ p }: { p: Politico }) {
  const enlace = "inline-flex min-h-9 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline";
  const ficha =
    p.tipo === "empresa" && p.ruc ? (
      <Link href={rutaEmpresa(p.ruc)} className={enlace}>
        Abrir la ficha de la empresa <ArrowRight size={14} aria-hidden />
      </Link>
    ) : p.personaCodigo ? (
      <Link href={rutaPersona(p.personaCodigo)} className={enlace}>
        Abrir su ficha de persona contratada <ArrowRight size={14} aria-hidden />
      </Link>
    ) : null;
  return <PieDetalle principal={ficha ?? <span className="text-mute">Un cruce es un hecho para revisar, no una acusación.</span>} />;
}
