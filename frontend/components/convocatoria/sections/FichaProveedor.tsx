"use client";

/**
 * La ficha del proveedor en el dictamen, con lo que dicen los registros (plan 2026-11-04): padrón SUNAT, RNP, sanciones y
 * penalidades del OECE, buenas pro del CONOSCE y las banderas de Vigía. Sale de `expediente_proveedor`: lo arma el agente
 * desde la base o, en un análisis anterior, la API con la ficha de /empresa/<RUC>. Arriba las cifras, después los datos,
 * después lo que el agente encontró en la web (lo que no está en un registro), plegado.
 */

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Building2, CalendarDays, FileWarning, Gavel, Users } from "lucide-react";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { chipCruce } from "@/lib/cruces";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import { fechaDossier, montoDossier } from "../dossier";

const ROL: Record<string, string> = {
  REPRESENTANTE_LEGAL: "Representante legal",
  SOCIO_ACCIONISTA_TITULAR: "Socio",
  ORGANO_ADMINISTRACION: "Órgano de administración",
};
const SEV_PUNTO: Record<string, string> = { alta: "bg-crimson", media: "bg-amber", baja: "bg-mute" };
const SEV_ORDEN = ["alta", "media", "baja"];

function Fila({ icono: Icono, titulo, children }: { icono: typeof Building2; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <Icono size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-micro font-semibold uppercase tracking-wide text-mute">{titulo}</dt>
        <dd className="mt-0.5 text-rotulo leading-5 text-ink">{children}</dd>
      </div>
    </div>
  );
}

