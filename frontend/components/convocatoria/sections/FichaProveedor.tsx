"use client";

/**
 * «Quién es» el proveedor en el dictamen, con lo que dicen los registros (plan 2026-11-04): padrón SUNAT, RNP, sanciones
 * y penalidades del OECE, buenas pro del CONOSCE y las banderas de Vigía. Sale de `expediente_proveedor`: lo arma el
 * agente desde la base o, en un análisis anterior, la API con la ficha de /empresa/<RUC>. Arriba las cifras, después
 * cada registro en su fila con su ícono, y al final a quién le vende más (con barras) y sus banderas, que llevan a su
 * ficha. Lo que el agente encontró en la web va al final de la pestaña («Lo que escribió el agente»), no aquí.
 */

import Link from "next/link";
import { ArrowUpRight, Building2, CalendarDays, FileWarning, Gavel, TriangleAlert, Users } from "lucide-react";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { chipCruce } from "@/lib/cruces";
import { rutaEmpresa } from "@/lib/empresas";
import { numero, oracion } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import { fechaDossier, montoDossier } from "../dossier";
import { antiguedadTexto, condicionLegible, estadoLegible, rucEnRegla, sancionVigente } from "./red/proveedor";

const ROL: Record<string, string> = {
  REPRESENTANTE_LEGAL: "Representante legal",
  SOCIO_ACCIONISTA_TITULAR: "Socio",
  ORGANO_ADMINISTRACION: "Órgano de administración",
};
const SEV_PUNTO: Record<string, string> = { alta: "bg-crimson", media: "bg-amber", baja: "bg-mute" };
const SEV_ORDEN = ["alta", "media", "baja"];
const CLASE_ENLACE = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/** Un registro en su fila: ícono, qué registro es y lo que dice. */
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

