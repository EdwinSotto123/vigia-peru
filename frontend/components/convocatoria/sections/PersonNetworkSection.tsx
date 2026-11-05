"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, ExternalLink, Landmark, MapPin, Newspaper, UserRound, Users, Vote, Wallet } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { Nota } from "@/components/patrones";
import { PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import { fechaDossier, montoDossier } from "../dossier";
import { RedProveedor } from "./RedProveedor";
import { Pliegue } from "./red/Pliegue";
import { SenalesRed } from "./red/SenalesRed";
import { sinFaltaSunat } from "./red/proveedor";

/** "rep_legal_y_socio" → "rep legal y socio". */
const legible = (v: unknown) => String(v ?? "").replace(/_/g, " ").trim();
const CLASE_ENLACE = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/** Nombre de una empresa de la red: si es persona natural (RUC 10), en orden SUNAT y con vidrio; si es RUC 20, a su ficha. */
function RazonSocial({ ruc, nombre }: { ruc?: string | null; nombre?: string | null }) {
  if (!nombre) return ruc ? <span className="font-mono">RUC <Ruc value={ruc} /></span> : null;
  if (esPersonaNatural(ruc)) return <PersonName name={nombre} orden="sunat" />;
  if (ruc && /^20\d{9}$/.test(String(ruc))) {
    return (
      <Link href={`/empresa/${ruc}`} prefetch={false} className={CLASE_ENLACE}>
        {nombre}
      </Link>
    );
  }
  return <>{nombre}</>;
}

/** Un enlace a la fuente de un dato (JNE, ONPE, la nota de prensa): sólo URLs públicas. */
function Fuente({ url, children = "Fuente" }: { url?: string | null; children?: ReactNode }) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-rotulo ${CLASE_ENLACE}`}>
      {children} <ExternalLink size={11} aria-hidden />
    </a>
  );
}

/** Un grupo de datos de la persona o de las empresas: rótulo con ícono y la lista. */
function Grupo({ icono, titulo, children }: { icono: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-mute">
        <span aria-hidden>{icono}</span>
        {titulo}
      </h4>
      <ul className="mt-1.5 space-y-1.5">{children}</ul>
    </div>
  );
}

/**
 * El capítulo «Con quién está vinculado» de la pestaña del proveedor: primero lo que encontró la red (sus señales, la
 * más grave arriba, con su evidencia), después la red dibujada (`RedProveedor`) y, a pedido, cada persona y cada
 * empresa con su fuente. La síntesis que escribió el agente va al final de la pestaña («Lo que escribió el agente»).
 */
export function PersonNetworkSection({
  person,
  web,
  proveedor,
  ctx,
  sunatEnBase = false,
}: {
  person: any;
  web?: any;
  proveedor?: any;
  ctx?: any;
  /** Con el padrón SUNAT en la base, la señal «falta de información SUNAT» del agente es falsa y no se muestra. */
  sunatEnBase?: boolean;
}) {
  const p = person?.persona_principal || {};
  const red = person?.red_empresarial || {};
  const banderas = sinFaltaSunat((person?.banderas_red || []) as any[], sunatEnBase);

  const hasGerente = !!p.nombre_completo;
  const empresasMismaDir: any[] = red.empresas_misma_direccion || [];
  const empresasMismoTitular: any[] = red.empresas_mismo_titular || [];
  const cargosPasados: any[] = p.cargos_pasados || [];
  const otrosCargos: any[] = p.otros_cargos_actuales || [];
  const candidaturas: any[] = p.candidaturas || [];
  const aportes: any[] = p.aportes_campañas || p.aportes_campanas || [];
  const menciones: any[] = p.menciones_prensa || [];
  // Si la persona principal ES el proveedor persona natural, su nombre viene en el orden del RUC (APELLIDO APELLIDO
  // NOMBRE): se tapa la segunda palabra.
  const ordenPersona =
    esPersonaNatural(proveedor?.ruc) && String(p.nombre_completo || "").trim().toUpperCase() === String(proveedor?.nombre || "").trim().toUpperCase()
      ? "sunat"
      : "nombres-primero";
  const nDetalle = (hasGerente ? 1 : 0) + empresasMismoTitular.length + empresasMismaDir.length;

  return (
    <div className="space-y-4">
      {banderas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-cuerpo font-semibold text-ink">Lo que encontró la red ({banderas.length})</h3>
          <SenalesRed banderas={banderas} etiqueta="Señales en la red de personas del proveedor" />
        </div>
      )}

      <RedProveedor person={person} web={web} proveedor={proveedor} ctx={ctx} />

      {nDetalle > 0 && (
        <Pliegue
          titulo="Cada persona y cada empresa, con su fuente"
          cuenta={nDetalle}
          icono={<Users size={16} />}
          detalle="Su representante con sus cargos, candidaturas, aportes y notas de prensa; las empresas con el mismo titular o el mismo domicilio fiscal."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {/* LA PERSONA */}
            <article className="space-y-3 rounded-2xl border border-line bg-paper p-4">
              <header className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-paperDeep text-inkSoft" aria-hidden>
                  <UserRound size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-rotulo font-semibold uppercase tracking-wide text-mute">Su representante</p>
                  <h3 className="font-display text-bloque font-bold leading-tight text-ink">
                    {hasGerente ? <PersonName name={p.nombre_completo} orden={ordenPersona} /> : "No identificado"}
                  </h3>
                  {p.cargo_actual && <Dato tipo="cargo" className="mt-0.5 block text-meta text-inkSoft">{p.cargo_actual}</Dato>}
                  {(p.linkedin || p.datosperu_url) && (
                    <span className="mt-1 flex flex-wrap gap-x-3">
                      <Fuente url={p.linkedin}>LinkedIn</Fuente>
                      <Fuente url={p.datosperu_url}>DatosPerú</Fuente>
                    </span>
                  )}
                </div>
              </header>

              {!hasGerente && <Nota>No se identificó al gerente ni al representante legal en las búsquedas de este análisis.</Nota>}

              {otrosCargos.length > 0 && (
                <Grupo icono={<Building2 size={13} />} titulo="Otros cargos actuales">
                  {otrosCargos.map((c: any, i: number) => (
                    <li key={i} className="text-meta leading-snug text-ink">
                      <strong className="font-semibold">{c.cargo}</strong>
                      {c.empresa && <> en <RazonSocial ruc={c.ruc} nombre={c.empresa} /></>}
                    </li>
                  ))}
                </Grupo>
              )}

              {cargosPasados.length > 0 && (
                <Grupo icono={<Landmark size={13} />} titulo="Cargos públicos pasados">
                  {cargosPasados.map((c: any, i: number) => (
                    <li key={i} className="text-meta leading-snug">
                      <span className="font-semibold text-ink">{c.cargo}</span>
                      <span className="flex flex-wrap gap-x-3 text-inkSoft">
                        {c.institucion && <Dato tipo="entidad">{c.institucion}</Dato>}
                        {c.periodo && <Dato tipo="fecha" mono>{c.periodo}</Dato>}
                        <Fuente url={c.fuente_url} />
                      </span>
                    </li>
                  ))}
                </Grupo>
              )}

              {candidaturas.length > 0 && (
                <Grupo icono={<Vote size={13} />} titulo="Candidaturas (JNE)">
                  {candidaturas.map((c: any, i: number) => (
                    <li key={i} className="text-meta leading-snug">
                      <span className="font-semibold text-ink">
                        {c.cargo}
                        {c.año ? ` (${c.año})` : ""}
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-inkSoft">
                        {c.partido && <Dato tipo="partido">{c.partido}</Dato>}
                        {c.resultado && <span>{c.resultado}</span>}
                        <Fuente url={c.fuente_url} />
                      </span>
                    </li>
                  ))}
                </Grupo>
              )}

              {aportes.length > 0 && (
                <Grupo icono={<Wallet size={13} />} titulo="Aportes a campañas (ONPE)">
                  {aportes.map((a: any, i: number) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-meta leading-snug text-ink">
                      {a.partido && <Dato tipo="partido">{a.partido}</Dato>}
                      {a.año && <span className="font-mono tabular-nums text-inkSoft">{a.año}</span>}
                      {a.monto != null && <span className="font-mono font-semibold tabular-nums">{montoDossier(a.monto)}</span>}
                      <Fuente url={a.fuente_url} />
                    </li>
                  ))}
                </Grupo>
              )}

              {menciones.length > 0 && (
                <Grupo icono={<Newspaper size={13} />} titulo="Menciones en prensa">
                  {menciones.map((m: any, i: number) => (
                    <li key={i} className="text-meta leading-snug">
                      <Fuente url={m.url}>
                        {m.medio || "Nota de prensa"}
                        {m.fecha ? `, ${fechaDossier(m.fecha, true)}` : ""}
                      </Fuente>
                      {m.titulo && <span className="block text-inkSoft">{redactDnis(m.titulo)}</span>}
                    </li>
                  ))}
                </Grupo>
              )}
            </article>

            {/* LAS EMPRESAS */}
            <article className="space-y-3 rounded-2xl border border-line bg-paper p-4">
              <header className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-paperDeep text-inkSoft" aria-hidden>
                  <Building2 size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-rotulo font-semibold uppercase tracking-wide text-mute">Sus otras empresas</p>
                  <h3 className="font-display text-bloque font-bold leading-tight text-ink">Empresas vinculadas</h3>
                  {red.observaciones && <p className="mt-0.5 text-meta text-inkSoft">{redactDnis(red.observaciones)}</p>}
                </div>
              </header>

              {empresasMismoTitular.length > 0 ? (
                <Grupo icono={<Users size={13} />} titulo={`Con el mismo titular (${empresasMismoTitular.length})`}>
                  {empresasMismoTitular.map((e: any, i: number) => (
                    <li key={i} className="text-meta leading-snug">
                      <span className="font-semibold text-ink">
                        <RazonSocial ruc={e.ruc} nombre={e.razon_social} />
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-inkSoft">
                        {e.ruc && e.razon_social && (
                          <Dato tipo="ruc" mono>
                            <Ruc value={e.ruc} />
                          </Dato>
                        )}
                        {e.rol_del_gerente && <Dato tipo="cargo">{legible(e.rol_del_gerente)}</Dato>}
                      </span>
                    </li>
                  ))}
                </Grupo>
              ) : (
                <p className="text-meta text-mute">Sin otras empresas con el mismo titular.</p>
              )}

              {empresasMismaDir.length > 0 ? (
                <Grupo icono={<MapPin size={13} />} titulo={`Con el mismo domicilio fiscal (${empresasMismaDir.length})`}>
                  {empresasMismaDir.map((e: any, i: number) => (
                    <li key={i} className="rounded-xl border border-crimson/30 bg-crimson-soft/40 px-3 py-2 text-meta leading-snug">
                      <span className="font-semibold text-ink">
                        <RazonSocial ruc={e.ruc} nombre={e.razon_social} />
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-inkSoft">
                        {e.ruc && e.razon_social && (
                          <Dato tipo="ruc" mono>
                            <Ruc value={e.ruc} />
                          </Dato>
                        )}
                        {e.direccion && <Dato tipo="lugar">{e.direccion}</Dato>}
                      </span>
                      {e.observacion && <span className="mt-0.5 block text-crimsonTexto">{redactDnis(e.observacion)}</span>}
                    </li>
                  ))}
                </Grupo>
              ) : (
                <p className="text-meta text-mute">Sin otras empresas en el mismo domicilio fiscal.</p>
              )}
            </article>
          </div>
        </Pliegue>
      )}
    </div>
  );
}
