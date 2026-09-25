"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, ExternalLink, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ESTADO_UI as ESTADO_PROC, ORDEN_BARRA, SONDEO_OPERACION, type Estado } from "@/components/admin/procesamiento/tipos";
import { fmtPEN, PERFIL_LABEL, type Operacion, type Resumen, type SaludServicio } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puede, puedeVerSeccion, type Rol } from "@/lib/permisos";
import {
  Badge,
  claseBoton,
  EmptyState,
  ErrorBanner,
  Expandable,
  KeyValue,
  PageSection,
  Punto,
  SkeletonFilas,
  StatCard,
  StatGrid,
  actorCorto,
  estadoAporte,
  estadoLote,
  fmtFechaHora,
  fmtNum,
  hace,
  leerAccion,
  plural,
  type EntradaBitacora,
  type ParClave,
  type Tone,
} from "@/components/admin/ui";

/**
 * Resumen: lo que espera una decisión, la salud del sistema, la cola, el dinero y lo último
 * que pasó. Cada bloque lleva a su página; cada chequeo de salud se abre para ver el detalle
 * (y, plegado, el técnico: servicios, direcciones, códigos).
 *
 * Tres pedidos independientes (/operacion, /resumen, /log), cada uno pinta su parte apenas
 * llega: /operacion tarda segundos (consulta los servicios desde la API, nunca desde el
 * navegador) y no frena a los otros dos. Con la caché compartida (useAdmin), volver a esta
 * página pinta al instante lo último que se vio.
 */

/** El API ya manda estos campos (backend/api/src/lib/salud.ts); el tipo de lib/admin.ts no los declara. */
type Servicio = SaludServicio & { comprobando?: boolean };
type Relay = Operacion["relay"] & { ms?: number | null; error?: string | null };

/** Igual que en Procesamiento: el lote corre cada noche, así que más de 30 h sin correr es que no está corriendo. */
const HORAS_LOTE_PARADO = 30;

const FILAS_COLA: Estado[] = ["procesando", "encolado", "esperando_documentos", "error", "pendiente_de_procesamiento", "procesado"];

const duracion = (seg: number) => (seg < 90 ? `${Math.round(seg)} s` : `${Math.round(seg / 60)} min`);
const cuando = (iso: string | null | undefined) => fmtFechaHora(iso) ?? "sin dato";

/** Un chequeo de salud: una fila con su estado; al abrirla, datos, qué hacer y el detalle técnico. */
interface Chequeo {
  clave: string;
  nombre: string;
  tono: Tone;
  estado: string;
  frase: string;
  datos?: ParClave[];
  extra?: React.ReactNode;
  tecnico?: string[];
  href?: string;
  enlace?: string;
}

function tonoServicio(s: Servicio): Tone {
  return s.ok === true ? "ok" : s.ok === false ? "danger" : "pending";
}
function estadoServicio(s: Servicio): string {
  if (s.ok === true) return s.ms != null ? `responde en ${fmtNum(s.ms)} ms` : "responde";
  if (s.ok === false) return "no responde";
  return s.comprobando ? "comprobando…" : "sin respuesta: puede estar arrancando";
}

