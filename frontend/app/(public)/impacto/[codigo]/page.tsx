import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock, ShieldCheck, Sprout } from "lucide-react";
import { Avatar } from "@/components/financiar/RankingTable";
import { EstadoAporte, haceDias } from "@/components/financiar/EstadoAporte";
import { CuentaCta } from "@/components/financiar/CuentaCta";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { CompartirButton } from "@/components/auditoria/CompartirButton";
import {
  TIPO_FINANCIADOR_LABEL,
  formatPEN,
  formatPENCorto,
  getComprobante,
  mensajePublicoVisible,
  pct,
  type Comprobante,
  type ComprobanteContrato,
} from "@/lib/financiamiento";
import { getProcesamientos, type Procesamiento } from "@/lib/auditoria";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: { codigo: string } }) {
  const codigo = params.codigo.toUpperCase();
  const c = await getComprobante(codigo);
  const description = c
    ? `${c.financiador} financió la auditoría de ${c.contratos} contratos públicos en ${c.zona}. ${c.resumen.contratosConSenal ?? c.resumen.senales} con al menos una señal de riesgo.`
    : "Comprobante público de una auditoría financiada en Vigía Perú.";
  return {
    title: `Comprobante de impacto ${codigo}`,
    description,
    openGraph: { title: c ? `Auditoría financiada por ${c.financiador}` : `Comprobante de impacto ${codigo}`, description },
    twitter: { card: "summary_large_image" },
  };
}

/**
 * Semilla del tablero en vivo a partir del detalle del comprobante: así la página
 * pinta la lista al instante y sigue funcionando si el endpoint de procesamientos
 * no responde (el tablero la reemplaza en cuanto llega la primera respuesta).
 */
function semillaDesdeComprobante(c: Comprobante): Procesamiento[] {
  return c.detalle.map((k) => ({
    ocid: k.ocid,
    estado: k.procesadaAt ? "procesado" : "encolado",
    faseActual: k.procesadaAt ? "final" : null,
    faseIndex: k.procesadaAt ? 10 : null,
    iniciadoAt: null,
    finalizadoAt: k.procesadaAt,
    intentos: 0,
    contribucionCodigo: c.codigo,
    financiador: c.financiador,
    financiadorVisible: true,
    ubigeo: c.ubigeo,
    zona: c.zona,
    titulo: k.titulo,
    entidad: k.entidad,
    montoPen: k.valorReferencial,
    alertaCodigo: k.alertaCodigo,
    alertaEstado: k.alertaEstado ?? null,
    score: k.score,
    banderas: k.banderas,
  }));
}

const ESTADO: Record<string, { label: string; tone: string }> = {
  pendiente_pago: { label: "Pago pendiente de validación", tone: "text-amberTexto" },
  pagada: { label: "Pago confirmado, esperando contratos en cola", tone: "text-moss" },
  en_proceso: { label: "Pago confirmado, auditoría en proceso", tone: "text-moss" },
  procesada: { label: "Auditoría completada", tone: "text-moss" },
  rechazada: { label: "Aporte rechazado", tone: "text-rust" },
  reembolsada: { label: "Aporte reembolsado", tone: "text-inkSoft" },
};

/** Un lote del capital semilla no pasó por ningún pago: se dice qué es. */
function estadoInstitucional(estado: string, esperando: boolean): { label: string; tone: string } {
  if (estado === "procesada") return { label: "Aporte institucional (capital semilla), auditoría completada", tone: "text-moss" };
  if (esperando) return { label: "Aporte institucional (capital semilla), esperando documentos", tone: "text-amberTexto" };
  if (estado === "en_proceso") return { label: "Aporte institucional (capital semilla), auditoría en proceso", tone: "text-moss" };
  return { label: "Aporte institucional (capital semilla)", tone: "text-moss" };
}

/** Señal publicada: leída, con al menos una bandera y fuera de revisión humana (mismo filtro que el backend). */
const esSenalPublicada = (k: ComprobanteContrato) => k.procesadaAt != null && k.alertaEstado !== "revision" && k.banderas > 0;

const suma = (xs: ComprobanteContrato[]) => xs.reduce((n, k) => n + (k.valorReferencial ?? 0), 0);

