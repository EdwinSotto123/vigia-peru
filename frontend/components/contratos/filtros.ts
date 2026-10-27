/**
 * Los filtros de una lista de contratos, para la `BarraFiltros` del kit: los usan /app/contratos y la lista de
 * contratos de la ficha de una entidad (/entidad/[ruc]), que así filtran igual y con las mismas palabras.
 *
 * Los conteos salen del resumen (`GET /contratos/resumen`), que cuenta cada pregunta sin su propio filtro; sin
 * resumen no hay conteo (nunca un 0 inventado).
 */

import type { FiltroSecundario, Parametros } from "@/components/listado";
import { etiquetaMes, ultimosMeses } from "@/components/mapa/meses";
import { DATOS_GANADORA, ETAPAS, LECTURAS, OPERATIVOS, PRIMER_ANIO_CONTRATOS, TIPOS, type ResumenContratos } from "@/lib/contratos";
import { fechaCorta, listaY, soles } from "@/lib/formato";
import { esTipoObra, GRUPOS_CRUCE, TIPO_CRUCE } from "@/lib/cruces";

/** Conteo de una opción: del resumen si respondió (0 es un dato); si no, sin número. */
const conteoDe = (resumen: ResumenContratos | null, m: Partial<Record<string, number>> | undefined, k: string) =>
  resumen ? m?.[k] ?? 0 : null;

/**
 * Tres preguntas a la vista, en desplegables, cada opción con su conteo:
 *   · ¿Lo leyó Vigía? (aún no · leyéndose · leído y publicado · leído, en revisión humana). Antes eran cinco chips que
 *     mezclaban el estado de lectura con el riesgo encontrado.
 *   · Riesgo encontrado: sólo existe para lo leído y publicado (elegir uno ya filtra a esos).
 *   · Antecedentes del ganador: con uno grave, con alguno y cada tipo (aportes, sanciones, visitas, socios comunes…),
 *     agrupados en el mismo desplegable. Antes los tipos eran un panel de chips que se abría arriba de la lista.
 */
export function filtrosVisibles(
  resumen: Pick<ResumenContratos, "porLectura" | "porRiesgo" | "porCruces"> | null,
  /** La obra va en su propio filtro (`filtroObra`): fuera de «Antecedentes». Donde no lo hay, la obra sigue ahí. */
  obraAparte = false,
): FiltroSecundario[] {
  const l = resumen?.porLectura;
  const r = resumen?.porRiesgo;
  const k = resumen?.porCruces;
  const deRiesgo = (x: "alto" | "medio" | "bajo") => (r ? r[x] ?? 0 : null);
  return [
    {
      param: "lectura",
      etiqueta: "¿Lo leyó Vigía?",
      corta: "¿Lo leyó Vigía?",
      todas: "Todos",
      opciones: LECTURAS.map((x) => ({ valor: x.value, etiqueta: x.label, conteo: l ? l[x.value] ?? 0 : null })),
    },
    {
      param: "riesgo",
      etiqueta: "Riesgo",
      corta: "Riesgo",
      todas: "Cualquiera",
      // El API junta "bajo" y "sin señales" (score < 40): la etiqueta lo dice.
      opciones: [
        { valor: "alto", etiqueta: "Alto", conteo: deRiesgo("alto") },
        { valor: "medio", etiqueta: "Medio", conteo: deRiesgo("medio") },
        { valor: "bajo", etiqueta: "Bajo o sin señales", conteo: deRiesgo("bajo") },
      ],
    },
    {
      param: "cruces",
      etiqueta: "Antecedentes del ganador",
      corta: "Antecedentes",
      todas: "Todos",
      // Un tipo sin coincidencias no se ofrece, pero un enlace puede traerlo elegido: el chip lo nombra igual.
      etiquetas: Object.fromEntries(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.corto]))),
      opciones: [
        { valor: "alta", etiqueta: "Con uno grave", conteo: k ? k.alta : null },
        { valor: "con", etiqueta: "Con alguno", conteo: k ? k.con : null },
        // Sólo los antecedentes que SÍ son de ESTE contrato (los que casos_cruce cuenta). Los hechos del proveedor que no
        // se atribuyen al contrato (aporte a cualquier partido, candidato, autoridad…) salen en 0 aquí —son datos de la
        // empresa, migración 115—, así que no se ofrecen en este filtro; se ven en /app/empresas y en «datos del proveedor».
        ...GRUPOS_CRUCE.flatMap((g) =>
          g.tipos
            .filter((t) => !(obraAparte && esTipoObra(t.tipo)))
            .filter((t) => !k?.tipos || (k.tipos[t.tipo] ?? 0) > 0)
            .map((t) => ({ valor: t.tipo, etiqueta: t.corto, grupo: g.titulo, conteo: k?.tipos ? k.tipos[t.tipo] ?? 0 : null }))),
      ],
    },
  ];
}

