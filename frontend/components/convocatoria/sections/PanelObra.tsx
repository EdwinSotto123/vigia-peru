"use client";

/**
 * Pestaña «La obra» del dictamen (redes de obras y consultoría, plan 2026-11-04): la obra en INFOBRAS de la Contraloría
 * y su inversión en Invierte.pe, desde la base (`obra_ejecucion` del agente de obras, `supervision_obra` del de
 * consultoría). Por obra: cifras arriba, el avance físico contra el programado y contra lo pagado en barras, los datos
 * de la ejecución, la inversión y qué une al supervisor con el contratista. Al final, el historial de quien ganó.
 */

import { ArrowUpRight, Building2, CircleAlert, Clock, Gavel, HardHat, Link2, Users } from "lucide-react";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { setRedactNames } from "../../Redact";
import { fechaDossier, montoDossier } from "../dossier";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { SeccionSegura } from "./SeccionSegura";

function Barra({ etiqueta, valor, tono }: { etiqueta: string; valor: number | null | undefined; tono: string }) {
  const v = typeof valor === "number" ? Math.max(0, Math.min(100, valor)) : null;
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-rotulo">
      <span className="text-inkSoft">{etiqueta}</span>
      <span className="h-2 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
        {v != null && <span className={cn("block h-full rounded-full", tono)} style={{ width: `${v}%` }} />}
      </span>
      <span className="text-right font-mono tabular-nums text-ink">{v != null ? `${v.toFixed(0)} %` : "Sin dato"}</span>
    </div>
  );
}

function Fila({ icono: Icono, titulo, children }: { icono: typeof Building2; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <Icono size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-micro font-semibold uppercase tracking-wide text-mute">{titulo}</dt>
        <dd className="mt-0.5 text-rotulo leading-5 text-ink">{children}</dd>
      </div>
    </div>
  );
}

function Vinculo({ v }: { v: any }) {
  if (!v) return <>Sin datos del supervisor.</>;
  const partes: string[] = [];
  if (v.mismo_ruc) partes.push("son la misma empresa o comparten consorciado");
  if (v.personas_comunes?.length) partes.push(`${v.personas_comunes.length} persona(s) en común en el RNP`);
  if (v.consorcios_comunes?.length) partes.push(`formaron juntos ${v.consorcios_comunes.length} consorcio(s)`);
  if (v.mismo_domicilio) partes.push("tienen el mismo domicilio fiscal");
  if (!partes.length) return <>Sin vínculo en el RNP, en consorcios ni por domicilio fiscal.</>;
  return (
    <span className="font-semibold text-crimsonTexto">
      {partes.join("; ")}.
      {v.personas_comunes?.length > 0 && (
        <span className="mt-0.5 block font-normal text-inkSoft">
          {v.personas_comunes.slice(0, 3).map((p: any) => p.nombre).join(", ")}
        </span>
      )}
    </span>
  );
}

