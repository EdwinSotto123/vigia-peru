/**
 * Los filtros de una lista de contratos, para la `BarraFiltros` del kit: los usan /app/contratos y la lista de
 * contratos de la ficha de una entidad (/entidad/[ruc]), que así filtran igual y con las mismas palabras.
 *
 * Los conteos salen del resumen (`GET /contratos/resumen`), que cuenta cada pregunta sin su propio filtro; sin
 * resumen no hay conteo (nunca un 0 inventado).
 */

import type { FiltroSecundario, Parametros } from "@/components/listado";
import { etiquetaMes, ultimosMeses } from "@/components/mapa/meses";
import { ETAPAS, LECTURAS, OPERATIVOS, PRIMER_ANIO_CONTRATOS, TIPOS, type ResumenContratos } from "@/lib/contratos";
import { soles } from "@/lib/formato";
import { GRUPOS_CRUCE } from "@/lib/cruces";

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
export function filtrosVisibles(resumen: Pick<ResumenContratos, "porLectura" | "porRiesgo" | "porCruces"> | null): FiltroSecundario[] {
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
      opciones: [
        { valor: "alta", etiqueta: "Con uno grave", conteo: k ? k.alta : null },
        { valor: "con", etiqueta: "Con alguno", conteo: k ? k.con : null },
        ...GRUPOS_CRUCE.flatMap((g) =>
          g.tipos.map((t) => ({ valor: t.tipo, etiqueta: t.corto, grupo: g.titulo, conteo: k?.tipos ? k.tipos[t.tipo] ?? 0 : null }))),
      ],
    },
  ];
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
  return { param: "mes", etiqueta: "Mes o año de convocatoria", todas: "Todo el histórico", opciones };
}

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
