"use client";

/**
 * «Quién es» el proveedor en un análisis anterior al expediente (antes del 2026-11-04), con el perfil que el agente web
 * copió del padrón: estado en la SUNAT, inicio de actividades, giro, dirección, gerente y socios. Las «señales
 * sugeridas» del agente ya no van aquí: están en «Lo que escribió el agente», al final de la pestaña.
 */

import Link from "next/link";
import { ArrowUpRight, Briefcase, Building2, MapPin, Users } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { numero, oracion } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { fechaDossier } from "../dossier";
import { condicionLegible, estadoLegible, rucEnRegla } from "./red/proveedor";

function Fila({ icono: Icono, titulo, children }: { icono: typeof Building2; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3">
      <Icono size={16} className="mt-0.5 shrink-0 text-mute" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-rotulo font-semibold uppercase tracking-wide text-mute">{titulo}</dt>
        <dd className="mt-1 text-dato leading-relaxed text-ink">{children}</dd>
      </div>
    </div>
  );
}

export function EmpresaAdjudicaCard({ empresa }: { empresa: any; banderasSugeridas?: any[] }) {
  // RUC 10 = persona natural con negocio: su "razón social" es su nombre en orden SUNAT (APELLIDO APELLIDO NOMBRE) y
  // el RUC lleva su DNI adentro (llega tapado).
  const natural = esPersonaNatural(empresa.ruc);
  const ruc20 = /^20\d{9}$/.test(String(empresa.ruc ?? ""));
  const actividades: string[] = Array.isArray(empresa.actividades_comerciales) ? empresa.actividades_comerciales.filter(Boolean) : [];
  const estado = [estadoLegible(empresa.estado), condicionLegible(empresa.condicion)].filter(Boolean).join(" y ");
  const enRegla = rucEnRegla(empresa.estado, empresa.condicion);
  const socios: any[] = empresa.socios || [];
  return (
    <section className="rounded-2xl border border-line bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-display text-bloque font-bold leading-tight text-ink">
            {natural ? <PersonName name={empresa.razon_social} orden="sunat" /> : empresa.razon_social}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-inkSoft">
            <Dato tipo="tipo">{natural ? "Persona natural con negocio" : empresa.tipo || "Empresa"}</Dato>
            {empresa.ruc && (
              <Dato tipo="ruc" mono>
                <Ruc value={empresa.ruc} />
              </Dato>
            )}
          </p>
        </div>
        {ruc20 && (
          <Link
            href={`/empresa/${empresa.ruc}`}
            prefetch={false}
            className="inline-flex min-h-8 items-center gap-1 text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
          >
            Ver su ficha completa <ArrowUpRight size={14} aria-hidden />
          </Link>
        )}
      </header>

      <dl className="divide-y divide-line px-5">
        <Fila icono={Building2} titulo="SUNAT">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {estado && (
              <span className={cn("pill font-semibold", enRegla ? "border-line bg-paperDeep text-ink" : "border-crimson/30 bg-crimson-soft text-crimsonTexto")}>
                RUC {estado}
              </span>
            )}
            {empresa.fecha_inicio_actividades && <span>inicio de actividades el {fechaDossier(empresa.fecha_inicio_actividades, true)}</span>}
            {empresa.edad_dias_al_contrato != null && (
              <span className={cn(Number(empresa.edad_dias_al_contrato) < 90 ? "font-semibold text-crimsonTexto" : "text-inkSoft")}>
                ({numero(Number(empresa.edad_dias_al_contrato))} días de inscrita al contratar)
              </span>
            )}
          </span>
          {empresa.ciiu && <span className="mt-1 block font-mono text-meta text-inkSoft">CIIU {empresa.ciiu}</span>}
        </Fila>

        {actividades.length > 0 && (
          <Fila icono={Briefcase} titulo="Giro">
            <ul className="space-y-0.5">
              {actividades.map((a, i) => (
                <li key={i}>{oracion(a)}</li>
              ))}
            </ul>
          </Fila>
        )}

        {empresa.direccion_legal && (
          <Fila icono={MapPin} titulo="Dirección legal">
            {empresa.direccion_legal}
          </Fila>
        )}

        {(empresa.gerente_general?.nombre || socios.length > 0) && (
          <Fila icono={Users} titulo="Quiénes están detrás">
            <ul className="space-y-1">
              {empresa.gerente_general?.nombre && (
                <li>
                  <span className="text-mute">Gerente general:</span>{" "}
                  {/* SUNAT publica al gerente como APELLIDO APELLIDO NOMBRE. */}
                  <strong className="font-semibold">
                    <PersonName name={empresa.gerente_general.nombre} orden="sunat" />
                  </strong>
                  {empresa.gerente_general.desde && <span className="text-mute">, desde el {fechaDossier(empresa.gerente_general.desde, true)}</span>}
                </li>
              )}
              {/* Sin el DNI de nadie: nunca se muestra (docs/PRIVACIDAD.md). */}
              {socios.map((s: any, i: number) => (
                <li key={i}>
                  <span className="text-mute">{s.cargo || "Socio"}:</span>{" "}
                  <strong className="font-semibold">
                    <PersonName name={s.nombre} />
                  </strong>
                  {s.participacion && <span className="text-mute">, {s.participacion}</span>}
                </li>
              ))}
            </ul>
          </Fila>
        )}
      </dl>
      <p className="px-5 pb-4 pt-1 text-rotulo text-mute">Fuente: el perfil del padrón de la SUNAT que leyó el agente en este análisis.</p>
    </section>
  );
}