function TarjetaObra({ o, rol }: { o: any; rol: "ejecucion" | "supervision" }) {
  const inv = o.inversion ?? null;
  const pagadoSinAvance = typeof o.financiero_pct === "number" && typeof o.fisico_real === "number" && o.financiero_pct - o.fisico_real >= 20;
  const cifras = [
    { valor: o.contrato_monto != null ? montoDossier(o.contrato_monto) : null, etiqueta: "contrato de obra", contexto: o.estado || undefined },
    { valor: typeof o.fisico_real === "number" ? `${o.fisico_real.toFixed(0)} %` : null, etiqueta: "avance físico real",
      contexto: typeof o.fisico_prog === "number" ? `programado ${o.fisico_prog.toFixed(0)} %` : undefined,
      tono: typeof o.fisico_prog === "number" && typeof o.fisico_real === "number" && o.fisico_prog - o.fisico_real >= 25 ? ("media" as const) : ("neutro" as const) },
    { valor: o.adicionales_pct != null ? `${o.adicionales_pct.toFixed(0)} %` : "0 %", etiqueta: "adicionales sobre el contrato",
      contexto: o.adicionales_n ? `${o.adicionales_n} adicional(es), ${montoDossier(o.adicionales_monto)}` : "ninguno",
      tono: (o.adicionales_pct ?? 0) >= 15 ? ("alta" as const) : ("neutro" as const) },
    rol === "supervision"
      ? { valor: o.supervision_pct_obra != null ? `${o.supervision_pct_obra.toFixed(1)} %` : null, etiqueta: "costo de la supervisión",
          contexto: "frente a la obra; lo habitual, 3 % a 10 %", tono: (o.supervision_pct_obra ?? 0) > 15 ? ("media" as const) : ("neutro" as const) }
      : { valor: inv?.sobrecosto_pct != null ? `${inv.sobrecosto_pct > 0 ? "+" : ""}${inv.sobrecosto_pct.toFixed(0)} %` : null,
          etiqueta: "costo actualizado frente al viable", contexto: "Invierte.pe",
          tono: (inv?.sobrecosto_pct ?? 0) >= 50 ? ("alta" as const) : ("neutro" as const) },
  ];
  return (
    <section className="rounded-2xl border border-line bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-seccion font-bold text-ink">{o.nombre || "Obra sin nombre en INFOBRAS"}</h2>
          <p className="mt-0.5 text-rotulo text-mute">
            {o.entidad_nombre}{o.cui && <>, CUI <span className="font-mono">{o.cui}</span></>}
          </p>
        </div>
        {o.fuente_url && (
          <a href={o.fuente_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-rotulo font-medium text-granate hover:underline">
            Ver en INFOBRAS <ArrowUpRight size={13} aria-hidden />
          </a>
        )}
      </header>
      <div className="space-y-4 px-5 py-4">
        <CifrasEnFila items={cifras} chico />
        <div className="space-y-2 rounded-xl border border-line bg-paperSoft px-4 py-3">
          <Barra etiqueta="Físico programado" valor={o.fisico_prog} tono="bg-mute" />
          <Barra etiqueta="Físico real" valor={o.fisico_real} tono="bg-granate" />
          <Barra etiqueta="Pagado" valor={o.financiero_pct} tono={pagadoSinAvance ? "bg-crimson" : "bg-anil"} />
          {pagadoSinAvance && (
            <p className="text-micro font-semibold text-crimsonTexto">Se pagó {(o.financiero_pct - o.fisico_real).toFixed(0)} puntos más de lo que avanzó la obra.</p>
          )}
          {o.avance_fecha && <p className="text-micro text-mute">Avance al {fechaDossier(o.avance_fecha, true)}, según INFOBRAS.</p>}
        </div>
        <dl className="divide-y divide-line">
          <Fila icono={HardHat} titulo="Contratista">{o.ejecutor_nombre || "Sin dato"}</Fila>
          <Fila icono={Users} titulo="Supervisor">
            {o.supervisor_nombre || "Sin dato"}
            {o.supervision_monto != null && <span className="text-mute">, {montoDossier(o.supervision_monto)}</span>}
          </Fila>
          <Fila icono={Link2} titulo="Supervisor y contratista"><Vinculo v={o.vinculo ?? o.vinculo_supervisor} /></Fila>
          <Fila icono={Clock} titulo="Plazo">
            {o.plazo_dias ? `${numero(o.plazo_dias)} días` : "Sin dato"}
            {o.dias_ampliacion ? <span className="text-mute">, ampliado {numero(o.dias_ampliacion)} días</span> : null}
            {(o.paralizada || o.dias_paralizada) && (
              <span className="mt-0.5 block font-semibold text-crimsonTexto">
                Paralizada{o.dias_paralizada ? ` ${numero(o.dias_paralizada)} días` : ""}{o.causal_paralizacion ? `: ${o.causal_paralizacion}` : ""}
              </span>
            )}
          </Fila>
          {(o.controversias > 0 || o.informes_control > 0) && (
            <Fila icono={Gavel} titulo="Controversias y control">
              {o.controversias > 0 && <>{o.controversias} controversia(s). </>}
              {o.informes_control > 0 && <>{o.informes_control} informe(s) de la Contraloría.</>}
            </Fila>
          )}
          {inv && (
            <Fila icono={CircleAlert} titulo="Inversión (Invierte.pe)">
              Viable por {montoDossier(inv.monto_viable)}; costo actualizado {montoDossier(inv.costo_actualizado)}
              {inv.monto_laudo ? <span className="font-semibold text-crimsonTexto">; laudos por {montoDossier(inv.monto_laudo)}</span> : null}.
              {inv.estado && <span className="block text-mute">{inv.estado}{inv.situacion ? `, ${inv.situacion}` : ""}</span>}
            </Fila>
          )}
        </dl>
      </div>
    </section>
  );
}

function Historial({ h, rol }: { h: any; rol: "ejecucion" | "supervision" }) {
  if (!h || !h.obras) return null;
  const cifras = [
    { valor: numero(h.obras), etiqueta: rol === "supervision" ? "obras que supervisó" : "obras que ejecutó", contexto: "según INFOBRAS" },
    { valor: numero(h.paralizadas ?? 0), etiqueta: "paralizadas", tono: h.paralizadas ? ("media" as const) : ("neutro" as const) },
    { valor: numero(h.con_adicionales_altos ?? 0), etiqueta: "con adicionales de 15 % o más", tono: h.con_adicionales_altos ? ("media" as const) : ("neutro" as const) },
    { valor: numero(h.pagadas_sin_avance ?? 0), etiqueta: "pagadas sin avance", tono: h.pagadas_sin_avance ? ("alta" as const) : ("neutro" as const) },
  ];
  return (
    <section className="rounded-2xl border border-line bg-paper px-5 py-4">
      <h3 className="mb-3 text-cuerpo font-semibold text-ink">{rol === "supervision" ? "Su historial como supervisor" : "Su historial como contratista"}</h3>
      <CifrasEnFila items={cifras} chico />
    </section>
  );
}

export function PanelObra({ result, nombresPrivados }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const sup = (result as any).supervision_obra;
  const eje = (result as any).obra_ejecucion;
  const rol: "ejecucion" | "supervision" = sup?.enlazada || (!eje?.enlazada && sup) ? "supervision" : "ejecucion";
  const datos = rol === "supervision" ? sup : eje;
  if (!datos?.enlazada) {
    return (
      <AvisoSeccion titulo="Este proceso no está enlazado a una obra en INFOBRAS" icono={<HardHat size={16} aria-hidden />}>
        No se pudo cruzar con la Contraloría: sin la obra no se revisan su avance, su supervisión ni sus adicionales.
      </AvisoSeccion>
    );
  }
  return (
    <div className="space-y-4">
      {(datos.obras || []).map((o: any, i: number) => (
        <SeccionSegura key={o.codigo ?? i} nombre="la obra">
          <TarjetaObra o={o} rol={rol} />
        </SeccionSegura>
      ))}
      <Historial h={rol === "supervision" ? datos.historial_supervisor : datos.historial_contratista} rol={rol} />
      <p className="text-micro text-mute">Fuente: INFOBRAS (Contraloría General de la República) e Invierte.pe (MEF), por el enlace de la obra con este proceso.</p>
    </div>
  );
}