/**
 * La obra del contrato (INFOBRAS e Invierte.pe): paralizada, atrasada, pagada sin avance, con adicionales… Son hechos de
 * la ejecución de ESTE contrato, no antecedentes de quien ganó: van en su propio desplegable (`obra`), que se combina con
 * el de antecedentes. Cada tipo con su conteo, sin este filtro y con los demás.
 */
export function filtroObra(resumen: Pick<ResumenContratos, "porObra" | "porCruces"> | null): FiltroSecundario {
  const k = resumen?.porObra ?? resumen?.porCruces;
  const tipos = GRUPOS_CRUCE.flatMap((g) => g.tipos).filter((t) => esTipoObra(t.tipo));
  return {
    param: "obra",
    etiqueta: "La obra del contrato",
    corta: "La obra",
    todas: "Toda obra o compra",
    etiquetas: Object.fromEntries(tipos.map((t) => [t.tipo, t.corto])),
    opciones: [
      { valor: "con", etiqueta: "Con alguna bandera de obra", conteo: k?.obra ?? null },
      ...tipos
        .filter((t) => !k?.tipos || (k.tipos[t.tipo] ?? 0) > 0)
        .map((t) => ({ valor: t.tipo, etiqueta: t.corto, grupo: grupoObra(t.tipo), conteo: k?.tipos ? k.tipos[t.tipo] ?? 0 : null })),
    ],
  };
}

/** Las banderas de la obra en tres grupos: cómo avanza, cuánto se pagó y añadió, y los conflictos. */
function grupoObra(tipo: string): string {
  if (/^obra_(paraliza|atraso|plazo)/.test(tipo)) return "Avance y plazo";
  if (/^obra_(pag|adicional)|^inversion_sobrecosto/.test(tipo)) return "Pagos, adicionales y costo";
  return "Controversias y control";
}

/** La cola de financiamiento y los documentos: la pregunta de quien va a financiar (va en "Filtros"). */
export const filtroOperativo = (resumen: ResumenContratos | null): FiltroSecundario => ({
  param: "operativo",
  etiqueta: "Cola y documentos",
  todas: "Todos",
  opciones: OPERATIVOS.map((o) => ({ valor: o.value, etiqueta: o.label, conteo: conteoDe(resumen, resumen?.porOperativo, o.value) })),
});

export const filtroTipo = (resumen: ResumenContratos | null): FiltroSecundario => ({
  param: "tipo",
  etiqueta: "Tipo",
  todas: "Todo tipo",
  opciones: TIPOS.map((t) => ({ valor: t.value, etiqueta: t.label, conteo: conteoDe(resumen, resumen?.porTipo, t.value) })),
});

/** Sin conteo: el resumen no cuenta por etapa. */
export const filtroEtapa = (): FiltroSecundario => ({
  param: "etapa",
  etiqueta: "Etapa",
  todas: "Toda etapa",
  opciones: ETAPAS.map((e) => ({ valor: e.value, etiqueta: e.label })),
});

/** Los últimos 12 meses; si la URL trae uno más viejo, se agrega para que el select no quede en blanco. */
export function filtroMes(parametros: Parametros): FiltroSecundario {
  const meses = ultimosMeses(12).map((m) => ({ valor: m.desde.slice(0, 7), etiqueta: m.etiqueta }));
  // Y cada año entero desde 2015 (la base trae la historia del OECE): "Todo 2022".
  const hoy = new Date().getUTCFullYear();
  const anios = Array.from({ length: hoy - PRIMER_ANIO_CONTRATOS + 1 }, (_, i) => String(hoy - i)).map((a) => ({ valor: a, etiqueta: `Todo ${a}` }));
  const opciones = [...meses, ...anios];
  if (parametros.mes && !opciones.some((m) => m.valor === parametros.mes)) opciones.push({ valor: parametros.mes, etiqueta: etiquetaMes(parametros.mes) });
  return { param: "mes", etiqueta: "Año o mes de convocatoria", todas: "Todo el histórico", opciones };
}

/**
 * El mismo filtro de fecha A LA VISTA (en `visibles`): «Año o mes» dentro del desplegable, como «Año» en Órdenes, y el
 * nombre completo en el chip de «Filtrando por». El periodo es el alcance de la lista: se ve, no se esconde (§12).
 */
