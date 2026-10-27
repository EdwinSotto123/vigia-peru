import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { EstadoVacio as AvisoEnLinea } from "@/components/ui/EstadoVacio";
import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, Flag } from "lucide-react";
import { EntidadesPanel, hrefEntidades } from "@/components/EntidadesPanel";
import { BarraFiltros, Listado, ZonaResultados, type FiltroSecundario } from "@/components/listado";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import {
  ORDENES_ENTIDADES,
  getEntidadesPagina,
  getEntidadesResumen,
  getRegionesEntidades,
  parseEntidadesQuery,
  type ClaseEntidad,
  type EntidadesPagina,
  type EntidadesResumen,
  type FacetasEntidades,
} from "@/lib/api-client";
import { numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { etiquetasUnicas } from "@/lib/personas";
import { nombrePartido } from "@/lib/planilla";

export const metadata: Metadata = {
  title: "Entidades del Estado",
  description:
    "Municipalidades, gobiernos regionales, ministerios, hospitales, universidades y empresas públicas: sus contratos desde 2015, los antecedentes de quienes ganan, su presupuesto y sus informes de control.",
};

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** El nombre de cada tipo en el filtro, y los tipos de la faceta (`FacetasEntidades.tipos`) que cuenta. */
const CLASE: Record<ClaseEntidad, { etiqueta: string; tipos: string[] }> = {
  ministerio: { etiqueta: "Ministerio", tipos: ["ministerio"] },
  regional: { etiqueta: "Gobierno regional", tipos: ["gobierno_regional"] },
  municipal: { etiqueta: "Municipalidad (todas)", tipos: ["municipal_provincial", "municipal_distrital"] },
  provincial: { etiqueta: "Municipalidad provincial", tipos: ["municipal_provincial"] },
  distrital: { etiqueta: "Municipalidad distrital", tipos: ["municipal_distrital"] },
  salud: { etiqueta: "Salud (hospitales, redes, DIRIS)", tipos: ["salud"] },
  educacion: { etiqueta: "Educación (UGEL, DRE)", tipos: ["educacion"] },
  universidad: { etiqueta: "Universidad pública", tipos: ["universidad"] },
  programa: { etiqueta: "Programa o proyecto especial", tipos: ["programa"] },
  fuerzas: { etiqueta: "Fuerzas Armadas o Policía", tipos: ["fuerzas_armadas"] },
  empresa: { etiqueta: "Empresa pública", tipos: ["empresa_publica"] },
  beneficencia: { etiqueta: "Sociedad de beneficencia", tipos: ["beneficencia"] },
  organismo: { etiqueta: "Organismo autónomo", tipos: ["organismo_autonomo"] },
  publico: { etiqueta: "Organismo público", tipos: ["organismo_publico"] },
  sin: { etiqueta: "Sin clasificar", tipos: ["sin"] },
};

/** Lo que dice la bajada según el orden elegido. */
const BAJADA: Record<string, string> = {
  contratos: "Ordenadas por cuántos contratos tienen desde 2015, con lo que otros registros dicen de cada una.",
  dictamen: "Ordenadas por cuántos de sus contratos ya tienen dictamen publicado.",
  nombre: "En orden alfabético.",
};

/**
 * /app/entidades — plantilla Listado (DESIGN_SYSTEM.md §14.1): encabezado →
 * indicadores → barra (búsqueda + filtros) → resultados. Búsqueda, filtros, orden y página
 * viven en la URL (`?q=&clase=&region=&provincia=&partido=&control=…&orden=&pagina=`).
 *
 * El orden lo hace el API sobre toda la lista: contratos desde 2015 (por defecto), contratos con dictamen o nombre.
 * Antes «Mayor monto» y «Mayor puntaje» reordenaban sólo la página a la vista (20 de 3,162) y se quitaron; un `?orden=`
 * de esos enlaces viejos se ignora. Hasta el 2026-10-27 el de por defecto fue el de dictamen, con sus columnas: sólo ~180
 * entidades tienen uno y la lista se leía vacía («0 de 426, Sin dato, Sin dato»). Ahora cada fila dice lo que toda
 * entidad tiene (EntidadesPanel.tsx) y las cifras de arriba, lo mismo para todas.
 *
 * Filtros: a la vista el tipo (el que se MUESTRA en cada fila, lib/entidad-tipo.ts: el backend lo deriva igual, del
 * nombre y, si no dice nada, del tipo declarado, porque `entidades.tipo` está casi todo en NULL), la región y el indicio de nepotismo; en
 * «Filtros», la provincia, quién la gobierna (partido y captura), los informes de la Contraloría y sus personas
 * (planilla, plazas CAS). Cada opción con cuántas entidades tiene en la región, la provincia y el tipo elegidos.
 *
 * Las tres consultas van por separado (`allSettled`): si cae el resumen, la lista sigue, y lo que no llegó se dice
 * en una línea en vez de desaparecer sin aviso.
 */
export default async function EntidadesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sp = searchParams ?? {};
  // `pagina` es el parámetro de todos los listados; `page` queda por los enlaces viejos.
  const query = { ...parseEntidadesQuery({ ...sp, page: texto(sp.pagina) ?? texto(sp.page) }), tipo: undefined };
  const q = query.q?.trim() || undefined;
  const actual = query.page ?? 1;

  const [rPagina, rResumen, rRegiones] = await Promise.allSettled([getEntidadesPagina(query), getEntidadesResumen(), getRegionesEntidades()]);
  for (const r of [rPagina, rResumen]) if (r.status === "rejected") console.error("[entidades] el API no respondió:", (r.reason as Error)?.message);
  const pagina: EntidadesPagina | null = rPagina.status === "fulfilled" ? rPagina.value : null;
  const resumen: EntidadesResumen | null = rResumen.status === "fulfilled" ? rResumen.value : null;
  const regiones: string[] = rRegiones.status === "fulfilled" ? rRegiones.value : [];

  // Datos planos (nunca funciones) hacia los componentes cliente del Listado.
  const parametros = {
    q, region: query.region, clase: query.clase, provincia: query.provincia, partido: query.partido, captura: query.captura ? "1" : undefined,
    control: query.control, planilla: query.planilla, plazas: query.plazas, nepotismo: query.nepotismo ? "1" : undefined,
    financio: query.financio ? "1" : undefined, orden: query.orden,
  };
  const aqui = hrefEntidades({ ...parametros, pagina: actual > 1 ? String(actual) : undefined });

  // El conteo por entidad (`alertas` del API) es de contratos con dictamen PUBLICADO, tengan
  // o no señales: un dictamen de score 0 también suma. Por eso esta página dice "con dictamen
  // publicado" y no "con señales" (DESIGN_SYSTEM.md §10.1): con la palabra vieja decía 80
  // entidades mientras /app/hallazgos, que sí cuenta señales, decía 61.
  return (
    <Pagina className="space-y-5">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Entidades" }]} />
      <EncabezadoPagina
        titulo="Entidades del Estado"
        bajada={BAJADA[query.orden ?? "contratos"]}
        ayuda={
          <Ayuda titulo="¿Qué dice cada fila?">
            <span className="block">
              Sus contratos en el SEACE desde 2015; cuántos los ganó alguien con antecedentes en otros registros (y cuántos con
              alguno grave); su presupuesto del año según el MEF y los informes de la Contraloría sobre ella.
            </span>
            <span className="mt-2 block">
              Las banderas son lo que otros registros dicen de la entidad: indicios para revisar, no acusaciones. Cada fila
              abre su vista previa con la evidencia; el dictamen de Vigía, cuando lo hay, también va ahí.
            </span>
          </Ayuda>
        }
        acciones={
          <Link
            href="/reporte/nuevo?modo=entidad"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-dato leading-5 font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
          >
            <Flag size={14} aria-hidden /> Denunciar una entidad
          </Link>
        }
      />

      {resumen ? (
        <CifrasEnFila
          items={[
            {
              valor: numero(resumen.totalEntidades),
              etiqueta: "entidades del Estado",
              contexto:
                resumen.conContratos == null
                  ? "que compran por el SEACE"
                  : resumen.conContratos === resumen.totalEntidades
                    ? "todas con contratos en el SEACE desde 2015"
                    : `${numero(resumen.conContratos)} con contratos desde 2015`,
              ayuda: (
                <Ayuda titulo="¿Qué cuentan estas cifras?">
                  <span className="block">
                    Todas las compradoras del Estado que Vigía tiene registradas y, de ellas, cuántas tienen contratos con
                    antecedentes del ganador, informes de la Contraloría o un dictamen de Vigía publicado.
                  </span>
                  <span className="mt-2 block text-mute">Son cifras de toda la base: no cambian con la búsqueda ni con los filtros.</span>
                </Ayuda>
              ),
            },
            {
              valor: resumen.conAntecedentes != null ? numero(resumen.conAntecedentes) : null,
              etiqueta: "con antecedentes del ganador",
              contexto: resumen.conGraves != null ? `en algún contrato; ${numero(resumen.conGraves)} con alguno grave` : "en algún contrato",
            },
            {
              valor: resumen.conInformes != null ? numero(resumen.conInformes) : null,
              etiqueta: "con informes de la Contraloría",
              contexto: "con responsabilidad presunta de sus funcionarios",
            },
            {
              valor: numero(resumen.conAlertas),
              etiqueta: "con dictamen publicado",
              contexto: `${solesCompacto(resumen.monto)} adjudicados en esos contratos`,
            },
          ]}
        />
      ) : (
        // Sin las cifras de arriba, se dice (antes desaparecían sin aviso). Si la lista tampoco llegó, su error lo dice.
        pagina && (
          <AvisoEnLinea icono={<CloudOff size={16} />} accion={{ href: aqui, etiqueta: "Reintentar" }}>
            No pudimos leer las cifras de todas las entidades: el servidor no respondió.
          </AvisoEnLinea>
        )
      )}

      <Listado ruta="/app/entidades" parametros={parametros}>
        <BarraEntidades facetas={pagina?.facetas ?? null} conConteos={!q} regiones={regiones} elegidos={{ provincia: query.provincia, partido: query.partido }} />
        <ZonaResultados>
          <EntidadesPanel pagina={pagina} actual={actual} parametros={parametros} q={q} aqui={aqui} orden={query.orden} />
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}

/**
 * La barra de la lista. Cada opción con cuántas entidades la tienen (`facetas`, sobre la región, la provincia y el tipo
 * elegidos); con una búsqueda por texto, sin números (`conConteos`: las facetas no la miran), pero con sus nombres.
 */
function BarraEntidades({
  facetas: f,
  conConteos,
  regiones,
  elegidos,
}: {
  facetas: FacetasEntidades | null;
  conConteos: boolean;
  regiones: string[];
  /** La provincia y el partido elegidos: su filtro se queda aunque no haya opciones (si no, su chip no se podría quitar). */
  elegidos: { provincia?: string; partido?: string };
}) {
  const tipos = new Map((f?.tipos ?? []).map((t) => [t.valor, t.n]));
  const cuenta = (x: number | null | undefined) => (conConteos && x != null ? x : null);
  const n = (k: keyof FacetasEntidades["senales"]) => cuenta(f?.senales?.[k]);
  // Un buscable sin opciones (sólo ministerios: ninguno tiene partido) no va, salvo que ya esté elegido.
  const hay = (xs: unknown[] | undefined, elegido: string | undefined) => !f || (xs?.length ?? 0) > 0 || !!elegido;
  const filtros: FiltroSecundario[] = [
    ...(hay(f?.provincias, elegidos.provincia)
      ? [{
          param: "provincia", etiqueta: "Provincia", todas: "Todas las provincias", seccion: "Dónde", buscable: true,
          opciones: etiquetasUnicas((f?.provincias ?? []).map((p) => ({ valor: p.valor, etiqueta: p.etiqueta, conteo: cuenta(p.n) }))),
        }]
      : []),
    ...(hay(f?.partidos, elegidos.partido)
      ? [{
          param: "partido", etiqueta: "Partido que la gobierna", todas: "Cualquier partido", seccion: "Quién la gobierna", buscable: true,
          opciones: etiquetasUnicas((f?.partidos ?? []).map((p) => ({ valor: p.valor, etiqueta: nombrePartido(p.valor) ?? p.valor, conteo: cuenta(p.n) }))),
        }]
      : []),
    {
      param: "captura", etiqueta: "Captura política", todas: "Todas", seccion: "Quién la gobierna",
      opciones: [{ valor: "1", etiqueta: "Con ganadores ligados a quien la gobierna", conteo: n("captura") }],
    },
    {
      param: "financio", etiqueta: "Financiaron su campaña", todas: "Todas", seccion: "Quién la gobierna",
      opciones: [{ valor: "1", etiqueta: "Con locadores o planilla que financiaron la campaña del que gobierna", conteo: n("financio") }],
    },
    {
      param: "control", etiqueta: "Informes de la Contraloría", todas: "Con o sin informes", seccion: "Control",
      opciones: [
        { valor: "penal", etiqueta: "Presunta responsabilidad penal", conteo: n("penal") },
        { valor: "civil", etiqueta: "Presunta responsabilidad civil", conteo: n("civil") },
        { valor: "administrativa", etiqueta: "Presunta responsabilidad administrativa", conteo: n("administrativa") },
        { valor: "alguno", etiqueta: "Con algún informe de control", conteo: n("informes") },
      ],
    },
    {
      param: "planilla", etiqueta: "Su planilla (Portal de Transparencia)", todas: "Con o sin planilla", seccion: "Personas",
      opciones: [
        { valor: "alta", etiqueta: "Con alguien con señal alta", conteo: n("planillaAlta") },
        { valor: "con", etiqueta: "Publicada", conteo: n("planilla") },
      ],
    },
    {
      param: "plazas", etiqueta: "Sus plazas CAS (SERVIR)", todas: "Con o sin plazas", seccion: "Personas",
      opciones: [
        { valor: "senales", etiqueta: "Con señales de plaza a la medida", conteo: n("plazasSenales") },
        { valor: "con", etiqueta: "Publicó alguna", conteo: n("plazas") },
      ],
    },
  ];
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar por nombre o RUC…", etiqueta: "Buscar una entidad por su nombre" }}
      visibles={[
        {
          param: "clase",
          etiqueta: "Tipo",
          corta: "Tipo",
          todas: "Todos los tipos",
          opciones: (Object.entries(CLASE) as [ClaseEntidad, (typeof CLASE)[ClaseEntidad]][]).map(([valor, c]) => ({
            valor,
            etiqueta: c.etiqueta,
            conteo: f ? cuenta(c.tipos.reduce((t, x) => t + (tipos.get(x) ?? 0), 0)) : null,
          })),
        },
        {
          param: "region",
          etiqueta: "Región",
          corta: "Región",
          todas: "Todo el Perú",
          opciones: regiones.map((r) => ({ valor: r, etiqueta: tituloNatural(r) })),
        },
        {
          param: "nepotismo",
          etiqueta: "Indicio",
          corta: "Indicio",
          todas: "Todas",
          opciones: [{ valor: "1", etiqueta: "Con posible nepotismo", conteo: n("nepotismo") }],
        },
      ]}
      filtros={filtros}
      orden={{ param: "orden", porDefecto: "contratos", opciones: ORDENES_ENTIDADES.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}
