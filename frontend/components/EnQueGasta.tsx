import { Ayuda, Pestanas } from "@/components/patrones";
import type { DatoGasto, GastoEntidad } from "@/lib/mef";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

/**
 * En qué gasta una entidad, según el MEF (GET /entidades/:ruc/gasto, migración 63): lo que viene después de "cuánto
 * tiene y cuánto gastó" en la sección "Cuánto gasta" de su ficha. Tres miradas, en pestañas:
 *   · Tipo de gasto: las genéricas (personal, bienes y servicios, inversión…), cada una se abre en sus partidas
 *     ("Alimentos y bebidas", "Combustibles…").
 *   · Función: para qué (defensa, salud, transporte…).
 *   · Proyectos de inversión: cada uno con su código único (CUI), lo que tiene y lo que ya gastó.
 * Cada barra es su parte del PIM de la entidad; el tramo oscuro, lo que ya se devengó. Son datos del presupuesto, no
 * señales: sin rojos ni juicios.
 */
export function EnQueGasta({ gasto }: { gasto: GastoEntidad | null }) {
  if (!gasto?.anio || gasto.genericas.length === 0) return null;
  const total = gasto.genericas.reduce((s, g) => s + g.pim, 0);
  const deTodo = gasto.cruce === "pliego";

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
          En qué gasta en {gasto.anio}
          {deTodo && <span className="text-[13px] font-normal text-amberTexto">(todo el gobierno regional)</span>}
          <Ayuda titulo="¿De dónde sale este desglose?">
            Del archivo de presupuesto y ejecución de gasto del MEF, fila por fila. La barra es la parte de su presupuesto
            (PIM) que va a cada rubro; el tramo oscuro, lo que ya gastó (devengado). Un rubro con poco gastado no es una
            irregularidad: el año puede estar en curso.
          </Ayuda>
        </h3>
        <Leyenda />
      </div>
      <Pestanas
        param="gasto"
        etiqueta="Desglose del gasto"
        pestanas={[
          {
            clave: "tipo",
            etiqueta: "Tipo de gasto",
            contenido: (
              <ul className="space-y-1">
                {gasto.genericas.map((g, i) => (
                  <li key={g.nombre}>
                    <details className="group/gen" open={i === 0}>
                      <summary className="cursor-pointer list-none rounded-xl px-2 py-2 transition-colors duration-rapido hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
                        <Fila nombre={oracion(g.nombre)} pim={g.pim} devengado={g.devengado} total={total} destacada />
                      </summary>
                      <div className="mb-2 ml-2 border-l-2 border-line pl-3 sm:ml-4 sm:pl-4">
                        <Barras filas={g.partidas} total={total} maximo={10} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            clave: "funcion",
            etiqueta: "Para qué",
            contenido: <Barras filas={gasto.funciones} total={total} maximo={12} />,
          },
          {
            clave: "proyectos",
            etiqueta: "Proyectos de inversión",
            conteo: gasto.proyectos.total,
            contenido: <Proyectos p={gasto.proyectos} total={total} />,
          },
        ]}
      />
    </div>
  );
}

const SIN_PROYECTO = "2999999";

/** "BIENES Y SERVICIOS" → "Bienes y servicios": categorías del clasificador, no nombres propios. */
function oracion(t: string): string {
  const b = t.trim().toLocaleLowerCase("es");
  return b.charAt(0).toLocaleUpperCase("es") + b.slice(1);
}

function Leyenda() {
  return (
    <p className="flex items-center gap-3 text-[12px] text-mute" aria-hidden>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-3 rounded-full bg-granate" /> ya gastado
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-3 rounded-full bg-granate/25" /> por gastar
      </span>
    </p>
  );
}

/** Un rubro: nombre, monto y % gastado; debajo, su barra (parte del PIM total, con lo devengado en oscuro). */
function Fila({
  nombre,
  pim,
  devengado,
  total,
  destacada = false,
  recortar = false,
  extra,
}: {
  nombre: string;
  pim: number;
  devengado: number;
  total: number;
  destacada?: boolean;
  /** Nombres largos (proyectos de cuatro líneas): dos líneas y el resto en el `title`. */
  recortar?: boolean;
  extra?: React.ReactNode;
}) {
  const ancho = total > 0 ? Math.max(0.6, Math.min(100, (pim / total) * 100)) : 0;
  const gastado = pim > 0 ? Math.min(100, (devengado / pim) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn("min-w-0", destacada ? "text-[14px] font-semibold text-ink" : "text-[13px] text-ink", recortar && "line-clamp-2")}
          title={recortar ? nombre : undefined}
        >
          {nombre}
          {extra}
        </span>
        <span className="shrink-0 text-right text-[13px] tabular-nums text-inkSoft">
          <span className="font-semibold text-ink">{solesCompacto(pim)}</span>
          <span className="hidden sm:inline"> · {pim > 0 ? `${porcentaje(gastado)} gastado` : "sin PIM"}</span>
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-paperDeep"
        role="img"
        aria-label={`${solesCompacto(pim)} de presupuesto, ${pim > 0 ? porcentaje(gastado) : "0 %"} gastado`}
      >
        <div className="h-full rounded-full bg-granate/25" style={{ width: `${ancho}%` }}>
          <div className="h-full rounded-full bg-granate" style={{ width: `${gastado}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Los rubros de mayor a menor; los que no entran, sumados en una línea. */
function Barras({ filas, total, maximo }: { filas: DatoGasto[]; total: number; maximo: number }) {
  const vista = filas.slice(0, maximo);
  const resto = filas.slice(maximo);
  return (
    <div className="space-y-3 py-2">
      <ul className="space-y-3">
        {vista.map((f) => (
          <li key={f.codigo}>
            <Fila nombre={oracion(f.nombre)} pim={f.pim} devengado={f.devengado} total={total} />
          </li>
        ))}
      </ul>
      {resto.length > 0 && (
        <p className="text-[12px] text-mute">
          Y {plural(resto.length, "rubro más", "rubros más")}: {solesCompacto(resto.reduce((s, f) => s + f.pim, 0))} en total.
        </p>
      )}
    </div>
  );
}

function Proyectos({ p, total }: { p: GastoEntidad["proyectos"]; total: number }) {
  if (p.total === 0) {
    return <p className="py-2 text-sm text-inkSoft">Este año no tiene proyectos de inversión con presupuesto en el MEF.</p>;
  }
  return (
    <div className="space-y-3 py-2">
      <p className="text-[13px] text-inkSoft">
        <span className="font-semibold text-ink">{solesCompacto(p.pim)}</span> en {plural(p.total, "proyecto", "proyectos")} (
        {total > 0 ? porcentaje((p.pim / total) * 100) : "0 %"} de su presupuesto), {p.pim > 0 ? porcentaje((p.devengado / p.pim) * 100) : "0 %"}{" "}
        ya gastado.{p.total > p.lista.length ? ` Los ${numero(p.lista.length)} de mayor presupuesto:` : ""}
      </p>
      <ul className="space-y-3">
        {p.lista.map((x) => (
          <li key={x.codigo}>
            <Fila
              nombre={tituloNatural(x.nombre)}
              recortar
              extra={
                // 2999999: inversiones sin código propio en el MEF (no es un CUI).
                x.codigo !== SIN_PROYECTO && (
                  <span className="ml-2 whitespace-nowrap font-mono text-[11px] font-normal text-mute" translate="no" title="Código único de inversión">
                    CUI {x.codigo}
                  </span>
                )
              }
              pim={x.pim}
              devengado={x.devengado}
              total={p.lista[0]?.pim || total}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
