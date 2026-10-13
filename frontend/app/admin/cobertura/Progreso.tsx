"use client";

import { CheckCircle2, Moon } from "lucide-react";
import type { ProgresoDocumentos } from "@/lib/admin";
import { Badge, BarraProgreso, Card, EmptyState, Expandable, Panel, StatCard, StatGrid, estadoLote, fmtDia, fmtFechaHora, fmtNum, hace } from "@/components/admin/ui";

// ── Lote nocturno de documentos: cuánto falta, a qué ritmo y qué falló ─────

/** Mínimo de noches con descargas en la semana para que un promedio signifique algo. */
const NOCHES_MINIMAS = 3;

/**
 * Cuándo terminaría, dicho con honestidad. El API divide lo que falta por el
 * promedio de las noches con actividad; con una o dos noches ese promedio no es
 * un ritmo (así salió "1172 noches ≈ 09-dic": 3 años, con la fecha sin año).
 */
function estimacion(pr: ProgresoDocumentos): { valor: string; pista: string; tono: "ok" | "neutral" | "muted" } {
  const activas = pr.ritmo.filter((r) => r.n > 0).length;
  if (pr.restantes === 0) return { valor: "Completo", pista: "no falta ningún documento publicado", tono: "ok" };
  if (!pr.porNoche || activas < NOCHES_MINIMAS || pr.nochesRestantes == null)
    return {
      valor: "Sin estimar",
      pista: activas === 0 ? "sin descargas en 7 días" : `${activas} de ${NOCHES_MINIMAS} noches con descargas`,
      tono: "muted",
    };
  const fin = fmtDia(new Date(Date.now() + pr.nochesRestantes * 864e5));
  if (pr.nochesRestantes > 365) return { valor: "Más de un año", pista: `a ${fmtNum(pr.porNoche)} por noche faltarían ${fmtNum(pr.nochesRestantes)} noches`, tono: "neutral" };
  return { valor: `${fmtNum(pr.nochesRestantes)} ${pr.nochesRestantes === 1 ? "noche" : "noches"}`, pista: `hacia el ${fin}, si se mantiene el ritmo`, tono: "neutral" };
}

/** Errores conocidos del lote en palabras llanas; el texto crudo queda en el detalle. */
const ERROR_ITEM: Record<string, string> = {
  "sin archivo o sin sha256": "El expediente lista el documento pero no trae el archivo ni su huella para bajarlo",
};