function chequeos(op: Operacion): Chequeo[] {
  const d = op.dispatcher;
  const sv = op.servicios.data as Servicio[];
  const nOk = sv.filter((s) => s.ok === true).length;
  const nCaidos = sv.filter((s) => s.ok === false).length;
  const nComprobando = sv.filter((s) => s.ok === null && s.comprobando).length;
  const nMudos = sv.filter((s) => s.ok === null && !s.comprobando).length;
  const r = op.relay as Relay;
  const g = op.ingesta;
  const l = op.lote;
  const finLote = l ? l.finalizadoAt ?? l.iniciadoAt : null;
  const horasLote = finLote ? (Date.now() - new Date(finLote).getTime()) / 3_600_000 : null;
  const loteParado = horasLote == null || horasLote > HORAS_LOTE_PARADO;

  const servicios: Pick<Chequeo, "tono" | "estado"> = !sv.length
    ? { tono: "muted", estado: "Sin dato" }
    : nOk === sv.length
      ? { tono: "ok", estado: "En orden" }
      : nCaidos === sv.length
        ? { tono: "danger", estado: "Caídos" }
        : nCaidos > 0
          ? { tono: "warn", estado: "Atención" }
          : { tono: "pending", estado: nComprobando ? "Comprobando…" : "Sin respuesta" };

  // Mismo orden de precedencia que antes: `comprobando` sólo cuenta mientras no hay respuesta.
  const relay: Pick<Chequeo, "tono" | "estado" | "frase"> =
    r.ok === true
      ? { tono: "ok", estado: "En orden", frase: "Lee el OECE desde una conexión peruana" }
      : r.ok === false
        ? { tono: "danger", estado: "Caído", frase: "No responde: los contratos nuevos no se pueden leer desde la nube" }
        : r.comprobando
          ? { tono: "pending", estado: "Comprobando…", frase: "comprobando…" }
          : r.url
            ? { tono: "muted", estado: "Sin dato", frase: "Todavía no se sabe si responde" }
            : { tono: "muted", estado: "Sin configurar", frase: "No hay un servidor configurado" };

  const lote: Pick<Chequeo, "tono" | "estado"> = !l
    ? { tono: "muted", estado: "Sin dato" }
    : l.estado === "error"
      ? { tono: "danger", estado: "Con error" }
      : l.estado === "procesando"
        ? { tono: "warn", estado: "Cargando" }
        : loteParado
          ? { tono: "warn", estado: "Sin correr" }
          : l.estado === "ok"
            ? { tono: "ok", estado: "En orden" }
            : { tono: estadoLote(l.estado).tono, estado: estadoLote(l.estado).label };

  return [
    {
      clave: "dispatcher",
      nombre: "Procesamiento automático",
      tono: d.ok ? "ok" : "warn",
      estado: d.ok ? "En orden" : "Atrasado",
      frase: d.activos > 0 ? `Leyendo ${plural(d.activos, "contrato", "contratos")} ahora` : d.ultimaCorrida ? `Corrió ${hace(d.ultimaCorrida)}` : "Todavía no corrió",
      extra: !d.ok && (
        <p className="text-[13px] text-inkSoft">
          {d.colgados > 0 ? "Hay contratos que dejaron de dar señal mientras se leían." : "Hay contratos en cola y no corre desde hace más de una hora."}
        </p>
      ),
      datos: [
        { etiqueta: "Última corrida", valor: fmtFechaHora(d.ultimaCorrida) },
        { etiqueta: "Leídos en 24 h", valor: fmtNum(d.procesados24h) },
        { etiqueta: "Con error", valor: fmtNum(d.errores) },
        { etiqueta: "Sin dar señal", valor: fmtNum(d.colgados), pista: "más de 20 min callados" },
      ],
      tecnico: [`dispatcher: inicio ${cuando(d.ultimoInicio)}, último latido ${cuando(d.ultimoLatido)}, fin ${cuando(d.ultimoFin)}`],
      href: "/admin/procesamientos",
      enlace: "Ver procesamiento",
    },
    {
      clave: "servicios",
      nombre: "Servicios de agentes",
      ...servicios,
      frase: [
        `${nOk} de ${sv.length} responden`,
        nComprobando > 0 && `${nComprobando} en comprobación`,
        nMudos > 0 && "vuelve a mirar en un minuto",
      ].filter(Boolean).join("; "),
      extra: (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {sv.map((s) => (
            <li key={s.perfil} className="flex min-w-0 items-center gap-2 text-[13px]">
              <Punto tono={tonoServicio(s)} />
              <span className="font-medium text-ink">{PERFIL_LABEL[s.perfil]?.split(" ")[0] ?? s.perfil}</span>
              <span className="min-w-0 truncate text-inkSoft">{estadoServicio(s)}</span>
            </li>
          ))}
        </ul>
      ),
      tecnico: [
        ...sv.map((s) => `${s.nombre}: ${[s.error ?? (s.status ? `HTTP ${s.status}` : null), s.ms != null && `${s.ms} ms`, s.detalle?.model, s.url].filter(Boolean).join(", ")}`),
        `Consultado ${cuando(op.servicios.consultadoAt)}${op.servicios.cacheado ? " (caché 60 s)" : ""}`,
      ],
    },
    {
      clave: "relay",
      nombre: "Servidor de Lima",
      ...relay,
      extra: r.ok === false && (
        <p className="text-[13px] text-inkSoft">
          Los contratos vuelven a la cola sin gastar intentos. Para destrabarlo, reinicia el servidor en su proveedor o corre el procesamiento desde una conexión peruana.
        </p>
      ),
      tecnico: [
        `relay: ${r.url ?? "sin dirección configurada"}`,
        ...(r.error ? [`Respuesta: ${r.error}`] : []),
        ...(r.ms != null ? [`${r.ms} ms`] : []),
        ...(r.consultadoAt ? [`Consultado ${cuando(r.consultadoAt)}`] : []),
      ],
    },
    {
      clave: "ingesta",
      nombre: "Convocatorias nuevas",
      tono: g.ok ? "ok" : "warn",
      estado: g.ok ? "En orden" : "Atrasada",
      frase: g.ultimaIngesta ? `Última carga ${hace(g.ultimaIngesta)}` : "Todavía no hay cargas",
      extra: !g.ok && <p className="text-[13px] text-inkSoft">La carga es diaria y lleva más de 36 h sin traer convocatorias.</p>,
      datos: [
        { etiqueta: "Nuevas en 24 h", valor: fmtNum(g.ultimas24h) },
        { etiqueta: "Contratos en total", valor: fmtNum(g.total) },
        { etiqueta: "Última carga", valor: fmtFechaHora(g.ultimaIngesta) },
      ],
      href: "/admin/cobertura",
      enlace: "Ver cobertura",
    },
    {
      clave: "lote",
      nombre: "Lote nocturno de documentos",
      ...lote,
      frase: l
        ? `${fmtNum(l.ok)} de ${fmtNum(l.total)} documentos${l.fallidos ? `, ${fmtNum(l.fallidos)} fallidos` : ""}, ${hace(finLote) ?? "sin fecha"}`
        : "Todavía no corrió ningún lote",
      extra: l && loteParado && (
        <p className="text-[13px] text-inkSoft">
          Corre cada noche desde el servidor de Lima. Mientras no corra, los contratos financiados se quedan esperando sus documentos.
        </p>
      ),
      datos: l ? [
        { etiqueta: "Bajados", valor: `${fmtNum(l.ok)} de ${fmtNum(l.total)}` },
        { etiqueta: "Fallidos", valor: fmtNum(l.fallidos) },
        { etiqueta: "Empezó", valor: fmtFechaHora(l.iniciadoAt) },
        { etiqueta: "Terminó", valor: fmtFechaHora(l.finalizadoAt) },
      ] : undefined,
      tecnico: l ? [`${l.id}: estado ${l.estado}`, ...(l.error ? [`Error: ${l.error}`] : [])] : undefined,
      href: "/admin/cobertura",
      enlace: "Ver cobertura",
    },
  ];
}

