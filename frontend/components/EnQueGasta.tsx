import { ChevronDown } from "lucide-react";
import { Ayuda, Pestanas, type Pestana } from "@/components/patrones";
import { ListaPaginada } from "@/components/listado";
import type { DatoGasto, GastoEntidad } from "@/lib/mef";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

/**
 * En qué gasta una entidad, según el MEF (GET /entidades/:ruc/gasto, migraciones 63 y 64): lo que viene después de
 * "cuánto tiene y cuánto gastó" en la pestaña "Cuánto gasta" de su ficha. Seis miradas, en pestañas:
 *   · Tipo de gasto: genérica (personal, bienes y servicios, inversión…) › partida ("Alimentos y bebidas") ›
 *     específica ("Alimentos y bebidas para consumo humano"); cada nivel se abre.
 *   · Para qué: la función (defensa, salud, transporte…).
 *   · Programas: los programas presupuestales y sus productos ("Niños con vacuna completa").
 *   · Proyectos de inversión: todos, paginados, con su código único (CUI).
 *   · De dónde viene: fuente de financiamiento › rubro (recursos ordinarios, canon, regalías…).
 *   · Mes a mes: lo devengado cada mes.
 * Cada barra es su parte del PIM de la entidad; el tramo oscuro, lo que ya se devengó. Son datos del presupuesto, no
 * señales: sin rojos ni juicios.
 */
