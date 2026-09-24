"use client";

/**
 * Lo que dijo la autoevaluación, en palabras: el juicio de respaldo de cada señal (con su motivo, o
 * diciendo que no lo dejó), las otras cuatro comprobaciones y el juicio de precio por ítem.
 * Las reglas se nombran con el mismo catálogo que usa el informe público, nunca con su id.
 */

import { useMemo } from "react";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/admin/ui";
import { etiquetaDeRegla, useReglasPerfil } from "@/components/agentes/useReglasPerfil";
import { redactDnis } from "@/components/Redact";
import type { BanderaRevision, RevisionDetalle } from "@/lib/admin";
import { cn } from "@/lib/utils";

type Juicio = { regla?: string; reason?: string; respaldada?: boolean };
type Fila = { key: string; regla: string; severidad: BanderaRevision["severidad"] | null; evidencia: string | null; juicio: Juicio | null };

export const SEVERIDAD_UI: Record<string, { label: string; tono: Tone }> = {
  alta: { label: "Severidad alta", tono: "danger" },
  media: { label: "Severidad media", tono: "warn" },
  baja: { label: "Severidad baja", tono: "muted" },
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const motivoDe = (r?: string | null) => (typeof r === "string" && r.trim() ? r.trim() : null);

/** Cada bandera con su juicio. Dos banderas de la misma regla se emparejan en orden; un juicio sin bandera va al final. */
function emparejar(banderas: BanderaRevision[], juicios: Juicio[]): Fila[] {
  const cola = new Map<string, Juicio[]>();
  for (const j of juicios) {
    const k = String(j.regla ?? "");
    cola.set(k, [...(cola.get(k) ?? []), j]);
  }
  const filas: Fila[] = banderas.map((b) => ({
    key: b.id, regla: b.regla, severidad: b.severidad, evidencia: b.evidencia, juicio: cola.get(b.regla)?.shift() ?? null,
  }));
  let i = 0;
  cola.forEach((resto, regla) => {
    for (const j of resto) filas.push({ key: `j-${i++}`, regla: regla || "sin_regla", severidad: null, evidencia: null, juicio: j });
  });
  return filas;
}

export function PorQueBloqueo({ d }: { d: RevisionDetalle }) {
  const { reglas } = useReglasPerfil(d.perfil);
  const ae = d.autoevaluacion;
  const filas = useMemo(() => emparejar(d.banderas, ae?.perBandera ?? []), [d.banderas, ae?.perBandera]);
  const juzgadas = filas.filter((f) => f.juicio);
  const respaldadas = juzgadas.filter((f) => f.juicio?.respaldada).length;

  return (
    <section aria-labelledby="porque" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <h2 id="porque" className="text-[11px] font-semibold uppercase tracking-wide text-mute">Por qué se bloqueó</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-inkSoft">
        Antes de publicar, un evaluador automático relee cada señal contra el expediente y el registro oficial. Esto es lo que
        dijo. Úsalo como guía: la decisión es tuya.
      </p>

      {!ae ? (
        <p className="mt-4 rounded-xl border border-dashed border-line p-4 text-sm text-mute">Este análisis no guardó su autoevaluación.</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-ink">¿La evidencia respalda cada señal?</h3>
            <span className="text-[12px] text-mute">
              {juzgadas.length ? `${respaldadas} de ${juzgadas.length} ${juzgadas.length === 1 ? "respaldada" : "respaldadas"}` : "Sin señales juzgadas"}, mínimo {pct(d.umbrales.min_respaldo)}
            </span>
          </div>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {filas.map((f) => (
              <li key={f.key} className="flex items-start gap-3 px-3 py-3 sm:px-4">
                <Veredicto ok={f.juicio ? !!f.juicio.respaldada : null} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-ink">{etiquetaDeRegla(f.regla, reglas)}</span>
                    {f.severidad && <Badge tono={SEVERIDAD_UI[f.severidad]?.tono ?? SEVERIDAD_UI.baja.tono}>{SEVERIDAD_UI[f.severidad]?.label ?? f.severidad}</Badge>}
                    <Badge tono={f.juicio ? (f.juicio.respaldada ? "ok" : "danger") : "muted"}>
                      {f.juicio ? (f.juicio.respaldada ? "Respaldada" : "No respaldada") : "Sin juicio"}
                    </Badge>
                  </div>
                  {f.evidencia && <p className="mt-1 line-clamp-3 break-words text-[12px] leading-relaxed text-mute">{redactDnis(f.evidencia)}</p>}
                  <p className="mt-1.5 break-words text-[13px] leading-relaxed text-ink">
                    {!f.juicio
                      ? <span className="text-mute">El evaluador no juzgó esta señal.</span>
                      : motivoDe(f.juicio.reason)
                        ? <><span className="font-medium">El evaluador: </span>{redactDnis(motivoDe(f.juicio.reason))}</>
                        : <span className="text-mute">El evaluador no dejó el motivo.</span>}
                  </p>
                </div>
              </li>
            ))}
            {!filas.length && <li className="px-4 py-5 text-center text-sm text-mute">No quedaron señales guardadas: la verificación las descartó todas.</li>}
          </ul>

          <h3 className="mt-6 text-sm font-semibold text-ink">Otras comprobaciones</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Comprobacion titulo="Norma y fuente citadas" conteo={ae.cita} umbral={d.umbrales.min_cita} nombre={["señal con cita", "señales con cita"]} />
            <Comprobacion titulo="Precios comparables con el mercado" conteo={ae.precio} umbral={d.umbrales.min_precio} nombre={["comparación razonable", "comparaciones razonables"]} />
            <Comprobacion
              titulo="Tono del dictamen"
              ok={ae.tono ? ae.tono.toLowerCase() !== "acusatorio" : null}
              valor={ae.tono ? (ae.tono.toLowerCase() === "acusatorio" ? "Acusatorio" : "Sin tono acusatorio") : null}
              motivo={ae.tonoReason}
            />
            <Comprobacion
              titulo="Ítems y objeto del contrato"
              ok={ae.coherencia ? ae.coherencia.toLowerCase() !== "incoherente" : null}
              valor={ae.coherencia ? (ae.coherencia.toLowerCase() === "incoherente" ? "No coinciden" : "Coinciden") : null}
              motivo={ae.coherenciaReason}
            />
          </div>

          {ae.perPrecio.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-ink">Precio por ítem</h3>
              <ul className="mt-2 space-y-1.5">
                {ae.perPrecio.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]">
                    <Veredicto ok={typeof p.plausible === "boolean" ? p.plausible : null} chico />
                    <div className="min-w-0 flex-1">
                      <span className="line-clamp-2 break-words font-medium text-ink">{p.item?.trim() || "Ítem sin nombre"}</span>
                      <span className="text-[12px] text-mute">
                        {p.plausible === false ? "Comparación dudosa" : p.plausible ? "Comparación razonable" : "Sin juicio"}
                        {motivoDe(p.reason) ? <>: {redactDnis(motivoDe(p.reason))}</> : ", sin motivo del evaluador"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Veredicto({ ok, chico = false }: { ok: boolean | null; chico?: boolean }) {
  const s = chico ? 14 : 17;
  if (ok === true) return <CheckCircle2 size={s} className="mt-0.5 shrink-0 text-moss" aria-label="Sí" />;
  if (ok === false) return <XCircle size={s} className="mt-0.5 shrink-0 text-rust" aria-label="No" />;
  return <CircleHelp size={s} className="mt-0.5 shrink-0 text-mute" aria-label="Sin juicio" />;
}

/** Una comprobación: por conteo (n juzgadas, ok aprobadas, contra el umbral) o por etiqueta (tono, coherencia). */
function Comprobacion({
  titulo, conteo, umbral, nombre, ok, valor, motivo,
}: {
  titulo: string;
  conteo?: { n?: number; ok?: number } | null;
  umbral?: number;
  /** Singular y plural: "1 de 1 comparación razonable", "2 de 4 señales con cita". */
  nombre?: [string, string];
  ok?: boolean | null;
  valor?: string | null;
  motivo?: string | null;
}) {
  let estado: boolean | null = ok ?? null;
  let texto = valor ?? "Sin dato";
  if (conteo !== undefined) {
    const n = Number(conteo?.n ?? 0), aprobadas = Number(conteo?.ok ?? 0);
    estado = n ? aprobadas / n >= (umbral ?? 0) : null;
    texto = n ? `${aprobadas} de ${n} ${nombre?.[n === 1 ? 0 : 1] ?? ""}`.trim() : "Nada que juzgar";
  }
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", estado === false ? "border-rust/30 bg-crimson-soft/40" : "border-line bg-paperSoft")}>
      <div className="flex items-start gap-2">
        <Veredicto ok={estado} chico />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-ink">{titulo}</div>
          <div className="text-[13px] text-ink">
            {texto}
            {umbral != null && <span className="text-[11px] text-mute">, mínimo {pct(umbral)}</span>}
          </div>
          {motivoDe(motivo) && <p className="mt-1 line-clamp-3 break-words text-[12px] leading-snug text-mute">{redactDnis(motivoDe(motivo))}</p>}
        </div>
      </div>
    </div>
  );
}
