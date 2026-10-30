"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, ExternalLink, EyeOff, FileImage, ImageOff, RefreshCw, Search, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, type ContribucionAdmin, type Operacion } from "@/lib/admin";
import { refrescarAdmin, refrescarTodo, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { Ayuda } from "@/components/patrones/Ayuda";
import {
  Aviso,
  Badge,
  BarraProgreso,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  Expandable,
  FilterChips,
  KeyValue,
  SinDato,
  estadoAporte,
  fmtFechaHora,
  hace,
  mensajeError,
  motivoNoVisibleLabel,
  nivelLabel,
  pasarelaLabel,
  plural,
  SkeletonPanel,
  tipoFinanciadorLabel,
  type Columna,
  type OpcionChip,
} from "@/components/admin/ui";

/**
 * Contribuciones: la bandeja de aportes. Desde el 2026-10-30 todo aporte nuevo va al fondo común («Ayúdanos a seguir
 * vigilando»): con tarjeta lo confirma Mercado Pago solo; con Yape, Plin o transferencia se valida aquí, mirando el
 * comprobante. Los aportes viejos por contrato siguen en la lista con su zona y cuántos contratos ya se leyeron.
 *
 * Arriba las bandejas: chips en UNA fila que se desliza de costado en el celular (antes ocupaban tres renglones), con
 * cuántos esperan en «Por validar», y la búsqueda. Abajo la lista, de 25 en 25, y al lado el aporte elegido con su
 * comprobante y las dos decisiones (confirmar pago / rechazar). En el teléfono cada aporte va en dos renglones (código y
 * quién; monto, estado y fecha) y el detalle queda debajo de la lista, que baja hasta él. Qué es cada bandeja, en el ⓘ.
 * Fuente: GET /api/admin/contribuciones · POST …/:codigo/validar · POST …/:codigo/rechazar · PATCH …/:codigo
 */

/** Las bandejas, en el orden del trabajo: lo que espera una decisión primero, «Todas» al final. */
const BANDEJAS: OpcionChip<string>[] = [
  { valor: "pendiente_pago", etiqueta: "Por validar" },
  { valor: "sin_comprobante", etiqueta: "Sin comprobante" },
  { valor: "pagada", etiqueta: "Pagadas" },
  { valor: "en_proceso", etiqueta: "En proceso" },
  { valor: "procesada", etiqueta: "Procesadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "todas", etiqueta: "Todas" },
];

/** Un aviso dentro del detalle: franja de borde a borde de la tarjeta, sin caja propia (nada de cajas dentro de cajas). */
const AVISO_EN_DETALLE = "-mx-4 rounded-none border-x-0 sm:-mx-5 sm:px-5";

function Page() {
  // El estado vive en la URL y se lee en cada cambio: antes se leía una sola vez, y el enlace del
  // menú (sin ?estado=) no volvía a "Por validar" si se llegaba con ?estado=todas desde el Resumen.
  const params = useSearchParams();
  const estado = params.get("estado") ?? "pendiente_pago";
  /** Cambia el estado en la URL sin ir al servidor (Next sincroniza history.replaceState con useSearchParams). */
  const setEstado = (v: string) => {
    const sp = new URLSearchParams(window.location.search);
    if (v === "pendiente_pago") sp.delete("estado");
    else sp.set("estado", v);
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  };
  const [q, setQ] = useState("");
  // La búsqueda viaja al API recién cuando dejas de escribir.
  const [qApi, setQApi] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQApi(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, isLoading, isValidating, mutate } = useAdmin<{ data: ContribucionAdmin[] }>(`/contribuciones?estado=${estado}&q=${encodeURIComponent(qApi)}`);
  // Cuántos esperan validación, para el chip «Por validar»: es el mismo pedido que ya hace el menú del panel
  // (AdminShell, cada minuto), así que no suma uno nuevo. Las demás bandejas no tienen conteo propio en el API.
  const { data: op } = useAdmin<Operacion>("/operacion");
  const porValidar = op?.aportes?.pendientesValidar ?? 0;
  const opciones = BANDEJAS.map((b) => (b.valor === "pendiente_pago" && porValidar > 0 ? { ...b, cuenta: porValidar, tono: "warn" as const } : b));
  // Sin pagos por validar la bandeja quedaba en una línea y el resto de la pantalla en blanco: se muestran los
  // últimos aportes (de cualquier estado) para poder abrir su comprobante y ver cómo van.
  const sinPendientes = estado === "pendiente_pago" && !qApi && !!data && data.data.length === 0;
  const recientesQ = useAdmin<{ data: ContribucionAdmin[] }>(sinPendientes ? "/contribuciones?estado=todas&q=" : null);
  const recientes = sinPendientes ? (recientesQ.data?.data ?? []).slice(0, 12) : [];
  const mostrandoRecientes = recientes.length > 0;
  const rows = mostrandoRecientes ? recientes : (data?.data ?? null);

  // El elegido se sigue por código: tras validar o refrescar se ve su versión nueva.
  const [elegido, setElegido] = useState<ContribucionAdmin | null>(null);
  // Otra bandeja (por los chips o por un enlace): el aporte elegido era de la anterior.
  useEffect(() => setElegido(null), [estado]);
  const sel = (elegido && rows?.find((c) => c.codigo === elegido.codigo)) || elegido;
  const detalleRef = useRef<HTMLDivElement>(null);
  const { open, toast } = useDialog();

  function elegir(c: ContribucionAdmin) {
    setElegido(c);
    // Por debajo de lg el detalle va después de la lista: llevar la vista hasta él.
    if (window.matchMedia("(max-width: 1023px)").matches) setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function validar(c: ContribucionAdmin) {
    open({
      title: `Confirmar pago de ${c.codigo}`,
      tone: "success",
      confirmLabel: c.tipoAporte === "apoyo" ? "Confirmar pago" : "Confirmar y asignar contratos",
      body: c.tipoAporte === "apoyo"
        ? <>Se marcará <strong>{fmtPEN(c.montoPen)}</strong> como recibido: es un aporte para seguir vigilando{c.periodicidad === "mensual" ? " (de cada mes)" : ""}, va al fondo común y no asigna contratos. Suma a lo recaudado del mes.</>
        : <>Se marcará <strong>{fmtPEN(c.montoPen)}</strong> como recibido y se asignarán <strong>{c.contratos}</strong> contratos de <strong>{c.zona}</strong>, los más graves primero. El financiador recibe su comprobante de impacto.</>,
      fields: [
        { name: "referencia", label: "Referencia del pago", placeholder: "N° de operación Yape/Plin o transferencia", hint: "Opcional, queda en la bitácora." },
        { name: "nota", label: "Nota interna", type: "textarea", placeholder: "Ej. verificado en el extracto del 14/09" },
      ],
      onConfirm: async (v) => {
        let r: { asignados: number; estado: string };
        try {
          r = await adminFetch<{ asignados: number; estado: string }>(`/contribuciones/${c.codigo}/validar`, { method: "POST", body: JSON.stringify({ referencia: v.referencia || undefined, nota: v.nota || undefined }) });
        } catch (e) { throw new Error(mensajeError(e)); }
        const faltan = c.contratos - r.asignados;
        toast(
          c.tipoAporte === "apoyo"
            ? `${c.codigo} validada: suma a lo recaudado del mes`
            : `${c.codigo} validada: ${plural(r.asignados, "contrato asignado", "contratos asignados")}${faltan > 0 ? ` (${plural(faltan, "espera", "esperan")} contratos nuevos en la zona)` : ""}`,
        );
        // El Resumen, la bitácora y el procesamiento cuentan este aporte: todos al día.
        setElegido(null); void refrescarTodo();
      },
    });
  }

  function rechazar(c: ContribucionAdmin) {
    open({
      title: `Rechazar ${c.codigo}`,
      tone: "danger",
      confirmLabel: "Rechazar aporte",
      body: <>El aporte queda como rechazado y no asigna contratos. El motivo se guarda en la bitácora.</>,
      fields: [{ name: "motivo", label: "Motivo", type: "textarea", required: true, placeholder: "Ej. el comprobante no corresponde al monto" }],
      onConfirm: async (v) => {
        try {
          await adminFetch(`/contribuciones/${c.codigo}/rechazar`, { method: "POST", body: JSON.stringify({ motivo: v.motivo }) });
        } catch (e) { throw new Error(mensajeError(e)); }
        toast(`${c.codigo} rechazada`); setElegido(null); void refrescarTodo();
      },
    });
  }

  // Cómo se pagó y si hay captura. Sólo en la tabla de escritorio: en el celular el segundo renglón es monto, estado y
  // fecha, y el detalle lo dice entero.
  const colPago: Columna<ContribucionAdmin> = {
    clave: "pago",
    titulo: "Pago",
    soloEscritorio: true,
    celda: (c) => {
      // La captura sólo cuenta en lo que se paga a mano: la tarjeta la confirma Mercado Pago y el aporte de Vigía no lleva.
      const aMano = c.pasarela !== "mercadopago" && c.pasarela !== "institucional";
      return (
        <>
          <span className="block whitespace-nowrap text-meta text-ink">{pasarelaLabel(c.pasarela) ?? <SinDato />}</span>
          {aMano &&
            (c.tieneComprobante ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-micro text-mossTexto"><FileImage size={11} aria-hidden /> Con comprobante</span>
            ) : (
              <span className="whitespace-nowrap text-micro text-mute">Sin comprobante</span>
            ))}
        </>
      );
    },
  };

  const columnas: Columna<ContribucionAdmin>[] = [
    {
      clave: "aporte",
      titulo: "Aporte",
      principal: true,
      // En el celular código y quién van en UNA línea (la segunda es monto, estado y fecha); en la tabla, uno sobre otro,
      // con el tipo y el RUC al lado del nombre.
      celda: (c) => (
        <span className="flex min-w-0 items-baseline gap-2 lg:flex-col lg:items-start lg:gap-0.5">
          <span className="shrink-0 font-mono text-rotulo font-medium leading-4 text-ink">{c.codigo}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink">
            <span className="truncate" title={c.nombrePublico ?? undefined}>{c.nombrePublico ?? <span className="text-mute">Anónimo</span>}</span>
            {!c.visible && <EyeOff size={12} className="shrink-0 text-rust" aria-label="Sin reconocimiento público" />}
            <span className="hidden whitespace-nowrap text-micro text-mute lg:inline">{[tipoFinanciadorLabel(c.tipo), c.ruc && `RUC ${c.ruc}`].filter(Boolean).join(", ")}</span>
          </span>
        </span>
      ),
    },
    {
      clave: "destino",
      titulo: "Destino",
      soloEscritorio: true,
      celda: (c) =>
        c.tipoAporte === "apoyo" ? (
          <>
            <span className="block whitespace-nowrap text-meta text-ink">Fondo común</span>
            <span className="block text-micro text-mute">{c.periodicidad === "mensual" ? "cada mes" : "una vez"}</span>
          </>
        ) : (
          // Aporte por contrato, el modelo de antes: su zona y cuántos de sus contratos ya se leyeron (la barra, en el detalle).
          <>
            <span className="block text-meta text-ink">
              {c.zona ?? <SinDato texto="Sin zona" />} <span className="text-micro text-mute">{nivelLabel(c.nivel)}</span>
            </span>
            <span className="block whitespace-nowrap text-micro text-inkSoft">
              <span className="font-mono text-ink">{c.procesados}</span> de {c.contratos} leídos
              {c.asignados < c.contratos && c.estado !== "pendiente_pago" && c.estado !== "rechazada" && (
                <span className="text-clayTexto">, {c.contratos - c.asignados} sin asignar</span>
              )}
            </span>
          </>
        ),
    },
    { clave: "monto", titulo: "Monto", alinear: "derecha", celda: (c) => fmtPEN(c.montoPen) },
    // Con el detalle abierto, el medio de pago del elegido se lee ahí: sin esta columna la tabla cabe a su lado sin
    // deslizarse de costado.
    ...(sel ? [] : [colPago]),
    { clave: "estado", titulo: "Estado", celda: (c) => { const e = estadoAporte(c.estado); return <Badge tono={e.tono}>{e.label}</Badge>; } },
    { clave: "fecha", titulo: "Fecha", className: "whitespace-nowrap text-rotulo text-mute", celda: (c) => <span title={fmtFechaHora(c.pagadaAt ?? c.createdAt) ?? undefined}>{hace(c.pagadaAt ?? c.createdAt)}</span> },
  ];

  return (
    <AdminShell
      title="Contribuciones"
      subtitle="Confirmar pagos, ver comprobantes y seguir cada aporte"
      actions={
        <button onClick={() => mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-3">
        {/* Las bandejas en una sola fila: en el celular se desliza de costado (sin barra), con el ⓘ fuera del desliz para
            que siempre se vea; en escritorio envuelve si no entra. El relleno de 4 px deja ver el anillo de foco. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 items-center gap-1.5 sm:flex-1">
            <FilterChips
              etiqueta="Estado del aporte"
              valor={estado}
              onCambiar={setEstado}
              opciones={opciones}
              className="-m-1 min-w-0 flex-nowrap overflow-x-auto p-1 [scrollbar-width:none] lg:flex-wrap [&::-webkit-scrollbar]:hidden"
            />
            <Ayuda titulo="¿Qué hay en cada bandeja?">
              <span className="block">
                <strong className="font-semibold text-ink">Por validar</strong>: pagos con Yape, Plin o transferencia que subieron su comprobante.
                Elige uno, mira la captura y confirma el pago o recházalo.
              </span>
              <span className="mt-1.5 block">
                <strong className="font-semibold text-ink">Sin comprobante</strong>: no subieron la captura, que es opcional. Si el pago llegó con el
                código del aporte, confírmalo igual; si no, vence solo a los 30 días.
              </span>
              <span className="mt-1.5 block">Los pagos con tarjeta los confirma Mercado Pago: no esperan tu validación.</span>
            </Ayuda>
          </div>
          <label className="relative w-full sm:w-64 sm:shrink-0">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, RUC, correo o zona" aria-label="Buscar aporte" className="min-h-[34px] w-full rounded-full border border-line bg-paperDeep py-1.5 pl-8 pr-3 text-meta text-ink placeholder:text-mute focus:border-granate/60" />
          </label>
        </div>

        <ErrorBanner error={error} onReintentar={() => mutate()} />

        {/* Sin nada por validar, la lista muestra los últimos aportes: se dice en una línea, no en un párrafo con caja. */}
        {mostrandoRecientes && (
          <p className="flex items-center gap-2 text-meta text-inkSoft">
            <Check size={15} className="shrink-0 text-moss" aria-hidden />
            <span className="min-w-0 truncate">
              <strong className="font-semibold text-ink">No hay pagos por validar.</strong> Los últimos {recientes.length} aportes:
            </span>
          </p>
        )}

        {/* Sin aportes en la bandeja no hay detalle que mostrar: la lista ocupa todo el ancho en vez de
            dejar al lado una segunda caja vacía. */}
        <div className={sel ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" : "grid gap-4"}>
          <DataTable
            etiqueta="Aportes"
            columnas={columnas}
            filas={rows}
            claveFila={(c) => c.codigo}
            onFila={elegir}
            filaActiva={(c) => sel?.codigo === c.codigo}
            cargando={isLoading || (isValidating && qApi !== q)}
            apilarHasta="lg"
            porPagina={25}
            compactoMovil
            className="self-start"
            vacio={
              q ? (
                <EmptyState compacto titulo="Ningún aporte coincide con la búsqueda" />
              ) : estado !== "pendiente_pago" ? (
                <EmptyState compacto titulo="Nada en esta bandeja" />
              ) : (
                <EmptyState compacto icono={<Check size={18} />} titulo="No hay pagos por validar" />
              )
            }
          />

          {sel && (
            <aside ref={detalleRef} className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start" aria-label="Detalle del aporte">
              <Detalle key={sel.codigo} c={sel} onValidar={() => validar(sel)} onRechazar={() => rechazar(sel)} onClose={() => setElegido(null)} />
            </aside>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function Detalle({ c, onValidar, onRechazar, onClose }: { c: ContribucionAdmin; onValidar: () => void; onRechazar: () => void; onClose: () => void }) {
  const [nota, setNota] = useState(c.notaAdmin ?? "");
  const [guardada, setGuardada] = useState<"ok" | "error" | null>(null);
  // El comprobante sale del bucket por el API: si no responde, o es un PDF (que una <img> no muestra), un marcador que
  // lo dice en vez de la imagen rota. El enlace para abrirlo sigue debajo.
  const [sinVista, setSinVista] = useState(false);
  useEffect(() => setNota(c.notaAdmin ?? ""), [c.codigo, c.notaAdmin]);
  async function guardarNota() {
    if ((c.notaAdmin ?? "") === nota) return;
    try {
      await adminFetch(`/contribuciones/${c.codigo}`, { method: "PATCH", body: JSON.stringify({ notaAdmin: nota || null }) });
      setGuardada("ok");
      refrescarAdmin("/contribuciones");
    } catch { setGuardada("error"); }
  }
  const e = estadoAporte(c.estado);
  return (
    <section className="rounded-2xl border border-line bg-paperSoft">
      <header className="flex items-start justify-between gap-3 px-4 pt-3 sm:px-5">
        <div>
          <p className="font-mono text-bloque leading-7 font-bold text-ink">{c.codigo}</p>
          <div className="mt-1"><Badge tono={e.tono} punto>{e.label}</Badge></div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar detalle" className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"><X size={16} aria-hidden /></button>
      </header>

      <div className="space-y-3 px-4 pb-4 pt-2.5 sm:px-5">
        {c.tipoAporte === "apoyo" ? (
          <p className="text-rotulo text-inkSoft">Aporte para seguir vigilando{c.periodicidad === "mensual" ? ", de cada mes" : ", una vez"}: va al fondo común y no asigna contratos.</p>
        ) : (
          <div>
            <p className="text-rotulo text-inkSoft"><span className="font-mono text-ink">{c.procesados}</span> de {c.contratos} contratos leídos, {c.asignados} asignados</p>
            <BarraProgreso valor={c.procesados} total={c.contratos} etiqueta={`${c.procesados} de ${c.contratos} contratos leídos`} className="mt-1.5" />
          </div>
        )}

        <KeyValue
          items={[
            { etiqueta: "Monto", valor: fmtPEN(c.montoPen), mono: true },
            c.tipoAporte === "apoyo"
              ? { etiqueta: "Destino sugerido", valor: c.paraRuc ? `Entidad ${c.paraRuc}` : c.paraUbigeo ? `Zona ${c.paraUbigeo}` : "La vigilancia en general" }
              : { etiqueta: "Zona", valor: `${c.zona}`, pista: nivelLabel(c.nivel) },
            { etiqueta: "Financiador", valor: c.nombrePublico ?? "Anónimo", pista: tipoFinanciadorLabel(c.tipo) },
            { etiqueta: "RUC", valor: c.ruc, mono: true },
            { etiqueta: "Correo", valor: c.email, completo: true },
            { etiqueta: "Medio de pago", valor: pasarelaLabel(c.pasarela) },
            { etiqueta: "Registrado", valor: fmtFechaHora(c.createdAt) },
            { etiqueta: "Pagado", valor: fmtFechaHora(c.pagadaAt), pista: c.validadaPor ? `validó ${c.validadaPor}` : undefined, completo: true },
          ]}
        />

        {!c.visible && (
          <Aviso tono="danger" titulo="Sin reconocimiento público" className={AVISO_EN_DETALLE}>
            {motivoNoVisibleLabel(c.motivoNoVisible) ?? "Sin motivo registrado"}. El aporte procesa contratos igual.
          </Aviso>
        )}
        {c.mensajePublico && <p className="border-l-2 border-paperEdge pl-2.5 text-meta italic text-inkSoft">“{c.mensajePublico}”</p>}

        <div>
          <p className="text-micro font-medium text-mute">Comprobante</p>
          {c.tieneComprobante ? (
            <a href={`/api/admin/contribuciones/${c.codigo}/comprobante`} target="_blank" className="mt-1 block overflow-hidden rounded-xl border border-line transition-colors duration-rapido hover:border-paperEdge">
              {sinVista ? (
                <span className="flex min-h-24 flex-col items-center justify-center gap-1 bg-paperDeep px-3 py-3 text-center text-rotulo leading-snug text-inkSoft">
                  <ImageOff size={18} aria-hidden />
                  No se puede mostrar aquí: puede ser un PDF o el archivo no responde
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/admin/contribuciones/${c.codigo}/comprobante`} alt={`Comprobante del aporte ${c.codigo}`} onError={() => setSinVista(true)} className="max-h-64 w-full bg-paperDeep object-contain" />
              )}
              <span className="flex items-center gap-1 px-2 py-1 text-micro text-inkSoft"><ExternalLink size={11} aria-hidden /> Abrir en pestaña nueva</span>
            </a>
          ) : (
            <p className="mt-1 text-dato leading-5 text-mute">El financiador aún no subió comprobante.</p>
          )}
        </div>

        <label className="block text-dato leading-5">
          <span className="text-micro font-medium text-mute">Nota interna</span>
          <textarea value={nota} onChange={(ev) => { setNota(ev.target.value); setGuardada(null); }} onBlur={guardarNota} rows={2} className="mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-dato leading-5 text-ink placeholder:text-mute focus:border-granate/60" placeholder="Ej. verificado en el extracto del 14/09" />
          {guardada && <span className={guardada === "ok" ? "text-micro text-mossTexto" : "text-micro text-crimsonTexto"}>{guardada === "ok" ? "Nota guardada" : "No se pudo guardar la nota"}</span>}
        </label>

        {/* Un pago con tarjeta lo confirma Mercado Pago (el API no deja validarlo a mano): sólo se puede rechazar el
            intento que quedó a medias. */}
        {c.estado === "pendiente_pago" && (
          <div className="flex flex-wrap items-center gap-2">
            {c.pasarela === "mercadopago" ? (
              <span className="min-w-0 flex-1 text-meta text-inkSoft">Lo confirma Mercado Pago al cobrar la tarjeta.</span>
            ) : (
              <button onClick={onValidar} className={claseBoton("exito", "md", "flex-1")}><Check size={14} aria-hidden /> Confirmar pago</button>
            )}
            <button onClick={onRechazar} className={claseBoton("peligro", "md")}><X size={14} aria-hidden /> Rechazar</button>
          </div>
        )}

        <div className="space-y-2 border-t border-line pt-3">
          <Link href={`/impacto/${c.codigo}`} target="_blank" className="inline-flex items-center gap-1 text-rotulo text-inkSoft hover:text-ink"><ExternalLink size={11} aria-hidden /> Comprobante de impacto público</Link>
          <Expandable variante="linea" resumen="Datos técnicos">
            <KeyValue
              columnas={1}
              items={[
                { etiqueta: "Referencia del pago", valor: c.pasarelaRef, mono: true },
                { etiqueta: "Pasarela (código)", valor: c.pasarela, mono: true },
                { etiqueta: "Ubigeo", valor: c.ubigeo, mono: true },
                { etiqueta: "Financiador (id)", valor: String(c.financiadorId), mono: true },
              ]}
            />
          </Expandable>
        </div>
      </div>
    </section>
  );
}

export default function ContribucionesPage() {
  // useSearchParams pide un límite de Suspense; mientras tanto, el panel con su esqueleto.
  return (
    <Suspense
      fallback={
        <AdminShell title="Contribuciones" subtitle="Confirmar pagos, ver comprobantes y seguir cada aporte">
          <SkeletonPanel lineas={6} />
        </AdminShell>
      }
    >
      <Page />
    </Suspense>
  );
}
