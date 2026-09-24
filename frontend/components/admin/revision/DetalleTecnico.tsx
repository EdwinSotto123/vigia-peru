"use client";

/**
 * Todo lo que el panel mostraba antes en crudo, plegado al final: señales tal como se guardaron,
 * verificación del dictamen, recortes y descartes, el motivo tal como lo dejó el sistema, los
 * puntajes de la autoevaluación, la bitácora de la alerta y los umbrales. Para quien quiera
 * auditar la auditoría; la decisión no debería necesitarlo.
 */

import { ChevronDown, Wrench } from "lucide-react";
import { redactDnis } from "@/components/Redact";
import { fmtDate, type DescarteRevision, type RevisionDetalle } from "@/lib/admin";
import { SenalesCrudas } from "./SenalesCrudas";

const legible = (s: string) => s.replace(/_/g, " ");
const pct = (x: number) => `${Math.round(x * 100)} %`;

const ACCION: Record<string, string> = { alerta_publicar: "publicó la alerta", alerta_descartar: "descartó la alerta" };

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">{titulo}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Un valor suelto del JSON de verificación, legible y con los DNI en vidrio. */
function valor(v: unknown): React.ReactNode {
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (v == null) return "sin dato";
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-mute">ninguno</span>;
    return redactDnis(v.map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : JSON.stringify(x))).join(", "));
  }
  if (typeof v === "object") return redactDnis(JSON.stringify(v));
  return redactDnis(String(v));
}

/** El objeto de verificación del dictamen, aplanado un nivel ("sanitizacion · modificado: no"). */
function aplanar(obj: Record<string, unknown>, prefijo = ""): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]): [string, unknown][] =>
    v && typeof v === "object" && !Array.isArray(v) && !prefijo ? aplanar(v as Record<string, unknown>, `${legible(k)} · `) : [[`${prefijo}${legible(k)}`, v]],
  );
}

/** Descartes idénticos (el mismo paso reintentado) se cuentan una vez. */
function agrupar(descartes: DescarteRevision[]): { d: DescarteRevision; n: number }[] {
  const m = new Map<string, { d: DescarteRevision; n: number }>();
  for (const d of descartes) {
    const k = JSON.stringify(d);
    const g = m.get(k);
    if (g) g.n++;
    else m.set(k, { d, n: 1 });
  }
  return Array.from(m.values());
}

