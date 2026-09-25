"use client";

import { AlertTriangle, Info } from "lucide-react";
import { numero } from "@/lib/formato";
import { fechaDossier } from "../dossier";
import { cn } from "@/lib/utils";
import { Dni, PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import { Evidencia } from "./Evidencia";

export function EmpresaAdjudicaCard({ empresa, banderasSugeridas }: { empresa: any; banderasSugeridas: any[] }) {
  // RUC 10 = persona natural con negocio: su "razón social" es su nombre en
  // orden SUNAT (APELLIDO APELLIDO NOMBRE) y el RUC lleva su DNI adentro.
  const natural = esPersonaNatural(empresa.ruc);
  const actividades: string[] = Array.isArray(empresa.actividades_comerciales)
    ? empresa.actividades_comerciales.filter(Boolean)
    : [];
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <h2 className="font-display text-xl font-bold text-ink">
        {natural ? <PersonName name={empresa.razon_social} orden="sunat" /> : empresa.razon_social}
      </h2>
      <p className="mt-0.5 text-[12px] text-mute">
        {natural ? "Persona natural con negocio que ganó el contrato" : "Empresa que ganó el contrato"}, según fuentes públicas
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        {empresa.ruc && <span className="font-mono">RUC <Ruc value={empresa.ruc} /></span>}
        {empresa.tipo && <span>{empresa.tipo}</span>}
        {empresa.condicion && (
          // Condición en SUNAT: activo/habido es el estado normal (verde = positivo); cualquier otra
          // (no habido, baja…) se nombra en tinta neutra con ícono: es un dato, no una señal.
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0 text-[11px] font-semibold",
            ["activo", "habido"].includes(String(empresa.condicion).toLowerCase())
              ? "bg-moss/10 text-mossTexto"
              : "bg-paperDeep text-ink")}>
            {!["activo", "habido"].includes(String(empresa.condicion).toLowerCase()) && <Info size={11} aria-hidden />}
            SUNAT: {String(empresa.condicion).toLowerCase()}
          </span>
        )}
        {empresa.edad_dias_al_contrato != null && (
          <span className={cn(empresa.edad_dias_al_contrato < 90 && "font-semibold text-ink")}>
            {numero(Number(empresa.edad_dias_al_contrato))} días de inscrita al contratar
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {empresa.fecha_inicio_actividades && (
          <div><dt className="text-[11px] text-mute">Inicio actividades</dt><dd className="text-ink">{fechaDossier(empresa.fecha_inicio_actividades)}</dd></div>
        )}
        {empresa.ciiu && (
          <div><dt className="text-[11px] text-mute">CIIU</dt><dd className="font-mono text-ink">{empresa.ciiu}</dd></div>
        )}
        {actividades.length > 0 && (
          <div className="sm:col-span-2"><dt className="text-[11px] text-mute">Actividad comercial</dt>
            <dd className="text-ink">
              <ul className="space-y-0.5">
                {actividades.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </dd>
          </div>
        )}
        {empresa.direccion_legal && (
          <div className="sm:col-span-2"><dt className="text-[11px] text-mute">Dirección legal</dt>
            <dd className="text-ink">{empresa.direccion_legal}</dd></div>
        )}
        {empresa.gerente_general?.nombre && (
          <div className="sm:col-span-2"><dt className="text-[11px] text-mute">Gerente general</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 text-ink">
              {/* SUNAT publica al gerente como APELLIDO APELLIDO NOMBRE. */}
              <strong><PersonName name={empresa.gerente_general.nombre} orden="sunat" /></strong>
              {empresa.gerente_general.desde && <span className="text-mute">desde {fechaDossier(empresa.gerente_general.desde, true)}</span>}
            </dd></div>
        )}
      </dl>
      {(empresa.socios || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="text-[12px] font-semibold text-ink">
            Socios y representantes ({empresa.socios.length})
          </h3>
          <ul className="mt-1.5 space-y-1">
            {empresa.socios.map((s: any, i: number) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-paperSoft px-2.5 py-1.5 text-xs">
                <strong className="text-ink"><PersonName name={s.nombre} /></strong>
                {s.dni && <span className="font-mono text-mute">DNI <Dni value={s.dni} /></span>}
                {s.participacion && <span className="text-mute">{s.participacion}</span>}
                {s.cargo && <span className="text-inkSoft">{s.cargo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(banderasSugeridas || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="text-[12px] font-semibold text-amberTexto">
            <AlertTriangle size={10} className="mr-1 inline" aria-hidden />
            Señales sugeridas para investigar
          </h3>
          <ul className="mt-1.5 space-y-1">
            {banderasSugeridas.map((b, i) => (
              <li key={i} className="rounded-lg bg-amber-soft px-2.5 py-1.5 text-xs">
                <strong className="text-ink">{b.titulo}.</strong>{" "}
                <span className="text-inkSoft">{redactDnis(b.descripcion)}</span>
                {b.evidencia && <Evidencia value={b.evidencia} className="mt-1 text-[11px] text-inkSoft" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
