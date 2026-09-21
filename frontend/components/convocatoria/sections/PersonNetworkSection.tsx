"use client";

import { ExternalLink, Network, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dni, PersonName, redactDnis } from "../../Redact";
import { RelationshipGraph } from "./RelationshipGraph";

export function PersonNetworkSection({ person, web, proveedor, ctx }: { person: any; web?: any; proveedor?: any; ctx?: any }) {
  const p = person?.persona_principal || {};
  const red = person?.red_empresarial || {};
  const banderas = person?.banderas_red || [];
  const sintesis = person?.sintesis || "";

  const hasGerente = !!p.nombre_completo;
  const empresasMismaDir = red.empresas_misma_direccion || [];
  const empresasMismoTitular = red.empresas_mismo_titular || [];
  const cargosPasados = p.cargos_pasados || [];
  const otrosCargos = p.otros_cargos_actuales || [];
  const candidaturas = p.candidaturas || [];
  const aportes = p.aportes_campañas || p.aportes_campanas || [];
  const menciones = p.menciones_prensa || [];

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
          <Network size={11} className="mr-1 inline" />
          person_network_agent · gerente + red empresarial
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Personas clave y red empresarial
        </h2>
        {sintesis && (
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">{redactDnis(sintesis)}</p>
        )}
      </div>

      <RelationshipGraph person={person} web={web} proveedor={proveedor} ctx={ctx} />

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* PERSONA PRINCIPAL */}
        <article className="space-y-3 rounded-md border border-line bg-paperSoft p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-heroViolet text-paper">
              <Users size={18} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
                Persona principal
              </div>
              <h3 className="font-serif text-base font-bold text-ink">
                {hasGerente ? <PersonName name={p.nombre_completo} /> : "Gerente no identificado"}
              </h3>
              {p.cargo_actual && (
                <p className="text-xs text-inkSoft">{p.cargo_actual}</p>
              )}
            </div>
          </div>

          {!hasGerente && (
            <p className="rounded-md bg-amber-soft px-3 py-2 text-[11px] text-amber">
              {p.sintesis_personal || "El agente no pudo identificar al gerente / representante legal en las búsquedas realizadas."}
            </p>
          )}

          {p.sintesis_personal && hasGerente && (
            <p className="text-xs leading-relaxed text-inkSoft">{redactDnis(p.sintesis_personal)}</p>
          )}

          {/* Identificadores */}
          {(p.dni || p.linkedin || p.datosperu_url) && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {p.dni && (
                <span className="rounded-md bg-paperDeep px-2 py-0.5 font-mono text-mute">DNI <Dni value={p.dni} /></span>
              )}
              {p.linkedin && (
                <a href={p.linkedin} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-heroViolet hover:underline">
                  LinkedIn <ExternalLink size={9} />
                </a>
              )}
              {p.datosperu_url && (
                <a href={p.datosperu_url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-heroViolet hover:underline">
                  DatosPerú <ExternalLink size={9} />
                </a>
              )}
            </div>
          )}

          {/* Otros cargos actuales */}
          {otrosCargos.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Otros cargos actuales
              </h4>
              <ul className="mt-1 space-y-1">
                {otrosCargos.map((c: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <strong>{c.cargo}</strong> · {c.empresa}
                    {c.ruc && <span className="ml-1 font-mono text-[10px] text-mute">RUC {c.ruc}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cargos pasados */}
          {cargosPasados.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Cargos pasados (públicos)
              </h4>
              <ul className="mt-1 space-y-1.5">
                {cargosPasados.map((c: any, i: number) => (
                  <li key={i} className="rounded-md bg-paperDeep px-2 py-1.5 text-xs">
                    <div className="font-semibold text-ink">{c.cargo}</div>
                    <div className="text-mute">
                      {c.institucion}
                      {c.periodo && <span className="ml-1">· {c.periodo}</span>}
                    </div>
                    {c.fuente_url && (
                      <a href={c.fuente_url} target="_blank" rel="noreferrer"
                         className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                        Fuente <ExternalLink size={9} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Candidaturas */}
          {candidaturas.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rust">
                Candidaturas políticas
              </h4>
              <ul className="mt-1 space-y-1.5">
                {candidaturas.map((c: any, i: number) => (
                  <li key={i} className="rounded-md border border-crimson-soft bg-paper px-2 py-1.5 text-xs">
                    <div className="font-semibold text-ink">{c.año} — {c.cargo}</div>
                    <div className="text-mute">{c.partido} · {c.resultado || "—"}</div>
                    {c.fuente_url && (
                      <a href={c.fuente_url} target="_blank" rel="noreferrer"
                         className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                        Fuente <ExternalLink size={9} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Aportes ONPE */}
          {aportes.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rust">
                Aportes a campañas (ONPE)
              </h4>
              <ul className="mt-1 space-y-1">
                {aportes.map((a: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <strong>{a.año}</strong> · {a.partido} · <span className="font-mono">S/. {a.monto}</span>
                    {a.fuente_url && (
                      <a href={a.fuente_url} target="_blank" rel="noreferrer"
                         className="ml-2 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Menciones prensa */}
          {menciones.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Menciones en prensa
              </h4>
              <ul className="mt-1 space-y-1">
                {menciones.map((m: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <a href={m.url} target="_blank" rel="noreferrer"
                       className="text-heroViolet hover:underline">
                      {m.medio} {m.fecha && `· ${m.fecha}`}
                    </a>
                    {m.titulo && <span className="ml-1 text-mute">— {m.titulo}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        {/* RED EMPRESARIAL */}
        <article className="space-y-3 rounded-md border border-line bg-paperSoft p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-heroGreen text-paper">
              <Network size={18} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
                Red empresarial
              </div>
              <h3 className="font-serif text-base font-bold text-ink">
                Empresas vinculadas
              </h3>
              {red.observaciones && (
                <p className="mt-0.5 text-[11px] text-inkSoft">{redactDnis(red.observaciones)}</p>
              )}
            </div>
          </div>

          {/* Empresas mismo titular */}
          {empresasMismoTitular.length > 0 ? (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                Mismo titular ({empresasMismoTitular.length})
              </h4>
              <ul className="mt-1 space-y-1.5">
                {empresasMismoTitular.map((e: any, i: number) => (
                  <li key={i} className="rounded-md bg-paperDeep px-2 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-mute">RUC {e.ruc}</span>
                      {e.rol_del_gerente && (
                        <span className="rounded-full bg-amber-soft px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber">
                          {e.rol_del_gerente}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-ink">{e.razon_social}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-mute">— Sin empresas con mismo titular detectadas.</p>
          )}

          {/* Empresas misma dirección */}
          {empresasMismaDir.length > 0 ? (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rust">
                Mismo domicilio fiscal ({empresasMismaDir.length})
              </h4>
              <ul className="mt-1 space-y-1.5">
                {empresasMismaDir.map((e: any, i: number) => (
                  <li key={i} className="rounded-md border border-crimson-soft bg-paper px-2 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-mute">RUC {e.ruc}</span>
                    </div>
                    <div className="text-xs font-semibold text-ink">{e.razon_social}</div>
                    {e.direccion && <div className="text-[10px] text-mute">📍 {e.direccion}</div>}
                    {e.observacion && <div className="mt-0.5 text-[10px] italic text-rust">{redactDnis(e.observacion)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-mute">— Sin empresas en el mismo domicilio detectadas.</p>
          )}
        </article>
      </div>

      {/* BANDERAS DE RED */}
      {banderas.length > 0 && (
        <div className="border-t border-line bg-crimson-soft px-5 py-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">
            <ShieldAlert size={11} className="mr-1 inline" />
            Banderas detectadas en la red ({banderas.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {banderas.map((b: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                    b.severidad === "alta"  ? "bg-rust text-paper" :
                    b.severidad === "media" ? "bg-amber text-paper" :
                                              "bg-paperDeep text-mute",
                  )}>● {b.severidad || "media"}</span>
                  <strong className="text-sm text-ink">{b.titulo}</strong>
                </div>
                <p className="mt-1 text-xs text-inkSoft">{redactDnis(b.descripcion)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