export function EnQueGasta({ gasto }: { gasto: GastoEntidad | null }) {
  if (!gasto?.anio || gasto.genericas.length === 0) return null;
  const total = gasto.genericas.reduce((s, g) => s + g.pim, 0);
  const deTodo = gasto.cruce === "pliego";
  const programas = gasto.programas ?? [];
  const fuentes = gasto.fuentes ?? [];
  const meses = gasto.meses ?? [];

  const pestanas: Pestana[] = [
    {
      clave: "tipo",
      etiqueta: "Tipo de gasto",
      contenido: (
        <ul className="space-y-1">
          {gasto.genericas.map((g, i) => (
            <li key={g.nombre}>
              <Plegable abierta={i === 0} cabeza={<Fila nombre={oracion(g.nombre)} pim={g.pim} devengado={g.devengado} total={total} destacada />}>
                <ul className="space-y-1">
                  {g.partidas.map((p) => (
                    <li key={p.codigo}>
                      <Plegable cabeza={<Fila nombre={oracion(p.nombre)} pim={p.pim} devengado={p.devengado} total={total} />}>
                        {p.especificas?.length ? <Barras filas={p.especificas} total={total} /> : null}
                      </Plegable>
                    </li>
                  ))}
                </ul>
              </Plegable>
            </li>
          ))}
        </ul>
      ),
    },
    {
      clave: "funcion",
      etiqueta: "Para qué",
      contenido: <Barras filas={gasto.funciones} total={total} />,
    },
    ...(programas.length > 0
      ? [
          {
            clave: "programas",
            etiqueta: "Programas",
            conteo: programas.length,
            contenido: (
              <ul className="space-y-1">
                {programas.map((p) => (
                  <li key={p.codigo}>
                    <Plegable cabeza={<Fila nombre={oracion(p.nombre)} pim={p.pim} devengado={p.devengado} total={total} destacada />}>
                      {p.productos.length > 0 ? <Barras filas={p.productos} total={total} /> : null}
                    </Plegable>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    {
      clave: "proyectos",
      etiqueta: "Proyectos de inversión",
      conteo: gasto.proyectos.total,
      contenido: <Proyectos p={gasto.proyectos} total={total} />,
    },
    ...(fuentes.length > 0
      ? [
          {
            clave: "fuentes",
            etiqueta: "De dónde viene",
            contenido: (
              <ul className="space-y-1">
                {fuentes.map((f, i) => (
                  <li key={f.nombre}>
                    <Plegable abierta={i === 0} cabeza={<Fila nombre={oracion(f.nombre)} pim={f.pim} devengado={f.devengado} total={total} destacada />}>
                      {f.rubros.length > 0 ? <Barras filas={f.rubros} total={total} /> : null}
                    </Plegable>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    ...(meses.some((m) => m.devengado > 0) ? [{ clave: "meses", etiqueta: "Mes a mes", contenido: <Meses meses={meses} anio={gasto.anio} /> }] : []),
  ];

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
      <Pestanas param="gasto" etiqueta="Desglose del gasto" pestanas={pestanas} />
    </div>
  );
}

const SIN_PROYECTO = "2999999";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

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

/**
 * Un nivel que se abre: la fila con su barra arriba y, adentro, el nivel siguiente con sangría. Sin nada adentro (una
 * partida sin específicas, una fuente con un solo rubro del mismo nombre) es una fila quieta, alineada con las demás.
 */
function Plegable({ cabeza, abierta = false, children }: { cabeza: React.ReactNode; abierta?: boolean; children: React.ReactNode }) {
  if (!children) return <div className="py-2 pl-[31px] pr-2">{cabeza}</div>;
  return (
    <details className="group/plg" open={abierta}>
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-xl px-2 py-2 transition-colors duration-rapido hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
        <ChevronDown size={15} className="mt-0.5 shrink-0 -rotate-90 text-mute transition-transform duration-rapido group-open/plg:rotate-0" aria-hidden />
        <span className="min-w-0 flex-1">{cabeza}</span>
      </summary>
      <div className="mb-2 ml-4 border-l-2 border-line pl-2 sm:ml-5 sm:pl-3">{children}</div>
    </details>
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
          <span className="block text-[12px] sm:inline sm:text-[13px]">
            <span className="hidden sm:inline"> · </span>
            {pim > 0 ? `${porcentaje(gastado)} gastado` : `${solesCompacto(devengado)} gastado, sin PIM`}
          </span>
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

/** Todos los rubros de mayor a menor; de a 12 si son muchos (programas con decenas de productos). */
function Barras({ filas, total }: { filas: DatoGasto[]; total: number }) {
  return (
    <div className="py-2">
      <ListaPaginada
        tam={12}
        nombre="rubros"
        className="space-y-3 px-2"
        items={filas.map((f) => ({ id: f.codigo, contenido: <Fila nombre={oracion(f.nombre)} pim={f.pim} devengado={f.devengado} total={total} /> }))}
      />
    </div>
  );
}

function Proyectos({ p, total }: { p: GastoEntidad["proyectos"]; total: number }) {
  if (p.total === 0) {
    return <p className="py-2 text-sm text-inkSoft">Este año no tiene proyectos de inversión con presupuesto en el MEF.</p>;
  }
  const mayor = p.lista[0]?.pim || total;
  return (
    <div className="space-y-3 py-2">
      <p className="text-[13px] text-inkSoft">
        <span className="font-semibold text-ink">{solesCompacto(p.pim)}</span> en {plural(p.total, "proyecto", "proyectos")} (
        {total > 0 ? porcentaje((p.pim / total) * 100) : "0 %"} de su presupuesto), {p.pim > 0 ? porcentaje((p.devengado / p.pim) * 100) : "0 %"}{" "}
        ya gastado. De mayor a menor presupuesto; la barra compara con el más grande.
      </p>
      <ListaPaginada
        tam={10}
        nombre="proyectos"
        className="space-y-3"
        items={p.lista.map((x) => ({
          id: x.codigo,
          contenido: (
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
              total={mayor}
            />
          ),
        }))}
      />
    </div>
  );
}

/** El devengado de cada mes en columnas; los meses sin devengado (aún no llegan) quedan vacíos. */
function Meses({ meses, anio }: { meses: { mes: number; devengado: number }[]; anio: number }) {
  const max = Math.max(...meses.map((m) => m.devengado), 1);
  const total = meses.reduce((s, m) => s + m.devengado, 0);
  const mayor = meses.reduce((a, b) => (b.devengado > a.devengado ? b : a), meses[0]);
  return (
    <div className="space-y-3 py-2">
      <p className="text-[13px] text-inkSoft">
        <span className="font-semibold text-ink">{solesCompacto(total)}</span> devengados en {anio}. El mes de más gasto fue{" "}
        {MESES[mayor.mes - 1]}, con {solesCompacto(mayor.devengado)}.
      </p>
      <ol className="grid h-48 grid-cols-12 items-end gap-1 sm:gap-2" aria-label={`Devengado por mes en ${anio}`}>
        {meses.map((m) => (
          <li key={m.mes} className="flex h-full flex-col items-center justify-end gap-1" title={`${MESES[m.mes - 1]}: ${solesCompacto(m.devengado)}`}>
            <span className="hidden text-[10.5px] tabular-nums text-mute sm:block">{m.devengado > 0 ? solesCompacto(m.devengado).replace("S/ ", "") : ""}</span>
            <span
              className={cn("w-full rounded-t-md", m.devengado > 0 ? "bg-granate" : "bg-paperDeep")}
              style={{ height: `${m.devengado > 0 ? Math.max(2, (m.devengado / max) * 100) : 2}%` }}
            />
            <span className="text-[11px] text-mute">{MESES[m.mes - 1]}</span>
            <span className="sr-only">{solesCompacto(m.devengado)}</span>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-mute">
        Devengado: el gasto que la entidad ya reconoció como obligación de pago, en el mes en que lo registró. {numero(meses.filter((m) => m.devengado > 0).length)} meses con datos.
      </p>
    </div>
  );
}
