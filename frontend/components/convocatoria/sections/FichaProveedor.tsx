"use client";

/**
 * «Quién es» el proveedor en el dictamen, con lo que dicen los registros (plan 2026-11-04): padrón SUNAT, RNP, sanciones
 * y penalidades del OECE, buenas pro del CONOSCE y las banderas de Vigía. Sale de `expediente_proveedor`: lo arma el
 * agente desde la base o, en un análisis anterior, la API con la ficha de /empresa/<RUC>.
 *
 * Ordenada por jerarquía (pedido del usuario del 2026-11-16: antes era una sola lista de filas del mismo peso, con las
 * ventas en medio de los antecedentes). Cinco subsecciones numeradas, cada una con su título y lo que responde:
 *
 *   1. Quién es                      su RUC, dónde está y lo que dice el padrón de la SUNAT.
 *   2. Cuánto le vende al Estado     las cifras del CONOSCE y a quién le vende más (con barras).
 *   3. Quiénes están detrás          socios, representantes y directivos del RNP, por su papel.
 *   4. Antecedentes                  sanciones y penalidades del OECE.
 *   5. Sus banderas en otros procesos   por familia y por gravedad; cada una abre la lista de sus procesos en el panel
 *                                       lateral (./red/BanderasProveedor).
 *
 * Lo que el agente encontró en la web va al final de la pestaña («Lo que escribió el agente»), no aquí.
 */

import Link from "next/link";
import { ArrowUpRight, Building2, Flag, Gavel, Receipt, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { rutaEmpresa } from "@/lib/empresas";
import { numero, oracion, plural } from "@/lib/formato";
import { nombreLegible as tituloNatural } from "../senal/nombres";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural, pareceEmpresa } from "../../Redact";
import { fechaDossier, montoDossier } from "../dossier";
import { BanderasProveedor } from "./red/BanderasProveedor";
import { antiguedadTexto, condicionLegible, estadoLegible, rucEnRegla, sancionVigente } from "./red/proveedor";

/** Los papeles del RNP, en el orden en que se leen: de quién es la empresa, quién firma por ella y quién la dirige. */
const ROLES: { clave: string; titulo: string }[] = [
  { clave: "SOCIO_ACCIONISTA_TITULAR", titulo: "Socios" },
  { clave: "REPRESENTANTE_LEGAL", titulo: "Representantes legales" },
  { clave: "ORGANO_ADMINISTRACION", titulo: "Órgano de administración" },
];
const CLASE_ENLACE = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";
/** Cuántas personas se ven por papel; el resto, contado y en su ficha. */
const POR_ROL = 6;

