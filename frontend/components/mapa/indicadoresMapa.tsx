import { Ayuda } from "@/components/patrones/Ayuda";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Indicador } from "@/components/listado";
import type { ContratoZona } from "@/lib/contratos";
import type { EstadoGlobal, Zona } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { NumeroVivo } from "./NumeroVivo";
import type { RangoMes } from "./meses";

/**
 * Las cifras de cabecera del mapa (plantilla Tablero, DESIGN_SYSTEM.md §14): antes iban
 * en una línea gris junto al título ("118 leídos de 18,393… · 44 de riesgo medio o
 * alto"); ahora son `Indicadores` —número, qué es, contexto— entre el encabezado y el
 * mapa. Mismas cifras, mismas fuentes y mismas palabras de §10.1.
 *
 * Mientras una fuente carga, la cifra es un esqueleto (nunca un cero provisional) y el
 * rótulo ya está: la fila no salta cuando llegan los datos.
 */

const ESPERA = <Skeleton className="h-[26px] w-20" />;
const vivo = (n: number) => <NumeroVivo valor={n} />;

/** `conSenales` de /contratos/geo cuenta score ≥ 40 y alerta publicada: se dice "de riesgo medio o alto", nunca "con señales". */
const AYUDA_RIESGO = (
  <Ayuda titulo="¿Qué se cuenta como riesgo medio o alto?">
    Contratos leídos con el dictamen publicado y un puntaje de 40 o más: tienen señales y su peso del riesgo es medio o
    alto. Son los puntos de la capa «Riesgo medio o alto».
  </Ayuda>
);

/** Todo el Perú: leídos de publicados, de riesgo medio o alto, y lo de hoy (sin mes elegido). */
export function indicadoresPais({
  total,
  cargando,
  mes,
  estado,
}: {
  total: { total: number; leidos: number; conSenales: number };
  cargando: boolean;
  mes: RangoMes | null;
  /** `undefined` = todavía no respondió; `null` = no respondió. */
  estado: EstadoGlobal | null | undefined;
}): Indicador[] {
  const enMes = mes ? ` en ${mes.etiqueta}` : "";
  const items: Indicador[] = [
    {
      valor: cargando ? ESPERA : vivo(total.leidos),
      etiqueta: "contratos leídos",
      contexto: cargando ? undefined : `de ${numero(total.total)} publicados${enMes}`,
    },
    {
      valor: cargando ? ESPERA : vivo(total.conSenales),
      etiqueta: "de riesgo medio o alto",
      contexto: cargando ? undefined : `de ${numero(total.leidos)} leídos${enMes}`,
      ayuda: AYUDA_RIESGO,
    },
  ];
  // "Hoy" no se acota por mes: con un mes elegido no se muestra.
  if (!mes) {
    items.push({
      valor: estado === undefined ? ESPERA : estado ? vivo(estado.procesadosHoy) : "Sin dato",
      etiqueta: "leídos hoy",
      contexto: estado ? `y ${numero(estado.ingresadosHoy)} contratos nuevos del SEACE` : undefined,
    });
  }
  return items;
}

/**
 * Un departamento abierto. "Financiados" y "esperando lectura" salen de una sola fuente
 * (`/financiamiento/zonas`); con un mes elegido el financiamiento no se puede acotar por
 * mes, así que se dice sólo lo que sí: cuántos del mes esperan lectura.
 */
export function indicadoresRegion({
  zona,
  financiamiento,
  financiamientoCargando,
  mes,
}: {
  /** Cifras del departamento en /contratos/geo (las del mes, si hay mes). `undefined` = cargando. */
  zona: ContratoZona | undefined;
  financiamiento: Zona | undefined;
  financiamientoCargando: boolean;
  mes: RangoMes | null;
}): Indicador[] {
  const enMes = mes ? ` en ${mes.etiqueta}` : "";
  const items: Indicador[] = [];
  if (!mes) {
    items.push({
      valor: financiamientoCargando ? ESPERA : financiamiento ? vivo(financiamiento.financiados) : "Sin dato",
      etiqueta: "financiados",
      contexto: financiamiento ? "con la lectura pagada" : undefined,
    });
  }
  const esperando = mes ? zona?.enCola : financiamiento?.pendientes ?? zona?.enCola;
  items.push(
    {
      valor: !zona || (!mes && financiamientoCargando) ? ESPERA : vivo(esperando ?? 0),
      etiqueta: "esperando lectura",
      contexto: zona ? `de ${numero(zona.total)} publicados${enMes}` : undefined,
    },
    {
      valor: zona ? vivo(zona.conSenales) : ESPERA,
      etiqueta: "de riesgo medio o alto",
      contexto: zona ? `de ${numero(zona.procesados)} leídos${enMes}` : undefined,
      ayuda: AYUDA_RIESGO,
    },
  );
  return items;
}
