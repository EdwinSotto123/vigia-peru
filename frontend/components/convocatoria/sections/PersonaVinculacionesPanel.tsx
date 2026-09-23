"use client";

import { cn } from "@/lib/utils";
import { Dni, PersonName, Ruc, esPersonaNatural } from "../../Redact";

/** Una razón social, no una persona: no lleva vidrio. */
const ES_EMPRESA = /\b(S\.?A\.?C?\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?|SOCIEDAD|EMPRESA|CONSORCIO|CORPORACI[OÓ]N|ASOCIACI[OÓ]N|COOPERATIVA)\b/i;

/**
 * La clave de `datos_peru_por_persona` es a veces un DNI, a veces un nombre
 * (en cualquiera de los dos órdenes) y a veces una razón social. Cada forma se
 * muestra con la redacción que le toca: nunca un DNI ni un apellido en claro.
 */
function Clave({ valor, ganadorRuc, ganadorRazon }: { valor: string; ganadorRuc?: string; ganadorRazon?: string }) {
  const v = valor.trim();
  if (/^\d{8}$/.test(v)) return <span className="font-mono">DNI <Dni value={v} /></span>;
  if (/^\d{11}$/.test(v)) return <span className="font-mono">RUC <Ruc value={v} /></span>;
  if (ganadorRazon && v.toUpperCase() === ganadorRazon.trim().toUpperCase()) {
    return esPersonaNatural(ganadorRuc) ? <PersonName name={v} orden="sunat" /> : <>{v}</>;
  }
  if (ES_EMPRESA.test(v)) return <>{v}</>;
  return <PersonName name={v} />;
}

export function PersonaVinculacionesPanel({ ctx }: { ctx: any }) {
  const datos = ctx?.datos_peru_por_persona || {};
  const ganadorRuc = ctx?.ganador?.ruc;
  const ganadorRazon = ctx?.ganador?.razon_social;
  const ganadorDni = ctx?.ganador?.dni_persona_natural;
  const comite: any[] = ctx?.comite_evaluacion || [];
  const firmantes: any[] = ctx?.firmantes_consolidados || [];

  // Categorizar cada key como titular / socio / firmante / comité
  const categoryFor = (key: string): { rol: string; color: string } => {
    if (key === ganadorRazon || key === ganadorDni) return { rol: "Titular del proveedor", color: "bg-crimson-soft text-crimsonTexto" };
    if (firmantes.some((f) => (f.nombre_completo === key) || (f.dni === key))) return { rol: "Firmante del acta", color: "bg-amber-soft text-amberTexto" };
    if (comite.some((m) => (m.nombre_completo === key) || (m.nombre === key) || (m.dni === key))) return { rol: "Comité de selección", color: "bg-heroViolet/15 text-heroViolet" };
    return { rol: "Socio o vínculo del proveedor", color: "bg-moss/15 text-mossTexto" };
  };

  // Solo mostrar personas con AL MENOS un hallazgo
  const personasConHallazgo = Object.entries(datos).filter(([, d]: any) => {
    return (d.onpe?.n_aportes || 0) > 0 ||
           (d.jne?.n_candidaturas || 0) > 0 ||
           (d.pep?.found) ||
           (d.visitas?.n_visitas || 0) > 0;
  });

  // Son consultas, no personas: la misma persona puede aparecer por su DNI y
  // por su nombre (hasta en dos órdenes). Se dice lo que es.
  const consultas = Object.keys(datos).length;

  if (personasConHallazgo.length === 0) {
    return (
      <div className="border-t border-line bg-paperSoft px-5 py-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
          Vinculaciones por persona
        </h3>
        <p className="mt-1 text-[11px] italic text-mute">
          Se cruzaron ONPE Claridad, candidaturas del JNE, PEPs y el registro de visitas para
          titular, socios, firmantes y comité ({consultas} consulta{consultas === 1 ? "" : "s"} por nombre o DNI).
          Ninguna registra hallazgos.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-paperSoft px-5 py-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
        Vinculaciones por persona
      </h3>
      <p className="mt-0.5 text-[10px] italic text-mute">
        {personasConHallazgo.length} con hallazgos de {consultas} consulta{consultas === 1 ? "" : "s"} por nombre o DNI.
        Cruces de ONPE, JNE, PEPs y visitas para titular, socios, firmantes del acta y comité de selección.
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
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest", cat.color)}>
                  {cat.rol}
                </span>
                <strong className="text-[12px] text-ink">
                  <Clave valor={String(key)} ganadorRuc={ganadorRuc} ganadorRazon={ganadorRazon} />
                </strong>
              </div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {onpe.n_aportes > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-crimsonTexto">ONPE:</span>{" "}
                    {onpe.n_aportes} aporte{onpe.n_aportes !== 1 ? "s" : ""} a partido
                    {onpe.aportes?.[0]?.partido && <span className="text-inkSoft"> ({onpe.aportes[0].partido}{onpe.aportes[0].año ? `, ${onpe.aportes[0].año}` : ""})</span>}
                  </div>
                )}
                {jne.n_candidaturas > 0 && (
                  <div className="text-[11px]">
                    <span className="font-bold text-amberTexto">JNE:</span>{" "}
                    {jne.n_candidaturas} candidatura{jne.n_candidaturas !== 1 ? "s" : ""}
                    {jne.candidaturas?.[0]?.cargo && (
                      <span className="text-inkSoft"> ({jne.candidaturas[0].cargo}{jne.candidaturas[0].año ? `, ${jne.candidaturas[0].año}` : ""})</span>
                    )}
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
                    <span className="font-bold text-mossTexto">Visitas (Ley 28024):</span>{" "}
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
