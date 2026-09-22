"use client";

import { Award, Calendar, ExternalLink, MapPin, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dni, PersonName, redactDnis } from "../../Redact";

export function FirmantesYAdjudicacionSection({
  firmantes,
  comite,
  motivos,
  lugarFecha,
  cruceFirmantes,
}: {
  firmantes: any[];
  comite: any[];
  motivos: any[];
  lugarFecha?: { lugar?: string; fecha?: string; hora?: string } | null;
  cruceFirmantes?: any[];
}) {
  const rolBadge = (r: string) => {
    const s = (r || "").toLowerCase();
    if (s.includes("aprob")) return "bg-amber-soft text-amberTexto";
    if (s.includes("presid") || s.includes("comite")) return "bg-heroViolet-soft text-heroViolet";
    if (s.includes("represent")) return "bg-crimson-soft text-rust";
    if (s.includes("evalu")) return "bg-paperDeep text-inkSoft";
    return "bg-paperDeep text-mute";
  };
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
          <Users size={11} className="mr-1 inline" />
          Quién firmó · Por qué ganó · Comité evaluador
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Firmantes y motivos de adjudicación
        </h2>
        {lugarFecha?.lugar && (
          <p className="mt-1 text-xs text-mute">
            <MapPin size={10} className="mr-1 inline" />
            {lugarFecha.lugar}
            {lugarFecha.fecha && <span className="ml-2"><Calendar size={10} className="mr-1 inline" />{lugarFecha.fecha}</span>}
            {lugarFecha.hora && <span className="ml-2">· {lugarFecha.hora}</span>}
          </p>
        )}
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* FIRMANTES */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            Firmantes del documento ({firmantes.length})
          </h3>
          {firmantes.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se identificaron firmantes en los PDFs procesados.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {firmantes.map((f: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <strong className="text-sm text-ink"><PersonName name={f.nombre_completo} /></strong>
                    {f.rol_en_documento && (
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                        rolBadge(f.rol_en_documento),
                      )}>
                        {String(f.rol_en_documento).replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {f.cargo && (
                    <div className="mt-0.5 text-[11px] text-inkSoft">{f.cargo}</div>
                  )}
                  {f.entidad && (
                    <div className="text-[10px] text-mute">{f.entidad}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-mute">
                    {f.dni && <span className="font-mono">DNI <Dni value={f.dni} /></span>}
                    {f.fecha_firma && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={9} /> {f.fecha_firma}
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
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            Comité de selección ({comite.length})
          </h3>
          {comite.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se detalla composición del comité (común en contrataciones directas).
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {comite.map((m: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <strong className="text-sm text-ink"><PersonName name={m.nombre_completo} /></strong>
                    {m.rol && (
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                        rolBadge(m.rol),
                      )}>
                        {String(m.rol).replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {m.cargo && <div className="mt-0.5 text-[11px] text-inkSoft">{m.cargo}</div>}
                  {m.certificacion_sican && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-[10px] text-heroViolet">
                      <Award size={9} /> SICAN {m.certificacion_sican}
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
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet mb-3">
            <Award size={11} className="mr-1 inline" />
            Por qué ganó cada postor ({motivos.length})
          </h3>
          <ul className="space-y-3">
            {motivos.map((m: any, i: number) => (
              <li key={i} className="rounded-lg border border-line bg-paperSoft p-3">
                <div className="flex items-baseline gap-2">
                  <strong className="text-sm font-bold text-ink">{m.ganador_razon_social}</strong>
                  {m.ganador_ruc && (
                    <span className="font-mono text-[10px] text-mute">RUC {m.ganador_ruc}</span>
                  )}
                  {m.item_adjudicado && (
                    <span className="rounded-md bg-paperDeep px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-heroViolet">
                      ítem {m.item_adjudicado}
                    </span>
                  )}
                  {m.posicion_ranking && (
                    <span className="ml-auto rounded-full bg-heroViolet-soft px-2 py-0.5 text-[10px] font-bold text-heroViolet">
                      #{m.posicion_ranking}
                    </span>
                  )}
                </div>
                {m.criterio_decisivo && (
                  <p className="mt-1.5 text-xs text-ink">
                    <strong>Criterio decisivo:</strong>{" "}
                    <span className="italic">{m.criterio_decisivo}</span>
                  </p>
                )}
                {m.observaciones_evaluacion && (
                  <p className="mt-1 text-xs leading-relaxed text-inkSoft">
                    {redactDnis(m.observaciones_evaluacion)}
                  </p>
                )}
                {(m.competidores_descalificados || []).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-mute hover:text-ink">
                      Competidores descalificados ({m.competidores_descalificados.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {m.competidores_descalificados.map((c: string, j: number) => (
                        <li key={j} className="text-[11px] text-mute">— {c}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CRUCE FIRMANTES vs GANADOR — banderas críticas */}
      {(cruceFirmantes || []).length > 0 && (
        <div className="border-t border-line bg-crimson-soft px-5 py-5">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">
            <ShieldAlert size={11} className="mr-1 inline" />
            Cruce firmantes ↔ ganador ({cruceFirmantes!.length})
          </h3>
          <p className="mt-1 text-[11px] text-mute">
            Coincidencias entre quienes firmaron por la entidad y personas vinculadas al proveedor adjudicado.
          </p>
          <ul className="mt-3 space-y-2">
            {cruceFirmantes!.map((c: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2">
                <div className="flex items-baseline gap-2 text-xs">
                  <strong className="text-ink">{c.firmante}</strong>
                  <span className="text-mute">({c.cargo_firmante})</span>
                  <span className="text-rust">↔</span>
                  <strong className="text-ink">{c.persona_proveedor}</strong>
                </div>
                {c.tipo_relacion && c.tipo_relacion !== "sin_relacion" && (
                  <div className="mt-1">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                      c.severidad === "alta"  ? "bg-rust text-paper" :
                      c.severidad === "media" ? "bg-amber text-paper" :
                                                "bg-paperDeep text-mute",
                    )}>
                      {String(c.tipo_relacion).replace(/_/g, " ")}
                    </span>
                  </div>
                )}
                {c.evidencia && (
                  <p className="mt-1 text-[11px] text-inkSoft">{redactDnis(c.evidencia)}</p>
                )}
                {c.fuente_url && (
                  <a href={c.fuente_url} target="_blank" rel="noreferrer"
                     className="mt-1 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                    Fuente <ExternalLink size={9} />
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
