"use client";

import { ExternalLink, Network, ShieldAlert, Users } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Dni, PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import { fechaDossier, montoDossier, severidadDe } from "../dossier";
import { Evidencia } from "./Evidencia";
import { RelationshipGraph } from "./RelationshipGraph";

/** "rep_legal_y_socio" → "rep legal y socio". */
const legible = (v: unknown) => String(v ?? "").replace(/_/g, " ").trim();

/** Nombre de una empresa de la red: si es persona natural (RUC 10), en orden SUNAT y con vidrio. */
function RazonSocial({ ruc, nombre }: { ruc?: string | null; nombre?: string | null }) {
  if (!nombre) return null;
  return esPersonaNatural(ruc) ? <PersonName name={nombre} orden="sunat" /> : <>{nombre}</>;
}

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
  // Si la persona principal ES el proveedor persona natural, su nombre viene
  // en el orden del RUC (APELLIDO APELLIDO NOMBRE): se tapa la segunda palabra.
  const ordenPersona =
    esPersonaNatural(proveedor?.ruc) &&
    String(p.nombre_completo || "").trim().toUpperCase() === String(proveedor?.nombre || "").trim().toUpperCase()
      ? "sunat"
      : "nombres-primero";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">
          Personas clave y red empresarial
        </h2>
        <p className="mt-0.5 text-[12px] text-mute">
          Quién está detrás del proveedor y con qué otras empresas se conecta
        </p>
        {sintesis && (
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">{redactDnis(sintesis)}</p>
        )}
      </div>

      <RelationshipGraph person={person} web={web} proveedor={proveedor} ctx={ctx} />

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* PERSONA PRINCIPAL */}
        <article className="space-y-3 rounded-xl border border-line bg-paperSoft p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-paperDeep text-inkSoft" aria-hidden>
              <Users size={18} />
            </div>
            <div>
              <div className="text-[12px] font-semibold text-ink">
                Persona principal
              </div>
              <h3 className="font-display text-base font-bold text-ink">
                {hasGerente ? <PersonName name={p.nombre_completo} orden={ordenPersona} /> : "Gerente no identificado"}
              </h3>
              {p.cargo_actual && (
                <p className="text-xs text-inkSoft">{p.cargo_actual}</p>
              )}
            </div>
          </div>

          {!hasGerente && (
            <p className="rounded-md bg-amber-soft px-3 py-2 text-[11px] text-amberTexto">
              {p.sintesis_personal
                ? redactDnis(p.sintesis_personal)
                : "No se pudo identificar al gerente ni al representante legal en las búsquedas realizadas."}
            </p>
          )}

          {p.sintesis_personal && hasGerente && (
            <p className="text-xs leading-relaxed text-inkSoft">{redactDnis(p.sintesis_personal)}</p>
          )}

          {/* Identificadores */}
          {(p.dni || p.linkedin || p.datosperu_url) && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {p.dni && (
                <span className="rounded-md bg-paperDeep px-2 py-0.5 font-mono text-mute">DNI <Dni value={p.dni} /></span>
              )}
              {p.linkedin && (
                <a href={p.linkedin} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-granate hover:underline">
                  LinkedIn <ExternalLink size={9} />
                </a>
              )}
              {p.datosperu_url && (
                <a href={p.datosperu_url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 rounded-md bg-paperDeep px-2 py-0.5 text-granate hover:underline">
                  DatosPerú <ExternalLink size={9} />
                </a>
              )}
            </div>
          )}

          {/* Otros cargos actuales */}
          {otrosCargos.length > 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-inkSoft">
                Otros cargos actuales
              </h4>
              <ul className="mt-1 space-y-1">
                {otrosCargos.map((c: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink">
                    <strong>{c.cargo}</strong>
                    {c.empresa && <span>en <RazonSocial ruc={c.ruc} nombre={c.empresa} /></span>}
                    {c.ruc && <span className="font-mono text-[11px] text-mute">RUC <Ruc value={c.ruc} /></span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cargos pasados */}
          {cargosPasados.length > 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-inkSoft">
                Cargos pasados (públicos)
              </h4>
              <ul className="mt-1 space-y-1.5">
                {cargosPasados.map((c: any, i: number) => (
                  <li key={i} className="rounded-md bg-paperDeep px-2 py-1.5 text-xs">
                    <div className="font-semibold text-ink">{c.cargo}</div>
                    <div className="flex flex-wrap gap-x-2 text-mute">
                      {c.institucion && <span>{c.institucion}</span>}
                      {c.periodo && <span>{c.periodo}</span>}
                    </div>
                    {c.fuente_url && (
                      <a href={c.fuente_url} target="_blank" rel="noreferrer"
                         className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-granate hover:underline">
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
              <h4 className="text-[12px] font-semibold text-rust">
                Candidaturas políticas
              </h4>
              <ul className="mt-1 space-y-1.5">
                {candidaturas.map((c: any, i: number) => (
                  <li key={i} className="rounded-md border border-crimson-soft bg-paper px-2 py-1.5 text-xs">
                    <div className="font-semibold text-ink">
                      {c.cargo}{c.año ? ` (${c.año})` : ""}
                    </div>
                    <div className="flex flex-wrap gap-x-2 text-mute">
                      {c.partido && <span>{c.partido}</span>}
                      {c.resultado && <span>{c.resultado}</span>}
                    </div>
                    {c.fuente_url && (
                      <a href={c.fuente_url} target="_blank" rel="noreferrer"
                         className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-granate hover:underline">
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
              <h4 className="text-[12px] font-semibold text-rust">
                Aportes a campañas (ONPE)
              </h4>
              <ul className="mt-1 space-y-1">
                {aportes.map((a: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink">
                    {a.año && <strong>{a.año}</strong>}
                    {a.partido && <span>{a.partido}</span>}
                    {a.monto != null && <span className="font-mono tabular-nums">{montoDossier(a.monto)}</span>}
                    {a.fuente_url && (
                      <a href={a.fuente_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 text-[11px] text-granate hover:underline">
                        Fuente <ExternalLink size={9} />
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
              <h4 className="text-[12px] font-semibold text-inkSoft">
                Menciones en prensa
              </h4>
              <ul className="mt-1 space-y-1">
                {menciones.map((m: any, i: number) => (
                  <li key={i} className="text-xs text-ink">
                    <a href={m.url} target="_blank" rel="noreferrer"
                       className="text-granate hover:underline">
                      {m.medio}{m.fecha ? `, ${fechaDossier(m.fecha, true)}` : ""}
                    </a>
                    {m.titulo && <div className="text-mute">{redactDnis(m.titulo)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        {/* RED EMPRESARIAL */}
        <article className="space-y-3 rounded-xl border border-line bg-paperSoft p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-paperDeep text-inkSoft" aria-hidden>
              <Network size={18} />
            </div>
            <div>
              <div className="text-[12px] font-semibold text-ink">
                Red empresarial
              </div>
              <h3 className="font-display text-base font-bold text-ink">
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
              <h4 className="text-[12px] font-semibold text-inkSoft">
                Mismo titular ({empresasMismoTitular.length})
              </h4>
              <ul className="mt-1 space-y-1.5">
                {empresasMismoTitular.map((e: any, i: number) => (
                  <li key={i} className="rounded-md bg-paperDeep px-2 py-1.5">
                    <div className="flex items-baseline gap-2">
                      {e.ruc && <span className="font-mono text-[11px] text-mute">RUC <Ruc value={e.ruc} /></span>}
                      {e.rol_del_gerente && (
                        <span className="rounded-full bg-amber-soft px-1.5 py-0.5 text-[11px] text-amberTexto">
                          {legible(e.rol_del_gerente)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-ink"><RazonSocial ruc={e.ruc} nombre={e.razon_social} /></div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-mute">No se detectaron empresas con el mismo titular.</p>
          )}

          {/* Empresas misma dirección */}
          {empresasMismaDir.length > 0 ? (
            <div>
              <h4 className="text-[12px] font-semibold text-rust">
                Mismo domicilio fiscal ({empresasMismaDir.length})
              </h4>
              <ul className="mt-1 space-y-1.5">
                {empresasMismaDir.map((e: any, i: number) => (
                  <li key={i} className="rounded-md border border-crimson-soft bg-paper px-2 py-1.5">
                    <div className="flex items-baseline gap-2">
                      {e.ruc && <span className="font-mono text-[11px] text-mute">RUC <Ruc value={e.ruc} /></span>}
                    </div>
                    <div className="text-xs font-semibold text-ink"><RazonSocial ruc={e.ruc} nombre={e.razon_social} /></div>
                    {e.direccion && <div className="text-[11px] text-mute">{e.direccion}</div>}
                    {e.observacion && <div className="mt-0.5 text-[11px] italic text-rust">{redactDnis(e.observacion)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-mute">No se detectaron empresas en el mismo domicilio fiscal.</p>
          )}
        </article>
      </div>

      {/* BANDERAS DE RED */}
      {banderas.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-4">
          <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <ShieldAlert size={13} className="text-mute" aria-hidden />
            Señales en la red de personas ({banderas.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {banderas.map((b: any, i: number) => (
              <li key={i} className="rounded-xl border border-line bg-paper px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Severidad bandera={severidadDe(b)} />
                  <strong className="text-sm text-ink">{redactDnis(b.titulo)}</strong>
                </div>
                <p className="mt-1 text-xs text-inkSoft">{redactDnis(b.descripcion)}</p>
                {b.evidencia && <Evidencia value={b.evidencia} className="mt-1.5 text-[11px] text-inkSoft" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
