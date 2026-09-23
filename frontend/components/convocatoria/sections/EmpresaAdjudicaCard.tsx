"use client";

import { AlertTriangle } from "lucide-react";
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
    <section className="surface p-5">
      <h2 className="font-serif text-xl font-bold text-ink">
        {natural ? <PersonName name={empresa.razon_social} orden="sunat" /> : empresa.razon_social}
      </h2>
      <p className="mt-0.5 text-[12px] text-mute">
        {natural ? "Persona natural con negocio que ganó el contrato" : "Empresa que ganó el contrato"}, según fuentes públicas
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        {empresa.ruc && <span className="font-mono">RUC <Ruc value={empresa.ruc} /></span>}
        {empresa.tipo && <span>{empresa.tipo}</span>}
        {empresa.condicion && (
          <span className={cn("rounded-full px-1.5 py-0 text-[9px] font-bold uppercase",
            ["activo", "habido"].includes(String(empresa.condicion).toLowerCase())
              ? "bg-moss/10 text-mossTexto"
              : "bg-crimson-soft text-crimsonTexto")}>
            {empresa.condicion}
          </span>
        )}
        {empresa.edad_dias_al_contrato != null && (
          <span className={cn(empresa.edad_dias_al_contrato < 90 && "font-bold text-crimsonTexto")}>
            {Number(empresa.edad_dias_al_contrato).toLocaleString("es-PE")} días de inscrita al contratar
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {empresa.fecha_inicio_actividades && (
          <div><dt className="text-[10px] uppercase tracking-wider text-mute">Inicio actividades</dt><dd className="font-mono text-ink">{empresa.fecha_inicio_actividades}</dd></div>
        )}
        {empresa.ciiu && (
          <div><dt className="text-[10px] uppercase tracking-wider text-mute">CIIU</dt><dd className="font-mono text-ink">{empresa.ciiu}</dd></div>
        )}
        {actividades.length > 0 && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Actividad comercial</dt>
            <dd className="text-ink">
              <ul className="space-y-0.5">
                {actividades.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </dd>
          </div>
        )}
        {empresa.direccion_legal && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Dirección legal</dt>
            <dd className="text-ink">{empresa.direccion_legal}</dd></div>
        )}
        {empresa.gerente_general?.nombre && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Gerente general</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 text-ink">
              {/* SUNAT publica al gerente como APELLIDO APELLIDO NOMBRE. */}
              <strong><PersonName name={empresa.gerente_general.nombre} orden="sunat" /></strong>
              {empresa.gerente_general.desde && <span className="text-mute">desde {empresa.gerente_general.desde}</span>}
            </dd></div>
        )}
      </dl>
      {(empresa.socios || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            Socios y representantes ({empresa.socios.length})
          </h3>
          <ul className="mt-1.5 space-y-1">
            {empresa.socios.map((s: any, i: number) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-paperSoft px-2.5 py-1.5 text-xs">
                <strong className="text-ink"><PersonName name={s.nombre} /></strong>
                {s.dni && <span className="font-mono text-mute">DNI <Dni value={s.dni} /></span>}
                {s.participacion && <span className="text-mute">{s.participacion}</span>}
                {s.cargo && <span className="text-heroViolet">{s.cargo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(banderasSugeridas || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-amberTexto">
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