export function FichaProveedor({ exp, nombre, sugeridas = [] }: { exp: any; nombre?: string | null; sugeridas?: any[] }) {
  // Un consorcio (en el OCDS figura con su código del SEACE, sin RUC): una ficha por integrante.
  if (exp?.consorcio && Array.isArray(exp.integrantes)) {
    return (
      <section className="space-y-3">
        <header className="rounded-2xl border border-line bg-paper px-5 py-4">
          <h2 className="font-display text-seccion font-bold text-ink">{exp.nombre || nombre || "Consorcio"}</h2>
          <p className="mt-0.5 text-rotulo text-mute">
            Consorcio que ganó el contrato, con {exp.integrantes.length} {exp.integrantes.length === 1 ? "integrante" : "integrantes"}.
            Abajo, lo que dicen los registros de cada uno.
          </p>
        </header>
        {exp.integrantes.map((e: any, i: number) => (
          <FichaProveedor key={e?.ruc ?? i} exp={e} nombre={e?.nombre} sugeridas={i === 0 ? sugeridas : []} />
        ))}
      </section>
    );
  }
  const ruc: string = exp?.ruc ?? "";
  const natural = esPersonaNatural(ruc);
  const s = exp?.sunat ?? null;
  const h = exp?.historial ?? {};
  const misma = h.con_esta_entidad ?? null;
  const pen = exp?.penalidades ?? null;
  const sanc: any[] = exp?.sanciones ?? [];
  const rnp: any[] = exp?.rnp ?? [];
  const rnpResumen = exp?.rnp_resumen ?? null;
  const razon = s?.razon_social || nombre || "";
  const edadAnios = typeof s?.edad_dias_al_contratar === "number" ? Math.floor(s.edad_dias_al_contratar / 365) : null;

  // Banderas por tipo, con sus severidades juntas (el expediente trae una fila por tipo y severidad).
  const porTipo = new Map<string, Record<string, number>>();
  for (const b of (exp?.banderas ?? []) as any[]) {
    const t = porTipo.get(b.tipo) ?? {};
    t[b.severidad] = (t[b.severidad] ?? 0) + Number(b.n ?? 0);
    porTipo.set(b.tipo, t);
  }
  const banderas = Array.from(porTipo.entries()).sort((a, b) => (b[1].alta ?? 0) - (a[1].alta ?? 0) || sum(b[1]) - sum(a[1]));
  // Lo que la web no aporta cuando ya está el padrón: «no se pudo obtener SUNAT» y parecidos.
  const web = sugeridas.filter((b) => !(s && /sunat/i.test(`${b?.titulo ?? ""} ${b?.descripcion ?? ""}`)));

  const cifras = [
    { valor: h.procesos != null ? numero(h.procesos) : null, etiqueta: "buenas pro en el Estado",
      contexto: h.primera ? `desde ${fechaDossier(h.primera, true)}${h.en_consorcio ? `, ${h.en_consorcio} en consorcio` : ""}` : undefined },
    { valor: h.monto != null ? montoDossier(h.monto) : null, etiqueta: "adjudicado en total",
      contexto: h.entidades != null ? `en ${h.entidades} ${h.entidades === 1 ? "entidad" : "entidades"}` : undefined },
    { valor: misma?.procesos != null ? numero(misma.procesos) : null, etiqueta: "con esta entidad",
      contexto: misma?.procesos ? montoDossier(misma.monto) : "ninguna antes", tono: misma?.procesos >= 5 ? ("media" as const) : ("neutro" as const) },
    { valor: banderas.length ? String(banderas.length) : "0", etiqueta: "tipos de bandera de Vigía",
      contexto: banderas.some(([, v]) => v.alta) ? "con alguna alta" : "ninguna alta",
      tono: banderas.some(([, v]) => v.alta) ? ("alta" as const) : ("neutro" as const) },
  ];

  return (
    <section className="rounded-2xl border border-line bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-seccion font-bold text-ink">
            {natural ? <PersonName name={razon} orden="sunat" /> : razon}
          </h2>
          <p className="mt-0.5 text-rotulo text-mute">
            {natural ? "Persona natural con negocio que ganó el contrato" : "Empresa que ganó el contrato"}
            {ruc && <> con RUC <span className="font-mono"><Ruc value={ruc} /></span></>}, según los registros públicos
          </p>
        </div>
        {!natural && /^20\d{9}$/.test(ruc) && (
          <Link href={`/empresa/${ruc}`} className="inline-flex items-center gap-1 text-rotulo font-medium text-granate hover:underline">
            Ver su ficha completa <ArrowUpRight size={13} aria-hidden />
          </Link>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        <CifrasEnFila items={cifras} chico />

        <dl className="divide-y divide-line">
          <Fila icono={Building2} titulo="SUNAT">
            {s ? (
              <>
                {[s.estado, s.condicion].filter(Boolean).join(", ") || "Sin estado"}
                {s.fecha_inicio_actividades && <>; inicio de actividades el {fechaDossier(s.fecha_inicio_actividades, true)}</>}
                {edadAnios != null && <> ({edadAnios >= 1 ? `${edadAnios} ${edadAnios === 1 ? "año" : "años"}` : `${s.edad_dias_al_contratar} días`} al contratar)</>}
                {s.actividad && <span className="block text-inkSoft">{String(s.actividad).trim().replace(/\.$/, "")}</span>}
                {s.inhabilitada && <span className="mt-1 block font-semibold text-crimsonTexto">Inhabilitada: {s.inhabilitada}{s.inhabilitada_hasta ? ` hasta ${fechaDossier(s.inhabilitada_hasta, true)}` : ""}</span>}
              </>
            ) : natural ? (
              "Persona natural con negocio: no está en el padrón de empresas de Vigía."
            ) : (
              "Sin datos en el padrón."
            )}
          </Fila>

          {(rnp.length > 0 || rnpResumen) && (
            <Fila icono={Users} titulo="Quiénes están detrás (RNP)">
              {rnp.length > 0 ? (
                <ul className="space-y-0.5">
                  {rnp.slice(0, 8).map((r, i) => (
                    <li key={i}>
                      <span className="text-mute">{ROL[r.rol] ?? String(r.rol ?? "").replace(/_/g, " ").toLowerCase()}:</span>{" "}
                      {redactDnis(r.nombre)}{r.desde && <span className="text-mute">, desde {fechaDossier(r.desde, true)}</span>}
                    </li>
                  ))}
                  {rnp.length > 8 && <li className="text-mute">y {rnp.length - 8} más en su ficha</li>}
                </ul>
              ) : (
                <>
                  {rnpResumen.socios ?? 0} {rnpResumen.socios === 1 ? "socio" : "socios"}, {rnpResumen.representantes ?? 0}{" "}
                  {rnpResumen.representantes === 1 ? "representante" : "representantes"} y {rnpResumen.directivos ?? 0} en el directorio.
                </>
              )}
            </Fila>
          )}

          <Fila icono={Gavel} titulo="Sanciones del OECE">
            {sanc.length ? (
              <ul className="space-y-0.5">
                {sanc.slice(0, 4).map((x, i) => (
                  <li key={i}>
                    {String(x.tipo ?? "sanción")} desde {fechaDossier(x.fecha_desde, true)}
                    {x.fecha_hasta && <> hasta {fechaDossier(x.fecha_hasta, true)}</>}
                    {x.estado && <span className="text-mute">, {String(x.estado).toLowerCase()} hoy</span>}
                  </li>
                ))}
                {sanc.length > 4 && <li className="text-mute">y {sanc.length - 4} más</li>}
              </ul>
            ) : exp?.desde_ficha ? (
              "Ver su ficha completa."
            ) : (
              "Ninguna registrada."
            )}
          </Fila>

          {pen?.n > 0 && (
            <Fila icono={FileWarning} titulo="Penalidades en contratos anteriores">
              {pen.n} en {pen.entidades} {pen.entidades === 1 ? "entidad" : "entidades"}, por {montoDossier(pen.monto)}
              {pen.desde && <span className="text-mute">, entre {fechaDossier(pen.desde, true)} y {fechaDossier(pen.hasta, true)}</span>}
            </Fila>
          )}

          {(h.principales_entidades?.length ?? 0) > 0 && (
            <Fila icono={CalendarDays} titulo="A quién le vende más">
              <ul className="space-y-0.5">
                {h.principales_entidades.slice(0, 5).map((e: any, i: number) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3">
                    <span className="min-w-0">{e.entidad}</span>
                    <span className="font-mono tabular-nums text-inkSoft">{e.procesos} {e.procesos === 1 ? "proceso" : "procesos"}, {montoDossier(e.monto)}</span>
                  </li>
                ))}
              </ul>
            </Fila>
          )}
        </dl>

        {banderas.length > 0 && (
          <div>
            <h3 className="text-cuerpo font-semibold text-ink">Banderas de Vigía de este proveedor</h3>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {banderas.slice(0, 12).map(([tipo, sev]) => (
                <li key={tipo} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-micro text-ink">
                  <span className={cn("h-1.5 w-1.5 rounded-full", SEV_PUNTO[SEV_ORDEN.find((k) => sev[k]) ?? "baja"])} aria-hidden />
                  {chipCruce(tipo)}
                  <span className="font-mono tabular-nums text-mute">{sum(sev)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {web.length > 0 && (
          <details className="rounded-xl border border-line bg-paperSoft px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-1.5 text-rotulo font-medium text-ink">
              <AlertTriangle size={13} className="text-amber" aria-hidden />
              Lo que el agente encontró en la web ({web.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {web.map((b, i) => (
                <li key={i} className="text-rotulo leading-5">
                  <strong className="text-ink">{redactDnis(b.titulo)}.</strong> <span className="text-inkSoft">{redactDnis(b.descripcion)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-micro text-mute">{exp?.fuente === "base de Vigía (ficha de empresa)"
          ? "Fuente: la ficha de empresa de Vigía (padrón SUNAT, RNP, OECE y CONOSCE)."
          : "Fuente: base de Vigía (padrón SUNAT, RNP, sanciones y penalidades del OECE, buenas pro del CONOSCE)."}</p>
      </div>
    </section>
  );
}

function sum(v: Record<string, number>): number {
  return Object.values(v).reduce((a, b) => a + b, 0);
}
