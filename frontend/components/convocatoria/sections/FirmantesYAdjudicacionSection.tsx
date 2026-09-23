"use client";

import { Award, Calendar, Clock, ExternalLink, MapPin, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { severidadColor } from "@/lib/formato";
import { Dni, PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { Evidencia, evidenciaComoTexto } from "./Evidencia";

/** Relaciones que el agente de red usa para decir "no hay vínculo". */
const SIN_VINCULO = new Set(["sin_relacion", "sin_vinculo", "ninguna", ""]);

const sevDe = (s: unknown): "alta" | "media" | "baja" => (s === "alta" || s === "media" ? s : "baja");

export function FirmantesYAdjudicacionSection({
  firmantes,
  comite,
  motivos,
  lugarFecha,
  cruceFirmantes,
  nombresSunat = [],
}: {
  firmantes: any[];
  comite: any[];
  motivos: any[];
  lugarFecha?: { lugar?: string; fecha?: string; hora?: string } | null;
  cruceFirmantes?: any[];
  /** Nombres de personas naturales en orden SUNAT (APELLIDO APELLIDO NOMBRE): se tapa la 2.ª palabra. */
  nombresSunat?: string[];
}) {
  const sunat = new Set(nombresSunat.map((n) => n.trim().toLowerCase()));
  const ordenDe = (n: unknown) => (typeof n === "string" && sunat.has(n.trim().toLowerCase()) ? "sunat" : "nombres-primero");
  const rolBadge = (r: string) => {
    const s = (r || "").toLowerCase();
    if (s.includes("aprob")) return "bg-amber-soft text-amberTexto";
    if (s.includes("presid") || s.includes("comite")) return "bg-heroViolet-soft text-heroViolet";
    if (s.includes("represent")) return "bg-crimson-soft text-crimsonTexto";
    if (s.includes("evalu")) return "bg-paperDeep text-inkSoft";
    return "bg-paperDeep text-mute";
  };
  const cruces = (cruceFirmantes || []).filter(Boolean);
  const conVinculo = cruces.filter((c: any) => !SIN_VINCULO.has(String(c?.tipo_relacion ?? "").toLowerCase()));
  const sinVinculo = cruces.length - conVinculo.length;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">Firmantes y motivos de adjudicación</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
          <Users size={11} aria-hidden /> Quién firmó, por qué ganó y quién evaluó
        </p>
        {(lugarFecha?.lugar || lugarFecha?.fecha) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mute">
            {lugarFecha?.lugar && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={10} aria-hidden /> {lugarFecha.lugar}
              </span>
            )}
            {lugarFecha?.fecha && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={10} aria-hidden /> {lugarFecha.fecha}
              </span>
            )}
            {lugarFecha?.hora && (
              <span className="inline-flex items-center gap-1">
                <Clock size={10} aria-hidden /> {lugarFecha.hora}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* FIRMANTES */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">Firmantes del documento ({firmantes.length})</h3>
          {firmantes.length === 0 ? (
            <p className="mt-2 text-[12px] italic text-mute">No se identificaron firmantes en los documentos leídos.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {firmantes.map((f: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <strong className="text-sm text-ink">
                      <PersonName name={f.nombre_completo} />
                    </strong>
                    {f.rol_en_documento && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          rolBadge(f.rol_en_documento),
                        )}
                      >
                        {String(f.rol_en_documento).replace(/_/g, " ").toLowerCase()}
                      </span>
                    )}
                  </div>
                  {f.cargo && <div className="mt-0.5 text-[11px] text-inkSoft">{f.cargo}</div>}
                  {f.entidad && <div className="text-[10px] text-mute">{f.entidad}</div>}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-mute">
                    {f.dni && (
                      <span className="font-mono">
                        DNI <Dni value={f.dni} />
                      </span>
                    )}
                    {f.fecha_firma && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={9} aria-hidden /> {f.fecha_firma}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        {/* COMITÉ DE EVALUACIÓN */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">Comité de selección ({comite.length})</h3>
          {comite.length === 0 ? (
            <p className="mt-2 text-[12px] italic text-mute">
              Los documentos no detallan quién integró el comité (es común en contrataciones directas).
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {comite.map((m: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <strong className="text-sm text-ink">
                      <PersonName name={m.nombre_completo || m.nombre} />
                    </strong>
                    {m.rol && (
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", rolBadge(m.rol))}>
                        {String(m.rol).replace(/_/g, " ").toLowerCase()}
                      </span>
                    )}
                  </div>
                  {m.cargo && <div className="mt-0.5 text-[11px] text-inkSoft">{m.cargo}</div>}
                  {m.certificacion_sican && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-[10px] text-heroViolet">
                      <Award size={9} aria-hidden /> SICAN {m.certificacion_sican}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {/* MOTIVOS DE ADJUDICACIÓN */}
      {motivos.length > 0 && (
        <div className="border-t border-line px-5 py-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Award size={12} className="text-heroViolet" aria-hidden />
            Por qué ganó cada postor ({motivos.length})
          </h3>
          <ul className="space-y-3">
            {motivos.map((m: any, i: number) => {
              const natural = esPersonaNatural(m.ganador_ruc);
              return (
                <li key={i} className="rounded-lg border border-line bg-paperSoft p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <strong className="text-sm font-bold text-ink">
                      {natural ? <PersonName name={m.ganador_razon_social} orden={ordenDe(m.ganador_razon_social)} /> : m.ganador_razon_social}
                    </strong>
                    {m.ganador_ruc && (
                      <span className="font-mono text-[10px] text-mute">
                        RUC <Ruc value={m.ganador_ruc} />
                      </span>
                    )}
                    {m.item_adjudicado && (
                      <span className="rounded-md bg-paperDeep px-1.5 py-0.5 text-[10px] text-heroViolet">
                        ítem {m.item_adjudicado}
                      </span>
                    )}
                    {m.posicion_ranking && (
                      <span className="ml-auto rounded-full bg-heroViolet-soft px-2 py-0.5 text-[10px] font-bold text-heroViolet">
                        puesto {m.posicion_ranking}
                      </span>
                    )}
                  </div>
                  {m.criterio_decisivo && (
                    <p className="mt-1.5 text-xs text-ink">
                      <strong>Criterio decisivo:</strong> <span className="italic">{m.criterio_decisivo}</span>
                    </p>
                  )}
                  {m.observaciones_evaluacion && (
                    <Evidencia value={m.observaciones_evaluacion} className="mt-1 text-xs leading-relaxed text-inkSoft" />
                  )}
                  {m.evidencia && normalizada(m.evidencia) && (
                    <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-inkSoft">
                      <div className="mb-0.5 text-[10px] font-medium text-mute">Lo que dice el acta</div>
                      <Evidencia value={m.evidencia} />
                    </div>
                  )}
                  {(m.competidores_descalificados || []).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-mute hover:text-ink">
                        Competidores descalificados ({m.competidores_descalificados.length})
                      </summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {m.competidores_descalificados.map((c: unknown, j: number) => (
                          <li key={j} className="text-[11px] text-mute">
                            {typeof c === "string" ? c : evidenciaComoTexto(c)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* CRUCE FIRMANTES vs GANADOR */}
      {cruces.length > 0 && (
        <div className={cn("border-t border-line px-5 py-5", conVinculo.length > 0 ? "bg-crimson-soft/60" : "bg-paperSoft")}>
          <h3 className={cn("flex items-center gap-1.5 text-[12px] font-semibold", conVinculo.length > 0 ? "text-crimsonTexto" : "text-ink")}>
            <ShieldAlert size={12} aria-hidden />
            Cruce entre firmantes y ganador
          </h3>
          <p className="mt-1 text-[12px] text-mute">
            Se buscaron vínculos entre quienes firmaron por la entidad y las personas del proveedor adjudicado.{" "}
            {conVinculo.length === 0
              ? `En los ${cruces.length} cruces revisados no apareció ningún vínculo.`
              : `${conVinculo.length} de ${cruces.length} cruces muestran un vínculo que conviene verificar${
                  sinVinculo > 0 ? `; los otros ${sinVinculo} no mostraron ninguno` : ""
                }.`}
          </p>
          <ul className="mt-3 space-y-2">
            {(conVinculo.length > 0 ? conVinculo : cruces).map((c: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <strong className="text-ink">
                    <PersonName name={c.firmante} />
                  </strong>
                  {c.cargo_firmante && <span className="text-mute">({c.cargo_firmante})</span>}
                  <span className="text-mute" aria-label="frente a">
                    y
                  </span>
                  <strong className="text-ink">
                    <PersonName name={c.persona_proveedor} orden={ordenDe(c.persona_proveedor)} />
                  </strong>
                </div>
                {c.tipo_relacion && !SIN_VINCULO.has(String(c.tipo_relacion).toLowerCase()) && (
                  <div className="mt-1">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", severidadColor(sevDe(c.severidad)))}>
                      {String(c.tipo_relacion).replace(/_/g, " ")}
                    </span>
                  </div>
                )}
                {c.descripcion && <Evidencia value={c.descripcion} className="mt-1 text-[11px] text-inkSoft" />}
                {c.evidencia && <Evidencia value={c.evidencia} className="mt-1 text-[11px] text-inkSoft" />}
                {typeof c.fuente_url === "string" && /^https?:\/\//.test(c.fuente_url) && (
                  <a
                    href={c.fuente_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline"
                  >
                    Fuente <ExternalLink size={9} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** ¿Hay al menos una cita legible en esta evidencia? */
function normalizada(e: unknown): boolean {
  return evidenciaComoTexto(e).trim().length > 0;
}
