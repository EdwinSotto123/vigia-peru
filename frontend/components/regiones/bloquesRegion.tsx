import Link from "next/link";
import type { DatoClave } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado";
import { BarraPartes, type ParteBarra } from "@/components/inicio/BarraPartes";
import { BarrasGasto, hayLectura, partesPorLectura, partesPorTipo } from "@/components/inicio/BloquesInicio";
import type { ResumenContratos } from "@/lib/contratos";
import { plural, porcentaje, solesCompacto } from "@/lib/formato";
import type { RegionBudgetSummary } from "@/lib/mef";

/**
 * Lo de adentro de los bloques del Inicio de una región, para sus dos lugares: la ficha /region/[id] (InicioRegionFicha,
 * en el servidor) y la pestaña Inicio del panel de zona del mapa (InicioRegion, en el navegador). Sin estado ni datos
 * propios: sirve en los dos lados. `contratos(filtro)` arma el enlace a la lista ya filtrada de cada lugar.
 */

/** El último año del MEF con su reparto por tipo de gasto; `null` si no hay con qué dibujar «en qué gasta». */
export function anioConGasto(mef: RegionBudgetSummary | null | undefined) {
  const anio = mef?.byYear?.length ? mef.byYear[mef.byYear.length - 1] : null;
  return anio && (mef?.topGenericas?.length ?? 0) > 0 ? anio : null;
}

/** Cuánto presupuesto, cuánto ya gastado y en qué (los tipos de gasto más grandes). */
export function GastoRegion({ mef }: { mef: RegionBudgetSummary }) {
  const anio = anioConGasto(mef);
  if (!anio) return null;
  return (
    <div className="space-y-4">
      <Indicadores
        apilado
        items={[
          { valor: solesCompacto(anio.pim), etiqueta: "de presupuesto", contexto: `en ${anio.year}` },
          { valor: porcentaje(anio.pim > 0 ? (anio.devengado / anio.pim) * 100 : 0), etiqueta: "ya gastado", contexto: solesCompacto(anio.devengado) },
        ]}
      />
      <BarrasGasto rubros={mef.topGenericas!} total={anio.pim} />
    </div>
  );
}

/**
 * Sus contratos: cuántos, por tipo y si Vigía los leyó. Cada número abre la lista que lo cuenta: antes «Leídos 219»
 * sumaba los publicados y los que están en revisión, y abría sólo los publicados (la lista decía otro número).
 *
 * Por tipo y la lectura, cada uno en una barra con su leyenda, con las mismas partes y colores que la ficha de una
 * entidad (BloquesInicio: partesPorTipo, partesPorLectura): antes eran píldoras sueltas y el reparto no se veía
 * (auditoría del 2026-11-05).
 */
export function datosContratosRegion(resumen: ResumenContratos, contratos: (f?: Record<string, string>) => string): DatoClave[] {
  const l = resumen.porLectura;
  const reparto = (partes: ParteBarra[], etiqueta: string) =>
    partes.some((p) => p.n > 0) ? <BarraPartes leyenda="en-linea" etiqueta={etiqueta} partes={partes} className="pt-1" /> : <span className="text-mute">Ninguno</span>;
  return [
    {
      etiqueta: "Desde 2015",
      valor: (
        <Link href={contratos()} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
          {plural(resumen.total, "contrato", "contratos")}
        </Link>
      ),
    },
    { etiqueta: "Por tipo", valor: reparto(partesPorTipo(resumen.porTipo, contratos), "Sus contratos por tipo") },
    {
      etiqueta: "¿Lo leyó Vigía?",
      // Sin ninguno leído, una barra entera de «Aún no» no dice nada: la frase. (La ficha de la región no tiene la cifra
      // de leídos en su cabecera, como la de una entidad: aquí se dice.)
      valor: l ? hayLectura(l) ? reparto(partesPorLectura(l, contratos), "Sus contratos según si Vigía los leyó") : <span className="text-mute">Ninguno todavía</span> : null,
    },
  ];
}
