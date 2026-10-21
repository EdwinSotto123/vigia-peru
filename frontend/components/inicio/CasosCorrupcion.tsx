import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { TIPO_RESPONSABILIDAD, type Corrupcion } from "@/lib/corrupcion";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { BloqueInicio, SinDato } from "./BloquesInicio";

/**
 * "Casos de corrupción" del Inicio (entidad, región, partido), con los rótulos de docs/CORRUPCION.md:
 *   · Procuraduría Anticorrupción: "Sentencia firme" (casos en ejecución de sentencia: lo COMPROBADO) y "Casos en
 *     trámite". Son cifras por sede (región), nunca de una entidad.
 *   · Contraloría: informes de control con responsabilidad PRESUNTA; "no es una condena", siempre a la vista.
 * Las dos fuentes van en cajas separadas y no se suman. Cada informe enlaza a su PDF oficial (que nombra a los
 * funcionarios: se enlaza, no se copia).
 */
export function CasosCorrupcion({
  datos,
  ambito,
  nombreRegion,
  mostrarEntidad = false,
  visibles = 5,
  nota,
}: {
  datos: Corrupcion | null | undefined;
  /** De quién es la sección: cambia los textos ("esta entidad", "esta región", "las entidades que gobernó"). */
  ambito: "entidad" | "region" | "partido";
  nombreRegion?: string | null;
  /** En la región y el partido cada informe dice de qué entidad es. */
  mostrarEntidad?: boolean;
  visibles?: number;
  /** Una advertencia bajo el título de la Contraloría. */
  nota?: string;
}) {
  const inf = datos?.informes;
  const pp = datos?.procuraduria ?? null;
  const de = ambito === "entidad" ? "esta entidad" : ambito === "region" ? `${nombreRegion ?? "esta región"}` : "las entidades que gobernó en el período";

  return (
    <BloqueInicio
      ancho
      titulo="Casos de corrupción"
      ayuda={
        <Ayuda titulo="¿De dónde salen y qué significan?">
          <span className="block">
            <strong>Procuraduría Anticorrupción</strong> (Procuraduría General del Estado): los casos penales por corrupción
            en los que el Estado es la parte agraviada. «Sentencia firme» son los que están en ejecución de sentencia: ya
            hay condena o una decisión firme y se cobra la reparación. Cuenta por sede, que es casi siempre un departamento.
          </span>
          <span className="mt-2 block">
            <strong>Contraloría</strong>: informes de control que señalan una responsabilidad presunta (penal, civil o
            administrativa) de funcionarios y la derivan a quien corresponde. No es una condena: la decide un juez o la
            entidad después.
          </span>
          <span className="mt-2 block">Las dos fuentes se muestran por separado y nunca se suman.</span>
        </Ayuda>
      }
    >
      {datos === undefined ? (
        <SinDato>Cargando…</SinDato>
      ) : datos === null ? (
        <SinDato>Sin dato: el servicio no respondió.</SinDato>
      ) : (
        // Dos columnas según el ancho del BLOQUE (container query), no de la pantalla: en el panel angosto de la región
        // van una sobre otra aunque la pantalla sea ancha.
        <div className="[container-type:inline-size]">
        <div className="grid gap-4 [@container(min-width:44rem)]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          {ambito !== "partido" && (
            <div className="rounded-xl border border-line bg-paperDeep/50 p-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-mute">
                Procuraduría Anticorrupción{ambito === "entidad" && nombreRegion ? ` · ${nombreRegion}` : ""}
              </p>
              {pp ? (
                <>
                  <p className="mt-2 font-mono text-[28px] font-semibold tabular-nums leading-none text-ink">{numero(pp.en_ejecucion)}</p>
                  <p className="mt-1 text-[13.5px] font-semibold text-ink">con sentencia firme</p>
                  <p className="text-[12.5px] text-inkSoft">en ejecución de sentencia</p>
                  <p className="mt-3 text-[13.5px] text-ink">
                    <span className="font-mono tabular-nums">{numero(pp.en_tramite)}</span> casos en trámite
                    {pp.reparacion_civil ? <span className="text-inkSoft"> · {solesCompacto(pp.reparacion_civil)} de reparación cobrada en el año</span> : null}
                  </p>
                  {ambito === "entidad" && (
                    <p className="mt-2 text-[12px] text-mute">Son de todo el departamento, no sólo de esta entidad: la Procuraduría publica sus cifras por sede.</p>
                  )}
                  <p className="mt-2 text-[12px] text-mute">
                    Corte {fechaCorta(pp.corte)}
                    {pp.sedes.length > 1 ? ` · ${pp.sedes.length} sedes` : ""}
                    {pp.url_fuente && (
                      <>
                        {" · "}
                        <a href={pp.url_fuente} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-granate underline-offset-4 hover:underline">
                          boletín <ExternalLink size={11} aria-hidden />
                        </a>
                      </>
                    )}
                  </p>
                </>
              ) : (
                <SinDato>La Procuraduría no publica una sede para este departamento en su último boletín.</SinDato>
              )}
            </div>
          )}

          <div className={ambito === "partido" ? "[@container(min-width:44rem)]:col-span-2" : undefined}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-mute">Contraloría · presunta responsabilidad, no es una condena</p>
            {nota && <p className="mt-1 text-[12px] text-mute">{nota}</p>}
            {inf && inf.total > 0 ? (
              <>
                <p className="mt-2 text-[13.5px] text-ink">
                  {plural(inf.total, "informe de control", "informes de control")} sobre {de}
                  {inf.desde ? <span className="text-inkSoft"> ({inf.desde.slice(0, 4)} a {inf.hasta?.slice(0, 4)})</span> : null}:{" "}
                  <strong className="font-semibold">{numero(inf.penal)}</strong> con presunta responsabilidad penal,{" "}
                  <strong className="font-semibold">{numero(inf.civil)}</strong> civil y {numero(inf.administrativa)} administrativa
                  {inf.funcionarios > 0 ? `, ${plural(inf.funcionarios, "funcionario comprendido", "funcionarios comprendidos")}` : ""}.
                </p>
                <ul className="mt-3 divide-y divide-line/70 rounded-xl border border-line">
                  {inf.ultimos.slice(0, visibles).map((i) => (
                    <li key={i.numero} className="px-3.5 py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-[12px] text-mute">
                          {i.fecha ? fechaCorta(i.fecha) : "Sin fecha"} · Informe <span className="font-mono">{i.numero}</span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {i.responsabilidades.map((r) => (
                            <span key={r} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r === "penal" ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft"}`}>
                              {TIPO_RESPONSABILIDAD[r] ?? r}
                            </span>
                          ))}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[13.5px] text-ink" title={i.titulo ?? undefined}>{i.titulo ? tituloNatural(i.titulo) : "Sin título"}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px]">
                        {mostrarEntidad && i.entidad && (
                          i.entidadRuc ? (
                            <Link href={`/entidad/${i.entidadRuc}`} prefetch={false} className="text-inkSoft underline-offset-4 hover:text-ink hover:underline">{tituloNatural(i.entidad)}</Link>
                          ) : (
                            <span className="text-inkSoft">{tituloNatural(i.entidad)}</span>
                          )
                        )}
                        {i.urlPdf && (
                          <a href={i.urlPdf} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-granate underline-offset-4 hover:underline">
                            Ver el informe <ExternalLink size={11} aria-hidden />
                          </a>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
                {inf.total > visibles && (
                  <p className="mt-2 text-[12px] text-mute">
                    Los {Math.min(visibles, inf.ultimos.length)} más recientes de {numero(inf.total)}. Todos están en el{" "}
                    <a href="https://buscadorinformes.contraloria.gob.pe/" target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
                      buscador de la Contraloría
                    </a>
                    .
                  </p>
                )}
              </>
            ) : (
              <SinDato>La Contraloría no tiene informes con responsabilidad sobre {de} en su buscador.</SinDato>
            )}
          </div>
        </div>
        </div>
      )}
    </BloqueInicio>
  );
}
