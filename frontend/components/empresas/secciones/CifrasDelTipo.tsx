import { MuestraSerie } from "@/components/charts/BarraSegmentada";
import { ColumnasAnio } from "@/components/charts/ColumnasAnio";
import { Indicadores } from "@/components/listado";
import { numero, plural } from "@/lib/formato";

/** Lo que hace falta de cada caso: su severidad, su fecha, su entidad (RUC o nombre) y su proceso. */
export interface CasoContado {
  severidad: "alta" | "media" | "baja";
  fecha: string | null;
  entidad: string | null;
  ocid: string | null;
}

/**
 * Lo que cuentan los casos de un tipo de antecedente de una empresa, bajo su título (pedido del usuario del 2026-11-18:
 * «lo veo sin forma»): cuántas veces, cuántas de señal alta con su parte, en cuántas entidades y procesos, y, si caen en
 * tres años o más, año por año (los de señal alta abajo). Desde tres casos: con uno o dos, la lista de abajo ya lo dice.
 * Va dentro de la tarjeta del tipo (la franja pierde su marco allí). Server-safe; el gráfico es de cliente.
 */
export function CifrasDelTipo({ titulo, casos, registros }: { titulo: string; casos: CasoContado[]; registros: number }) {
  if (casos.length < 3) return null;
  const altas = casos.filter((c) => c.severidad === "alta").length;
  const entidades = new Set(casos.map((c) => c.entidad).filter(Boolean)).size;
  const procesos = new Set(casos.map((c) => c.ocid).filter(Boolean)).size;
  const porAnio = new Map<number, { a: number; b: number }>();
  for (const c of casos) {
    const y = c.fecha ? Number(c.fecha.slice(0, 4)) : NaN;
    if (!Number.isFinite(y) || y < 1990) continue;
    const x = porAnio.get(y) ?? { a: 0, b: 0 };
    if (c.severidad === "alta") x.a += 1;
    else x.b += 1;
    porAnio.set(y, x);
  }
  const anios = [...porAnio.entries()].sort(([x], [y]) => x - y);
  return (
    <div className="space-y-4 px-4 pb-4 sm:px-5">
      <Indicadores
        franja
        items={[
          {
            valor: numero(casos.length),
            etiqueta: "veces",
            contexto: registros < casos.length ? `en ${plural(registros, "registro", "registros")}` : "una por registro",
            icono: null,
            parte: null,
          },
          { valor: numero(altas), etiqueta: "de señal alta", contexto: `de ${numero(casos.length)}`, tono: altas ? "alta" : "neutro", parte: altas / casos.length },
          ...(entidades > 0
            ? [{ valor: numero(entidades), etiqueta: entidades === 1 ? "entidad" : "entidades distintas", contexto: procesos ? `en ${plural(procesos, "proceso", "procesos")}` : "sin proceso atado", parte: null }]
            : []),
        ]}
      />
      {anios.length >= 3 && (
        <figure className="space-y-2">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-meta font-semibold text-ink">Año por año</span>
            <span className="flex flex-wrap items-center gap-x-4 text-rotulo text-inkSoft">
              {altas > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <MuestraSerie i={0} /> De señal alta
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <MuestraSerie i={1} /> Media o baja
              </span>
            </span>
          </figcaption>
          <ColumnasAnio
            anios={anios.map(([anio, x]) => ({ anio, a: x.a, b: x.b, detalleA: plural(x.a, "vez", "veces"), detalleB: plural(x.b, "vez", "veces") }))}
            etiquetaA="De señal alta"
            etiquetaB="Media o baja"
            formato="numero"
            etiqueta={`${titulo}, por año`}
          />
        </figure>
      )}
    </div>
  );
}
