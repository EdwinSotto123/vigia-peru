"use client";

import { rutaContrato } from "@/lib/rutas";
import Link from "next/link";
import { ArrowRight, ChevronDown, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Ayuda } from "@/components/patrones/Ayuda";
import { cn } from "@/lib/utils";
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
 * Resumen, en el orden de todo el panel: arriba lo que espera una decisión (tres cifras sueltas, cada una
 * lleva a su bandeja); debajo, dos columnas. A la izquierda el sistema: la salud (un renglón por chequeo, que
 * se abre para ver los datos, qué hacer y, plegado, el detalle técnico), la cola en una línea y los últimos
 * contratos leídos. A la derecha la plata (una franja de cifras) y lo último de la bitácora. Cada bloque
 * lleva a su página y lo que explica va en su ⓘ (rediseño del 2026-10-30: eran 7 cajas dentro de cajas y
 * 3.6 pantallas en el celular).
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

/** La bitácora muestra 8 líneas con las dos columnas (xl) y 6 cuando todo va en una: en el celular, menos scroll. */
const ACTIVIDAD_ANCHO = 8;
const ACTIVIDAD_ANGOSTO = 6;

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
        <p className="text-meta text-inkSoft">
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
            <li key={s.perfil} className="flex min-w-0 items-center gap-2 text-meta">
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
        <p className="text-meta text-inkSoft">
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
      extra: !g.ok && <p className="text-meta text-inkSoft">La carga es diaria y lleva más de 36 h sin traer convocatorias.</p>,
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
        <p className="text-meta text-inkSoft">
          Corre cada noche desde el servidor de Lima. Mientras no corra, los contratos de la cola se quedan esperando sus documentos.
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
  const log = (logQ.data?.data ?? []).slice(0, ACTIVIDAD_ANCHO);
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
  const enRevision = op ? cola.revision ?? op.revision.n : 0;
  const salud = op ? chequeos(op) : [];
  const enOrden = salud.filter((c) => c.tono === "ok").length;
  const pedidos = op?.pedidos ?? null;
  const descargas = pedidos ? pedidos.pendientes + pedidos.descargando : null;
  // Contratos con aporte asignado que todavía no se leyeron (desde el fondo común ya no se compra la lectura de uno).
  const esperanLectura = k ? Math.max(0, k.asignados - k.procesados) : 0;

  return (
    <AdminShell
      title="Resumen"
      subtitle="Lo que espera una decisión y cómo está el sistema"
      actions={
        <button onClick={load} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-4 sm:space-y-6">
        <ErrorBanner error={opQ.error} titulo="No se pudo leer el estado del sistema" onReintentar={() => opQ.mutate()} />

        <PageSection titulo="Espera una decisión">
          {/* Tres cifras sueltas, sin una caja que las envuelva: cada una es el atajo a su bandeja. En el celular, las
              alertas a lo ancho (su pista es larga) y las otras dos lado a lado: tres apiladas medían 200 px. */}
          <div className={cn("grid gap-2", verFinanciamiento ? "grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2")}>
            <StatCard
              etiqueta="Alertas en revisión"
              valor={op?.revision.n ?? null}
              cargando={cargandoOp}
              tono="pending"
              destacado={(op?.revision.n ?? 0) > 0}
              pista={op ? (op.revision.n > 0 && op.revision.masAntigua ? `la más antigua espera desde ${hace(op.revision.masAntigua)}` : "nada frenado") : undefined}
              href="/admin/revision"
              className={verFinanciamiento ? "col-span-2 sm:col-span-1" : undefined}
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
          </div>
        </PageSection>

        {/* Dos columnas que se apilan cada una por su cuenta: con una grilla de filas, la columna más corta
            dejaba un hueco hasta la fila siguiente. Izquierda, el sistema; derecha, la plata y lo que pasó. */}
        <div className="grid items-start gap-4 sm:gap-6 xl:grid-cols-2">
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <PageSection
              titulo="Salud del sistema"
              meta={op ? `${enOrden} de ${salud.length} en orden` : undefined}
              ayuda={
                <Ayuda titulo="¿Qué se revisa?">
                  El procesamiento automático, los servicios de agentes, el servidor de Lima (lee el OECE desde una conexión
                  peruana), las convocatorias nuevas y el lote nocturno de documentos. Abre un chequeo para ver sus datos, qué
                  hacer y el detalle técnico.
                </Ayuda>
              }
            >
              <div className={CAJA}>
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
              // «Cola» a secas en el celular: con el nombre entero, el botón «Abrir» bajaba a otro renglón.
              titulo={<>Cola<span className="hidden sm:inline"> de procesamiento</span></>}
              meta={op ? plural(totalCola, "contrato", "contratos") : undefined}
              ayuda={
                <Ayuda titulo="¿Qué es cada estado?">
                  {AYUDA_COLA.map(([estado, que]) => (
                    <span key={estado} className="block">
                      <strong className="font-semibold">{estado}:</strong> {que}.
                    </span>
                  ))}
                  <span className="mt-1.5 block">Toca un estado para ver esos contratos.</span>
                </Ayuda>
              }
              acciones={
                <Link href="/admin/procesamientos" className={claseBoton("secundario")}>
                  Abrir <ArrowRight size={13} aria-hidden />
                </Link>
              }
            >
              <div className={CAJA}>
                {op ? (
                  // La cola en una línea: la barra del reparto (desde sm; en el celular, la línea de cifras basta) y la
                  // cifra de cada estado que tiene algo (una lista de ceros no dice nada). Qué significa cada uno, en el ⓘ.
                  <div className="space-y-2.5 px-4 py-3">
                    {totalCola > 0 && (
                      <div className="hidden h-2 w-full overflow-hidden rounded-full bg-paperDeep sm:flex" aria-hidden>
                        {ORDEN_BARRA.map((e) => ((cola[e] ?? 0) > 0 ? <span key={e} className={ESTADO_PROC[e].barra} style={{ width: `${((cola[e] ?? 0) / totalCola) * 100}%` }} /> : null))}
                      </div>
                    )}
                    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta">
                      {FILAS_COLA.filter((e) => (cola[e] ?? 0) > 0).map((e) => (
                        <li key={e}>
                          <EstadoCola href={`/admin/procesamientos?estado=${e}`} tono={ESTADO_PROC[e].tono} n={cola[e] ?? 0} etiqueta={ESTADO_PROC[e].corto} />
                        </li>
                      ))}
                      {enRevision > 0 && (
                        <li>
                          <EstadoCola href="/admin/revision" tono="pending" n={enRevision} etiqueta="en revisión humana" />
                        </li>
                      )}
                      {totalCola === 0 && !enRevision && <li className="text-inkSoft">Nada en cola ni en revisión: todo lo asignado ya se leyó.</li>}
                    </ul>
                    <p className="text-rotulo text-mute">
                      {k ? (
                        <>
                          <span className="font-semibold tabular-nums text-ink">{fmtNum(k.colaGlobal)}</span> contratos más esperan turno en todo el país
                        </>
                      ) : cargandoRes ? (
                        "Contando la cola del país…"
                      ) : (
                        "Sin dato de la cola del país"
                      )}
                    </p>
                  </div>
                ) : cargandoOp ? (
                  <SkeletonFilas filas={2} columnas={2} />
                ) : (
                  <EmptyState compacto titulo="La cola no llegó" descripcion="Reintenta desde el aviso de arriba." />
                )}
              </div>
            </PageSection>

            <PageSection
              titulo="Últimos procesados"
              acciones={
                <Link href="/admin/procesamientos?estado=procesado" className={claseBoton("secundario")}>
                  Ver procesados <ArrowRight size={13} aria-hidden />
                </Link>
              }
            >
              <div className={CAJA}>
                {op ? (
                  op.ultimos.length ? (
                    <ul className="divide-y divide-line">
                      {/* recorte: el resumen muestra los 5 últimos; la lista entera está en Procesamiento (enlace de arriba). */}
                      {op.ultimos.slice(0, 5).map((u) => (
                        <li key={u.ocid}>
                          <Link href={rutaContrato(u.ocid, "vivo")} target="_blank" className={cn(FILA, "block")}>
                            <span className="flex items-start justify-between gap-3">
                              <span className="line-clamp-1 min-w-0 text-meta font-medium text-ink" title={u.titulo ?? undefined}>{u.titulo ?? `Contrato ${u.ocid}`}</span>
                              <span className="shrink-0 text-rotulo text-mute" title={fmtFechaHora(u.finalizadoAt) ?? undefined}>{hace(u.finalizadoAt)}</span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute">
                              <span className="font-mono">{u.ocid}</span>
                              {u.score != null && <span>puntaje <span className="tabular-nums text-inkSoft">{u.score}</span></span>}
                              {u.segundos != null && <span>leído en {duracion(u.segundos)}</span>}
                              {u.alertaEstado === "revision" && <Badge tono="pending">En revisión</Badge>}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState compacto icono={<ShieldCheck size={18} />} titulo="Nada procesado todavía" descripcion="Cuando se lea un contrato de la cola, aparece aquí." />
                  )
                ) : cargandoOp ? (
                  <SkeletonFilas filas={5} columnas={2} />
                ) : (
                  <EmptyState compacto titulo="La lista no llegó" descripcion="Reintenta desde el aviso de arriba." />
                )}
              </div>
            </PageSection>
          </div>

          <div className="min-w-0 space-y-4 sm:space-y-6">
            {verFinanciamiento && (
              // Sin botones en la cabecera: Recaudado lleva a Contribuciones y Financiadores a su página (las cifras son
              // los atajos). Desde el fondo común no se compra la lectura de un contrato: se cuenta lo leído con aportes.
              <PageSection
                titulo="Financiamiento"
                ayuda={
                  <Ayuda titulo="¿Qué cuentan estas cifras?">
                    <span className="block">Recaudado: los aportes confirmados (pagados, en proceso o procesados).</span>
                    <span className="block">Leídos con aportes: contratos que ya se leyeron con un aporte asignado. Los aportes van a un fondo común, no a la lectura de un contrato.</span>
                    <span className="block">Señales halladas: de esos contratos, los que tienen al menos una señal publicada; los que esperan revisión van aparte.</span>
                  </Ayuda>
                }
              >
                <ErrorBanner error={resQ.error} titulo="No se pudieron leer las cifras de financiamiento" onReintentar={() => resQ.mutate()} className="mb-3" />
                {/* `tarjeta`: la StatGrid ya es la caja; dentro de una `.tarjeta` sus cifras van sin marco (CifrasEnFila).
                    Una franja de cifras, no cuatro cajas dentro de otra. De a dos por fila: en media pantalla, cuatro
                    en fila dejaban celdas de 70 px y un monto de cinco cifras se salía. */}
                <StatGrid columnas={2} className="tarjeta">
                  <StatCard etiqueta="Recaudado" valor={k ? fmtPEN(k.montoConfirmadoPen) : null} cargando={cargandoRes} pista={k ? `${fmtPEN(k.montoMesPen)} este mes` : undefined} href="/admin/contribuciones?estado=todas" />
                  <StatCard
                    etiqueta="Leídos con aportes"
                    valor={k?.procesados ?? null}
                    cargando={cargandoRes}
                    pista={k ? (esperanLectura > 0 ? `${fmtNum(esperanLectura)} esperan lectura` : "ninguno espera") : undefined}
                    href="/admin/procesamientos"
                  />
                  <StatCard etiqueta="Señales halladas" valor={k?.senales ?? null} cargando={cargandoRes} pista={k?.enRevision ? `${fmtNum(k.enRevision)} en revisión aparte` : undefined} />
                  <StatCard
                    etiqueta="Financiadores"
                    valor={k?.financiadores ?? null}
                    cargando={cargandoRes}
                    pista={k ? (k.financiadoresOcultos ? `${plural(k.financiadoresOcultos, "oculto", "ocultos")} al público` : "todos visibles") : undefined}
                    href="/admin/financiadores"
                  />
                </StatGrid>
                {data && data.porEstado.length > 0 && (
                  // Los aportes por estado en UNA fila: en el celular se desliza de costado en vez de partirse en renglones.
                  <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
                    <span className="shrink-0 text-meta font-medium text-inkSoft">Aportes</span>
                    <ul className="contents">
                      {data.porEstado.map((e) => {
                        const x = estadoAporte(e.estado);
                        return (
                          <li key={e.estado} className="shrink-0">
                            <Link
                              href={`/admin/contribuciones?estado=${encodeURIComponent(e.estado)}`}
                              className="inline-flex min-h-[32px] items-center gap-2 whitespace-nowrap rounded-full border border-line bg-paperSoft py-1 pl-1 pr-3 text-meta transition-colors duration-rapido hover:border-paperEdge hover:bg-paperDeep/60"
                            >
                              <Badge tono={x.tono} punto>{x.label}</Badge>
                              <span className="font-semibold tabular-nums text-ink">{fmtNum(e.n)}</span>
                              <span className="tabular-nums text-mute">{fmtPEN(e.monto)}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </PageSection>
            )}

            <PageSection
              titulo="Actividad reciente"
              acciones={
                <Link href="/admin/bitacora" className={claseBoton("secundario")}>
                  Ver bitácora <ArrowRight size={13} aria-hidden />
                </Link>
              }
            >
              <ErrorBanner error={logQ.error} titulo="No se pudo leer la bitácora" onReintentar={() => logQ.mutate()} className="mb-3" />
              <div className={CAJA}>
                {cargandoLog ? (
                  <SkeletonFilas filas={ACTIVIDAD_ANGOSTO} columnas={2} />
                ) : log.length ? (
                  <ol className="divide-y divide-line">
                    {log.map((e, i) => (
                      <FilaActividad key={`${e.createdAt}-${i}`} e={e} rol={rol} className={i >= ACTIVIDAD_ANGOSTO ? "hidden xl:block" : undefined} />
                    ))}
                  </ol>
                ) : (
                  <EmptyState compacto icono={<ScrollText size={18} />} titulo="Sin acciones registradas" descripcion="Validar un aporte, publicar una alerta o editar un ajuste deja aquí una línea con tu correo." />
                )}
              </div>
            </PageSection>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

/** Caja de una lista del resumen: la misma superficie que las tarjetas del panel. */
const CAJA = "overflow-hidden rounded-2xl border border-line bg-paperSoft";
/** Fila de una lista: un escalón más clara al pasar el mouse. */
const FILA = "px-4 py-2.5 transition-colors duration-rapido hover:bg-paperDeep/50";

/**
 * Un chequeo de salud en un renglón (desde sm, el nombre y la frase van juntos y la frase se corta; en el
 * celular, dos líneas). Se abre para ver los datos, qué hacer y el detalle técnico.
 */
function FilaChequeo({ c }: { c: Chequeo }) {
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors duration-rapido hover:bg-paperDeep/50 sm:py-2.5 [&::-webkit-details-marker]:hidden">
          <Punto tono={c.tono} />
          <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
            <span className="block text-dato font-medium leading-5 text-ink sm:shrink-0">{c.nombre}</span>
            <span className="block text-meta leading-snug text-mute sm:truncate" title={c.frase}>{c.frase}</span>
          </span>
          <Badge tono={c.tono}>{c.estado}</Badge>
          <ChevronDown size={14} className="shrink-0 text-inkSoft transition-transform duration-rapido [details[open]>summary_&]:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-3 border-t border-line bg-paperDeep/30 px-4 py-3 sm:pl-9">
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
                  {/* Un bloque de código, no otra caja: fondo de página sin borde. */}
                  <ul className="space-y-1 rounded-lg bg-paper px-3 py-2 font-mono text-rotulo leading-relaxed text-inkSoft">
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

/** Qué significa cada estado de la cola, en una frase: va en el ⓘ de la sección, no en cada fila. */
const AYUDA_COLA: [string, string][] = [
  ["Procesados", "ya tienen su análisis"],
  ["En cola", "esperan su turno"],
  ["Procesando", "se están leyendo ahora"],
  ["Esperan documentos", "falta bajar sus documentos"],
  ["Con error", "fallaron; se pueden volver a encolar"],
  ["Sin análisis", "su tipo o etapa no tiene revisiones"],
  ["En revisión humana", "esperan que una persona decida"],
];

/** Un estado de la cola en su línea: punto, cifra y nombre, y lleva a esos contratos. La cifra va pegada al nombre. */
function EstadoCola({ href, tono, n, etiqueta }: { href: string; tono: Tone; n: number; etiqueta: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 rounded-md text-inkSoft underline-offset-2 transition-colors duration-rapido hover:text-ink hover:underline">
      <Punto tono={tono} />
      <span className="font-semibold tabular-nums text-ink">{fmtNum(n)}</span>
      {etiqueta}
    </Link>
  );
}

/**
 * Una línea de la bitácora en frase; si la acción tocó algo que se puede abrir, la fila entera lleva
 * ahí. Sólo si quien mira puede entrar a esa sección: a un revisor no se le ofrece un enlace a
 * Contribuciones que termina en "sección sólo para administradores" (sin perfil todavía, tampoco).
 */
function FilaActividad({ e, rol, className }: { e: EntradaBitacora; rol: Rol | null; className?: string }) {
  const a = leerAccion(e);
  const href = a.href && (a.externo || (rol && puedeVerSeccion(rol, a.href.split("?")[0]))) ? a.href : null;
  const cuerpo = (
    <span className="flex items-start gap-3">
      <Punto tono={a.tono} className="mt-1.5" />
      <span className="min-w-0 flex-1 text-meta leading-snug">
        <span className="font-medium text-ink" title={e.actor}>{actorCorto(e.actor)}</span> <span className="text-inkSoft">{a.frase}</span>
        {a.objeto && <span className="text-ink">: {a.objeto}</span>}
        {a.resumen && <span className="mt-0.5 block truncate text-rotulo text-mute">{a.resumen}</span>}
      </span>
      <span className="shrink-0 text-rotulo text-mute" title={fmtFechaHora(e.createdAt) ?? undefined}>{hace(e.createdAt)}</span>
    </span>
  );
  return (
    <li className={className}>
      {href ? (
        <Link href={href} target={a.externo ? "_blank" : undefined} className={cn(FILA, "block")}>
          {cuerpo}
        </Link>
      ) : (
        <div className="px-4 py-2.5">{cuerpo}</div>
      )}
    </li>
  );
}
