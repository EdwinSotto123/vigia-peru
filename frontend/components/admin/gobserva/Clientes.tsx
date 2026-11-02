"use client";

import { useMemo, useState } from "react";
import { Ban, Gift, Search, Users } from "lucide-react";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { Badge, DataTable, EmptyState, ErrorBanner, FilterChips, MenuFila, claseBoton, mensajeError, type Columna } from "@/components/admin/ui";
import { ESTADO_PLAN, MEDIO, PLAN, PRODUCTO, PRODUCTOS_G, soles, type ClienteAdmin, type ProductoG, type RespuestaConfig } from "./tipos";

type FiltroProducto = "" | ProductoG;
type FiltroEstado = "activa" | "pendiente" | "cancelada" | "vencida" | "";

const plano = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Los planes contratados de Gobserva, con la cuenta de cada uno: quién paga qué, por qué medio, hasta cuándo y si se
 * renueva. Desde aquí se regalan meses (cortesía: prensa, aliados, pruebas) y se cancela un plan (no se renueva y sigue
 * hasta el final de lo pagado).
 */
export function ClientesGobserva() {
  const [producto, setProducto] = useState<FiltroProducto>("");
  const [estado, setEstado] = useState<FiltroEstado>("activa");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams({ ...(producto ? { producto } : {}), ...(estado ? { estado } : {}) }).toString();
  const { data, error, isLoading, mutate } = useAdmin<{ data: ClienteAdmin[] }>(`/gobserva/clientes${qs ? `?${qs}` : ""}`);
  // El catálogo, para elegir el plan de una cortesía (el mismo pedido que la pestaña Configuración).
  const { data: cfg } = useAdmin<RespuestaConfig>("/gobserva/config", { revalidateOnFocus: false });
  const { open, toast } = useDialog();

  const filas = useMemo(() => {
    const t = plano(q.trim());
    if (!t) return data?.data;
    return data?.data.filter((c) => [c.email, c.nombre, c.empresa, c.ruc, c.codigo].some((v) => plano(v).includes(t)));
  }, [data, q]);

  const opcionesPlan = PRODUCTOS_G.flatMap((p) =>
    Object.entries(cfg?.base[p] ?? {}).map(([id, b]) => ({ value: `${p}:${id}`, label: `${PRODUCTO[p]}, ${b.nombre}` })),
  );

  function cortesia() {
    open({
      title: "Regalar meses de un plan",
      tone: "success",
      confirmLabel: "Activar la cortesía",
      body: <>Para prensa, aliados o pruebas. La persona necesita una cuenta en Gobserva con ese correo; si ya tiene el plan, se le suman los meses.</>,
      fields: [
        { name: "email", label: "Correo de la cuenta", required: true, placeholder: "nombre@empresa.pe" },
        { name: "plan", label: "Plan", type: "select", required: true, options: opcionesPlan, defaultValue: opcionesPlan[0]?.value },
        {
          name: "meses",
          label: "Meses",
          type: "select",
          options: ["1", "2", "3", "6", "12"].map((m) => ({ value: m, label: m === "1" ? "1 mes" : `${m} meses` })),
          defaultValue: "1",
        },
      ],
      onConfirm: async (v) => {
        const [prod, plan] = (v.plan ?? "").split(":");
        let r: { codigo: string; vigenteHasta?: string };
        try {
          r = await adminFetch(`/gobserva/cortesia`, {
            method: "POST",
            body: JSON.stringify({ email: v.email.trim(), producto: prod, plan, meses: Number(v.meses || 1) }),
          });
        } catch (e) {
          throw new Error(mensajeError(e));
        }
        toast(`Cortesía activa: ${r.codigo}${r.vigenteHasta ? ` hasta el ${r.vigenteHasta}` : ""}`);
        void refrescarAdmin("/gobserva");
      },
    });
  }

  function cancelar(c: ClienteAdmin) {
    open({
      title: `Cancelar ${c.codigo}`,
      tone: "danger",
      confirmLabel: "Cancelar el plan",
      body: (
        <>
          El plan de <strong>{c.email}</strong> deja de renovarse{c.medio === "tarjeta" ? " y se cancela la suscripción en Mercado Pago" : ""}. Sigue activo hasta
          el {c.vigenteHasta ?? "final de lo pagado"}.
        </>
      ),
      fields: [{ name: "motivo", label: "Motivo", type: "textarea", placeholder: "Ej. lo pidió por correo" }],
      onConfirm: async (v) => {
        try {
          await adminFetch(`/gobserva/planes/${encodeURIComponent(c.codigo)}/cancelar`, { method: "POST", body: JSON.stringify({ motivo: v.motivo?.trim() || undefined }) });
        } catch (e) {
          throw new Error(mensajeError(e));
        }
        toast(`${c.codigo} cancelado: no se renueva`);
        void refrescarAdmin("/gobserva");
      },
    });
  }

  const columnas: Columna<ClienteAdmin>[] = [
    {
      clave: "cliente",
      titulo: "Cliente",
      principal: true,
      celda: (c) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">{c.email}</span>
          <span className="block truncate text-rotulo text-mute">{[c.empresa || c.nombre, c.ruc ? `RUC ${c.ruc}` : null].filter(Boolean).join(", ") || "Sin datos de facturación"}</span>
        </span>
      ),
    },
    {
      clave: "plan",
      titulo: "Plan",
      celda: (c) => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-1.5 text-meta font-medium text-ink">
            {PRODUCTO[c.producto]}, {PLAN[c.plan] ?? c.plan}
            {c.fundador && <Badge tono="brand">Fundador</Badge>}
          </span>
          <span className="block font-mono text-micro text-mute">{c.codigo}</span>
        </span>
      ),
    },
    {
      clave: "pago",
      titulo: "Pago",
      celda: (c) => (
        <span className="block min-w-0">
          <span className="block text-meta text-ink">
            {MEDIO[c.medio] ?? c.medio}
            {c.medio !== "cortesia" && <span className="tabular-nums">, {soles(c.monto)}</span>}
          </span>
          <span className="block text-micro text-mute">
            {c.medio === "tarjeta" ? (c.renovar ? "Se renueva cada mes" : "No se renueva") : c.medio === "cortesia" ? "Regalado" : "Por meses"}
            {c.cobros > 0 && `, ${c.cobros} ${c.cobros === 1 ? "cobro" : "cobros"}`}
          </span>
        </span>
      ),
    },
    {
      clave: "vigencia",
      titulo: "Hasta",
      alinear: "derecha",
      celda: (c) => <span className="whitespace-nowrap font-mono text-meta text-inkSoft">{c.vigenteHasta ?? "Sin fecha"}</span>,
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (c) => <Badge tono={ESTADO_PLAN[c.estado]?.tono ?? "neutral"}>{ESTADO_PLAN[c.estado]?.etiqueta ?? c.estado}</Badge>,
    },
    {
      clave: "acciones",
      titulo: <span className="sr-only">Acciones</span>,
      acciones: true,
      celda: (c) =>
        c.estado === "activa" || c.estado === "pendiente" ? (
          <MenuFila
            etiqueta={`Acciones de ${c.codigo}`}
            acciones={[{ etiqueta: "Cancelar el plan", icono: <Ban size={14} aria-hidden />, onClick: () => cancelar(c), peligro: true }]}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterChips<FiltroProducto>
            etiqueta="Producto"
            valor={producto}
            onCambiar={setProducto}
            opciones={[{ valor: "", etiqueta: "Todos" }, ...PRODUCTOS_G.map((p) => ({ valor: p, etiqueta: PRODUCTO[p] }))]}
          />
          <FilterChips<FiltroEstado>
            etiqueta="Estado del plan"
            valor={estado}
            onCambiar={setEstado}
            opciones={[
              { valor: "activa", etiqueta: "Activos", tono: "ok" },
              { valor: "pendiente", etiqueta: "Esperando pago", tono: "warn" },
              { valor: "cancelada", etiqueta: "No se renuevan" },
              { valor: "vencida", etiqueta: "Vencidos" },
              { valor: "", etiqueta: "Todos" },
            ]}
          />
        </div>
        <button type="button" onClick={cortesia} disabled={!opcionesPlan.length} className={claseBoton("secundario", "sm")}>
          <Gift size={14} aria-hidden /> Regalar meses
        </button>
      </div>
      <label className="flex max-w-md items-center gap-2 rounded-xl border border-line bg-paper px-3">
        <Search size={15} aria-hidden className="text-mute" />
        <span className="sr-only">Buscar clientes</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por correo, empresa, RUC o código"
          className="min-h-11 w-full bg-transparent text-destacado text-ink outline-none sm:text-dato"
        />
      </label>
      {error && <ErrorBanner error={error} onReintentar={() => mutate()} />}
      <DataTable
        columnas={columnas}
        filas={filas}
        claveFila={(c) => c.codigo}
        etiqueta="Clientes de Gobserva"
        cargando={isLoading}
        porPagina={25}
        compactoMovil
        reinicio={`${producto}|${estado}|${q}`}
        vacio={
          <EmptyState
            compacto
            icono={<Users size={20} aria-hidden />}
            titulo={q || producto || estado ? "Nadie con ese filtro" : "Todavía no hay clientes"}
            descripcion="Los planes llegan desde el pago de cada producto (tarjeta, Yape o Plin) o como cortesía."
          />
        }
      />
    </div>
  );
}
