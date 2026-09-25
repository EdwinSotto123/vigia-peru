/**
 * Tarjeta de resultados de un análisis terminado: señales de riesgo con severidad (color,
 * ícono y palabra), norma y evidencia; el puntaje (gauge) SÓLO si hay señales que lo expliquen
 * (DESIGN_SYSTEM.md §10.4); mercado (mediana vs ofertado), documentos leídos,
 * recortes/validaciones pendientes y UN botón al dictamen completo.
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): cada señal es una fila —regla, severidad, norma y
 * una línea de evidencia— y su evidencia completa se abre en el panel lateral (Revelar). Lo
 * que explica qué es una señal o por qué algo está en revisión, a un clic (Ayuda).
 *
 * Sin hooks: sirve en server components (/app/contratos/[ocid]) y dentro de
 * ContratoEnVivo (client).
 *
 * `revision` (la autoevaluación bloqueó la publicación): NADA del análisis se muestra. Ni el
 * score, ni las señales, ni qué reglas dispararon, ni los precios. Antes el aviso convivía con
 * un gauge "100 RIESGO ALTO": un análisis que el propio sistema no se atrevió a publicar se
 * leía como una condena. Se dice qué pasa y por qué, en palabras, y nada más.
 *
 * Mercado: se respeta el veredicto del backend. Con `veredicto = no_verificable` o sin
 * `sobreprecioPct`, los totales del lote no se comparan (salía "S/ 68,215 de mercado frente a
 * S/ 186,200 ofertado" sobre unidades que no coincidían), y un ítem cuyo propio veredicto es
 * `no_verificable`/`sin_dato` no muestra diferencia porcentual.
 */

import { BarraCompartir } from "@/components/patrones";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ExternalLink, Eye, FileText, Scale, Scissors, ShieldCheck } from "lucide-react";
import { duracion, reglaLabel, type MercadoItem, type ResultadoAnalisis as Resultado, type SenalRiesgo } from "@/lib/auditoria";
import { validacionLabel } from "@/lib/contratos";
import { plural, porcentaje, soles } from "@/lib/formato";
import { Severidad } from "@/components/ui/Severidad";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle } from "@/components/patrones/Detalle";
import { ConteoSenales } from "@/components/convocatoria/sections/ConteoSenales";
import { EvidenciaRedactada } from "./EvidenciaRedactada";
import { ScoreGauge } from "./ScoreGauge";
import { ReglasEvaluadas } from "./ReglasEvaluadas";

interface Props {
  resultado: Resultado | null;
  ocid: string;
  /** Respaldo cuando `resultado` aún no llegó (score/banderas de la vista). */
  score?: number | null;
  banderas?: number;
  duracionMs?: number | null;
  /** Ruta que se comparte (por defecto /app/auditoria/[ocid]). */
  sharePath?: string;
  compacto?: boolean;
  className?: string;
  /**
   * El procesamiento está en revisión humana (`estadoVisible(p) === "revision"`). Hace falta
   * aparte de `resultado.estado`: el resultado puede no haber llegado todavía y el respaldo
   * (score/banderas de la vista) no sabe nada de la revisión.
   */
  revision?: boolean;
}

/** Veredictos con los que el backend dice que la comparación NO vale. */
const SIN_COMPARACION = new Set(["no_verificable", "sin_dato"]);

/** "36 % sobre la mediana" · "25 % bajo la mediana" · "igual a la mediana". En tinta neutra: una diferencia no es una señal. */
function diferencia(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return "igual a la mediana";
  return `${porcentaje(Math.abs(r))} ${r > 0 ? "sobre" : "bajo"} la mediana`;
}

