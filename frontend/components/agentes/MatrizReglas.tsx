"use client";

/**
 * Matriz de reglas evaluadas: "se evaluaron 25 reglas, dispararon 5" — y las 20 que NO
 * dispararon también se muestran, con su etiqueta y su descripción del catálogo.
 *
 * Es la interacción más honesta que permite este dato: una regla que no disparó es evidencia
 * de lo que se descartó. Mostrar solo las que dispararon convierte un análisis completo en un
 * pliego de cargos, que es exactamente lo que este producto promete no ser.
 *
 * Catálogo: GET /financiamiento/procesamientos/reglas?perfil= (JSON estático generado por
 * backend/scripts/exportar_reglas.py). Sin perfil no se adivina uno: se dice qué falta.
 */

import { AlertTriangle, Check } from "lucide-react";
import { reglaLabel, tipoContratoHumano, type ReglasPerfil } from "@/lib/auditoria";
import { Popover } from "@/components/ui/Flotante";
import { Severidad } from "@/components/ui/Severidad";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { redactDnis } from "@/components/Redact";
import { nombreDeAgente } from "./catalogo";
import { ORDEN_SEVERIDAD, type SenalAgente } from "./senales";

interface Props {
  /** Catálogo del perfil, ya cargado por el contenedor (useReglasPerfil). */
  reglas: ReglasPerfil | null;
  cargando?: boolean;
  /** Ids de reglas deterministas que dispararon (`compliance_resumen_det.reglas`). */
  reglasDisparadas?: string[] | null;
  senales: SenalAgente[];
  /** Cuántas reglas declara haber evaluado el análisis, cuando no hay catálogo del perfil. */
  reglasEvaluadas?: number | null;
}

export function MatrizReglas({ reglas: data, cargando = false, reglasDisparadas, senales, reglasEvaluadas }: Props) {
  const porRegla = new Map<string, SenalAgente[]>();
  for (const s of senales) {
    const lista = porRegla.get(s.regla) ?? [];
    lista.push(s);
    porRegla.set(s.regla, lista);
  }
  const disparadas = new Set<string>([...(reglasDisparadas ?? []), ...senales.map((s) => s.regla)]);

  if (cargando) {
    return (
      <div className="space-y-1.5 px-5 py-4" aria-busy>
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  // ── Sin catálogo del perfil: se declara lo que falta, no se rellena con otro perfil ──
  if (!data) {
    const n = reglasEvaluadas ?? null;
    const m = disparadas.size;
    return (
      <div className="px-5 py-4 text-[12px] leading-relaxed text-mute">
        <p className="text-ink">
          {n != null
            ? `Se evaluaron ${n} reglas sobre este contrato y dispararon ${m}.`
            : `Dispararon ${m} ${m === 1 ? "regla" : "reglas"} sobre este contrato.`}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {[...disparadas].sort().map((id) => (
            <li key={id} className="pill border-rust/40 bg-crimson-soft text-rust">
              <AlertTriangle size={11} aria-hidden />
              {etiquetaDe(id, data)}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          El catálogo de las reglas que <em>no</em> dispararon no llega en esta respuesta: sin el
          tipo de contrato del análisis (bienes, servicios, obras u otros) no se puede decir cuáles se
          descartaron, y mostrar el de otro tipo sería inventarlo.
        </p>
      </div>
    );
  }

  const reglas = [...data.reglas].sort(
    (a, b) => Number(disparadas.has(b.id)) - Number(disparadas.has(a.id)) || a.etiqueta.localeCompare(b.etiqueta, "es"),
  );
  const nDisparadas = data.reglas.filter((r) => disparadas.has(r.id)).length;
  const otras = senales.filter((s) => !data.reglas.some((r) => r.id === s.regla));

  return (
    <div className="px-5 py-4">
      <p className="text-[13px] leading-relaxed text-ink">
        Se evaluaron <strong className="font-semibold tabular-nums">{data.reglas.length} reglas</strong> para contratos de{" "}
        {tipoContratoHumano(data.perfil) ?? data.perfil} y dispararon{" "}
        <strong className="font-semibold tabular-nums">{nDisparadas}</strong>
        {nDisparadas !== data.reglas.length && <>; las otras {data.reglas.length - nDisparadas} se descartaron</>}.
      </p>
      <ul className="mt-2 grid gap-x-4 gap-y-0.5 sm:grid-cols-2" aria-label="Reglas evaluadas en este contrato">
        {reglas.map((r) => {
          const on = disparadas.has(r.id);
          const s = porRegla.get(r.id)?.sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad])[0];
          return (
            <li key={r.id} className="min-w-0">
              <Popover
                titulo={r.etiqueta}
                anchoClase="w-80"
                className="w-full rounded-md px-1 py-0.5 text-left transition-colors duration-rapido hover:bg-paperDeep"
                trigger={
                  <span className="flex w-full min-w-0 items-start gap-1.5 text-[12px] leading-snug">
                    {on ? (
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rust" aria-hidden />
                    ) : (
                      <Check size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden />
                    )}
                    <span className={cn("min-w-0 flex-1 truncate", on ? "font-medium text-ink" : "text-mute")}>
                      {r.etiqueta}
                    </span>
                    <span className="sr-only">{on ? " (disparó)" : " (evaluada, no disparó)"}</span>
                  </span>
                }
              >
                <span className="block text-mute">{r.descripcion}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  {on ? (
                    <>
                      {s ? <Severidad bandera={s.severidad} formato="linea" /> : null}
                      <span className="text-[12px] text-ink">Disparó en este contrato.</span>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-moss">
                      <Check size={12} aria-hidden /> Se evaluó y no disparó.
                    </span>
                  )}
                </span>
                {on && s?.evidencia && <span className="mt-1 block text-[12px] text-inkSoft">{redactDnis(s.evidencia)}</span>}
              </Popover>
            </li>
          );
        })}
      </ul>

      {otras.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="text-[12px] text-ink">
            Otras {otras.length} {otras.length === 1 ? "señal" : "señales"} no salen de estas reglas
            deterministas sino de lo que leyeron los agentes (expediente, mercado, prensa):
          </p>
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {otras.map((s, i) => (
              <li key={`${s.regla}-${i}`} className="flex min-w-0 items-start gap-1.5 text-[12px] leading-snug">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rust" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {data.otrasSenales[s.regla]?.etiqueta ?? reglaLabel(s.regla)}
                </span>
                <span className="shrink-0 text-[11px] text-mute">{nombreDeAgente(s.agenteBruto ?? s.agente)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function etiquetaDe(id: string, data: ReglasPerfil | null): string {
  if (!data) return reglaLabel(id);
  return data.reglas.find((r) => r.id === id)?.etiqueta ?? data.otrasSenales[id]?.etiqueta ?? reglaLabel(id);
}
