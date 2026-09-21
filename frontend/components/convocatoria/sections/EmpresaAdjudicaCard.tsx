"use client";

import { AlertTriangle, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dni, PersonName, redactDnis } from "../../Redact";

export function EmpresaAdjudicaCard({ empresa, banderasSugeridas }: { empresa: any; banderasSugeridas: any[] }) {
  return (
    <section className="surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
        <Building2 size={11} className="mr-1 inline" />
        Empresa adjudicataria · perfil completo (web_research_agent)
      </div>
      <h2 className="mt-1 font-serif text-xl font-bold text-ink">{empresa.razon_social}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        <span className="font-mono">RUC {empresa.ruc}</span>
        {empresa.tipo && <span>· {empresa.tipo}</span>}
        {empresa.condicion && (
          <span className={cn("rounded-full px-1.5 py-0 text-[9px] font-bold uppercase",
            empresa.condicion?.toLowerCase() === "activo" ? "bg-moss/10 text-moss" : "bg-rust/10 text-rust")}>
            {empresa.condicion}
          </span>
        )}
        {empresa.edad_dias_al_contrato != null && (
          <span className={cn(empresa.edad_dias_al_contrato < 90 ? "text-rust font-bold" : "")}>
            · {empresa.edad_dias_al_contrato} días desde alta
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
        {(empresa.actividades_comerciales || []).length > 0 && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Actividad comercial</dt>
            <dd className="text-ink">{(empresa.actividades_comerciales as string[]).join(" · ")}</dd></div>
        )}
        {empresa.direccion_legal && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Dirección legal</dt>
            <dd className="text-ink">📍 {empresa.direccion_legal}</dd></div>
        )}
        {empresa.gerente_general?.nombre && (
          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-mute">Gerente general</dt>
            <dd className="text-ink"><strong>{empresa.gerente_general.nombre}</strong>{empresa.gerente_general.desde && <span className="text-mute"> · desde {empresa.gerente_general.desde}</span>}</dd></div>
        )}
      </dl>
      {(empresa.socios || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            Socios y representantes · {empresa.socios.length}
          </div>
          <ul className="mt-1.5 space-y-1">
            {empresa.socios.map((s: any, i: number) => (
              <li key={i} className="rounded-lg bg-paperSoft px-2.5 py-1.5 text-xs">
                <strong className="text-ink"><PersonName name={s.nombre} /></strong>
                {s.dni && <span className="ml-1.5 font-mono text-mute">DNI <Dni value={s.dni} /></span>}
                {s.participacion && <span className="ml-1.5 text-mute">· {s.participacion}</span>}
                {s.cargo && <span className="ml-1.5 text-heroViolet">· {s.cargo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(banderasSugeridas || []).length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber">
            <AlertTriangle size={10} className="mr-1 inline" />
            Banderas sugeridas a investigar
          </div>
          <ul className="mt-1.5 space-y-1">
            {banderasSugeridas.map((b, i) => (
              <li key={i} className="rounded-lg bg-amber-soft px-2.5 py-1.5 text-xs">
                <strong className="text-ink">{b.titulo}.</strong>{" "}
                <span className="text-mute">{redactDnis(b.descripcion)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
