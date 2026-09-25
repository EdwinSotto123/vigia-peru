"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, ExternalLink, EyeOff, FileImage, MousePointerClick, RefreshCw, Search, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, type ContribucionAdmin } from "@/lib/admin";
import { refrescarAdmin, refrescarTodo, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
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
} from "@/components/admin/ui";

/**
 * Contribuciones: la bandeja de aportes. A la izquierda la lista (filtrada por estado y
 * búsqueda), a la derecha el aporte elegido con su comprobante y las dos decisiones
 * (confirmar pago / rechazar). En el teléfono el detalle queda debajo y se baja hasta él.
 * Fuente: GET /api/admin/contribuciones · POST …/:codigo/validar · POST …/:codigo/rechazar · PATCH …/:codigo
 */

const TABS = [
  { valor: "pendiente_pago", etiqueta: "Por validar" }, { valor: "pagada", etiqueta: "Pagadas" }, { valor: "en_proceso", etiqueta: "En proceso" },
  { valor: "procesada", etiqueta: "Procesadas" }, { valor: "rechazada", etiqueta: "Rechazadas" }, { valor: "todas", etiqueta: "Todas" },
];

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
  const rows = data?.data ?? null;

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
      confirmLabel: "Confirmar y asignar contratos",
      body: <>Se marcará <strong>{fmtPEN(c.montoPen)}</strong> como recibido y se asignarán <strong>{c.contratos}</strong> contratos de <strong>{c.zona}</strong>, los más antiguos primero. El financiador recibe su comprobante de impacto.</>,
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
          `${c.codigo} validada: ${plural(r.asignados, "contrato asignado", "contratos asignados")}${faltan > 0 ? ` (${plural(faltan, "espera", "esperan")} contratos nuevos en la zona)` : ""}`,
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

  const columnas: Columna<ContribucionAdmin>[] = [
    {
      clave: "aporte",
      titulo: "Aporte",
      principal: true,
      celda: (c) => (
        <>
          <span className="font-mono text-xs font-medium text-ink">{c.codigo}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink">
            {c.nombrePublico ?? <span className="text-mute">Anónimo</span>}
            {!c.visible && <EyeOff size={12} className="text-rust" aria-label="Sin reconocimiento público" />}
          </span>
          <span className="block text-[11px] text-mute">{[tipoFinanciadorLabel(c.tipo), c.ruc && `RUC ${c.ruc}`].filter(Boolean).join(", ")}</span>
        </>
      ),
    },
    { clave: "zona", titulo: "Zona", celda: (c) => <>{c.zona} <span className="text-[11px] text-mute">{nivelLabel(c.nivel)}</span></> },
    {
      clave: "avance",
      titulo: "Contratos leídos",
      className: "w-40",
      celda: (c) => (
        <div className="w-full max-w-[160px]">
          <span className="text-[12px] text-inkSoft"><span className="font-mono text-ink">{c.procesados}</span> de {c.contratos}</span>
          <BarraProgreso valor={c.procesados} total={c.contratos} etiqueta={`${c.procesados} de ${c.contratos} contratos leídos`} alto="sm" className="mt-1" />
          {c.asignados < c.contratos && c.estado !== "pendiente_pago" && c.estado !== "rechazada" && <span className="text-[11px] text-clayTexto">{c.contratos - c.asignados} sin asignar</span>}
        </div>
      ),
    },
    { clave: "monto", titulo: "Monto", alinear: "derecha", celda: (c) => fmtPEN(c.montoPen) },
    {
      clave: "comprobante",
      titulo: "Comprobante",
      celda: (c) => (c.tieneComprobante ? <span className="inline-flex items-center gap-1 text-[12px] text-mossTexto"><FileImage size={13} aria-hidden /> Subido</span> : <span className="text-[12px] text-mute">No subió</span>),
    },
    { clave: "estado", titulo: "Estado", celda: (c) => { const e = estadoAporte(c.estado); return <Badge tono={e.tono}>{e.label}</Badge>; } },
    { clave: "fecha", titulo: "Fecha", className: "whitespace-nowrap text-[12px] text-mute", celda: (c) => <span title={fmtFechaHora(c.pagadaAt ?? c.createdAt) ?? undefined}>{hace(c.pagadaAt ?? c.createdAt)}</span> },
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
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips etiqueta="Estado del aporte" valor={estado} onCambiar={setEstado} opciones={TABS} />
          <label className="relative w-full sm:ml-auto sm:w-72">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, RUC, correo o zona" aria-label="Buscar aporte" className="w-full rounded-full border border-line bg-paper py-1.5 pl-8 pr-3 text-xs text-ink" />
          </label>
        </div>

        <ErrorBanner error={error} onReintentar={() => mutate()} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <DataTable
            etiqueta="Aportes"
            columnas={columnas}
            filas={rows}
            claveFila={(c) => c.codigo}
            onFila={elegir}
            filaActiva={(c) => sel?.codigo === c.codigo}
            cargando={isLoading || (isValidating && qApi !== q)}
            apilarHasta="lg"
            className="self-start"
            vacio={
              q || estado !== "pendiente_pago" ? (
                <EmptyState compacto titulo="Nada en esta bandeja" descripcion={q ? "Ningún aporte coincide con la búsqueda." : "Prueba con otro estado o con Todas."} />
              ) : (
                <EmptyState compacto icono={<Check size={18} />} titulo="No hay pagos por validar" descripcion="Cuando un financiador registre un aporte y suba su comprobante, aparece aquí." />
              )
            }
          />

          <aside ref={detalleRef} className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start" aria-label="Detalle del aporte">
            {sel ? (
              <Detalle key={sel.codigo} c={sel} onValidar={() => validar(sel)} onRechazar={() => rechazar(sel)} onClose={() => setElegido(null)} />
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-paper/60">
                <EmptyState compacto icono={<MousePointerClick size={18} />} titulo="Elige un aporte" descripcion="Verás su comprobante, a quién pertenece y los botones para confirmar el pago o rechazarlo." />
              </div>
            )}
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}