export default async function ImpactoPage({ params }: { params: { codigo: string } }) {
  const c = await getComprobante(params.codigo);
  if (!c) notFound();
  const institucional = c.pasarela === "institucional";
  const p = pct(c.resumen.procesados, c.contratos);
  // El tablero en vivo arranca con lo que ya sabe el API de procesamientos; si aún no
  // responde (o la contribución no tiene asignaciones), usa el detalle del comprobante.
  const enVivo = await getProcesamientos({ codigo: c.codigo, limit: 300 });
  const semilla = enVivo && enVivo.length ? enVivo : semillaDesdeComprobante(c);

  const leidos = c.detalle.filter((k) => k.procesadaAt);
  const valorLeido = suma(leidos);
  const valorAsignado = suma(c.detalle);
  const esperandoDocumentos = (enVivo ?? []).filter((x) => x.estado === "esperando_documentos").length;
  const asignadaAt = c.detalle.map((k) => k.asignadaAt).filter(Boolean).sort()[0] ?? null;
  const esperando = c.resumen.procesados === 0 && c.resumen.asignados > 0 && esperandoDocumentos > 0;
  const est = institucional ? estadoInstitucional(c.estado, esperando) : ESTADO[c.estado] ?? { label: c.estado, tone: "text-inkSoft" };
  const mensaje = mensajePublicoVisible(c.mensajePublico, c.pasarela);
  // Primer contrato procesado: el resultado más antiguo del aporte, con enlace a su auditoría.
  const primero = [...leidos].sort((a, b) => String(a.procesadaAt).localeCompare(String(b.procesadaAt)))[0] ?? null;
  const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-3xl border border-line bg-paper p-5 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-mute">Comprobante de impacto</div>
              <h1 className="font-mono text-3xl font-bold text-ink">{c.codigo}</h1>
              <div className={`mt-1 inline-flex items-center gap-1.5 text-sm ${est.tone}`}>
                {institucional ? <Sprout size={14} aria-hidden /> : c.estado === "pendiente_pago" ? <Clock size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />} {est.label}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Avatar tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} />
              <div>
                <div className="text-sm font-semibold text-ink">{c.slug ? <Link href={`/aliado/${c.slug}`} className="hover:underline">{c.financiador}</Link> : c.financiador}</div>
                <div className="text-[11px] text-mute">{c.slug === "vigia-peru" ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[c.tipo] ?? c.tipo}</div>
              </div>
            </div>
          </div>

          {/* El aporte en una frase, armada con el detalle real del comprobante. */}
          <EnUnaFrase c={c} leidos={leidos} valorAsignado={valorAsignado} esperandoDocumentos={esperandoDocumentos} />

          <p className="mt-4 text-sm text-inkSoft">
            {institucional
              ? `Asignado el ${fecha(asignadaAt ?? c.createdAt)} con capital semilla de Vigía Perú.`
              : c.pagadaAt
                ? `Pago confirmado el ${fecha(c.pagadaAt)}.`
                : `Registrado el ${fecha(c.createdAt)}.`}
          </p>
          {mensaje && <p className="mt-3 border-l-2 border-amber pl-3 text-sm italic text-inkSoft">“{mensaje}”</p>}

          {/* Estado del aporte en 4 pasos */}
          <div className="mt-6">
            <EstadoAporte
              estado={c.estado}
              procesados={c.resumen.procesados}
              contratos={c.contratos}
              institucional={institucional}
              espera={c.resumen.asignados > 0 ? { asignadoHace: haceDias(asignadaAt), esperandoDocumentos, asignados: c.resumen.asignados } : null}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <K label="Leídos" v={`${c.resumen.procesados} / ${c.contratos}`} hint={(c.resumen.enRevision ?? 0) > 0 ? `${c.resumen.enRevision} en revisión humana` : undefined} />
            <K label="Por leer" v={String(Math.max(0, c.resumen.asignados - c.resumen.procesados))} hint={esperandoDocumentos > 0 ? `${esperandoDocumentos} esperan sus documentos` : undefined} />
            <K label="Con señal" v={String(c.resumen.contratosConSenal ?? leidos.filter(esSenalPublicada).length)} hint={`${c.resumen.senales} ${c.resumen.senales === 1 ? "señal" : "señales"} en total, con dictamen publicado`} />
            <K label="Valor de lo leído" v={formatPEN(valorLeido)} hint={valorAsignado > valorLeido ? `de ${formatPEN(valorAsignado)} asignados` : undefined} />
          </div>
          {(c.resumen.enRevision ?? 0) > 0 && (
            <p className="mt-2 text-[12px] text-inkSoft">
              <strong className="text-clayTexto">{c.resumen.enRevision}</strong> contrato{c.resumen.enRevision === 1 ? "" : "s"} leído{c.resumen.enRevision === 1 ? "" : "s"} {c.resumen.enRevision === 1 ? "espera" : "esperan"} revisión humana:
              la autoevaluación no alcanzó el umbral para publicar y una persona decide. No cuentan como señal.
            </p>
          )}
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-paperDeep" role="img" aria-label={`${p}% de los contratos ya leídos`}>
            <div className="h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
          </div>

          {/* primer contrato procesado */}
          {primero && (
            <Link href={`/app/auditoria/${encodeURIComponent(primero.ocid)}`} className="group mt-6 flex items-center justify-between gap-3 rounded-2xl border border-moss/30 bg-moss/5 px-4 py-3 text-sm text-ink transition-colors hover:border-moss/60">
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-moss">Primer contrato leído con este aporte</span>
                <span className="mt-0.5 block truncate font-medium">{primero.titulo ?? primero.ocid}</span>
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-[11px] text-inkSoft">
                  <span className="truncate">{primero.entidad ?? "Entidad no identificada"}</span>
                  <span className="shrink-0">
                    {primero.alertaEstado === "revision"
                      ? "en revisión humana"
                      : primero.banderas > 0
                        ? `${primero.banderas} señal${primero.banderas === 1 ? "" : "es"} de riesgo`
                        : "sin señales"}
                  </span>
                </span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-moss transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}

          {/* contratos en vivo */}
          <div className="mt-8">
            <h2 className="font-semibold text-ink">Contratos de este aporte</h2>
            <p className="mt-0.5 text-[13px] text-inkSoft">
              {c.estado === "pendiente_pago"
                ? "Los contratos se asignan al confirmar el pago. Desde ese momento verás aquí cada uno avanzar en vivo."
                : "Cada contrato pasa de la cola al análisis y al dictamen. Haz clic en uno para verlo fase por fase."}
            </p>
            <div className="mt-4">
              <TableroAuditoria codigo={c.codigo} autoRefreshMs={5000} limit={300} initial={semilla} />
            </div>
          </div>

          <div className="mt-8 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[13px] text-inkSoft">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            <span>
              {institucional ? "Este lote" : "Este aporte"} financió capacidad de lectura. Los contratos se asignaron por antigüedad y
              los dictámenes los escribieron los agentes de Vigía Perú, que no reciben el nombre de quien financió.
            </span>
          </div>

          {!institucional && <div className="mt-6"><CuentaCta codigo={c.codigo} /></div>}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <CompartirButton
              path={`/impacto/${c.codigo}`}
              titulo={`Auditoría financiada por ${c.financiador}`}
              texto={`${c.financiador} financió la auditoría de ${c.contratos} contratos públicos en ${c.zona}. ${c.resumen.contratosConSenal ?? c.resumen.senales} con al menos una señal de riesgo.`}
            />
            <Link href="/app/financiar" className="ml-auto rounded-lg bg-heroViolet px-3 py-1.5 font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">Ver otras zonas</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "Los 10 contratos de Cusco suman S/ 3.2 millones en 7 entidades; 8 tenían al menos una señal."
 * Todo sale del detalle del comprobante; si todavía no hay contratos asignados, no se dice nada.
 * La señal más fuerte (score más alto entre las publicadas) enlaza a su ficha.
 */
function EnUnaFrase({ c, leidos, valorAsignado, esperandoDocumentos }: {
  c: Comprobante;
  leidos: ComprobanteContrato[];
  valorAsignado: number;
  esperandoDocumentos: number;
}) {
  const n = c.detalle.length;
  if (n === 0) return null;
  const entidades = new Set(c.detalle.map((k) => k.entidad).filter(Boolean)).size;
  const conSenal = leidos.filter(esSenalPublicada);
  const nConSenal = c.resumen.contratosConSenal ?? conSenal.length;
  const fuerte = [...conSenal].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.banderas - a.banderas)[0] ?? null;
  const num = (v: number) => v.toLocaleString("es-PE");

  let desenlace: React.ReactNode;
  if (leidos.length === 0) {
    desenlace = esperandoDocumentos > 0
      ? <>; ninguno terminó de leerse todavía, {num(esperandoDocumentos)} esperan sus documentos.</>
      : <>; ninguno terminó de leerse todavía.</>;
  } else if (leidos.length < n) {
    desenlace = <>. Van <strong className="font-mono">{num(leidos.length)}</strong> leídos y <strong className="font-mono">{num(nConSenal)}</strong> {nConSenal === 1 ? "tenía" : "tenían"} al menos una señal.</>;
  } else {
    desenlace = <>; <strong className="font-mono">{num(nConSenal)}</strong> {nConSenal === 1 ? "tenía" : "tenían"} al menos una señal.</>;
  }

  return (
    <div className="mt-6 rounded-2xl border border-heroViolet/20 bg-heroViolet-soft/50 px-4 py-4 sm:px-5">
      <p className="font-serif text-lg leading-snug text-ink sm:text-xl">
        {n === 1 ? "El contrato" : <>Los <strong className="font-mono">{num(n)}</strong> contratos</>} de {c.zona}{" "}
        {n === 1 ? "vale" : "suman"} <strong className="whitespace-nowrap">{formatPENCorto(valorAsignado)}</strong> de valor referencial
        {entidades > 0 && <> en {num(entidades)} {entidades === 1 ? "entidad" : "entidades"}</>}
        {desenlace}
      </p>
      {fuerte && (
        <Link
          href={`/app/contratos/${encodeURIComponent(fuerte.ocid)}`}
          className="group mt-3 flex items-start justify-between gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm transition-colors hover:border-heroViolet/40"
        >
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-heroViolet">La señal más fuerte{fuerte.score != null ? `, puntaje ${fuerte.score}` : ""}</span>
            <span className="mt-0.5 line-clamp-2 font-medium text-ink">{fuerte.titulo ?? fuerte.ocid}</span>
            {fuerte.entidad && <span className="mt-0.5 block truncate text-[12px] text-inkSoft">{fuerte.entidad}</span>}
          </span>
          <ArrowRight size={16} className="mt-1 shrink-0 text-heroViolet transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function K({ label, v, hint }: { label: string; v: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3 shadow-card">
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="font-mono text-lg text-ink">{v}</div>
      {hint && <div className="text-[10px] leading-snug text-inkSoft">{hint}</div>}
    </div>
  );
}