export function DetalleTecnico({ d }: { d: RevisionDetalle }) {
  const verif = d.verificacionDictamen && typeof d.verificacionDictamen === "object" ? aplanar(d.verificacionDictamen) : [];
  const descartes = agrupar(Array.isArray(d.descartes) ? d.descartes : []);
  const pctEval = Object.entries(d.autoevaluacion?.pct ?? {});
  const u = d.umbrales;

  return (
    <details className="group rounded-2xl border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Wrench size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">Detalle técnico</span>
          <span className="block text-[12px] text-mute">Evidencia cruda, verificación automática, agentes, recortes y descartes, bitácora y umbrales.</span>
        </span>
        <ChevronDown size={16} className="mt-0.5 shrink-0 text-mute transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="space-y-6 border-t border-line px-4 py-4 sm:px-5">
        <Bloque titulo={`Señales tal como se guardaron (${d.banderas.length})`}>
          <SenalesCrudas banderas={d.banderas} />
        </Bloque>

        <Bloque titulo="Motivo que dejó el sistema">
          {d.motivoPipeline
            ? <p className="break-words font-mono text-[12px] text-ink">{redactDnis(d.motivoPipeline)}</p>
            : <p className="text-[12px] text-mute">El pipeline no dejó aviso al bloquear (análisis a demanda o conexión cortada).</p>}
          {d.motivos.length > 0 && (
            <>
              <p className="mt-2 text-[11px] text-mute">Recalculado con los umbrales de hoy:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink">
                {d.motivos.map((m) => <li key={m.clave} className="break-words">{m.texto}</li>)}
              </ul>
            </>
          )}
        </Bloque>

        <Bloque titulo="Verificación del dictamen">
          {verif.length ? (
            <dl className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
              {verif.map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-2 border-b border-line/60 py-1">
                  <dt className="shrink-0 text-mute">{k}</dt>
                  <dd className="min-w-0 break-words text-right text-ink sm:ml-auto">{valor(v)}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="text-[12px] text-mute">Sin verificación guardada.</p>}
        </Bloque>

        <Bloque titulo="Recortes y descartes">
          {descartes.length ? (
            <ul className="space-y-1.5 text-[12px]">
              {descartes.map(({ d: x, n }, i) => (
                <li key={i} className="break-words">
                  <span className="font-mono text-ink">{x.donde ?? "sin ubicación"}</span>
                  {x.agente && <span className="text-mute"> ({x.agente})</span>}
                  <span className="text-ink">: {[x.motivo, ...(x.motivos ?? [])].filter(Boolean).map((m) => legible(String(m))).join(", ") || "sin motivo"}</span>
                  {x.detalle && <span className="text-mute">. {redactDnis(x.detalle)}</span>}
                  {n > 1 && <span className="ml-1 rounded bg-paperDeep px-1 text-[11px] text-inkSoft">×{n}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-mute">Sin descartes registrados.</p>}
          <p className="mt-3 text-[11px] text-mute">Validaciones pendientes</p>
          {d.validacionesPendientes?.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink">
              {d.validacionesPendientes.map((v, i) => <li key={i} className="break-words">{redactDnis(typeof v === "string" ? v : JSON.stringify(v))}</li>)}
            </ul>
          ) : <p className="mt-1 text-[12px] text-mute">Ninguna.</p>}
        </Bloque>

        {pctEval.length > 0 && (
          <Bloque titulo="Puntajes de la autoevaluación">
            <ul className="flex flex-wrap gap-1.5 text-[12px]">
              {pctEval.map(([k, v]) => (
                <li key={k} className="rounded-full border border-line bg-paperSoft px-2 py-0.5">
                  <span className="text-mute">{legible(k)}</span> <span className="font-mono text-ink">{typeof v === "number" ? `${v} %` : v}</span>
                </li>
              ))}
            </ul>
          </Bloque>
        )}

        <Bloque titulo="Bitácora de esta alerta">
          {d.log.length ? (
            <ul className="divide-y divide-line text-[12px]">
              {d.log.map((l, i) => (
                <li key={i} className="py-1.5">
                  <span className="font-medium text-ink">{l.actor}</span> <span className="text-mute">{ACCION[l.accion] ?? legible(l.accion)}</span>{" "}
                  <span className="text-[11px] text-mute">{fmtDate(l.createdAt)}</span>
                  {motivoDe(l.detalle) && <div className="break-words text-inkSoft">{redactDnis(motivoDe(l.detalle))}</div>}
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-mute">Sin acciones registradas.</p>}
        </Bloque>

        <Bloque titulo="Umbrales vigentes">
          <ul className="grid gap-1 text-[12px] text-ink sm:grid-cols-2">
            <li>Respaldo mínimo de señales: <span className="font-mono">{pct(u.min_respaldo)}</span> (con 2 o más juzgadas)</li>
            <li>Señales con norma y fuente: <span className="font-mono">{pct(u.min_cita)}</span> (con 3 o más)</li>
            <li>Comparaciones de precio razonables: <span className="font-mono">{pct(u.min_precio)}</span> (con 3 o más)</li>
            <li>Bloquea por tono acusatorio: {u.bloquea_tono ? "sí" : "no"}; por ítems incoherentes: {u.bloquea_coherencia ? "sí" : "no"}</li>
          </ul>
          {u.nota && <p className="mt-2 text-[11px] leading-snug text-mute">{u.nota}</p>}
        </Bloque>
      </div>
    </details>
  );
}

const motivoDe = (detalle: unknown): string | null =>
  detalle && typeof detalle === "object" && "motivo" in detalle ? String((detalle as { motivo: unknown }).motivo ?? "") || null : null;
