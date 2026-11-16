"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, Info, Landmark } from "lucide-react";
import { BloqueDetalle, Nota } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import type { EmpresaDeSenal } from "@/components/agentes/senales";
import { rutaEmpresa, type SeccionEmpresa } from "@/lib/empresas";
import { plural, soles } from "@/lib/formato";
import { nombreLegible as tituloNatural } from "./nombres";
import { PersonName, esPersonaNatural } from "../../Redact";
import { esRucDeEmpresa, llamaPersonaAUnaEmpresa, rucsDeEmpresaEn, type Aludido, type ContextoSenal } from "./directorio";

const ENLACE = "font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/** Dónde seguir cada señal en la ficha del ganador (sólo si es una empresa): la lista que la sostiene. */
const DONDE_SEGUIR: Record<string, { seccion: SeccionEmpresa; extra?: Record<string, string>; texto: string }> = {
  testaferro_multi_ruc: { seccion: "socios", texto: "Su gente: socios, representantes y sus otras empresas" },
  postores_vinculados_rnp: { seccion: "socios", texto: "Su gente: socios, representantes y sus otras empresas" },
  penalidades_oece_historicas: { seccion: "antecedentes", extra: { atipo: "penalidad" }, texto: "Sus penalidades, una por una" },
  sancion_vigente_oece: { seccion: "antecedentes", texto: "Sus sanciones y antecedentes" },
  sancion_historica_oece: { seccion: "antecedentes", texto: "Sus sanciones y antecedentes" },
  proveedor_sancionado_osce: { seccion: "antecedentes", texto: "Sus sanciones y antecedentes" },
  concentracion_entidad: { seccion: "clientes", texto: "A qué entidades le vende" },
  postor_unico_mayoritario: { seccion: "postulaciones", texto: "Los procesos a los que se presentó" },
  lobby_visits_pre_convocatoria: { seccion: "visitas", texto: "Las visitas de su gente a entidades" },
};

/**
 * Lo que el análisis NO guardó de una regla, dicho en el panel para que el hueco no parezca un descuido de quien lee
 * (pedido del usuario del 2026-11-16). Sólo reglas cuyo texto promete una lista que la señal no trae.
 */
const NO_GUARDO: Record<string, string> = {
  testaferro_multi_ruc:
    "El análisis guardó cuántas empresas son, pero no cuáles ni en qué contratos ganaron: la señal no trae esa lista. Para verlas, abre «Su gente» en la ficha de la empresa.",
  postores_vinculados_rnp: "El análisis no guardó, dentro de la señal, la lista de personas en común: está en «Proveedor y red».",
};

