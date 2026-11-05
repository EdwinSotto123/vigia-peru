"use client";

import { Landmark, ShieldAlert, Vote, Wallet } from "lucide-react";
import { Nota } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { esRef } from "@/lib/privacidad";
import { ConTapados, PersonName, esPersonaNatural } from "../../Redact";

/** Una razón social, no una persona: no lleva vidrio. */
const ES_EMPRESA = /\b(S\.?A\.?C?\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?|SOCIEDAD|EMPRESA|CONSORCIO|CORPORACI[OÓ]N|ASOCIACI[OÓ]N|COOPERATIVA)\b/i;

/**
 * La clave de `datos_peru_por_persona` es a veces un documento, a veces un nombre (en cualquiera de los dos órdenes) y
 * a veces una razón social. Cada forma se muestra con la redacción que le toca: nunca un DNI (ni tapado: «persona con
 * documento protegido» dice lo mismo) ni un apellido en claro.
 */
function Clave({ valor, ganadorRuc, ganadorRazon }: { valor: string; ganadorRuc?: string; ganadorRazon?: string }) {
  const v = valor.trim();
  if (esRef(v) || /^\d{8}$/.test(v)) return <>{v.startsWith("10") ? "Persona natural con negocio" : "Persona con documento protegido"}</>;
  if (/^10\d{9}$/.test(v)) return <>Persona natural con negocio</>;
  if (v.includes("•")) return <ConTapados texto={v} />;
  if (/^\d{11}$/.test(v)) return <span className="font-mono">RUC {v}</span>;
  if (ganadorRazon && v.toUpperCase() === ganadorRazon.trim().toUpperCase()) {
    return esPersonaNatural(ganadorRuc) ? <PersonName name={v} orden="sunat" /> : <>{v}</>;
  }
  if (ES_EMPRESA.test(v)) return <>{v}</>;
  return <PersonName name={v} />;
}

/** Las personas consultadas con algún hallazgo (aporte, candidatura, PEP o visita). */
export function personasConHallazgo(ctx: any): [string, any][] {
  return Object.entries(ctx?.datos_peru_por_persona || {}).filter(
    ([, d]: [string, any]) => (d?.onpe?.n_aportes || 0) > 0 || (d?.jne?.n_candidaturas || 0) > 0 || !!d?.pep?.found || (d?.visitas?.n_visitas || 0) > 0,
  );
}

/**
 * Lo que dicen ONPE (aportes), JNE (candidaturas), el registro de personas expuestas políticamente y el de visitas de
 * cada persona alrededor del contrato: el titular, sus socios, quienes firmaron el acta y el comité. Una fila por
 * persona con su papel y cada hallazgo con su ícono.
 */
export function PersonaVinculacionesPanel({ ctx }: { ctx: any }) {
  const datos = ctx?.datos_peru_por_persona || {};
  const ganadorRuc = ctx?.ganador?.ruc;
  const ganadorRazon = ctx?.ganador?.razon_social;
  const ganadorDni = ctx?.ganador?.dni_persona_natural;
  const comite: any[] = ctx?.comite_evaluacion || [];
  const firmantes: any[] = ctx?.firmantes_consolidados || [];

  // El papel de cada persona en el contrato: es un dato, no una severidad (tinta neutra para todos).
  const papelDe = (key: string): string => {
    if (key === ganadorRazon || key === ganadorDni) return "Titular del proveedor";
    if (firmantes.some((f) => f.nombre_completo === key || f.dni === key)) return "Firmó el acta";
    if (comite.some((m) => m.nombre_completo === key || m.nombre === key || m.dni === key)) return "Comité de selección";
    return "Socio o vínculo del proveedor";
  };

  const conHallazgo = personasConHallazgo(ctx);
  // Son consultas, no personas: la misma persona puede aparecer por su documento y por su nombre (hasta en dos órdenes).
  const consultas = Object.keys(datos).length;

  if (conHallazgo.length === 0) {
    return (
      <Nota>
        Se cruzaron los aportes de la ONPE, las candidaturas del JNE, las personas expuestas políticamente y el registro de
        visitas del titular, sus socios, quienes firmaron el acta y el comité ({consultas} {consultas === 1 ? "consulta" : "consultas"} por
        nombre o documento). Ninguna registra hallazgos.
      </Nota>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-meta text-inkSoft">
        {conHallazgo.length} con hallazgos de {consultas} {consultas === 1 ? "consulta" : "consultas"} por nombre o documento (una persona puede
        aparecer por los dos).
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {conHallazgo.map(([key, d]: [string, any], i: number) => {
          const onpe = d.onpe || {};
          const jne = d.jne || {};
          const pep = d.pep || {};
          const visitas = d.visitas || {};
          const aporte = onpe.aportes?.[0];
          const cand = jne.candidaturas?.[0];
          return (
            <li key={i} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="pill border-line bg-paperDeep text-inkSoft">{papelDe(key)}</span>
                <strong className="text-dato font-semibold text-ink">
                  <Clave valor={String(key)} ganadorRuc={ganadorRuc} ganadorRazon={ganadorRazon} />
                </strong>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
                {onpe.n_aportes > 0 && (
                  <Dato icono={Wallet} nombre="Aportes (ONPE)">
                    {onpe.n_aportes} {onpe.n_aportes === 1 ? "aporte" : "aportes"} a campañas
                    {aporte?.partido && ` (${aporte.partido}${aporte.año ? `, ${aporte.año}` : ""})`}
                  </Dato>
                )}
                {jne.n_candidaturas > 0 && (
                  <Dato icono={Vote} nombre="Candidaturas (JNE)">
                    {jne.n_candidaturas} {jne.n_candidaturas === 1 ? "candidatura" : "candidaturas"}
                    {cand?.cargo && ` (${cand.cargo}${cand.año ? `, ${cand.año}` : ""})`}
                  </Dato>
                )}
                {pep.found && (
                  <Dato icono={ShieldAlert} nombre="Persona expuesta políticamente">
                    Persona expuesta políticamente
                  </Dato>
                )}
                {visitas.n_visitas > 0 && (
                  <Dato icono={Landmark} nombre="Visitas a entidades (Ley 28024)">
                    {visitas.n_visitas} {visitas.n_visitas === 1 ? "visita" : "visitas"} a entidades públicas
                  </Dato>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
