import type { ReactNode } from "react";
import { BarraSegmentada, Medidor, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { ColumnasAnio, type AnioColumna } from "@/components/charts/ColumnasAnio";
import { ColumnasSerie, type PuntoSerie } from "@/components/charts/ColumnasSerie";
import { Ayuda, AyudaTermino } from "@/components/patrones";
import { numero, plural, porcentaje } from "@/lib/formato";
import { mesCorto } from "@/lib/partidosApi";
import type { MesVisitas, VisitasEntidad } from "@/lib/visitas";

/**
 * El resumen de las visitas de una entidad, en UNA tarjeta sobre sus listas (rediseño del 2026-11-18): cómo cambian mes a
 * mes y cómo se reparten (quién la visita, cuántas van a quien decide las compras y cuántas fuera del horario). Antes la
 * pestaña eran cinco tablas apiladas y nada contaba la historia de un vistazo.
 *
 * Mes a mes con hasta 36 meses (a 390 px, 36 columnas aún se distinguen); con más (el Congreso, desde 2020), por año y
 * partido en lo que fue de empresas y lo demás. Colores sólo por las series (`--serie-1…`): la 1 es siempre «de empresas y
 * organizaciones privadas», en el reparto y en las columnas por año. Server component.
 */

const MAX_MESES = 36;

/** Todos los meses del primero al último: un mes sin visitas cargadas va como hueco (sin dato), no como un cero. */
function completar(meses: MesVisitas[]): (MesVisitas | { mes: string; visitas: null })[] {
  if (!meses.length) return [];
  const por = new Map(meses.map((m) => [m.mes, m]));
  const [a0, m0] = meses[0].mes.split("-").map(Number);
  const [a1, m1] = meses[meses.length - 1].mes.split("-").map(Number);
  const out: (MesVisitas | { mes: string; visitas: null })[] = [];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? ((m = 1), a++) : m++) {
    const clave = `${a}-${String(m).padStart(2, "0")}`;
    out.push(por.get(clave) ?? { mes: clave, visitas: null });
  }
  return out;
}

function PorMes({ meses }: { meses: MesVisitas[] }) {
  const puntos: PuntoSerie[] = completar(meses).map((m) =>
    m.visitas == null
      ? { clave: m.mes, rotulo: mesCorto(m.mes), valor: null, texto: "", detalle: `${mesCorto(m.mes)}: sin visitas cargadas` }
      : {
          clave: m.mes,
          rotulo: mesCorto(m.mes),
          valor: m.visitas,
          texto: numero(m.visitas),
          detalle: `${mesCorto(m.mes)}: ${plural(m.visitas, "visita", "visitas")}, ${numero((m as MesVisitas).privadas)} de empresas y organizaciones privadas, ${numero((m as MesVisitas).decisores)} a quien decide las compras`,
        },
  );
  return <ColumnasSerie puntos={puntos} etiqueta="Visitas por mes" serie={1} />;
}

function PorAnio({ meses }: { meses: MesVisitas[] }) {
  const porAnio = new Map<number, { visitas: number; privadas: number }>();
  for (const m of meses) {
    const a = Number(m.mes.slice(0, 4));
    const x = porAnio.get(a) ?? { visitas: 0, privadas: 0 };
    x.visitas += m.visitas;
    x.privadas += m.privadas;
    porAnio.set(a, x);
  }
  const anios: AnioColumna[] = [...porAnio.entries()].map(([anio, x]) => ({
    anio,
    a: x.privadas,
    b: Math.max(0, x.visitas - x.privadas),
    detalleA: numero(x.privadas),
    detalleB: numero(Math.max(0, x.visitas - x.privadas)),
  }));
  return (
    <div className="space-y-2">
      <ColumnasAnio anios={anios} etiquetaA="De empresas y organizaciones privadas" etiquetaB="Las demás" formato="numero" etiqueta="Visitas por año" />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-rotulo text-inkSoft" aria-label="Qué es cada color">
        <li className="inline-flex items-center gap-1.5"><MuestraSerie i={0} /> De empresas y organizaciones privadas</li>
        <li className="inline-flex items-center gap-1.5"><MuestraSerie i={1} /> Las demás</li>
      </ul>
    </div>
  );
}

