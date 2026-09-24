"use client";

import { RotateCcw } from "lucide-react";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { Badge, claseBoton, DataTable, EmptyState, ErrorBanner, PageSection, mensajeError, plural, type Columna, type Tone } from "@/components/admin/ui";
import { hace } from "./tipos";
// ── Pedidos de descarga ───────────────────────────────────────────────────

interface Pedido {
  id: number; ocid: string; motivo: string; estado: "pendiente" | "descargando" | "listo" | "fallido";
  solicitadoAt: string; tomadoAt: string | null; atendidoAt: string | null; intentos: number; loteId: string | null;
  error: string | null; titulo: string | null; entidad: string | null;
}

const PEDIDO_UI: Record<Pedido["estado"], { label: string; tono: Tone }> = {
  pendiente: { label: "En espera", tono: "warn" },
  descargando: { label: "Descargando", tono: "pending" },
  listo: { label: "Listo", tono: "ok" },
  fallido: { label: "Fallido", tono: "danger" },
};

/**
 * Pedidos de descarga (migración 15): contratos financiados sin documentos. Los
 * atiende el lote nocturno. Plegado por defecto: el aviso de arriba ya dice
 * cuántos hay y por qué; esto es el detalle para quien lo quiera.
 */
export function PedidosDescarga({ onChange }: { onChange: () => void }) {
  // Caché compartida: volver a la página pinta al instante lo último que se vio.
  const pedidosQ = useAdmin<{ data: Pedido[] }>("/pedidos");
  const rows: Pedido[] | null = pedidosQ.data?.data ?? null;
  const cargando = !pedidosQ.data && !pedidosQ.error;
  const { toast } = useDialog();
  const abiertos = (rows ?? []).filter((p) => p.estado !== "listo");
  const listos = (rows ?? []).filter((p) => p.estado === "listo").length;
  async function reintentar(p: Pedido) {
    try {
      await adminFetch(`/pedidos/${p.id}/reintentar`, { method: "POST", body: "{}" });
      toast(`${p.ocid} vuelve a la cola de descarga`);
      void refrescarAdmin("/pedidos");
      onChange();
    } catch (e) {
      toast(mensajeError(e), "error");
    }
  }

  const columnas: Columna<Pedido>[] = [
    {
      clave: "contrato",
      titulo: "Contrato",
      principal: true,
      className: "max-w-md",
      celda: (p) => (
        <>
          <span className="block font-mono text-xs text-ink">{p.ocid}</span>
          <span className="block truncate text-[12px] text-mute" title={p.titulo ?? ""}>
            {p.titulo ?? "Sin título"}
          </span>
          {p.error && <span className="block text-[11px] text-crimsonTexto">{p.error}</span>}
        </>
      ),
    },
    { clave: "estado", titulo: "Estado", celda: (p) => <Badge tono={PEDIDO_UI[p.estado].tono}>{PEDIDO_UI[p.estado].label}</Badge> },
    { clave: "pedido", titulo: "Pedido", className: "whitespace-nowrap text-[12px] text-mute", celda: (p) => hace(p.solicitadoAt) ?? "Sin fecha" },
    { clave: "intentos", titulo: "Intentos", alinear: "derecha", celda: (p) => p.intentos },
    {
      clave: "acciones",
      titulo: "Acciones",
      acciones: true,
      celda: (p) =>
        p.estado === "fallido" ? (
          <button onClick={() => reintentar(p)} className={claseBoton("secundario", "xs")}>
            <RotateCcw size={11} aria-hidden /> Reintentar
          </button>
        ) : null,
    },
  ];

  return (
    <PageSection
      titulo="Descargas pendientes"
      meta={rows ? `${abiertos.length} en espera, ${plural(listos, "atendida", "atendidas")}` : cargando ? "cargando…" : "sin dato"}
      plegable
      abierto={false}
      className="mt-8"
    >
      <ErrorBanner error={pedidosQ.error} titulo="No se pudieron leer las descargas" onReintentar={() => pedidosQ.mutate()} className="mb-3" />
      <DataTable
        etiqueta="Descargas pendientes"
        columnas={columnas}
        filas={rows ? abiertos : null}
        claveFila={(p) => String(p.id)}
        hrefFila={(p) => `/app/contratos/${encodeURIComponent(p.ocid)}`}
        cargando={cargando}
        anchoMinimo="min-w-[640px]"
        vacio={<EmptyState compacto titulo="Ningún contrato financiado espera documentos" />}
      />
    </PageSection>
  );
}