/** Una subsección de la ficha: su número, su ícono, su título y, a la derecha, un dato o un enlace. */
function Sub({ n, icono: Icono, titulo, nota, children }: { n: number; icono: LucideIcon; titulo: string; nota?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-4 py-4 sm:px-5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="flex items-center gap-2 font-display text-cuerpo font-bold text-ink">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-semibold tabular-nums text-inkSoft" aria-hidden>
            {n}
          </span>
          <Icono size={15} className="shrink-0 text-mute" aria-hidden />
          {titulo}
        </h4>
        {nota && <div className="text-rotulo text-mute">{nota}</div>}
      </div>
      {children}
    </section>
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
  const banderas: any[] = exp?.banderas ?? [];
  const tiposBandera = new Set(banderas.map((b) => b?.tipo)).size;
  const conAlta = banderas.some((b) => b?.severidad === "alta");
  const principales: any[] = h.principales_entidades ?? [];
  const mayor = Math.max(1, ...principales.map((e) => Number(e?.monto) || 0));
  const sancVigentes = sanc.filter((x) => sancionVigente(x)).length;

  const cifras = [
    { valor: h.procesos != null ? numero(h.procesos) : null, etiqueta: "buenas pro en el Estado",
      contexto: h.primera ? `desde ${fechaDossier(h.primera, true)}${h.en_consorcio ? `, ${h.en_consorcio} en consorcio` : ""}` : undefined },
    { valor: h.monto != null ? montoDossier(h.monto) : null, etiqueta: "adjudicado en total",
      contexto: h.entidades != null ? `en ${h.entidades} ${h.entidades === 1 ? "entidad" : "entidades"}` : undefined },
    { valor: misma?.procesos != null ? numero(misma.procesos) : null, etiqueta: "con esta entidad",
      contexto: misma?.procesos ? montoDossier(misma.monto) : "ninguna antes", tono: misma?.procesos >= 5 ? ("media" as const) : ("neutro" as const) },
  ];

  // El RNP por papel: socios, representantes y directivos, cada grupo con sus nombres (los papeles que no se conocen, al final).
  const porRol = ROLES.map((r) => ({ ...r, gente: rnp.filter((x) => x?.rol === r.clave) })).filter((g) => g.gente.length > 0);
  const otrosRoles = rnp.filter((x) => !ROLES.some((r) => r.clave === x?.rol));
  if (otrosRoles.length > 0) porRol.push({ clave: "otros", titulo: "Otros papeles", gente: otrosRoles });

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paperSoft px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-display text-bloque font-bold leading-tight text-ink">
            {natural ? <PersonName name={razon} orden="sunat" /> : razon ? tituloNatural(razon) : "Proveedor sin razón social"}
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

      <div className="divide-y divide-line">
        <Sub n={1} icono={Building2} titulo="Quién es" nota="Padrón de la SUNAT">
          {s ? (
            <div className="space-y-1.5 text-dato leading-relaxed text-ink">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {estadoTexto && (
                  <span className={cn("pill font-semibold", enRegla ? "border-line bg-paperDeep text-ink" : "border-crimson/30 bg-crimson-soft text-crimsonTexto")}>
                    RUC {estadoTexto}
                  </span>
                )}
                {s.fecha_inicio_actividades && (
                  <Dato tipo="fecha" nombre="Inicio de actividades">
                    Opera desde el {fechaDossier(s.fecha_inicio_actividades, true)}
                    {edad && <span className="text-inkSoft"> ({edad} al contratar)</span>}
                  </Dato>
                )}
              </p>
              {s.actividad && (
                <p className="text-meta text-inkSoft">
                  <Dato tipo="servicio" nombre="Giro">
                    Giro: {oracion(String(s.actividad).trim().replace(/\.$/, ""))}
                  </Dato>
                </p>
              )}
              {s.fecha_inicio_dudosa && (
                <p className="flex items-start gap-1.5 text-meta text-amberTexto">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                  {s.fecha_inicio_dudosa}
                </p>
              )}
              {s.inhabilitada && (
                <p className="font-semibold text-crimsonTexto">
                  Inhabilitada: {s.inhabilitada}
                  {s.inhabilitada_hasta ? ` hasta el ${fechaDossier(s.inhabilitada_hasta, true)}` : ""}
                </p>
              )}
            </div>
          ) : (
            <p className="text-meta text-mute">
              {natural ? "Persona natural con negocio: Vigía no arma la ficha del padrón de una persona." : "Sin datos en el padrón de la SUNAT que tiene Vigía."}
            </p>
          )}
        </Sub>

        <Sub n={2} icono={Receipt} titulo="Cuánto le vende al Estado" nota="Buenas pro del CONOSCE">
          <CifrasEnFila items={cifras} chico />
          {principales.length > 0 && (
            <div className="mt-3">
              <p className="text-meta font-semibold text-ink">A quién le vende más</p>
              <ul className="mt-1.5 space-y-2">
                {principales.map((e: any, i: number) => {
                  const esta = !!entidadRuc && e?.entidad_ruc === entidadRuc;
                  const nombreEntidad = tituloNatural(String(e.entidad ?? "Entidad sin nombre"));
                  return (
                    <li key={i}>
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta">
                        <span className={cn("min-w-0", esta && "font-semibold")}>
                          {/^20\d{9}$/.test(String(e?.entidad_ruc ?? "")) ? (
                            <Link href={`/entidad/${e.entidad_ruc}`} prefetch={false} className="text-ink hover:text-granate hover:underline">
                              {nombreEntidad}
                            </Link>
                          ) : (
                            nombreEntidad
                          )}
                          {esta && <span className="ml-1.5 pill border-granate/40 bg-granate-50 text-granate">esta entidad</span>}
                        </span>
                        <span className="font-mono text-rotulo tabular-nums text-inkSoft">
                          {plural(Number(e.procesos) || 0, "proceso", "procesos")}, {montoDossier(e.monto)}
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
            </div>
          )}
        </Sub>

        {(rnp.length > 0 || rnpResumen) && (
          <Sub
            n={3}
            icono={Users}
            titulo="Quiénes están detrás"
            nota={rnp.length > 0 ? `${plural(rnp.length, "persona o empresa", "personas y empresas")} en el RNP` : "Registro Nacional de Proveedores"}
          >
            {porRol.length > 0 ? (
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {porRol.map((g) => (
                  <div key={g.clave} className="min-w-0">
                    <p className="flex items-baseline gap-2 text-meta font-semibold text-ink">
                      {g.titulo}
                      <span className="font-mono text-rotulo font-normal tabular-nums text-mute">{g.gente.length}</span>
                    </p>
                    <ul className="mt-1 space-y-0.5 text-meta leading-snug text-inkSoft">
                      {/* recorte: los 6 primeros de cada papel; el resto, contado y en su ficha */}
                      {g.gente.slice(0, POR_ROL).map((r, i) => (
                        <li key={i} className="break-words">
                          {/* Una empresa socia se escribe como las demás empresas; una persona llega con un apellido tapado y así se deja. */}
                          {pareceEmpresa(r.nombre) ? tituloNatural(String(r.nombre)) : <PersonName name={r.nombre} orden="sunat" />}
                          {r.desde && <span className="text-mute">, desde {fechaDossier(r.desde, true)}</span>}
                        </li>
                      ))}
                      {g.gente.length > POR_ROL && (
                        <li className="text-mute">
                          y {g.gente.length - POR_ROL} más{ruc20 ? " en " : ""}
                          {ruc20 && <Link href={rutaEmpresa(ruc, "socios")} prefetch={false} className={CLASE_ENLACE}>su ficha</Link>}
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-meta text-inkSoft">
                {rnpResumen.socios ?? 0} {rnpResumen.socios === 1 ? "socio" : "socios"}, {rnpResumen.representantes ?? 0}{" "}
                {rnpResumen.representantes === 1 ? "representante" : "representantes"} y {rnpResumen.directivos ?? 0} en el directorio.
              </p>
            )}
          </Sub>
        )}

        <Sub
          n={rnp.length > 0 || rnpResumen ? 4 : 3}
          icono={Gavel}
          titulo="Antecedentes"
          nota={sancVigentes > 0 ? <span className="font-semibold text-crimsonTexto">{plural(sancVigentes, "sanción vigente", "sanciones vigentes")}</span> : "Sanciones y penalidades del OECE"}
        >
          <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            <div className="bg-paper px-3.5 py-2.5">
              <dt className="text-rotulo font-semibold uppercase tracking-wide text-mute">Sanciones del Tribunal</dt>
              <dd className="mt-1 text-meta leading-relaxed text-ink">
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
                    {sanc.length > 4 && (
                      <li className="text-mute">
                        y {sanc.length - 4} más{ruc20 ? " en " : ""}
                        {ruc20 && <Link href={rutaEmpresa(ruc, "antecedentes")} prefetch={false} className={CLASE_ENLACE}>su ficha</Link>}
                      </li>
                    )}
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
              </dd>
            </div>
            <div className="bg-paper px-3.5 py-2.5">
              <dt className="text-rotulo font-semibold uppercase tracking-wide text-mute">Penalidades en contratos anteriores</dt>
              <dd className="mt-1 text-meta leading-relaxed text-ink">
                {pen?.n > 0 ? (
                  <>
                    <span className="font-semibold">{plural(Number(pen.n), "penalidad", "penalidades")}</span> en {plural(Number(pen.entidades) || 0, "entidad", "entidades")}, por{" "}
                    <span className="font-mono tabular-nums">{montoDossier(pen.monto)}</span>
                    {pen.desde && (
                      <span className="block text-rotulo text-mute">
                        entre el {fechaDossier(pen.desde, true)} y el {fechaDossier(pen.hasta, true)}
                      </span>
                    )}
                  </>
                ) : (
                  "Ninguna registrada."
                )}
              </dd>
            </div>
          </dl>
        </Sub>

        {banderas.length > 0 && (
          <Sub
            n={rnp.length > 0 || rnpResumen ? 5 : 4}
            icono={Flag}
            titulo="Sus banderas en otros procesos"
            nota={
              <span className={cn(conAlta && "font-semibold text-crimsonTexto")}>
                {plural(tiposBandera, "tipo de bandera", "tipos de bandera")}
                {conAlta ? ", con alguna alta" : ", ninguna alta"}
              </span>
            }
          >
            <p className="mb-2.5 text-meta leading-snug text-inkSoft">
              Lo que Vigía marcó en otros procesos de este proveedor, por familia y de lo más grave a lo más leve.
              {ruc20 && " Toca una para ver en qué procesos."}
            </p>
            <BanderasProveedor banderas={banderas} ruc={ruc} />
          </Sub>
        )}
      </div>

      <p className="border-t border-line bg-paperSoft px-4 py-2.5 text-rotulo text-mute sm:px-5">
        {exp?.fuente === "base de Vigía (ficha de empresa)"
          ? "Fuente: la ficha de empresa de Vigía (padrón SUNAT, RNP, OECE y CONOSCE)."
          : "Fuente: base de Vigía (padrón SUNAT, RNP, sanciones y penalidades del OECE, buenas pro del CONOSCE)."}
      </p>
    </section>
  );
}
