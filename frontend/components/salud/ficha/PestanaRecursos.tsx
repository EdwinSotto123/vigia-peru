import type { LucideIcon } from "lucide-react";
import {
  Ambulance, Apple, Baby, BedDouble, Brain, CalendarX2, DoorOpen, GraduationCap, HandHelping, HeartPulse, Info, Microscope, Pill, Scissors,
  Smile, Stethoscope, Syringe, Users,
} from "lucide-react";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha } from "@/components/salud/comun";
import { fechaCorta, numero, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { ColumnasApiladas, type SerieGrafico } from "./Graficos";
import { Bloque, Tesela } from "./piezas";

/**
 * La pestaña «Recursos y cirugías»: lo que la IPRESS declaró a SUSALUD de su último mes (consultorios, camas, personal,
 * ambulancias) en teselas con su ícono, y sus cirugías mes a mes de los últimos 13 meses publicados (mayores y menores
 * apiladas; suspendidas aparte), con la advertencia de que declarar cirugías no prueba estar autorizada para cada tipo.
 */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const mesLargo = (anio: number, mes: number) => `${MESES[mes - 1] ?? mes} de ${anio}`;
const mesCorto = (anio: number, mes: number) => fechaCorta(`${anio}-${String(mes).padStart(2, "0")}`);

const INFRAESTRUCTURA: [string, string, LucideIcon][] = [
  ["consultorios", "consultorios", DoorOpen],
  ["consultoriosFuncionales", "consultorios funcionales", DoorOpen],
  ["camas", "camas", BedDouble],
  ["ambulancias", "ambulancias", Ambulance],
];
const PERSONAL: [string, string, LucideIcon][] = [
  ["medicos", "médicos", Stethoscope],
  ["medicosSerums", "médicos SERUMS", GraduationCap],
  ["medicosResidentes", "médicos residentes", GraduationCap],
  ["enfermeras", "enfermeras y enfermeros", HeartPulse],
  ["obstetrices", "obstetras", Baby],
  ["odontologos", "odontólogos", Smile],
  ["psicologos", "psicólogos", Brain],
  ["nutricionistas", "nutricionistas", Apple],
  ["tecnologos", "tecnólogos médicos", Microscope],
  ["farmaceuticos", "químicos farmacéuticos", Pill],
  ["auxiliares", "auxiliares", HandHelping],
  ["otrosProfesionales", "otros profesionales", Users],
];

const SERIES: SerieGrafico[] = [
  { nombre: "Mayores", color: 1 },
  { nombre: "Menores", color: 2 },
];

/** Una rejilla de cifras con su ícono, dentro de un bloque (sin una caja por cifra: no hay cajas dentro de cajas). */
function Cifras({ campos, recursos, angosta = false }: { campos: [string, string, LucideIcon][]; recursos: Record<string, number | null>; angosta?: boolean }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-x-4 gap-y-4", angosta ? "sm:grid-cols-4 xl:grid-cols-2" : "sm:grid-cols-3 xl:grid-cols-4")}>
      {campos.map(([clave, etiqueta, Icono]) => {
        const v = recursos[clave];
        return (
          <li key={clave} className="flex min-w-0 items-start gap-2.5">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink/[0.06] text-inkSoft">
              <Icono size={16} />
            </span>
            <span className="min-w-0">
              <span className={cn("block font-display text-bloque font-bold leading-none tabular-nums", v == null ? "text-mute" : "text-ink")}>
                {v == null ? <span className="text-meta font-semibold">Sin dato</span> : numero(v)}
              </span>
              <span className="mt-1 block text-meta leading-snug text-inkSoft">{etiqueta}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PestanaRecursos({ f }: { f: FichaIpress }) {
  const r = f.recursos;
  const fr = f.fuentes.recursos;
  const fc = f.fuentes.cirugias;
  const mesFuente = (al: string | number | null | undefined) => (typeof al === "string" ? al.slice(0, 7) : al ?? null);
  const meses = [...f.cirugiasPorMes].sort((a, b) => a.anio - b.anio || a.mes - b.mes).slice(-13);
  const doce = meses.slice(-12);
  const suma = (k: "mayores" | "menores" | "suspendidas") => doce.reduce((t, m) => t + (m[k] ?? 0), 0);
  const rango = doce.length ? `${mesCorto(doce[0].anio, doce[0].mes)} a ${mesCorto(doce[doce.length - 1].anio, doce[doce.length - 1].mes)}` : null;
  const anio = r && typeof r.anio === "number" ? r.anio : null;
  const mes = r && typeof r.mes === "number" ? r.mes : null;
  return (
    <div className="space-y-6">
      <CabeceraPestana>Lo que la IPRESS declaró a SUSALUD: su último mes de recursos y sus cirugías mes a mes.</CabeceraPestana>

      {r ? (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Bloque titulo="Infraestructura" descripcion={anio && mes ? `Declarada para ${mesLargo(anio, mes)}.` : undefined}>
              <Cifras campos={INFRAESTRUCTURA} recursos={r} angosta />
            </Bloque>
            <Bloque titulo="Personal" descripcion={anio && mes ? `Declarado para ${mesLargo(anio, mes)}.` : undefined}>
              <Cifras campos={PERSONAL} recursos={r} />
            </Bloque>
          </div>
          {fr && <FuenteFecha nombre="Recursos de salud por IPRESS (SUSALUD, Consulta A)" url={fr.url} al={anio && mes ? `${anio}-${String(mes).padStart(2, "0")}` : mesFuente(fr.al)} />}
        </div>
      ) : (
        <p className="flex items-start gap-2.5 rounded-2xl border border-line bg-paper px-4 py-3 text-dato text-inkSoft">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          No figura en los datos de recursos de SUSALUD{fr?.al ? ` (publicados hasta ${fechaCorta(String(mesFuente(fr.al)))})` : ""}. No todas las IPRESS los informan cada mes.
        </p>
      )}

      <section aria-labelledby="cirugias-t" className="space-y-4">
        <h3 id="cirugias-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <Scissors size={18} aria-hidden className="text-mute" /> Cirugías declaradas
        </h3>
        <p className="flex items-start gap-2.5 rounded-2xl border border-amber/30 bg-amber-soft/40 px-4 py-3 text-meta leading-relaxed text-ink">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
          <span>
            <span className="font-semibold">Que una IPRESS declare cirugías no prueba que esté autorizada para cada tipo.</span>{" "}
            <span className="text-inkSoft">Lo autorizado se ve en sus servicios y en su centro quirúrgico en RENIPRESS.</span>
          </span>
        </p>
        {meses.length ? (
          <>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label={`Cirugías de ${rango}`}>
              <li className="min-w-0">
                <Tesela icono={Scissors} valor={numero(suma("mayores"))} etiqueta="cirugías mayores" contexto={rango} />
              </li>
              <li className="min-w-0">
                <Tesela icono={Syringe} valor={numero(suma("menores"))} etiqueta="cirugías menores" contexto={rango} />
              </li>
              <li className="col-span-2 min-w-0 lg:col-span-1">
                <Tesela icono={CalendarX2} valor={numero(suma("suspendidas"))} etiqueta="cirugías suspendidas" contexto={rango} />
              </li>
            </ul>
            <Bloque titulo="Mes a mes" descripcion={`Los últimos ${meses.length} meses publicados.`}>
              <ColumnasApiladas
                etiqueta="Cirugías mayores y menores declaradas por mes"
                series={SERIES}
                grupos={meses.map((m) => ({
                  clave: `${m.anio}-${m.mes}`,
                  rotulo: mesCorto(m.anio, m.mes),
                  valores: [m.mayores, m.menores],
                  detalle: `${mesLargo(m.anio, m.mes)}: ${numero(m.mayores)} mayores, ${numero(m.menores)} menores y ${numero(m.suspendidas)} suspendidas`,
                }))}
              />
              <details className="group mt-4 border-t border-line pt-3">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-dato font-semibold text-granate [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Ver la tabla mes a mes</span>
                  <span className="hidden group-open:inline">Ocultar la tabla</span>
                </summary>
                <div className="-mx-4 mt-2 overflow-x-auto sm:-mx-5">
                  <table className="w-full min-w-[30rem] text-dato">
                    <caption className="sr-only">Cirugías declaradas por mes</caption>
                    <thead>
                      <tr className="border-b border-line text-left text-meta text-mute">
                        <th scope="col" className="px-4 pb-2 font-medium sm:px-5">Mes</th>
                        <th scope="col" className="px-2 pb-2 text-right font-medium">Mayores</th>
                        <th scope="col" className="px-2 pb-2 text-right font-medium">Menores</th>
                        <th scope="col" className="px-2 pb-2 text-right font-medium">Suspendidas</th>
                        <th scope="col" className="px-2 pb-2 text-right font-medium">Programadas</th>
                        <th scope="col" className="px-4 pb-2 text-right font-medium sm:px-5">Emergencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {[...meses].reverse().map((m) => (
                        <tr key={`${m.anio}-${m.mes}`}>
                          <th scope="row" className="whitespace-nowrap px-4 py-2 text-left font-medium text-ink sm:px-5">{mesCorto(m.anio, m.mes)}</th>
                          {[m.mayores, m.menores, m.suspendidas, m.programadas].map((v, i) => (
                            <td key={i} className="px-2 py-2 text-right font-mono tabular-nums text-inkSoft">{numero(v)}</td>
                          ))}
                          <td className="px-4 py-2 text-right font-mono tabular-nums text-inkSoft sm:px-5">{numero(m.emergencia)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Bloque>
            {fc && <FuenteFecha nombre="Producción de intervenciones quirúrgicas (SUSALUD, Consulta H)" url={fc.url} al={f.cirugiasHasta ?? mesFuente(fc.al)} />}
          </>
        ) : (
          <p className="flex items-start gap-2.5 rounded-2xl border border-line bg-paper px-4 py-3 text-dato text-inkSoft">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            No figuran cirugías declaradas en los datos de SUSALUD{fc?.al ? ` (publicados hasta ${fechaCorta(String(mesFuente(fc.al)))})` : ""}.
          </p>
        )}
      </section>
    </div>
  );
}