function Detalle({ c, onValidar, onRechazar, onClose }: { c: ContribucionAdmin; onValidar: () => void; onRechazar: () => void; onClose: () => void }) {
  const [nota, setNota] = useState(c.notaAdmin ?? "");
  const [guardada, setGuardada] = useState<"ok" | "error" | null>(null);
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
    <section className="rounded-2xl border border-line bg-paper">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <p className="font-mono text-lg font-bold text-ink">{c.codigo}</p>
          <div className="mt-1"><Badge tono={e.tono} punto>{e.label}</Badge></div>
        </div>
        <button onClick={onClose} aria-label="Cerrar detalle" className="rounded-lg p-1 text-mute hover:bg-paperDeep hover:text-ink"><X size={16} aria-hidden /></button>
      </header>

      <div className="space-y-4 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div>
          <p className="text-[12px] text-inkSoft"><span className="font-mono text-ink">{c.procesados}</span> de {c.contratos} contratos leídos, {c.asignados} asignados</p>
          <BarraProgreso valor={c.procesados} total={c.contratos} etiqueta={`${c.procesados} de ${c.contratos} contratos leídos`} className="mt-1.5" />
        </div>

        <KeyValue
          items={[
            { etiqueta: "Monto", valor: fmtPEN(c.montoPen), mono: true },
            { etiqueta: "Zona", valor: `${c.zona}`, pista: nivelLabel(c.nivel) },
            { etiqueta: "Financiador", valor: c.nombrePublico ?? "Anónimo", pista: tipoFinanciadorLabel(c.tipo) },
            { etiqueta: "RUC", valor: c.ruc, mono: true },
            { etiqueta: "Correo", valor: c.email, completo: true },
            { etiqueta: "Medio de pago", valor: pasarelaLabel(c.pasarela) },
            { etiqueta: "Registrado", valor: fmtFechaHora(c.createdAt) },
            { etiqueta: "Pagado", valor: fmtFechaHora(c.pagadaAt), pista: c.validadaPor ? `validó ${c.validadaPor}` : undefined, completo: true },
          ]}
        />

        {!c.visible && (
          <Aviso tono="danger" titulo="Sin reconocimiento público">
            {motivoNoVisibleLabel(c.motivoNoVisible) ?? "Sin motivo registrado"}. El aporte procesa contratos igual.
          </Aviso>
        )}
        {c.mensajePublico && <p className="border-l-2 border-amber pl-2 text-[13px] italic text-inkSoft">“{c.mensajePublico}”</p>}

        <div>
          <p className="text-[11px] font-medium text-mute">Comprobante</p>
          {c.tieneComprobante ? (
            <a href={`/api/admin/contribuciones/${c.codigo}/comprobante`} target="_blank" className="mt-1 block overflow-hidden rounded-xl border border-line hover:border-ink/25">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/admin/contribuciones/${c.codigo}/comprobante`} alt={`Comprobante del aporte ${c.codigo}`} className="max-h-64 w-full bg-paperDeep object-contain" />
              <span className="flex items-center gap-1 px-2 py-1 text-[11px] text-inkSoft"><ExternalLink size={11} aria-hidden /> Abrir en pestaña nueva</span>
            </a>
          ) : (
            <p className="mt-1 text-sm text-mute">El financiador aún no subió comprobante.</p>
          )}
        </div>

        <label className="block text-sm">
          <span className="text-[11px] font-medium text-mute">Nota interna</span>
          <textarea value={nota} onChange={(ev) => { setNota(ev.target.value); setGuardada(null); }} onBlur={guardarNota} rows={2} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" placeholder="Ej. verificado en el extracto del 14/09" />
          {guardada && <span className={guardada === "ok" ? "text-[11px] text-mossTexto" : "text-[11px] text-crimsonTexto"}>{guardada === "ok" ? "Nota guardada" : "No se pudo guardar la nota"}</span>}
        </label>

        {c.estado === "pendiente_pago" && (
          <div className="flex gap-2">
            <button onClick={onValidar} className={claseBoton("exito", "md", "flex-1")}><Check size={14} aria-hidden /> Confirmar pago</button>
            <button onClick={onRechazar} className={claseBoton("peligro", "md")}><X size={14} aria-hidden /> Rechazar</button>
          </div>
        )}

        <div className="space-y-2 border-t border-line pt-3">
          <Link href={`/impacto/${c.codigo}`} target="_blank" className="inline-flex items-center gap-1 text-[12px] text-inkSoft hover:text-ink"><ExternalLink size={11} aria-hidden /> Comprobante de impacto público</Link>
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