export function Progreso({ pr }: { pr: ProgresoDocumentos }) {
  const lote = pr.loteActual;
  const est = estimacion(pr);
  const max = Math.max(1, ...pr.ritmo.map((x) => x.n));
  const dia = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });

  // Errores agrupados por causa: 20 filas iguales se leen como una sola con su cuenta.
  const grupos = new Map<string, typeof pr.errores>();
  for (const e of pr.errores) grupos.set(e.error ?? "error sin detalle", [...(grupos.get(e.error ?? "error sin detalle") ?? []), e]);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-3xl font-semibold text-ink">{pr.pct.toLocaleString("es-PE")} %</span>
          <span className="text-sm text-inkSoft">
            <span className="font-mono text-ink">{fmtNum(pr.vigentes)}</span> de {fmtNum(pr.publicados)} documentos publicados en el SEACE ya están en el almacén
          </span>
        </div>
        <BarraProgreso pct={pr.pct} alto="lg" etiqueta={`${pr.pct} % de los documentos publicados ya está en el almacén`} className="mt-3" />
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-mute">
          {lote ? (
            <>
              <Badge tono={estadoLote(lote.estado).tono} punto>{estadoLote(lote.estado).label}</Badge>
              <span title={lote.id}>
                Último lote {fmtFechaHora(lote.finalizadoAt ?? lote.iniciadoAt) ?? "sin fecha"}: {fmtNum(lote.ok)} de {fmtNum(lote.total)} documentos
                {lote.fallidos ? <span className="text-crimsonTexto">, {fmtNum(lote.fallidos)} fallidos</span> : null}
              </span>
            </>
          ) : (
            <span>Todavía no corrió ningún lote de documentos.</span>
          )}
        </p>
      </Card>

      <StatGrid columnas={4}>
        <StatCard etiqueta="Faltan" valor={pr.restantes} tono={pr.restantes ? "warn" : "ok"} pista={`documentos, de ${fmtNum(pr.contratosSinBajar)} contratos`} />
        <StatCard
          etiqueta="Ritmo"
          valor={pr.porNoche ? `${fmtNum(pr.porNoche)} / noche` : "Sin descargas"}
          pista={pr.porNoche ? "noches con descargas, 7 días" : "en los últimos 7 días"}
        />
        <StatCard etiqueta="Fin estimado" valor={est.valor} tono={est.tono} pista={est.pista} />
        <StatCard etiqueta="En lotes abiertos" valor={pr.itemsPendientes} pista="documentos esperando turno" />
      </StatGrid>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* Un panel con cabecera solo si hay algo que listar; sin datos, una línea que lo diga. */}
        {!pr.ritmo.length && (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2.5 text-[13px] leading-snug text-inkSoft">
            <Moon size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            <span><strong className="font-semibold text-ink">Ninguna descarga en la última semana.</strong> El lote nocturno no bajó documentos en estos 7 días.</span>
          </p>
        )}
        {!!pr.ritmo.length && (
          <section aria-label="Descargados por noche" className="rounded-xl border border-line bg-paperSoft px-3 py-2">
            <h3 className="text-[13px] font-semibold text-ink">
              Descargados por noche <span className="font-normal text-mute">últimos 7 días</span>
            </h3>
            <ul className="mt-1.5 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
              {pr.ritmo.map((r) => (
                <li key={r.dia} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-inkSoft">{dia(r.dia)}</span>
                  <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                    <span className="block h-full rounded-full bg-moss" style={{ width: `${Math.round((r.n / max) * 100)}%` }} />
                  </span>
                  <span className="shrink-0 text-right text-mute">
                    <span className="font-mono text-ink">{fmtNum(r.n)}</span> docs, {fmtNum(r.contratos)} contr.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!pr.errores.length && (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2.5 text-[13px] leading-snug text-inkSoft">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            <span><strong className="font-semibold text-ink">Ningún documento falló.</strong> Los últimos lotes bajaron todo lo que intentaron.</span>
          </p>
        )}
        {!!pr.errores.length && <Panel titulo="Errores recientes" descripcion={pr.errores.length ? `Los últimos ${pr.errores.length} documentos que fallaron, agrupados por causa` : "Documentos que fallaron en los últimos lotes"}>
          {(
            <div className="space-y-2">
              {Array.from(grupos.entries()).map(([causa, items]) => {
                const contratos = new Set(items.map((e) => e.clave.split("/")[0]));
                return (
                  <Expandable
                    key={causa}
                    resumen={<span className="font-medium">{ERROR_ITEM[causa] ?? causa}</span>}
                    meta={`${items.length} docs de ${contratos.size} ${contratos.size === 1 ? "contrato" : "contratos"}`}
                    className="rounded-xl"
                  >
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-[12px]">
                      {items.map((e, i) => {
                        const [ocid, doc] = e.clave.split("/");
                        return (
                          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-ink">
                              Contrato <span className="font-mono">{ocid}</span>
                              {doc && <span className="text-mute">, documento <span className="font-mono">{doc}</span></span>}
                            </span>
                            <span className="text-mute" title={e.loteId}>{hace(e.procesadoAt) ?? "sin fecha"}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {ERROR_ITEM[causa] && <p className="mt-2 font-mono text-[11px] text-mute">Mensaje del lote: {causa}</p>}
                  </Expandable>
                );
              })}
            </div>
          )}
        </Panel>}
      </div>
    </div>
  );
}
