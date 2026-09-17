"use client";

import { ExternalLink, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonName, redactDnis } from "../../Redact";

export function EstructuraEntidadSection({
  autoridades, entityPersonnel, entidad,
}: { autoridades?: any; entityPersonnel?: any; entidad?: any }) {
  const a = autoridades || {};
  const ep = entityPersonnel || {};
  const funcionarios: any[] = ep.funcionarios_designados || [];
  const resoluciones: any[] = ep.resoluciones_designacion || [];

  const alcaldeP = a.alcalde_provincial_actual;
  const alcaldeD = a.alcalde_distrital_actual;
  const gobernador = a.gobernador_regional_actual;
  const regidores: any[] = a.regidores_provinciales || [];

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Network size={11} className="mr-1 inline" />
          Estructura de la entidad contratante
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          ¿Quién dirige y firma en {entidad?.nombre || a.entidad_consultada || "esta entidad"}?
        </h2>
        <p className="mt-1 text-xs text-mute">
          Capa 2 (autoridades electas vía JNE) + Capa 3 (gerentes designados de
          confianza) — quienes toman las decisiones de contratación pública en
          el período actual.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* AUTORIDADES ELECTAS — Capa 2 */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            🗳️ Autoridades electas (período 2023-2026)
          </h3>
          {!alcaldeP && !alcaldeD && !gobernador && regidores.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se identificaron autoridades electas para esta región en el JNE.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-[12px]">
              {alcaldeP && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-rust/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-rust">
                      Alcalde Provincial
                    </span>
                    <strong className="text-ink">{alcaldeP.nombre}</strong>
                  </div>
                  <div className="mt-0.5 text-[11px] text-inkSoft">
                    {alcaldeP.partido} · electo {alcaldeP.año_eleccion} · {alcaldeP.provincia}
                  </div>
                  {alcaldeP.fuente_url && (
                    <a href={alcaldeP.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                      <ExternalLink size={9} /> Fuente JNE
                    </a>
                  )}
                </li>
              )}
              {alcaldeD && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-amber/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber">
                      Alcalde Distrital
                    </span>
                    <strong className="text-ink">{alcaldeD.nombre}</strong>
                  </div>
                  <div className="mt-0.5 text-[11px] text-inkSoft">
                    {alcaldeD.partido} · electo {alcaldeD.año_eleccion} · {alcaldeD.distrito}
                  </div>
                </li>
              )}
              {gobernador && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-clay/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-clay">
                      Gobernador Regional
                    </span>
                    <strong className="text-ink">{gobernador.nombre}</strong>
                  </div>
                  <div className="mt-0.5 text-[11px] text-inkSoft">
                    {gobernador.partido} · electo {gobernador.año_eleccion} · {gobernador.region}
                  </div>
                </li>
              )}
              {regidores.length > 0 && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
                    Regidores ({regidores.length})
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {regidores.map((r, i) => (
                      <li key={i} className="text-[11px] text-ink">
                        <strong>{r.nombre}</strong>
                        {r.partido && <span className="ml-1 text-inkSoft italic">— {r.partido}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          )}
        </article>

        {/* FUNCIONARIOS DESIGNADOS — Capa 3 */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            👔 Funcionarios designados de confianza
          </h3>
          {funcionarios.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              {ep.sin_data_publica
                ? "La entidad no publica su directorio en portal de transparencia."
                : "Aún no se identificaron gerentes designados. El sub-agente entity_personnel_agent investiga vía El Peruano + portal transparencia."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-[12px]">
              {funcionarios.map((f, i) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-moss">
                      {f.cargo || "Funcionario"}
                    </span>
                    {f.vigente && (
                      <span className="rounded-full bg-clay/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-clay">
                        vigente
                      </span>
                    )}
                  </div>
                  <strong className="mt-0.5 block text-ink"><PersonName name={f.nombre_completo} /></strong>
                  {f.area && (
                    <div className="text-[11px] text-inkSoft">{f.area}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-mute">
                    {f.fecha_designacion && (
                      <span>📅 designado {f.fecha_designacion}</span>
                    )}
                    {f.acto_resolutivo && (
                      <span>📄 {f.acto_resolutivo}</span>
                    )}
                    {f.fuente_url && (
                      <a href={f.fuente_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-0.5 text-clay hover:underline">
                        <ExternalLink size={9} /> Fuente
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {resoluciones.length > 0 && (
            <details className="mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-mute hover:text-ink">
                Resoluciones de designación ({resoluciones.length})
              </summary>
              <ul className="mt-2 space-y-1 text-[11px]">
                {resoluciones.map((r, i) => (
                  <li key={i} className="text-ink">
                    <strong className="font-mono">{r.numero}</strong>
                    {r.fecha && <span className="ml-1 text-mute">({r.fecha})</span>}
                    {r.objeto && <span className="ml-1 italic text-inkSoft">— {r.objeto}</span>}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer"
                         className="ml-1 text-clay hover:underline">
                        <ExternalLink size={9} className="inline" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {ep.observaciones && (
            <p className="mt-2 border-t border-line pt-2 text-[11px] italic text-mute">
              {redactDnis(ep.observaciones)}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
