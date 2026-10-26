import Link from "next/link";
import type { DatoClave } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado";
import { BarrasGasto, Fichas } from "@/components/inicio/BloquesInicio";
import { TIPOS, type ResumenContratos } from "@/lib/contratos";
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
 */
export function datosContratosRegion(resumen: ResumenContratos, contratos: (f?: Record<string, string>) => string): DatoClave[] {
  const l = resumen.porLectura;
  return [
    {
      etiqueta: "Desde 2015",
      valor: (
        <Link href={contratos()} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
          {plural(resumen.total, "contrato", "contratos")}
        </Link>
      ),
    },
    { etiqueta: "Por tipo", valor: <Fichas items={TIPOS.map((t) => ({ etiqueta: t.label, n: resumen.porTipo[t.value] ?? 0, href: contratos({ tipo: t.value }) }))} /> },
    {
      etiqueta: "¿Lo leyó Vigía?",
      valor: l ? (
        <Fichas
          items={[
            { etiqueta: "Con dictamen", n: l.publicado ?? 0, href: contratos({ lectura: "publicado" }), destacada: true },
            { etiqueta: "En revisión humana", n: l.revision ?? 0, href: contratos({ lectura: "revision" }) },
            { etiqueta: "Leyéndose", n: l.leyendo ?? 0, href: contratos({ lectura: "leyendo" }) },
            { etiqueta: "Aún no", n: l.sin_leer ?? 0, href: contratos({ lectura: "sin_leer" }) },
          ]}
        />
      ) : null,
    },
  ];
}
