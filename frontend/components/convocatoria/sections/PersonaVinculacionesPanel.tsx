"use client";

import { cn } from "@/lib/utils";

export function PersonaVinculacionesPanel({ ctx }: { ctx: any }) {
  const datos = ctx?.datos_peru_por_persona || {};
  const ganadorRuc = ctx?.ganador?.ruc;
  const ganadorRazon = ctx?.ganador?.razon_social;
  const ganadorDni = ctx?.ganador?.dni_persona_natural;
  const comite: any[] = ctx?.comite_evaluacion || [];
  const firmantes: any[] = ctx?.firmantes_consolidados || [];

  // Categorizar cada key como titular / socio / firmante / comité
  const categoryFor = (key: string): { rol: string; color: string } => {
    if (key === ganadorRazon || key === ganadorDni) return { rol: "Titular del proveedor", color: "bg-rust/15 text-rust" };
    if (firmantes.some((f) => (f.nombre_completo === key) || (f.dni === key))) return { rol: "Firmante del acta", color: "bg-amber/15 text-amber" };
    if (comite.some((m) => (m.nombre_completo === key) || (m.nombre === key) || (m.dni === key))) return { rol: "Comité de selección", color: "bg-heroViolet/15 text-heroViolet" };
    return { rol: "Socio o vínculo del proveedor", color: "bg-moss/15 text-moss" };
  };

  // Solo mostrar personas con AL MENOS un hallazgo
  const personasConHallazgo = Object.entries(datos).filter(([, d]: any) => {
    return (d.onpe?.n_aportes || 0) > 0 ||
           (d.jne?.n_candidaturas || 0) > 0 ||
           (d.pep?.found) ||
           (d.visitas?.n_visitas || 0) > 0;
  });

  if (personasConHallazgo.length === 0) {
    // Mostrar al menos el conteo de personas investigadas con "0 hallazgos"
    const total = Object.keys(datos).length;
    return (
      <div className="border-t border-line bg-paperSoft px-5 py-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
          Vinculaciones por persona ({total} investigadas)
        </h3>
        <p className="mt-1 text-[11px] text-mute italic">
          Se cruzaron ONPE Claridad, JNE candidaturas, PEPs y registro de visitas para
          {" "}{total} personas (titular + socios + firmantes + comité) — ninguna registra hallazgos.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-paperSoft px-5 py-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
        ⚡ Vinculaciones por persona · {personasConHallazgo.length} con hallazgos · {Object.keys(datos).length} investigadas
      </h3>
      <p className="mt-0.5 text-[10px] text-mute italic">
        Cruces de ONPE / JNE / PEPs / visitas para titular, socios, firmantes del acta y miembros del comité de selección.
      </p>
      <ul className="mt-2 space-y-2">
        {personasConHallazgo.map(([key, d]: any, i: number) => {
          const cat = categoryFor(key);
          const onpe = d.onpe || {};
          const jne = d.jne || {};
          const pep = d.pep || {};
          const visitas = d.visitas || {};
          return (
            <li key={i} className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest", cat.color)}>
                  {cat.rol}
                </span>
                <strong className="text-[12px] text-ink">{key}</strong>
              </div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {onpe.n_aportes > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-rust">ONPE:</span>{" "}
                    {onpe.n_aportes} aporte{onpe.n_aportes !== 1 ? "s" : ""} a partido
                    {onpe.aportes?.[0]?.partido && <span className="text-inkSoft"> ({onpe.aportes[0].partido}{onpe.aportes[0].año ? `, ${onpe.aportes[0].año}` : ""})</span>}
                  </div>
                )}
                {jne.n_candidaturas > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-amber">JNE:</span>{" "}
                    {jne.n_candidaturas} candidatura{jne.n_candidaturas !== 1 ? "s" : ""}
                    {jne.candidaturas?.[0]?.cargo && <span className="text-inkSoft"> ({jne.candidaturas[0].cargo}, {jne.candidaturas[0].año})</span>}
                  </div>
                )}
                {pep.found && (
                  <div className="text-[11px]">
                    <span className="font-bold text-heroViolet">PEP:</span>{" "}
                    Persona expuesta políticamente activa
                  </div>
                )}
                {visitas.n_visitas > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-moss">Visitas Ley 28024:</span>{" "}
                    {visitas.n_visitas} a entidades públicas
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