export const filtroMesVisible = (parametros: Parametros): FiltroSecundario => ({ ...filtroMes(parametros), corta: "Año o mes" });

/**
 * Los subtítulos con que una lista de contratos agrupa su menú «Filtros» (`FiltroSecundario.seccion`): antes eran ocho
 * desplegables seguidos, sin orden. Las mismas palabras en toda lista que los use.
 */
export const SECCIONES_FILTRO = { que: "Qué", quien: "Quién compra", ganador: "Quién ganó", cuanto: "Cuánto", lectura: "Lectura" } as const;

/**
 * Los datos de la EMPRESA que ganó (su estado de hoy en la SUNAT, hechos políticos de su gente): van aparte de
 * «Antecedentes del ganador», que sólo cuenta lo ligado a ESTE contrato (migración 115). Sin conteo: contarlos pide
 * cruzar cada empresa con todos sus contratos, y un 0 provisional no va.
 */
export const filtroGanadora = (): FiltroSecundario => ({
  param: "ganadora",
  etiqueta: "Datos de la empresa ganadora",
  todas: "Cualquier empresa",
  opciones: DATOS_GANADORA.map((d) => ({ valor: d.valor, etiqueta: d.etiqueta, grupo: d.grupo })),
});

/** El posible error de carga del OECE (S/ 1 de valor referencial, o 20 veces lo adjudicado): las mismas palabras que en Empresas. */
export const filtroDudoso = (resumen: Pick<ResumenContratos, "porDudoso"> | null): FiltroSecundario => ({
  param: "dudoso",
  etiqueta: "Calidad del dato",
  todas: "Todos los datos",
  opciones: [{ valor: "si", etiqueta: "Con posible error de carga", conteo: resumen?.porDudoso ?? null }],
});

/** Pone esos filtros bajo un subtítulo del menú «Filtros». */
export const enSeccion = (seccion: string, ...filtros: FiltroSecundario[]): FiltroSecundario[] => filtros.map((f) => ({ ...f, seccion }));

const MONTOS_DESDE = [50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
const MONTOS_HASTA = [50_000, 100_000, 500_000, 1_000_000, 5_000_000];

/** Un preset de monto; si la URL trae otro valor, se agrega con su formato (el select no queda en blanco). */
function opcionesMonto(presets: number[], actual: string | undefined) {
  const opciones = presets.map((m) => ({ valor: String(m), etiqueta: soles(m) }));
  if (actual && !opciones.some((o) => o.valor === actual)) opciones.push({ valor: actual, etiqueta: soles(Number(actual)) });
  return opciones;
}

export const filtrosMonto = (parametros: Parametros): FiltroSecundario[] => [
  { param: "monto_min", etiqueta: "Valor referencial desde", todas: "Sin mínimo", opciones: opcionesMonto(MONTOS_DESDE, parametros.monto_min) },
  { param: "monto_max", etiqueta: "Valor referencial hasta", todas: "Sin máximo", opciones: opcionesMonto(MONTOS_HASTA, parametros.monto_max) },
];

/**
 * Lo que llega por enlace sin un control propio, como chip de «Filtrando por» que se puede quitar: varios antecedentes a
 * la vez (`cruce`, la bandera de captura de una entidad) y el período de un gobierno (`desde`/`hasta`; un mes entero va
 * como `mes`, que sí tiene control). Antes la lista filtraba y la barra decía «Todos» y «Todo el histórico».
 */
export function chipsDeEnlace(parametros: Parametros, conCruce = true): { clave: string; texto: string; params: string[] }[] {
  const out: { clave: string; texto: string; params: string[] }[] = [];
  if (conCruce && parametros.cruce) {
    const nombres = parametros.cruce.split(",").filter(Boolean).map((t) => TIPO_CRUCE[t]?.corto ?? t.replace(/_/g, " "));
    out.push({ clave: "cruce", texto: `Antecedentes: ${listaY(nombres)}`, params: ["cruce"] });
  }
  const d = parametros.desde && /^\d{4}-\d{2}-\d{2}$/.test(parametros.desde) ? fechaCorta(parametros.desde) : null;
  const h = parametros.hasta && /^\d{4}-\d{2}-\d{2}$/.test(parametros.hasta) ? fechaCorta(parametros.hasta) : null;
  if (d || h) out.push({ clave: "periodo", texto: d && h ? `Período: del ${d} al ${h}` : d ? `Desde el ${d}` : `Hasta el ${h}`, params: ["desde", "hasta"] });
  return out;
}