export default function AdminHome() {
  const opQ = useAdmin<Operacion>("/operacion", SONDEO_OPERACION);
  const resQ = useAdmin<Resumen>("/resumen", { refreshInterval: 60_000 });
  // Misma clave que la Bitácora: comparten caché.
  const logQ = useAdmin<{ data: EntradaBitacora[] }>("/log", { refreshInterval: 60_000 });
  // La plata (aportes por validar, financiamiento) es del admin: al revisor no se le muestra.
  const { rol } = useSesionEquipo();
  const verFinanciamiento = puede(rol, "ver_financiamiento");
  const op = opQ.data ?? null;
  const data = resQ.data ?? null;
  const log = (logQ.data?.data ?? []).slice(0, 8);
  const loading = opQ.isValidating || resQ.isValidating || logQ.isValidating;
  // Cargando = todavía sin datos ni error: cada bloque muestra su propio esqueleto.
  const cargandoOp = !op && !opQ.error;
  const cargandoRes = !data && !resQ.error;
  const cargandoLog = !logQ.data && !logQ.error;

  function load() {
    void opQ.mutate();
    void resQ.mutate();
    void logQ.mutate();
  }

  const k = data?.kpi;
  const cola = op?.cola ?? {};
  const totalCola = FILAS_COLA.reduce((a, e) => a + (cola[e] ?? 0), 0);
  const salud = op ? chequeos(op) : [];
  const enOrden = salud.filter((c) => c.tono === "ok").length;
  const pedidos = op?.pedidos ?? null;
  const descargas = pedidos ? pedidos.pendientes + pedidos.descargando : null;

  return (
    <AdminShell
      title="Resumen"
      subtitle="Lo que espera una decisión y cómo está el sistema, en una pantalla"
      actions={
        <button onClick={load} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-8">
        <ErrorBanner error={opQ.error} titulo="No se pudo leer el estado del sistema" onReintentar={() => opQ.mutate()} />

        <PageSection titulo="Espera una decisión">
          <StatGrid columnas={verFinanciamiento ? 3 : 2}>
            <StatCard
              etiqueta="Alertas en revisión"
              valor={op?.revision.n ?? null}
              cargando={cargandoOp}
              tono="pending"
              destacado={(op?.revision.n ?? 0) > 0}
              pista={op ? (op.revision.n > 0 && op.revision.masAntigua ? `la más antigua espera desde ${hace(op.revision.masAntigua)}` : "nada frenado") : undefined}
              href="/admin/revision"
            />
            {verFinanciamiento && (
              <StatCard
                etiqueta="Aportes por validar"
                valor={op?.aportes.pendientesValidar ?? null}
                cargando={cargandoOp}
                tono="warn"
                destacado={(op?.aportes.pendientesValidar ?? 0) > 0}
                pista={
                  op
                    ? op.aportes.pendientesValidar > 0
                      ? [`${fmtNum(op.aportes.conComprobante)} con comprobante`, op.aportes.esperandoContratos > 0 && `${plural(op.aportes.esperandoContratos, "espera", "esperan")} contratos`].filter(Boolean).join(", ")
                      : "nada por validar"
                    : undefined
                }
                href="/admin/contribuciones?estado=pendiente_pago"
              />
            )}
            <StatCard
              etiqueta="Descargas pendientes"
              valor={descargas}
              cargando={cargandoOp}
              tono={pedidos?.fallidos ? "danger" : descargas ? "pending" : "neutral"}
              destacado={!!pedidos?.fallidos}
              pista={
                pedidos
                  ? pedidos.fallidos
                    ? `${plural(pedidos.fallidos, "falló", "fallaron")}`
                    : `${plural(pedidos.listos24h, "atendida", "atendidas")} en 24 h`
                  : op
                    ? "sin dato de descargas"
                    : undefined
              }
              href="/admin/procesamientos"
            />
          </StatGrid>
        </PageSection>

        <div className="grid gap-8 xl:grid-cols-2">
          <PageSection titulo="Salud del sistema" meta={op ? `${enOrden} de ${salud.length} en orden` : undefined} className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              {op ? (
                <ul className="divide-y divide-line">
                  {salud.map((c) => <FilaChequeo key={c.clave} c={c} />)}
                </ul>
              ) : cargandoOp ? (
                <SkeletonFilas filas={5} columnas={2} />
              ) : (
                <EmptyState compacto titulo="El estado no llegó" descripcion="Reintenta desde el aviso de arriba." />
              )}
            </div>
          </PageSection>

          <PageSection
            titulo="Cola de procesamiento"
            meta={op ? plural(totalCola, "contrato", "contratos") : undefined}
            acciones={
              <Link href="/admin/procesamientos" className={claseBoton("secundario")}>
                Abrir <ArrowRight size={12} aria-hidden />
              </Link>
            }
            className="min-w-0"
          >
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              {op ? (
                <>
                  {totalCola > 0 && (
                    <div className="px-4 pt-4" aria-hidden>
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-paperDeep">
                        {ORDEN_BARRA.map((e) => ((cola[e] ?? 0) > 0 ? <span key={e} className={ESTADO_PROC[e].barra} style={{ width: `${((cola[e] ?? 0) / totalCola) * 100}%` }} /> : null))}
                      </div>
                    </div>
                  )}
                  <ul className="mt-2 divide-y divide-line">
                    {FILAS_COLA.map((e) => (
                      <li key={e}>
                        <FilaCola href={`/admin/procesamientos?estado=${e}`} tono={ESTADO_PROC[e].tono} etiqueta={ESTADO_PROC[e].label} n={cola[e] ?? 0} />
                      </li>
                    ))}
                    <li>
                      <FilaCola href="/admin/revision" tono="pending" etiqueta="En revisión humana" n={cola.revision ?? op.revision.n} />
                    </li>
                  </ul>
                </>
              ) : cargandoOp ? (
                <SkeletonFilas filas={6} columnas={2} />
              ) : (
                <EmptyState compacto titulo="La cola no llegó" descripcion="Reintenta desde el aviso de arriba." />
              )}
              <p className="border-t border-line px-4 py-2.5 text-[12px] text-inkSoft">
                {k ? <><span className="font-mono text-ink">{fmtNum(k.colaGlobal)}</span> contratos esperan financiamiento en todo el país.</> : cargandoRes ? "Contando los que esperan financiamiento…" : "Sin dato de la cola sin financiar."}
              </p>
            </div>
          </PageSection>
        </div>

        {verFinanciamiento && (
          <PageSection
            titulo="Financiamiento"
            acciones={
              <>
                <Link href="/admin/contribuciones" className={claseBoton("secundario")}>Contribuciones</Link>
                <Link href="/admin/financiadores" className={claseBoton("secundario")}>Financiadores</Link>
              </>
            }
          >
            <ErrorBanner error={resQ.error} titulo="No se pudieron leer las cifras de financiamiento" onReintentar={() => resQ.mutate()} className="mb-3" />
            <StatGrid columnas={4}>
              <StatCard etiqueta="Recaudado" valor={k ? fmtPEN(k.montoConfirmadoPen) : null} cargando={cargandoRes} pista={k ? `${fmtPEN(k.montoMesPen)} este mes` : undefined} href="/admin/contribuciones?estado=todas" />
              <StatCard
                etiqueta="Contratos financiados"
                valor={k?.contratosFinanciados ?? null}
                cargando={cargandoRes}
                pista={k ? `${fmtNum(k.procesados)} leídos de ${fmtNum(k.asignados)} asignados` : undefined}
                href="/admin/procesamientos"
              />
              <StatCard etiqueta="Señales halladas" valor={k?.senales ?? null} cargando={cargandoRes} pista={k?.enRevision ? `sin contar ${fmtNum(k.enRevision)} en revisión` : undefined} />
              <StatCard
                etiqueta="Financiadores"
                valor={k?.financiadores ?? null}
                cargando={cargandoRes}
                pista={k ? (k.financiadoresOcultos ? `${plural(k.financiadoresOcultos, "oculto", "ocultos")} al público` : "todos visibles") : undefined}
                href="/admin/financiadores"
              />
            </StatGrid>
            {data && data.porEstado.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-inkSoft">Aportes</span>
                <ul className="contents">
                  {data.porEstado.map((e) => {
                    const x = estadoAporte(e.estado);
                    return (
                      <li key={e.estado}>
                        <Link
                          href={`/admin/contribuciones?estado=${encodeURIComponent(e.estado)}`}
                          className="inline-flex items-center gap-2 rounded-full border border-line bg-paper py-1 pl-1 pr-3 text-[12px] transition-colors duration-rapido hover:border-ink/25"
                        >
                          <Badge tono={x.tono} punto>{x.label}</Badge>
                          <span className="font-mono text-ink">{fmtNum(e.n)}</span>
                          <span className="text-mute">{fmtPEN(e.monto)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </PageSection>
        )}

        <div className="grid gap-8 xl:grid-cols-2">
          <PageSection
            titulo="Últimos procesados"
            acciones={
              <Link href="/app/auditoria" target="_blank" className={claseBoton("secundario")}>
                <ExternalLink size={12} aria-hidden /> Tablero público
              </Link>
            }
            className="min-w-0"
          >
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              {op ? (
                op.ultimos.length ? (
                  <ul className="divide-y divide-line">
                    {op.ultimos.map((u) => (
                      <li key={u.ocid}>
                        <Link href={`/app/auditoria/${encodeURIComponent(u.ocid)}`} target="_blank" className="block px-4 py-2.5 transition-colors duration-rapido hover:bg-paperSoft">
                          <span className="flex items-start justify-between gap-3">
                            <span className="line-clamp-1 min-w-0 text-[13px] font-medium text-ink" title={u.titulo ?? undefined}>{u.titulo ?? `Contrato ${u.ocid}`}</span>
                            <span className="shrink-0 text-[11px] text-mute" title={fmtFechaHora(u.finalizadoAt) ?? undefined}>{hace(u.finalizadoAt)}</span>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
                            <span className="font-mono">{u.ocid}</span>
                            {u.score != null && <span>puntaje {u.score}</span>}
                            {u.segundos != null && <span>leído en {duracion(u.segundos)}</span>}
                            {u.alertaEstado === "revision" && <Badge tono="pending">En revisión</Badge>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compacto icono={<ShieldCheck size={18} />} titulo="Nada procesado todavía" descripcion="Valida un aporte o procesa un lote: lo que se lea aparece aquí." />
                )
              ) : cargandoOp ? (
                <SkeletonFilas filas={5} columnas={2} />
              ) : (
                <EmptyState compacto titulo="La lista no llegó" descripcion="Reintenta desde el aviso de arriba." />
              )}
            </div>
          </PageSection>

          <PageSection
            titulo="Actividad reciente"
            acciones={
              <Link href="/admin/bitacora" className={claseBoton("secundario")}>
                Ver bitácora <ArrowRight size={12} aria-hidden />
              </Link>
            }
            className="min-w-0"
          >
            <ErrorBanner error={logQ.error} titulo="No se pudo leer la bitácora" onReintentar={() => logQ.mutate()} className="mb-3" />
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              {cargandoLog ? (
                <SkeletonFilas filas={5} columnas={2} />
              ) : log.length ? (
                <ol className="divide-y divide-line">
                  {log.map((e, i) => <FilaActividad key={`${e.createdAt}-${i}`} e={e} rol={rol} />)}
                </ol>
              ) : (
                <EmptyState compacto icono={<ScrollText size={18} />} titulo="Sin acciones registradas" descripcion="Validar un aporte, publicar una alerta o editar un ajuste deja aquí una línea con tu correo." />
              )}
            </div>
          </PageSection>
        </div>
      </div>
    </AdminShell>
  );
}

/** Un chequeo de salud: la fila dice el estado; se abre para ver los datos, qué hacer y el detalle técnico. */
function FilaChequeo({ c }: { c: Chequeo }) {
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
          <Punto tono={c.tono} className="mt-1.5" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">{c.nombre}</span>
            <span className="block text-[12px] leading-snug text-inkSoft">{c.frase}</span>
          </span>
          <Badge tono={c.tono}>{c.estado}</Badge>
          <ChevronDown size={14} className="mt-0.5 shrink-0 text-inkSoft transition-transform duration-rapido [details[open]>summary_&]:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-3 sm:pl-9">
          {c.extra}
          {c.datos && <KeyValue items={c.datos} columnas={4} />}
          {(c.href || c.tecnico?.length) && (
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              {c.href && (
                <Link href={c.href} className={claseBoton("secundario", "xs")}>
                  {c.enlace} <ArrowRight size={11} aria-hidden />
                </Link>
              )}
              {c.tecnico?.length ? (
                <Expandable variante="linea" resumen="Detalle técnico" className="min-w-0 flex-1 pt-0.5">
                  <ul className="space-y-1 rounded-lg bg-paperSoft px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
                    {c.tecnico.map((t, i) => <li key={i} className="break-all">{t}</li>)}
                  </ul>
                </Expandable>
              ) : null}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function FilaCola({ href, tono, etiqueta, n }: { href: string; tono: Tone; etiqueta: string; n: number }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-2 transition-colors duration-rapido hover:bg-paperSoft">
      <Punto tono={tono} />
      <span className="min-w-0 flex-1 text-[13px] text-ink">{etiqueta}</span>
      <span className={n ? "font-mono text-sm font-semibold text-ink" : "font-mono text-sm text-mute"}>{fmtNum(n)}</span>
    </Link>
  );
}

/**
 * Una línea de la bitácora en frase; si la acción tocó algo que se puede abrir, la fila entera lleva
 * ahí. Sólo si quien mira puede entrar a esa sección: a un revisor no se le ofrece un enlace a
 * Contribuciones que termina en "sección sólo para administradores" (sin perfil todavía, tampoco).
 */
function FilaActividad({ e, rol }: { e: EntradaBitacora; rol: Rol | null }) {
  const a = leerAccion(e);
  const href = a.href && (a.externo || (rol && puedeVerSeccion(rol, a.href.split("?")[0]))) ? a.href : null;
  const cuerpo = (
    <span className="flex items-start gap-3">
      <Punto tono={a.tono} className="mt-1.5" />
      <span className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="font-medium text-ink" title={e.actor}>{actorCorto(e.actor)}</span> <span className="text-inkSoft">{a.frase}</span>
        {a.objeto && <span className="text-ink">: {a.objeto}</span>}
        {a.resumen && <span className="mt-0.5 block truncate text-[12px] text-mute">{a.resumen}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-mute" title={fmtFechaHora(e.createdAt) ?? undefined}>{hace(e.createdAt)}</span>
    </span>
  );
  return (
    <li>
      {href ? (
        <Link href={href} target={a.externo ? "_blank" : undefined} className="block px-4 py-2.5 transition-colors duration-rapido hover:bg-paperSoft">
          {cuerpo}
        </Link>
      ) : (
        <div className="px-4 py-2.5">{cuerpo}</div>
      )}
    </li>
  );
}