export function ResultadoAnalisis({ resultado: r, ocid, score, banderas, duracionMs, sharePath, compacto = false, className = "", revision = false }: Props) {
  const dossierId = r?.codigo?.replace(/^OECE-/, "") ?? ocid;
  const dossierHref = `/app/convocatoria/${encodeURIComponent(dossierId)}`;
  const enRevision = revision || r?.estado === "revision";

  if (enRevision) {
    return <EnRevision r={r} ocid={ocid} duracionMs={duracionMs} sharePath={sharePath} compacto={compacto} className={className} />;
  }

  const senales = r?.banderas ?? [];
  const n = r ? senales.length : (banderas ?? 0);
  const porSev = { alta: 0, media: 0, baja: 0 };
  for (const s of senales) porSev[s.severidad] += 1;
  const conSenales = n > 0;
  const titulo = conSenales ? plural(n, "señal de riesgo", "señales de riesgo") : "Sin señales de riesgo";
  // El puntaje nunca aparece sin las señales que lo explican (§10.4).
  const scoreVisible = conSenales ? r?.score ?? score ?? null : null;
  const mercado = r?.mercado && ((r.mercado.nItems ?? 0) > 0 || (r.mercado.nConMediana ?? 0) > 0) ? r.mercado : null;

  return (
    <section className={`rounded-2xl border bg-paper ${conSenales ? "border-line" : "border-moss/30"} ${compacto ? "p-4" : "p-5"} ${className}`} aria-label="Resultado del análisis">
      {/* resumen (+ puntaje sólo con señales) */}
      <div className={`flex ${compacto ? "flex-col items-start gap-3" : "flex-wrap items-center gap-4"}`}>
        {conSenales && <ScoreGauge score={scoreVisible} size={compacto ? 112 : 132} className="shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-mute">Resultado de la lectura</p>
          <div className="mt-0.5 flex items-center gap-1">
            <h2 className={`inline-flex items-center gap-2 font-display font-bold leading-tight text-ink ${compacto ? "text-lg" : "text-xl"}`}>
              {conSenales ? <AlertTriangle size={18} className="text-inkSoft" aria-hidden /> : <CheckCircle2 size={18} className="text-mossTexto" aria-hidden />}
              {titulo}
            </h2>
            {conSenales && (
              <Ayuda titulo="¿Qué es una señal?">
                Un patrón que cita norma y evidencia oficial y merece revisión. No es una acusación: es un indicio para volver
                a la fuente.
              </Ayuda>
            )}
          </div>
          {/* El mismo conteo por severidad (color, ícono y palabra) que la cabecera del dossier. */}
          {conSenales && <ConteoSenales conteo={{ total: senales.length, ...porSev }} className="mt-1.5" />}
          {(!conSenales || (duracionMs != null && duracionMs > 0)) && (
            <p className="mt-1.5 text-[12px] leading-snug text-mute">
              {!conSenales && "Ningún patrón de riesgo en lo revisado. El dictamen explica qué se cotejó. "}
              {duracionMs != null && duracionMs > 0 && <>Análisis en <span className="font-mono">{duracion(duracionMs)}</span>.</>}
            </p>
          )}
        </div>
      </div>

      {/* qué reglas corrieron (y cuáles no dispararon) */}
      {r && (
        <div className="mt-3">
          <ReglasEvaluadas perfil={r.perfil} senales={senales} reglasDisparadas={r.reglasDisparadas} compacto={compacto} />
        </div>
      )}

      {/* señales */}
      {senales.length > 0 && (
        <ol className="mt-4 divide-y divide-line border-t border-line" aria-label="Señales de riesgo">
          {senales.slice(0, compacto ? 4 : 8).map((s, i) => (
            <li key={`${s.regla}-${i}`} className="py-2">
              {compacto ? (
                <LineaSenal s={s} />
              ) : (
                <>
                  <Revelar
                    titulo={reglaLabel(s.regla)}
                    descripcion={s.norma ?? undefined}
                    etiqueta={`Ver la evidencia de la señal: ${reglaLabel(s.regla)}`}
                    ancho="md"
                    className="-mx-2 w-auto rounded-lg px-2 py-0.5 transition-colors duration-rapido hover:bg-paperSoft"
                    detalle={<DetalleSenal s={s} />}
                    pie={
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                        <Link href={dossierHref} className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                          Leer el dictamen completo <ArrowRight size={13} aria-hidden />
                        </Link>
                        {s.fuenteUrl && (
                          <a href={s.fuenteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-ink hover:underline">
                            Fuente oficial <ExternalLink size={11} aria-hidden />
                          </a>
                        )}
                      </span>
                    }
                  >
                    <LineaSenal s={s} conFlecha />
                  </Revelar>
                  {/* Una línea de evidencia, fuera del botón: los DNI van tras vidrio y el vidrio
                      es su propio control. Entera, en el panel. */}
                  {s.evidencia && (
                    <p className="mt-0.5 line-clamp-1 border-l-2 border-line pl-2 text-[12px] leading-snug text-inkSoft">
                      <EvidenciaRedactada texto={s.evidencia} />
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
          {senales.length > (compacto ? 4 : 8) && (
            <li className="py-2 text-[12px] text-mute">y {plural(senales.length - (compacto ? 4 : 8), "señal más", "señales más")} en el dictamen</li>
          )}
        </ol>
      )}

      {/* mercado, documentos y recortes */}
      {(mercado || r?.documentos || (r?.recortes ?? 0) > 0 || (r?.validacionesPendientes?.length ?? 0) > 0) && (
        <dl className={`mt-3 grid gap-2 border-t border-line pt-3 text-[12px] ${compacto ? "" : "sm:grid-cols-2"}`}>
          {mercado && <Mercado mercado={mercado} compacto={compacto} />}
          {(r?.documentos || (r?.recortes ?? 0) > 0 || (r?.validacionesPendientes?.length ?? 0) > 0) && (
            <div className="rounded-xl bg-paperSoft p-3">
              <dt className="text-[12px] font-semibold text-inkSoft">Expediente</dt>
              <dd className="mt-1 space-y-1 text-ink">
                {r?.documentos && (
                  <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5" title={r.documentos.titulos.join(", ")}>
                    <span className="inline-flex items-center gap-1.5">
                      <FileText size={12} className="text-mute" aria-hidden />
                      <span className="font-mono tabular-nums">{r.documentos.n}</span> documento{r.documentos.n === 1 ? "" : "s"} leído{r.documentos.n === 1 ? "" : "s"}
                    </span>
                    {r.documentos.paginas > 0 && <span><span className="font-mono tabular-nums">{r.documentos.paginas}</span> páginas</span>}
                    {r.documentos.conError > 0 && <span className="text-inkSoft">{r.documentos.conError} que no se pudieron leer</span>}
                  </div>
                )}
                {(r?.recortes ?? 0) > 0 && (
                  <div className="inline-flex items-center gap-1.5 text-mute" title="Límites que aplicó el análisis (documentos o ítems que quedaron fuera); el dictamen los lista tal cual.">
                    <Scissors size={12} aria-hidden /> {r!.recortes} recorte{r!.recortes === 1 ? "" : "s"} declarado{r!.recortes === 1 ? "" : "s"}
                  </div>
                )}
                {(r?.validacionesPendientes?.length ?? 0) > 0 && (
                  <ul className="list-inside list-disc text-[12px] text-inkSoft">
                    {r!.validacionesPendientes.map((v) => <li key={v}>pendiente: {validacionLabel(v)}</li>)}
                  </ul>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* acciones: un botón por destino */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={dossierHref} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-granate px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-granate-deep">
          Leer el dictamen completo <ArrowRight size={15} aria-hidden />
        </Link>
        <BarraCompartir compacto titulo={`Análisis ${r?.codigo ?? ocid} en Vigía Perú`} texto={titulo} ruta={sharePath ?? `/app/auditoria/${encodeURIComponent(ocid)}`} />
      </div>
      {r && !r.dictamenListo && <p className="mt-2 text-[12px] text-mute">El dictamen se está publicando; si el enlace no muestra nada todavía, vuelve en un minuto.</p>}
    </section>
  );
}

/** Caja de mercado que obedece el veredicto del backend. */
function Mercado({ mercado, compacto }: { mercado: NonNullable<Resultado["mercado"]>; compacto: boolean }) {
  const nItems = mercado.nItems ?? mercado.items.length;
  const globalNoVerificable = mercado.veredicto === "no_verificable";
  // Un ítem se compara sólo si su propio veredicto lo permite y trae los tres números.
  const comparables = globalNoVerificable
    ? []
    : mercado.items.filter(
        (it): it is MercadoItem & { mediana: number; ofertado: number; diffPct: number } =>
          it.mediana != null && it.ofertado != null && it.diffPct != null && !SIN_COMPARACION.has(it.veredicto ?? ""),
      );
  const loteComparable = !globalNoVerificable && mercado.sobreprecioPct != null && mercado.totalMercado != null && mercado.totalOfertado != null;
  const itemsLeidos = `${nItems} ${nItems === 1 ? "ítem leído" : "ítems leídos"}`;

  return (
    <div className="rounded-xl bg-paperSoft p-3">
      <dt className="text-[12px] font-semibold text-inkSoft">Mercado</dt>
      <dd className="mt-1 space-y-1 text-ink">
        {comparables.length === 0 && !loteComparable ? (
          <p className="text-[12px] leading-snug text-inkSoft">
            No se pudo comparar con el mercado <span className="text-mute">({itemsLeidos})</span>.
          </p>
        ) : (
          <>
            {comparables.slice(0, compacto ? 1 : 3).map((it, i) => (
              <div key={i} className="leading-snug">
                <div className="line-clamp-1 text-[12px] text-mute" title={it.item ?? ""}>{it.item ?? "Ítem"}</div>
                <div className="text-[12px]">
                  <span className="font-mono tabular-nums">{soles(it.ofertado)}</span> ofertado, mediana de mercado{" "}
                  <span className="font-mono tabular-nums">{soles(it.mediana)}</span>
                  {it.unidad ? <span className="text-mute"> por {it.unidad.toLowerCase()}</span> : null}
                  <span className="ml-1 font-semibold text-ink">({diferencia(it.diffPct)})</span>
                </div>
              </div>
            ))}
            {loteComparable ? (
              <div className="text-[12px] text-mute">
                Todo el lote: <span className="font-mono tabular-nums">{soles(mercado.totalOfertado!)}</span> ofertado frente a{" "}
                <span className="font-mono tabular-nums">{soles(mercado.totalMercado!)}</span> de mercado
                <span className="ml-1 font-semibold text-ink">
                  ({Math.round(mercado.sobreprecioPct!) === 0 ? "sin diferencia" : `${porcentaje(Math.abs(Math.round(mercado.sobreprecioPct!)))} ${mercado.sobreprecioPct! > 0 ? "más caro" : "más barato"}`})
                </span>
              </div>
            ) : (
              <div className="text-[12px] text-mute">
                {comparables.length} de {itemsLeidos} se pudo comparar; el total del lote no.
              </div>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

/** Regla, severidad, cotejo y norma en una fila. Sólo `span`: puede ir dentro del botón de Revelar. */
function LineaSenal({ s, conFlecha = false }: { s: SenalRiesgo; conFlecha?: boolean }) {
  return (
    <span className="flex items-start gap-2">
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-ink">{reglaLabel(s.regla)}</span>
          <Severidad bandera={s.severidad} formato="linea" className="text-[12px]" />
          {s.verificada === true && (
            // Una sola palabra para lo mismo en todo el producto: "cotejada" (SelloVerificada).
            <span className="inline-flex items-center gap-0.5 text-[11px] text-mossTexto">
              <ShieldCheck size={12} aria-hidden /> cotejada
            </span>
          )}
        </span>
        {s.norma && (
          <span className="mt-0.5 flex items-start gap-1 text-[12px] text-mute">
            <Scale size={11} className="mt-[2px] shrink-0" aria-hidden /> <span className="min-w-0 truncate" title={s.norma}>{s.norma}</span>
          </span>
        )}
      </span>
      {conFlecha && <ChevronRight size={15} className="mt-0.5 shrink-0 text-mute group-hover:text-granate" aria-hidden />}
    </span>
  );
}

/** El panel de una señal (§14.4): chips, qué se encontró (DNI tras vidrio) y la norma entera. */
function DetalleSenal({ s }: { s: SenalRiesgo }) {
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <Severidad bandera={s.severidad} formato="pastilla" />
        {s.verificada === true && (
          <span className="pill border-moss/40 bg-moss/10 text-mossTexto">
            <ShieldCheck size={12} aria-hidden /> Cotejada
          </span>
        )}
      </ChipsDetalle>
      <BloqueDetalle titulo="Qué se encontró">
        {s.evidencia ? (
          <p className="text-inkSoft">
            <EvidenciaRedactada texto={s.evidencia} />
          </p>
        ) : (
          <p className="text-mute">Sin evidencia guardada en este resumen: el dictamen la cita completa.</p>
        )}
      </BloqueDetalle>
      {s.norma && (
        <BloqueDetalle titulo="La norma que cita">
          <p>{s.norma}</p>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

const pctMotivo = (x: number | null) => (x == null ? null : porcentaje(x * 100));

/**
 * Lo único que se muestra de un análisis en revisión humana: que lo está, y por qué. Los
 * motivos como chips (con su medida dentro); qué significa cada uno, a un clic.
 */
function EnRevision({ r, ocid, duracionMs, sharePath, compacto, className }: {
  r: Resultado | null;
  ocid: string;
  duracionMs?: number | null;
  sharePath?: string;
  compacto: boolean;
  className: string;
}) {
  const motivos = r?.revisionMotivos ?? [];
  return (
    <section className={`rounded-2xl border border-clay/40 bg-paper ${compacto ? "p-4" : "p-5"} ${className}`} aria-label="Resultado del análisis">
      <p className="text-[12px] font-medium text-mute">Resultado de la lectura</p>
      <div className="mt-0.5 flex items-center gap-1">
        <h2 className={`inline-flex items-center gap-2 font-display font-bold leading-tight text-ink ${compacto ? "text-lg" : "text-xl"}`}>
          <Eye size={18} className="text-clayTexto" aria-hidden />
          En revisión
        </h2>
        <Ayuda titulo="¿Qué significa «en revisión»?">
          Una persona del equipo lo revisa y decide publicarlo o descartarlo. Mientras tanto no se muestran su puntaje ni
          sus señales: no cuentan como hallazgos.
        </Ayuda>
      </div>
      <p className="mt-1 text-[13px] text-inkSoft">
        Una persona lo revisa antes de publicarlo.
        {duracionMs != null && duracionMs > 0 && <> El análisis tardó <span className="font-mono">{duracion(duracionMs)}</span>.</>}
      </p>
      {motivos.length > 0 ? (
        // Los motivos públicos, sin los nombres de las señales afectadas: nombrar en público una
        // señal que la autoevaluación marcó como sin respaldo sería publicarla por la puerta de atrás.
        <div className="mt-3" aria-label="Por qué está en revisión humana">
          <div className="flex items-center gap-1 text-[12px] font-semibold text-clayTexto">
            Por qué no se publicó todavía
            <Ayuda titulo="Por qué no se publicó todavía">
              {motivos.map((m, i) => (
                <span key={m.clave} className={i > 0 ? "mt-1.5 block" : "block"}>
                  <span className="font-semibold text-ink">{m.titulo}</span>
                  {m.valor != null && m.umbral != null && (
                    <span className="tabular-nums text-mute"> ({pctMotivo(m.valor)} · mínimo {pctMotivo(m.umbral)})</span>
                  )}
                  . {m.detalle}
                </span>
              ))}
            </Ayuda>
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {motivos.map((m) => (
              <li key={m.clave} className="pill border-line bg-paperSoft text-inkSoft">
                {m.titulo}
                {m.valor != null && <span className="font-semibold tabular-nums text-ink">{pctMotivo(m.valor)}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[12px] leading-snug text-mute">La autoevaluación no alcanzó el mínimo para publicar este análisis.</p>
      )}
      <div className="mt-4">
        <BarraCompartir compacto titulo={`Análisis ${r?.codigo ?? ocid} en Vigía Perú`} texto="En revisión" ruta={sharePath ?? `/app/auditoria/${encodeURIComponent(ocid)}`} />
      </div>
    </section>
  );
}
