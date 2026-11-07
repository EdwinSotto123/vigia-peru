import { Check, Minus } from "lucide-react";
import type { Limites } from "@/lib/gobserva-cuenta";
import { entero, precioDe, type PlanesServidor } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";

interface Columna {
  id: string;
  nombre: string;
  precio: string;
  periodo?: string;
  limites: Limites;
  destacado?: boolean;
}

/** Cada fila de la tabla: qué se compara y el valor en cada plan (true y false se dibujan como sí y no). */
const FILAS: { que: string; valor: (l: Limites) => string | boolean }[] = [
  { que: "Buscar convocatorias, leer las fichas y medir tu mercado", valor: () => true },
  { que: "Contratos menores abiertos para cotizar, con su requerimiento", valor: () => true },
  { que: "Obras que se vienen (Gobserva Obras incluido)", valor: () => true },
  { que: "Alertas", valor: (l) => entero(l.alertas) },
  { que: "Cada cuánto te avisamos", valor: (l) => (l.frecuencias.includes("diaria") ? "Cada mañana o cada semana" : "Cada semana") },
  { que: "Procesos guardados", valor: (l) => `Hasta ${entero(l.guardados)}` },
  { que: "Recordatorio antes de que cierren las consultas", valor: (l) => l.recordatorios },
  { que: "Descarga en Excel (CSV)", valor: (l) => (l.csv ? `Hasta ${entero(l.filasCsv)} filas` : false) },
];

/**
 * La tabla que compara Gratis, Inicia, Crece y Pro con los límites del catálogo de la API (los mismos que cobran y aplican las
 * cuentas): nada escrito a mano que pueda quedar desfasado. Lo que todavía no funciona no entra (eso va en las tarjetas,
 * marcado «Pronto»). Server-safe.
 */
export function ComparaPlanes({ cat, className, enCaja = false, actual }: { cat: PlanesServidor; className?: string; enCaja?: boolean; actual?: string }) {
  const columnas: Columna[] = [{ id: "gratis", nombre: "Gratis", precio: "S/ 0", limites: cat.gratis }];
  for (const id of ["inicia", "crece", "pro"]) {
    const p = cat.planes.find((x) => x.id === id);
    if (p) columnas.push({ id, nombre: p.nombre, ...precioDe(p), limites: p.limites, destacado: id === "crece" });
  }
  if (columnas.length < 2) return null;

  // Dentro de una caja de la app (Plan y pagos): sólo la tabla, sin título ni borde propios, con «Tu plan» marcado.
  const tabla = (
      <div className={cn("overflow-x-auto", !enCaja && "mt-5 rounded-2xl border border-line bg-paper")}>
        <table className="w-full min-w-[36rem] border-collapse text-left">
          <caption className="sr-only">Qué incluye cada plan de Gobserva Licitaciones</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[38%] px-3 py-3 align-bottom text-meta font-semibold text-mute sm:px-5">
                Qué incluye
              </th>
              {columnas.map((c) => (
                <th key={c.id} scope="col" className={cn("px-3 py-3 align-bottom sm:px-5", c.destacado && "bg-granate-50")}>
                  <span className="block font-display text-cuerpo font-bold leading-tight text-ink sm:text-bloque">{c.nombre}</span>
                  {actual === c.id && <span className="mt-1 inline-block rounded-full bg-granate px-2 py-0.5 text-rotulo font-semibold text-paper">Tu plan</span>}
                  <span className="mt-0.5 block text-meta font-medium leading-snug text-inkSoft">
                    {c.precio}
                    {c.periodo ? <span className="block text-rotulo font-normal text-mute sm:ml-1 sm:inline">{c.periodo}</span> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {FILAS.map((f) => (
              <tr key={f.que}>
                <th scope="row" className="px-3 py-3 text-meta font-medium leading-snug text-ink sm:px-5 sm:text-dato">
                  {f.que}
                </th>
                {columnas.map((c) => {
                  const v = f.valor(c.limites);
                  return (
                    <td key={c.id} className={cn("px-3 py-3 align-top text-meta leading-snug text-inkSoft sm:px-5 sm:text-dato", c.destacado && "bg-granate-50/60")}>
                      {v === true ? (
                        <>
                          <Check size={17} aria-hidden className="text-mossTexto" />
                          <span className="sr-only">Sí</span>
                        </>
                      ) : v === false ? (
                        <>
                          <Minus size={17} aria-hidden className="text-mute" />
                          <span className="sr-only">No</span>
                        </>
                      ) : (
                        <span className={cn(c.destacado && "font-semibold text-ink")}>{v}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
  if (enCaja) return tabla;
  return (
    <section id="comparar" aria-labelledby="comparar-t" className={cn("scroll-mt-24", className)}>
      <h2 id="comparar-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
        Compara los planes
      </h2>
      {tabla}
    </section>
  );
}