/** Un bloque del reparto: su título y, debajo, la barra y su leyenda en pares rótulo y valor. */
function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1">
        <p className="text-meta font-semibold text-ink">{titulo}</p>
        {ayuda}
      </div>
      {children}
    </div>
  );
}

/** «4,205 de 22,873 (18 %)»: la parte, su total y su porcentaje, como valor de un par. */
function Parte({ n, de }: { n: number; de: number }) {
  return (
    <span className="font-mono tabular-nums text-ink">
      {numero(n)} <span className="font-sans text-mute">de {numero(de)}</span> ({de > 0 ? porcentaje((100 * n) / de) : porcentaje(0)})
    </span>
  );
}

export function ResumenVisitas({ d }: { d: VisitasEntidad }) {
  const r = d.resumen;
  if (!r) return null;
  const meses = d.meses ?? [];
  const total = d.total;
  const otras = Math.max(0, total - r.privadas - r.publicas - r.personas);
  const quien = [
    { clave: "privadas", nombre: "Empresas y organizaciones privadas", valor: r.privadas },
    { clave: "publicas", nombre: "Entidades públicas", valor: r.publicas },
    { clave: "personas", nombre: "A título personal", valor: r.personas },
  ];
  const porMes = meses.length > 0 && meses.length <= MAX_MESES;
  return (
    <section aria-label="Cómo la visitan" className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-8">
        {meses.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-1">
              <h3 className="text-cuerpo font-semibold text-ink">{porMes ? "Visitas por mes" : "Visitas por año"}</h3>
              <Ayuda titulo={porMes ? "¿Cómo leer las visitas por mes?" : "¿Cómo leer las visitas por año?"}>
                {porMes
                  ? "Cada columna es un mes, con el número del mes con más visitas y el del último. Un mes sin columna no tiene visitas cargadas: la entidad no publicó su registro ese mes o aún no llega. Al pasar sobre una columna se ven las de empresas y las que fueron a quien decide las compras."
                  : "Cada columna es un año, partida en las visitas de empresas y organizaciones privadas y las demás. El último año va hasta el último mes cargado."}
              </Ayuda>
            </div>
            {porMes ? <PorMes meses={meses} /> : <PorAnio meses={meses} />}
          </div>
        ) : null}
        <div className="min-w-0 space-y-5">
          <Bloque titulo="Quién la visita">
            <BarraSegmentada
              etiqueta="Quién la visita"
              partes={quien.map((x) => ({ clave: x.clave, nombre: x.nombre, valor: x.valor, texto: plural(x.valor, "visita", "visitas") }))}
              otros={otras > 0 ? { clave: "otras", nombre: "Sin tipo en el registro", valor: otras, texto: plural(otras, "visita", "visitas") } : null}
            />
            <dl className="space-y-1 text-meta">
              {[...quien.map((x, i) => ({ ...x, i: i as number | "otros" })), ...(otras > 0 ? [{ clave: "otras", nombre: "Sin tipo en el registro", valor: otras, i: "otros" as const }] : [])].map((x) => (
                <div key={x.clave} className="flex items-baseline justify-between gap-3">
                  <dt className="inline-flex min-w-0 items-center gap-2 text-inkSoft">
                    <MuestraSerie i={x.i} className="translate-y-px" />
                    <span className="truncate">{x.nombre}</span>
                  </dt>
                  <dd className="shrink-0 font-mono tabular-nums text-ink">
                    {numero(x.valor)} <span className="text-mute">({total > 0 ? porcentaje((100 * x.valor) / total) : porcentaje(0)})</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Bloque>
          <Bloque titulo="A quien decide las compras" ayuda={<AyudaTermino clave="visita-decisor" />}>
            <Medidor parte={total > 0 ? r.decisores / total : 0} etiqueta={`${numero(r.decisores)} de ${numero(total)} visitas fueron a quien decide las compras`} />
            <p className="text-meta">
              <Parte n={r.decisores} de={total} />
            </p>
          </Bloque>
          <Bloque titulo="Fuera del horario de oficina" ayuda={<AyudaTermino clave="visita-fuera-horario" />}>
            <Medidor parte={total > 0 ? r.fueraDeHora / total : 0} etiqueta={`${numero(r.fueraDeHora)} de ${numero(total)} visitas fueron fuera del horario de oficina`} />
            <p className="text-meta">
              <Parte n={r.fueraDeHora} de={total} />
            </p>
          </Bloque>
        </div>
      </div>
    </section>
  );
}