/** Una empresa por su nombre, enlazada a su ficha; sin nombre en el dictamen, su RUC enlazado. */
function Empresa({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  return (
    <Link href={rutaEmpresa(ruc)} prefetch={false} className={ENLACE}>
      {nombre ? tituloNatural(nombre) : `Empresa con RUC ${ruc}`}
    </Link>
  );
}

/**
 * «Sobre quién es esta señal», en su panel lateral: el ganador del contrato (con su RUC y su ficha, si es una empresa),
 * la entidad, y cada empresa que nombra la evidencia con lo que el dictamen sabe de ella (si es el ganador, un postor,
 * una socia del ganador en el RNP…). Cuando la evidencia llama «persona» a un documento que es un RUC de empresa, se
 * aclara. Sin datos nuevos: todo sale del mismo dictamen.
 */
export function SobreQuien({
  regla,
  evidencias,
  ctx,
  otrasEmpresas = [],
}: {
  regla: string;
  evidencias: (string | null | undefined)[];
  ctx: ContextoSenal;
  /** Las empresas que la regla guardó en la señal (análisis desde el 2026-11-16): se listan con lo que ganó cada una. */
  otrasEmpresas?: EmpresaDeSenal[];
}) {
  const { ganador, entidad, directorio } = ctx;
  const todo = evidencias.filter(Boolean).join(" ");
  // Las que la señal ya trae con su detalle no se repiten en la lista sacada del texto.
  const conDetalle = new Set(otrasEmpresas.map((e) => e.ruc).filter(Boolean));
  const aludidos: Aludido[] = rucsDeEmpresaEn(todo)
    .filter((ruc) => !conDetalle.has(ruc))
    .map((ruc) => directorio.get(ruc) ?? { ruc, nombre: null, roles: [] });
  const malLlamada = llamaPersonaAUnaEmpresa(todo);
  const empresaMalLlamada = malLlamada ? directorio.get(malLlamada) ?? null : null;
  const ganadorEsEmpresa = esRucDeEmpresa(ganador?.ruc);
  const seguir = ganadorEsEmpresa ? DONDE_SEGUIR[regla] : undefined;
  if (!ganador && !entidad && aludidos.length === 0 && otrasEmpresas.length === 0) return null;

  return (
    <BloqueDetalle titulo="Sobre quién es esta señal">
      <dl className="divide-y divide-line/70 rounded-xl border border-line">
        {ganador && (
          <div className="px-3.5 py-2.5">
            <dt className="text-meta text-mute">Quién ganó este contrato</dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-dato text-ink">
              {ganadorEsEmpresa ? (
                <Empresa ruc={ganador.ruc!} nombre={ganador.nombre} />
              ) : esPersonaNatural(ganador.ruc) ? (
                <PersonName name={ganador.nombre} orden="sunat" />
              ) : (
                <span className="font-semibold">{ganador.nombre ?? "Sin nombre en el registro"}</span>
              )}
              {ganadorEsEmpresa && (
                <Dato tipo="ruc" mono className="text-meta text-inkSoft">
                  {ganador.ruc}
                </Dato>
              )}
            </dd>
          </div>
        )}
        {entidad?.nombre && (
          <div className="px-3.5 py-2.5">
            <dt className="text-meta text-mute">Quién contrata</dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-dato text-ink">
              {esRucDeEmpresa(entidad.ruc) ? (
                <Link href={`/entidad/${entidad.ruc}`} prefetch={false} className={ENLACE}>
                  {tituloNatural(entidad.nombre)}
                </Link>
              ) : (
                <span className="font-semibold">{tituloNatural(entidad.nombre)}</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {otrasEmpresas.length > 0 && (
        <div className="mt-3">
          <p className="text-meta font-semibold text-ink">
            {otrasEmpresas.length === 1 ? "La otra empresa de la que habla la señal" : `Las ${otrasEmpresas.length} otras empresas de las que habla la señal`}
          </p>
          <ul className="mt-1.5 divide-y divide-line/70 rounded-xl border border-line">
            {otrasEmpresas.map((e, i) => (
              <li key={e.ruc ?? i} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <Building2 size={15} className="mt-1 shrink-0 text-mute" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-dato">
                    {e.ruc ? (
                      <Empresa ruc={e.ruc} nombre={e.nombre ?? directorio.get(e.ruc)?.nombre ?? null} />
                    ) : (
                      <span className="font-semibold">{e.nombre ? tituloNatural(e.nombre) : "Empresa sin RUC en la señal"}</span>
                    )}
                    {e.ruc && (
                      <Dato tipo="ruc" mono className="text-meta text-inkSoft">
                        {e.ruc}
                      </Dato>
                    )}
                  </p>
                  {e.papel && <p className="mt-0.5 text-meta leading-snug text-inkSoft">{e.papel.charAt(0).toLocaleUpperCase("es") + e.papel.slice(1)}.</p>}
                  {(e.procesos != null || e.monto != null || e.mismaEntidad != null) && (
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-meta text-inkSoft">
                      {e.procesos != null && <Dato tipo="documento">{plural(e.procesos, "proceso ganado", "procesos ganados")}</Dato>}
                      {e.monto != null && e.monto > 0 && <span className="font-mono tabular-nums">{soles(e.monto)}</span>}
                      {e.mismaEntidad != null && <span>{e.mismaEntidad ? "También le ganó a esta entidad" : "No le ganó a esta entidad"}</span>}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aludidos.length > 0 && (
        <div className="mt-3">
          <p className="text-meta font-semibold text-ink">{aludidos.length === 1 ? "La empresa que nombra la evidencia" : "Las empresas que nombra la evidencia"}</p>
          <ul className="mt-1.5 divide-y divide-line/70 rounded-xl border border-line">
            {aludidos.map((a) => {
              const esGanador = !!ganador?.ruc && a.ruc === ganador.ruc;
              const esEntidad = !!entidad?.ruc && a.ruc === entidad.ruc;
              const Icono = esEntidad ? Landmark : Building2;
              return (
                <li key={a.ruc} className="flex items-start gap-2.5 px-3.5 py-2.5">
                  <Icono size={15} className="mt-1 shrink-0 text-mute" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-dato">
                      {esEntidad ? (
                        <Link href={`/entidad/${a.ruc}`} prefetch={false} className={ENLACE}>
                          {a.nombre ? tituloNatural(a.nombre) : `Entidad con RUC ${a.ruc}`}
                        </Link>
                      ) : (
                        <Empresa ruc={a.ruc} nombre={a.nombre} />
                      )}
                      <Dato tipo="ruc" mono className="text-meta text-inkSoft">
                        {a.ruc}
                      </Dato>
                    </p>
                    {a.roles.length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5 text-meta leading-snug text-inkSoft">
                        {a.roles.map((r) => (
                          <li key={r}>{r}.</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-meta leading-snug text-mute">
                        {a.nombre ? "El dictamen la nombra, pero no dice qué papel tiene en este contrato." : "El dictamen no trae su nombre: está en su ficha."}
                      </p>
                    )}
                    {!esGanador && !esEntidad && ganador?.nombre && (
                      <p className="mt-0.5 text-rotulo text-mute">No es la empresa que ganó este contrato.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {malLlamada && (
        <Nota icono={<Info size={14} aria-hidden />} className="mt-3">
          La evidencia dice «persona con documento {malLlamada}», pero ese número es un RUC de empresa
          {empresaMalLlamada?.nombre ? <>: se trata de {tituloNatural(empresaMalLlamada.nombre)}</> : null}. El registro de proveedores (RNP) anota a
          los socios que son empresas con el mismo campo que a las personas, y la regla no los distingue. Una empresa que es socia de varias
          empresas de su mismo grupo no es, sola, un testaferro: hay que mirar si esas empresas compiten entre sí.
        </Nota>
      )}

      {NO_GUARDO[regla] && otrasEmpresas.length === 0 && (
        <Nota icono={<Info size={14} aria-hidden />} className="mt-3">
          {NO_GUARDO[regla]}
        </Nota>
      )}

      {seguir && (
        <p className="mt-3 text-meta">
          <Link href={rutaEmpresa(ganador!.ruc!, seguir.seccion, seguir.extra)} prefetch={false} className={`inline-flex min-h-8 items-center gap-1 ${ENLACE}`}>
            {seguir.texto} <ArrowUpRight size={14} aria-hidden />
          </Link>
        </p>
      )}
    </BloqueDetalle>
  );
}
