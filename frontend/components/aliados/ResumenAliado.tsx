import { CircleDashed, TriangleAlert } from "lucide-react";
import type { ContribucionAliado } from "./CadenaAliado";
import { Proporcion } from "./TarjetaAliado";
import { resumirContribuciones } from "./perfil";
import { RegionesDeAliado } from "./PerfilAliado";

/**
 * El resumen de un aliado sin salir del muro.
 *
 * Es el `detalle` que viaja dentro de `<Revelar>`: un ReactNode ya resuelto en
 * el servidor, nunca una función — cruzar ese límite con una función compila,
 * pasa `tsc` y revienta sólo en producción.
 *
 * Qué contesta, en este orden: cuánto de lo que pagó ya se leyó, qué salió,
 * dónde cayó, y aporte por aporte. La ficha completa profundiza; esto es para
 * decidir si vale la pena ir.
 */

const num = (n: number) => n.toLocaleString("es-PE");
const mes = (iso: string) => new Date(iso).toLocaleDateString("es-PE", { month: "short", year: "numeric" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });

export function ResumenAliado({
  nombre,
  contribuciones,
  regionesConCola,
  financiadosMuro,
  esMaqueta = false,
}: {
  nombre: string;
  contribuciones: ContribucionAliado[];
  regionesConCola: number;
  /** Contratos financiados por TODO el muro: denominador de su peso relativo. */
  financiadosMuro: number;
  /**
   * El panel se abre encima de la página y se puede capturar solo: la advertencia
   * de maqueta tiene que viajar con él, no quedarse en el aviso de la página.
   */
  esMaqueta?: boolean;
}) {
  const r = resumirContribuciones(contribuciones);

  if (r.aportes === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-5 text-[13px] leading-relaxed text-mute">
        {nombre} figura en el muro pero todavía no tiene ningún aporte confirmado. En cuanto el primero se
        confirme, acá aparece qué contratos hizo leer y qué salió en ellos.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {esMaqueta && (
        <p className="flex items-start gap-2 rounded-xl border border-dashed border-amber/60 bg-amber-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-inkSoft">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
          <span>
            <strong className="font-semibold text-ink">{nombre} no existe.</strong> Es un aliado de maqueta:
            sus aportes, sus lecturas y sus señales están inventados para poder mirar el diseño con volumen.
          </span>
        </p>
      )}
      <div className="space-y-3">
        <Proporcion
          parte={r.leidos}
          total={r.financiados}
          leyenda={`de sus ${num(r.financiados)} contratos financiados ya leídos`}
          tono="leido"
        />
        <Proporcion
          parte={r.conSenal}
          total={r.leidos}
          leyenda="de los leídos traían al menos una señal"
          tono="neutro"
        />
        <Proporcion
          parte={r.financiados}
          total={financiadosMuro}
          leyenda={`de los ${num(financiadosMuro)} contratos financiados en todo el muro`}
          tono="financiado"
        />
      </div>

      <p className="text-[12px] leading-relaxed text-mute">
        Primer aporte en {mes(contribuciones[contribuciones.length - 1].pagadaAt)} ·{" "}
        <span className="font-mono text-inkSoft">{num(r.regiones.length)}</span> de las{" "}
        <span className="font-mono text-inkSoft">{num(regionesConCola)}</span> regiones con cola abierta
        {r.enRevision > 0 && (
          <>
            {" "}· <span className="font-mono text-inkSoft">{num(r.enRevision)}</span> de sus leídos{" "}
            {r.enRevision === 1 ? "espera" : "esperan"} revisión humana y todavía no{" "}
            {r.enRevision === 1 ? "cuenta" : "cuentan"} como señal
          </>
        )}
        .
      </p>

      <QueSalio leidos={r.leidos} conSenal={r.conSenal} enRevision={r.enRevision} sinSenal={r.sinSenal} />

      <RegionesDeAliado regiones={r.regiones} financiados={r.financiados} titulo="Dónde cayeron sus contratos" />

      <section>
        <h3 className="text-[11px] uppercase tracking-wide text-mute">
          Sus {num(r.aportes)} {r.aportes === 1 ? "aporte" : "aportes"}, uno por uno
        </h3>
        <ol className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {contribuciones.map((c) => (
            <li key={c.codigo} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-2.5">
              <span className="min-w-0 text-[13px] text-ink">
                <span className="font-medium">{c.zona}</span>{" "}
                <span className="font-mono text-[11px] text-mute">{c.codigo}</span>{" "}
                <span className="text-[11px] text-mute">· {fecha(c.pagadaAt)}</span>
              </span>
              <span className="text-[12px] text-inkSoft">
                <span className="font-mono font-semibold text-ink">{num(c.procesados)}</span> leídos de{" "}
                <span className="font-mono">{num(c.contratos)}</span> ·{" "}
                <span className="font-mono font-semibold text-ink">{num(c.senales)}</span> con señal
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="rounded-xl border border-heroViolet/25 bg-heroViolet-soft/60 px-3.5 py-3 text-[12px] leading-relaxed text-inkSoft">
        <strong className="font-semibold text-ink">{nombre} no eligió ninguno de estos contratos.</strong>{" "}
        Al aportar se elige una región y una cantidad; los contratos concretos salen de la cola por
        antigüedad, en una consulta SQL que corre antes del análisis, y los agentes que los leen no reciben
        el nombre de quien financió.
      </p>
    </div>
  );
}

/**
 * En qué terminaron las lecturas que pagó. Una barra apilada a escala, no
 * cuatro cajas con un número cada una: lo que importa es la proporción entre
 * los cuatro destinos posibles de un contrato leído.
 */
export function QueSalio({
  leidos,
  conSenal,
  enRevision,
  sinSenal,
  titulo = "Qué salió en lo que ya se leyó",
}: {
  leidos: number;
  conSenal: number;
  enRevision: number;
  sinSenal: number;
  titulo?: string;
}) {
  if (leidos === 0) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-[12px] leading-relaxed text-mute">
        <CircleDashed size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Ninguno de sus contratos terminó de leerse todavía. Cada lectura completa tarda unos diez minutos
          de agentes, y la cola los toma por antigüedad.
        </span>
      </p>
    );
  }
  const partes = [
    { clave: "senal", etiqueta: "con al menos una señal publicada", valor: conSenal, barra: "bg-rust" },
    { clave: "revision", etiqueta: "esperando revisión humana", valor: enRevision, barra: "bg-amber" },
    { clave: "limpio", etiqueta: "salieron sin ninguna señal", valor: sinSenal, barra: "bg-moss" },
  ].filter((p) => p.valor > 0);

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-mute">{titulo}</h3>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
        {partes.map((p) => (
          <div key={p.clave} className={p.barra} style={{ width: `${(p.valor / leidos) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-inkSoft">
        {partes.map((p) => (
          <li key={p.clave} className="flex items-baseline gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${p.barra}`} aria-hidden />
            <span>
              <span className="font-mono font-semibold text-ink">{num(p.valor)}</span> de{" "}
              <span className="font-mono">{num(leidos)}</span> leídos {p.etiqueta}
            </span>
          </li>
        ))}
      </ul>
      {conSenal > 0 && (
        <p className="mt-2 max-w-[72ch] text-[11px] leading-relaxed text-mute">
          Una señal no es una acusación: es un hallazgo con su norma citada y el documento oficial que lo
          sostiene.
        </p>
      )}
    </section>
  );
}