export function FichaProveedor({
  exp,
  nombre,
  entidadRuc,
}: {
  exp: any;
  nombre?: string | null;
  /** Ya no se muestran aquí: van en «Lo que escribió el agente». Se acepta por compatibilidad. */
  sugeridas?: any[];
  /** La entidad de este contrato: se marca en «A quién le vende más». */
  entidadRuc?: string | null;
}) {
  // Un consorcio (en el OCDS figura con su código del SEACE, sin RUC): una ficha por integrante.
  if (exp?.consorcio && Array.isArray(exp.integrantes)) {
    return (
      <div className="space-y-3">
        <p className="text-meta text-inkSoft">
          <strong className="font-semibold text-ink">{exp.nombre || nombre || "El consorcio"}</strong> ganó el contrato con{" "}
          {exp.integrantes.length} {exp.integrantes.length === 1 ? "integrante" : "integrantes"}. Lo que dicen los registros de cada uno:
        </p>
        {exp.integrantes.map((e: any, i: number) => (
          <FichaProveedor key={e?.ruc ?? i} exp={e} nombre={e?.nombre} entidadRuc={entidadRuc} />
        ))}
      </div>
    );
  }
  const ruc: string = exp?.ruc ?? "";
  const natural = esPersonaNatural(ruc);
  const ruc20 = /^20\d{9}$/.test(ruc);
  const s = exp?.sunat ?? null;
  const h = exp?.historial ?? {};
  const misma = h.con_esta_entidad ?? null;
  const pen = exp?.penalidades ?? null;
  const sanc: any[] = exp?.sanciones ?? [];
  const rnp: any[] = exp?.rnp ?? [];
  const rnpResumen = exp?.rnp_resumen ?? null;
  const razon = s?.razon_social || nombre || "";
  const edad = antiguedadTexto(s?.edad_dias_al_contratar);
  const enRegla = s ? rucEnRegla(s.estado, s.condicion) : true;
  const estadoTexto = s ? [estadoLegible(s.estado), condicionLegible(s.condicion)].filter(Boolean).join(" y ") : "";

  // Banderas por tipo, con sus severidades juntas (el expediente trae una fila por tipo y severidad).
  const porTipo = new Map<string, Record<string, number>>();
  for (const b of (exp?.banderas ?? []) as any[]) {
    const t = porTipo.get(b.tipo) ?? {};
    t[b.severidad] = (t[b.severidad] ?? 0) + Number(b.n ?? 0);
    porTipo.set(b.tipo, t);
  }
  const banderas = Array.from(porTipo.entries()).sort((a, b) => (b[1].alta ?? 0) - (a[1].alta ?? 0) || sum(b[1]) - sum(a[1]));
  const principales: any[] = h.principales_entidades ?? [];
  const mayor = Math.max(1, ...principales.map((e) => Number(e?.monto) || 0));

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
          <h3 className="font-display text-bloque font-bold leading-tight text-ink">
            {natural ? <PersonName name={razon} orden="sunat" /> : razon || "Proveedor sin razón social"}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-inkSoft">
            <Dato tipo="tipo">{natural ? "Persona natural con negocio" : "Empresa"}</Dato>
            {ruc && (
              <Dato tipo="ruc" mono>
                <Ruc value={ruc} />
              </Dato>
            )}
            {s?.departamento && <Dato tipo="lugar">{oracion(String(s.departamento))}</Dato>}
          </p>
        </div>
        {ruc20 && (
          <Link href={`/empresa/${ruc}`} prefetch={false} className={cn("inline-flex min-h-8 items-center gap-1 text-meta font-semibold", CLASE_ENLACE)}>
            Ver su ficha completa <ArrowUpRight size={14} aria-hidden />
          </Link>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        <CifrasEnFila items={cifras} chico />

        <dl className="divide-y divide-line">
          <Fila icono={Building2} titulo="SUNAT">
            {s ? (
              <>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {estadoTexto && (
                    <span className={cn("pill font-semibold", enRegla ? "border-line bg-paperDeep text-ink" : "border-crimson/30 bg-crimson-soft text-crimsonTexto")}>
                      RUC {estadoTexto}
                    </span>
                  )}
                  {s.fecha_inicio_actividades && (
                    <span>
                      inicio de actividades el {fechaDossier(s.fecha_inicio_actividades, true)}
                      {edad && <span className="text-inkSoft"> ({edad} al contratar)</span>}
                    </span>
                  )}
                </span>
                {s.actividad && <span className="mt-1 block text-meta text-inkSoft">Giro: {oracion(String(s.actividad).trim().replace(/\.$/, ""))}</span>}
                {s.fecha_inicio_dudosa && (
                  <span className="mt-1.5 flex items-start gap-1.5 text-meta text-amberTexto">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                    {s.fecha_inicio_dudosa}
                  </span>
                )}
                {s.inhabilitada && (
                  <span className="mt-1.5 block font-semibold text-crimsonTexto">
                    Inhabilitada: {s.inhabilitada}
                    {s.inhabilitada_hasta ? ` hasta el ${fechaDossier(s.inhabilitada_hasta, true)}` : ""}
                  </span>
                )}
              </>
            ) : natural ? (
              "Persona natural con negocio: Vigía no arma la ficha del padrón de una persona."
            ) : (
              "Sin datos en el padrón de la SUNAT que tiene Vigía."
            )}
          </Fila>

          {(rnp.length > 0 || rnpResumen) && (
            <Fila icono={Users} titulo="Quiénes están detrás (RNP)">
              {rnp.length > 0 ? (
                <ul className="space-y-0.5">
                  {/* recorte: los 8 primeros; el resto, contado y en su ficha */}
                  {rnp.slice(0, 8).map((r, i) => (
                    <li key={i}>
                      <span className="text-mute">{ROL[r.rol] ?? String(r.rol ?? "").replace(/_/g, " ").toLowerCase()}:</span> {redactDnis(r.nombre)}
                      {r.desde && <span className="text-mute">, desde {fechaDossier(r.desde, true)}</span>}
                    </li>
                  ))}
                  {rnp.length > 8 && (
                    <li className="text-mute">
                      y {rnp.length - 8} más{ruc20 ? " en " : ""}
                      {ruc20 && <Link href={rutaEmpresa(ruc, "socios")} prefetch={false} className={CLASE_ENLACE}>su ficha</Link>}
                    </li>
                  )}
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
              <ul className="space-y-1">
                {/* recorte: las 4 más recientes; el resto, contado */}
                {sanc.slice(0, 4).map((x, i) => {
                  const vigente = sancionVigente(x);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-x-2">
                      <span className={cn("pill", vigente ? "border-crimson/30 bg-crimson-soft font-semibold text-crimsonTexto" : "border-line bg-paperDeep text-inkSoft")}>
                        {vigente ? "Vigente" : "Ya no vigente"}
                      </span>
                      <span>
                        {oracion(String(x.tipo ?? "sanción"))} desde el {fechaDossier(x.fecha_desde, true)}
                        {x.fecha_hasta && <> hasta el {fechaDossier(x.fecha_hasta, true)}</>}
                      </span>
                    </li>
                  );
                })}
                {sanc.length > 4 && <li className="text-mute">y {sanc.length - 4} más</li>}
              </ul>
            ) : exp?.desde_ficha ? (
              ruc20 ? (
                <Link href={rutaEmpresa(ruc, "antecedentes")} prefetch={false} className={CLASE_ENLACE}>
                  Ver sus antecedentes en su ficha
                </Link>
              ) : (
                "Sin dato en este análisis."
              )
            ) : (
              "Ninguna registrada."
            )}
          </Fila>

          {pen?.n > 0 && (
            <Fila icono={FileWarning} titulo="Penalidades en contratos anteriores">
              {pen.n} en {pen.entidades} {pen.entidades === 1 ? "entidad" : "entidades"}, por {montoDossier(pen.monto)}
              {pen.desde && <span className="text-inkSoft">, entre el {fechaDossier(pen.desde, true)} y el {fechaDossier(pen.hasta, true)}</span>}
            </Fila>
          )}

          {principales.length > 0 && (
            <Fila icono={CalendarDays} titulo="A quién le vende más">
              <ul className="space-y-2">
                {principales.map((e: any, i: number) => {
                  const esta = !!entidadRuc && e?.entidad_ruc === entidadRuc;
                  return (
                    <li key={i}>
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className={cn("min-w-0", esta && "font-semibold")}>
                          {e.entidad}
                          {esta && <span className="ml-1.5 pill border-granate/40 bg-granate-50 text-granate">esta entidad</span>}
                        </span>
                        <span className="font-mono text-meta tabular-nums text-inkSoft">
                          {e.procesos} {e.procesos === 1 ? "proceso" : "procesos"}, {montoDossier(e.monto)}
                        </span>
                      </span>
                      {/* La barra es el monto frente al de su mayor cliente: se compara de un vistazo. */}
                      <span role="img" aria-label={`${montoDossier(e.monto)}`} className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
                        <span className={cn("block h-full rounded-full", esta ? "bg-granate" : "bg-granate/45")} style={{ width: `${Math.max(3, ((Number(e.monto) || 0) / mayor) * 100)}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Fila>
          )}
        </dl>

        {banderas.length > 0 && (
          <div>
            <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Sus banderas en otros procesos (Vigía)</h4>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {banderas.map(([tipo, sev]) => {
                const cuerpo = (
                  <>
                    <span className={cn("size-1.5 rounded-full", SEV_PUNTO[SEV_ORDEN.find((k) => sev[k]) ?? "baja"])} aria-hidden />
                    {chipCruce(tipo)}
                    <span className="font-mono tabular-nums text-mute">{sum(sev)}</span>
                  </>
                );
                const clase = "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-line bg-paperSoft px-2.5 text-rotulo text-ink";
                return (
                  <li key={tipo}>
                    {ruc20 ? (
                      <Link href={rutaEmpresa(ruc, "antecedentes", { atipo: tipo })} prefetch={false} className={cn(clase, "hover:border-paperEdge hover:bg-paperDeep")}>
                        {cuerpo}
                      </Link>
                    ) : (
                      <span className={clase}>{cuerpo}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="text-rotulo text-mute">
          {exp?.fuente === "base de Vigía (ficha de empresa)"
            ? "Fuente: la ficha de empresa de Vigía (padrón SUNAT, RNP, OECE y CONOSCE)."
            : "Fuente: base de Vigía (padrón SUNAT, RNP, sanciones y penalidades del OECE, buenas pro del CONOSCE)."}
        </p>
      </div>
    </section>
  );
}

function sum(v: Record<string, number>): number {
  return Object.values(v).reduce((a, b) => a + b, 0);
}
