"use client";

import { useState } from "react";
import { CheckCircle2, Receipt, XCircle } from "lucide-react";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { Badge, DataTable, EmptyState, ErrorBanner, FilterChips, MenuFila, SinDato, mensajeError, type Columna } from "@/components/admin/ui";
import { ESTADO_COBRO, MEDIO, PLAN, PRODUCTO, soles, type CobroAdmin } from "./tipos";

type EstadoCobro = "pendiente" | "pagado" | "rechazado" | "reembolsado";

/**
 * Los cobros de Gobserva. Los de Yape, Plin o transferencia esperan aquí: se busca la operación en la app o en el
 * extracto y se confirma (el plan se activa o se extiende y la persona recibe su comprobante) o se rechaza con un motivo.
 * Los de tarjeta los confirma Mercado Pago solo y aparecen ya pagados.
 */
export function CobrosGobserva() {
  const [estado, setEstado] = useState<EstadoCobro>("pendiente");
  const ruta = `/gobserva/cobros?estado=${estado}`;
  const { data, error, isLoading, mutate } = useAdmin<{ data: CobroAdmin[] }>(ruta);
  const { open, toast } = useDialog();

  function confirmar(k: CobroAdmin) {
    open({
      title: `Confirmar ${k.numero}`,
      tone: "success",
      confirmLabel: "Confirmar pago",
      body: (
        <>
          Recibiste <strong>{soles(k.monto)}</strong> por {k.meses} {k.meses === 1 ? "mes" : "meses"} de {PRODUCTO[k.producto]} {PLAN[k.plan] ?? k.plan}, de{" "}
          <strong>{k.email}</strong>. El plan se activa (o se extiende) y su comprobante queda en su cuenta.
        </>
      ),
      fields: [
        {
          name: "operacion",
          label: "Número de operación",
          defaultValue: k.operacion ?? "",
          placeholder: "El que ves en Yape, Plin o el extracto",
          hint: k.operacion ? "La persona escribió este; corrígelo si no coincide." : "Opcional: queda en el comprobante y en la bitácora.",
        },
      ],
      onConfirm: async (v) => {
        try {
          await adminFetch(`/gobserva/cobros/${encodeURIComponent(k.numero)}/confirmar`, { method: "POST", body: JSON.stringify({ operacion: v.operacion?.trim() || undefined }) });
        } catch (e) {
          throw new Error(mensajeError(e));
        }
        toast(`${k.numero} confirmado: el plan ya está activo`);
        void refrescarAdmin("/gobserva");
      },
    });
  }

  function rechazar(k: CobroAdmin) {
    open({
      title: `Rechazar ${k.numero}`,
      tone: "danger",
      confirmLabel: "Rechazar pago",
      body: <>El cobro queda rechazado y el plan no se activa. El motivo se guarda en la bitácora.</>,
      fields: [{ name: "motivo", label: "Motivo", type: "textarea", required: true, minimo: 3, placeholder: "Ej. no encontramos la operación en Yape" }],
      onConfirm: async (v) => {
        try {
          await adminFetch(`/gobserva/cobros/${encodeURIComponent(k.numero)}/rechazar`, { method: "POST", body: JSON.stringify({ motivo: v.motivo }) });
        } catch (e) {
          throw new Error(mensajeError(e));
        }
        toast(`${k.numero} rechazado`);
        void refrescarAdmin("/gobserva");
      },
    });
  }

  const columnas: Columna<CobroAdmin>[] = [
    {
      clave: "cobro",
      titulo: "Cobro",
      principal: true,
      celda: (k) => (
        <span className="block min-w-0">
          <span className="block font-mono text-rotulo font-medium text-ink">{k.numero}</span>
          <span className="block truncate text-meta text-inkSoft">{k.email}</span>
        </span>
      ),
    },
    {
      clave: "plan",
      titulo: "Plan",
      celda: (k) => (
        <span className="block min-w-0">
          <span className="block text-meta font-medium text-ink">{PRODUCTO[k.producto]}, {PLAN[k.plan] ?? k.plan}</span>
          <span className="block font-mono text-micro text-mute">{k.codigo}</span>
        </span>
      ),
    },
    {
      clave: "pago",
      titulo: "Pago",
      celda: (k) => (
        <span className="block min-w-0">
          <span className="block text-meta text-ink">{MEDIO[k.medio] ?? k.medio}</span>
          <span className="block font-mono text-micro text-inkSoft">{k.operacion ? `Op. ${k.operacion}` : k.medio === "tarjeta" ? "Mercado Pago" : <SinDato texto="Sin operación" />}</span>
        </span>
      ),
    },
    {
      clave: "monto",
      titulo: "Monto",
      alinear: "derecha",
      celda: (k) => (
        <span className="block whitespace-nowrap text-right">
          <span className="block font-semibold tabular-nums text-ink">{soles(k.monto)}</span>
          <span className="block text-micro text-mute">{k.meses} {k.meses === 1 ? "mes" : "meses"}</span>
        </span>
      ),
    },
    {
      clave: "fecha",
      titulo: estado === "pagado" ? "Pagado" : "Creado",
      alinear: "derecha",
      celda: (k) => <span className="whitespace-nowrap font-mono text-meta text-inkSoft">{estado === "pagado" ? k.pagado ?? k.creado : k.creado}</span>,
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (k) => (
        <span className="block min-w-0">
          <Badge tono={ESTADO_COBRO[k.estado]?.tono ?? "neutral"}>{ESTADO_COBRO[k.estado]?.etiqueta ?? k.estado}</Badge>
          {k.motivo && <span className="mt-0.5 block truncate text-micro text-mute" title={k.motivo}>{k.motivo}</span>}
        </span>
      ),
    },
    {
      clave: "acciones",
      titulo: <span className="sr-only">Acciones</span>,
      acciones: true,
      celda: (k) =>
        k.estado === "pendiente" ? (
          <MenuFila
            etiqueta={`Acciones de ${k.numero}`}
            acciones={[
              { etiqueta: "Confirmar pago", icono: <CheckCircle2 size={14} aria-hidden />, onClick: () => confirmar(k) },
              { etiqueta: "Rechazar", icono: <XCircle size={14} aria-hidden />, onClick: () => rechazar(k), peligro: true },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <FilterChips<EstadoCobro>
        etiqueta="Estado del cobro"
        valor={estado}
        onCambiar={setEstado}
        opciones={[
          { valor: "pendiente", etiqueta: "Por validar", tono: "warn" },
          { valor: "pagado", etiqueta: "Pagados" },
          { valor: "rechazado", etiqueta: "Rechazados" },
          { valor: "reembolsado", etiqueta: "Devueltos" },
        ]}
      />
      {error && <ErrorBanner error={error} onReintentar={() => mutate()} />}
      <DataTable
        columnas={columnas}
        filas={data?.data}
        claveFila={(k) => k.numero}
        etiqueta="Cobros de Gobserva"
        cargando={isLoading}
        onFila={estado === "pendiente" ? confirmar : undefined}
        porPagina={25}
        compactoMovil
        reinicio={estado}
        vacio={
          <EmptyState
            compacto
            icono={<Receipt size={20} aria-hidden />}
            titulo={estado === "pendiente" ? "Nada por validar" : "Sin cobros en esta bandeja"}
            descripcion={estado === "pendiente" ? "Los pagos con Yape, Plin o transferencia llegan aquí para que los confirmes." : "Cambia de bandeja arriba."}
          />
        }
      />
    </div>
  );
}
