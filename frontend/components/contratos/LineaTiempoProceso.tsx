import { dia } from "./EvidenciaContrato";
import { fechaConAnio, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { adjudicacionesVigentes, type ContratoDetalle } from "@/lib/contratos";

/**
 * Los hitos del proceso con fecha, en orden: convocatoria, ofertas, buena pro, adjudicaciones del registro,
 * consentimiento, firma del contrato (los tres de CONOSCE, del `cronograma` de la API) y, si Vigía lo leyó, cuándo; cada
 * uno con su fuente, en la pestaña Cronograma. Una placa con los hitos unidos por una línea y, en cada uno, cuántos días
 * pasaron desde el anterior; los del mismo día van juntos ("Buena pro y adjudicación"). Arriba, cuánto tardó de la
 * convocatoria a la buena pro (o, sin esa fecha, a la adjudicación). Solo lo que el registro trae (nada se estima); con
 * menos de dos hitos no se dibuja. Server-safe.
 */
interface Hito {
  fecha: string;
  textos: string[];
  vigia: boolean;
}

const DIA_MS = 86_400_000;
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS);

/**
 * Cuándo ganó quien ganó: la fecha de la buena pro y, si el registro no la trae, la de la primera adjudicación vigente
 * (la que el OCDS guarda con el ganador; sin vigentes, la primera de todas). La usan la cifra de la convocatoria y esta
 * línea de tiempo, y es la misma de «cuando ganó» en los antecedentes: antes la cifra decía «buena pro: sin fecha»
 * mientras la línea de tiempo marcaba la adjudicación del 23 set. y los antecedentes, «cuando ganó (23 set.)».
 */
export function fechaGano(c: Pick<ContratoDetalle, "fechaBuenaPro" | "adjudicaciones">): { fecha: string; deAdjudicacion: boolean } | null {
  const bp = dia(c.fechaBuenaPro);
  if (bp) return { fecha: bp, deAdjudicacion: false };
  const vigentes = adjudicacionesVigentes(c);
  const fechas = (vigentes.length ? vigentes : c.adjudicaciones ?? []).map((a) => dia(a.fecha)).filter((f): f is string => !!f).sort();
  return fechas.length ? { fecha: fechas[0], deAdjudicacion: true } : null;
}

export function LineaTiempoProceso({ c, idTitulo = "linea-tiempo" }: { c: ContratoDetalle; idTitulo?: string }) {
  const crudos: { fecha: string; texto: string; vigia?: boolean }[] = [];
  const agregar = (valor: string | null | undefined, texto: string, vigia = false) => {
    const d = valor ? dia(valor) : null;
    if (d) crudos.push({ fecha: d, texto, vigia });
  };
  agregar(c.fecha, "Convocatoria");
  agregar(c.fechaBuenaPro, "Buena pro");
  for (const a of c.adjudicaciones ?? []) agregar(a.fecha, "Adjudicación");
  const HITO: Partial<Record<NonNullable<ContratoDetalle["cronograma"]>[number]["clave"], string>> = {
    ofertas: "Ofertas", consentimiento: "Consentimiento", contrato: "Contrato firmado",
  };
  for (const h of c.cronograma ?? []) if (HITO[h.clave]) agregar(h.fecha, HITO[h.clave]!);
  if (c.alerta && c.alerta.estado !== "revision") agregar(c.alerta.analizadoEn, "Leído por Vigía", true);

  // Un hito por día, con sus textos sin repetir.
  const porDia = new Map<string, Hito>();
  for (const h of crudos) {
    const x = porDia.get(h.fecha) ?? { fecha: h.fecha, textos: [], vigia: false };
    if (!x.textos.includes(h.texto)) x.textos.push(h.texto);
    x.vigia ||= !!h.vigia;
    porDia.set(h.fecha, x);
  }
  const hitos = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (hitos.length < 2) return null;

  const conv = dia(c.fecha);
  const gano = fechaGano(c);
  const hasta = conv && gano && gano.fecha >= conv ? dias(conv, gano.fecha) : null;
  const meta = gano?.deAdjudicacion ? "adjudicación" : "buena pro";

  return (
    <section aria-labelledby={idTitulo} className="rounded-2xl border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={idTitulo} className="font-display text-bloque font-bold text-ink">
          Línea de tiempo
        </h2>
        {hasta !== null && (
          <span className="text-rotulo text-mute">
            {hasta === 0 ? `${meta} el mismo día` : `${plural(hasta, "día", "días")} hasta la ${meta}`}
          </span>
        )}
      </div>
      <ol className="mt-3">
        {hitos.map((h, i) => {
          const ultimo = i === hitos.length - 1;
          const salto = i === 0 ? null : dias(hitos[i - 1].fecha, h.fecha);
          return (
            <li key={h.fecha} className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-x-3">
              {/* El punto del hito y, hasta el siguiente, la línea que los une. */}
              <span aria-hidden className="relative flex justify-center">
                <span
                  className={cn(
                    "relative z-10 mt-1 h-3 w-3 rounded-full border-2",
                    h.vigia ? "border-granate bg-granate" : "border-granate bg-paper",
                  )}
                />
                {!ultimo && <span className="absolute bottom-0 top-4 w-0.5 bg-line" />}
              </span>
              <div className={cn("min-w-0", !ultimo && "pb-3")}>
                <div className="flex items-baseline justify-between gap-3 text-meta">
                  <span className={cn("font-medium", h.vigia ? "text-granate" : "text-ink")}>{unir(h.textos)}</span>
                  {/* Con el año, también el de este: la línea cruza años (convocatoria en diciembre, contrato en enero) y
                      «4 ago.» debajo de «20 dic. 2025» no decía de cuál era. */}
                  <time dateTime={h.fecha} className="shrink-0 font-mono text-rotulo tabular-nums text-inkSoft">
                    {fechaConAnio(h.fecha)}
                  </time>
                </div>
                {salto !== null && salto > 0 && (
                  <span className="mt-1 inline-block rounded-full bg-paperDeep px-2 py-0.5 text-micro text-mute">
                    {plural(salto, "día", "días")} después
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "Buena pro", "Buena pro y adjudicación": el primero con mayúscula, los demás en minúscula. */
function unir(textos: string[]): string {
  const t = textos.map((x, i) => (i === 0 ? x : x.charAt(0).toLocaleLowerCase("es") + x.slice(1)));
  return t.length <= 1 ? t.join("") : `${t.slice(0, -1).join(", ")} y ${t[t.length - 1]}`;
}
