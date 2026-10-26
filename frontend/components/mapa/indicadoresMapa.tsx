import { Ayuda } from "@/components/patrones/Ayuda";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Indicador } from "@/components/listado";
import type { EstadoGlobal } from "@/lib/financiamiento";
import type { CifrasAnio } from "@/lib/cifras";
import { anioLectura } from "@/lib/contratos";
import { numero } from "@/lib/formato";
import { NumeroVivo } from "./NumeroVivo";
import type { RangoMes } from "./meses";

/**
 * Las cifras del país en la cabecera del panel «Todo el Perú» (plantilla Tablero, DESIGN_SYSTEM.md §14): número, qué
 * es, contexto. Antes iban en una fila encima del mapa y empujaban el lienzo fuera de la primera pantalla.
 *
 * Sin mes ni filtros son las cifras del año de `lib/cifras`: el MISMO resumen que el Inicio, financiar y la portada
 * (antes el mapa sumaba sus departamentos y el Inicio contaba toda la base: la misma palabra, otro número). Con un mes o
 * filtros, lo que cumple, sumado de los departamentos del mapa, y el contexto lo dice.
 *
 * Mientras una fuente carga, la cifra es un esqueleto (nunca un cero provisional) y el rótulo ya está: la fila no salta
 * cuando llegan los datos. Si no respondió, «Sin dato».
 */

const ESPERA = <Skeleton className="h-[22px] w-16" />;
const vivo = (n: number) => <NumeroVivo valor={n} />;

/** `conSenales` de /contratos/geo cuenta score ≥ 40 y alerta publicada: se dice "de riesgo medio o alto", nunca "con señales". */
const AYUDA_RIESGO = (
  <Ayuda titulo="¿Qué se cuenta como riesgo medio o alto?">
    <span className="block">
      Contratos leídos con el dictamen publicado y un puntaje de 40 o más: tienen señales y su peso del riesgo es medio o
      alto.
    </span>
    <span className="mt-2 block text-mute">
      La cifra es la del año. La capa de puntos «Riesgo medio o alto, todos los años» dibuja también los de años
      anteriores, y no sigue los filtros.
    </span>
  </Ayuda>
);

export function indicadoresPais({
  total,
  cargando,
  mes,
  filtrado,
  estado,
  anio,
}: {
  /** Lo que cumple, sumado de los departamentos del mapa (para un mes o con filtros). */
  total: { total: number; leidos: number; conSenales: number };
  cargando: boolean;
  mes: RangoMes | null;
  /** Hay filtros de contratos puestos (partido, tipo, lectura, antecedentes). */
  filtrado: boolean;
  /** `undefined` = todavía no respondió; `null` = no respondió. */
  estado: EstadoGlobal | null | undefined;
  /** Las cifras del año (lib/cifras). `undefined` = cargando; `null` = no respondió. */
  anio: CifrasAnio | null | undefined;
}): Indicador[] {
  if (!mes && !filtrado) {
    const a = anio;
    return [
      {
        valor: a === undefined ? ESPERA : a ? vivo(a.leidos) : null,
        etiqueta: "contratos leídos",
        contexto: a ? `de ${numero(a.publicados)} publicados en ${a.anio}` : undefined,
        ayuda: (
          <Ayuda titulo="¿De dónde sale?">
            Del mismo resumen que el Inicio, financiar y la portada: los contratos convocados este año. La lista de
            abajo los reparte por la sede de la entidad que contrata.
          </Ayuda>
        ),
      },
      {
        valor: a === undefined ? ESPERA : a ? vivo(a.riesgoMedioOAlto) : null,
        etiqueta: "de riesgo medio o alto",
        contexto: a ? `de ${numero(a.leidos)} leídos en ${a.anio}` : undefined,
        ayuda: AYUDA_RIESGO,
      },
      // "Hoy" no se acota por mes ni por filtros: sólo en la vista sin acotar.
      {
        valor: estado === undefined ? ESPERA : estado ? vivo(estado.procesadosHoy) : null,
        etiqueta: "leídos hoy",
        contexto: estado ? `y ${numero(estado.ingresadosHoy)} contratos nuevos del SEACE` : undefined,
      },
    ];
  }
  const donde = mes ? ` en ${mes.etiqueta}` : ` en ${anioLectura()}`;
  const conFiltros = filtrado ? ", con estos filtros" : "";
  return [
    {
      valor: cargando ? ESPERA : vivo(total.leidos),
      etiqueta: "contratos leídos",
      contexto: cargando ? undefined : `de ${numero(total.total)} publicados${donde}${conFiltros}`,
    },
    {
      valor: cargando ? ESPERA : vivo(total.conSenales),
      etiqueta: "de riesgo medio o alto",
      contexto: cargando ? undefined : `de ${numero(total.leidos)} leídos${donde}`,
      ayuda: AYUDA_RIESGO,
    },
  ];
}
