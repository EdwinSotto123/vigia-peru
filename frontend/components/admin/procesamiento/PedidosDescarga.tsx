"use client";

import { RotateCcw } from "lucide-react";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Badge, DataTable, EmptyState, ErrorBanner, MenuFila, mensajeError, type Columna, type Tone } from "@/components/admin/ui";
import { fmtFechaHora, hace, MENU_A_LA_DERECHA, plural } from "./tipos";
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
 * Los pedidos de descarga (GET /pedidos, migración 15): contratos financiados sin documentos. La página los pide
 * para saber si muestra la pestaña (sólo con pedidos abiertos) y la pestaña, para su lista: es la misma clave de
 * SWR, un solo request.
 */
export function usePedidos() {
  // Caché compartida: volver a la página pinta al instante lo último que se vio.
  const q = useAdmin<{ data: Pedido[] }>("/pedidos");
  const rows: Pedido[] | null = q.data?.data ?? null;
  const abiertos = (rows ?? []).filter((p) => p.estado !== "listo");
  return {
    q,
    rows,
    abiertos,
    listos: (rows ?? []).length - abiertos.length,
    fallidos: abiertos.filter((p) => p.estado === "fallido").length,
    cargando: !q.data && !q.error,
  };
}

/**
 * La pestaña «Descargas» de Procesamiento: los pedidos que el lote nocturno todavía no atendió. La fila abre la
 * ficha del contrato; reintentar uno fallido va en su «⋯». Antes era una sección plegada al pie de la página.
 */
export function PedidosDescarga({ onChange }: { onChange: () => void }) {
  const { q, rows, abiertos, listos, cargando } = usePedidos();
  const { toast } = useDialog();
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
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-rotulo text-ink">{p.ocid}</span>
            <span className="truncate text-meta text-inkSoft" title={p.titulo ?? undefined}>
              {p.titulo ?? "Sin título"}
            </span>
          </span>
          {p.error && (
            <span className="block truncate text-micro text-crimsonTexto" title={p.error}>
              {p.error}
            </span>
          )}
        </>
      ),
    },
    { clave: "estado", titulo: "Estado", celda: (p) => <Badge tono={PEDIDO_UI[p.estado]?.tono ?? "muted"}>{PEDIDO_UI[p.estado]?.label ?? p.estado}</Badge> },
    {
      clave: "pedido",
      titulo: "Pedido",
      className: "whitespace-nowrap text-rotulo text-mute",
      celda: (p) => <span title={fmtFechaHora(p.solicitadoAt) ?? undefined}>{hace(p.solicitadoAt) ?? "Sin fecha"}</span>,
    },
    // Con la palabra: en la línea compacta del celular un «2» suelto no se entiende.
    { clave: "intentos", titulo: "Intentos", className: "whitespace-nowrap text-rotulo text-inkSoft", celda: (p) => plural(p.intentos, "intento", "intentos") },
    {
      clave: "menu",
      titulo: <span className="sr-only">Acciones</span>,
      etiquetaMovil: "Acciones",
      alinear: "derecha",
      // Menos relleno arriba y abajo: el «⋯» mide 32 px y, con el de siempre, estiraba la fila.
      className: "w-px py-1",
      celda: (p) =>
        p.estado === "fallido" ? (
          <MenuFila
            etiqueta={`Acciones de ${p.ocid}`}
            acciones={[{ etiqueta: "Reintentar la descarga", icono: <RotateCcw size={14} aria-hidden />, onClick: () => void reintentar(p) }]}
          />
        ) : null,
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-mute">
          {rows ? `${abiertos.length.toLocaleString("es-PE")} en espera, ${plural(listos, "atendida", "atendidas")}` : cargando ? "Cargando…" : "Sin dato"}
        </span>
        <Ayuda titulo="¿Qué son estas descargas?">
          Contratos financiados que no tenían sus documentos. Los baja el lote nocturno (1:30) por el relay de Lima, porque el SEACE no deja entrar a la
          nube. Toca uno para abrir su ficha; uno fallido se reintenta desde su «⋯».
        </Ayuda>
      </div>
      <ErrorBanner error={q.error} titulo="No se pudieron leer las descargas" onReintentar={() => q.mutate()} className="mt-3" />
      <DataTable
        className={`mt-3 ${MENU_A_LA_DERECHA}`}
        etiqueta="Descargas pendientes"
        columnas={columnas}
        filas={rows ? abiertos : null}
        claveFila={(p) => String(p.id)}
        hrefFila={(p) => `/app/contratos/${encodeURIComponent(p.ocid)}`}
        cargando={cargando}
        anchoMinimo="min-w-[640px]"
        porPagina={15}
        compactoMovil
        vacio={<EmptyState compacto titulo="Ningún contrato financiado espera documentos" />}
      />
    </>
  );
}
