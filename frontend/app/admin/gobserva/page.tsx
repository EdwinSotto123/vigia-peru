"use client";

import { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ClientesGobserva } from "@/components/admin/gobserva/Clientes";
import { CobrosGobserva } from "@/components/admin/gobserva/Cobros";
import { ConfiguracionGobserva } from "@/components/admin/gobserva/Configuracion";
import { EnviosGobserva } from "@/components/admin/gobserva/Envios";
import { InscritosGobserva } from "@/components/admin/gobserva/Inscritos";
import { soles, type Resumen } from "@/components/admin/gobserva/tipos";
import { ErrorBanner, PanelPestana, Pestanas, SkeletonPanel, StatCard, StatGrid, claseBoton, plural, usePestana } from "@/components/admin/ui";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";

const PESTANAS = ["cobros", "clientes", "envios", "config", "inscritos"] as const;
type Pestana = (typeof PESTANAS)[number];

/**
 * Gobserva en el panel (2026-11-01): lo que entra (ingresos del mes y lo que se renueva solo cada mes con tarjeta), los
 * cobros de Yape o Plin que esperan confirmación, los clientes con su plan, los avisos que salieron, la configuración
 * (precios, fundador, medios de pago y el RUC del vendedor, que es una variable) y la lista de espera de antes de cobrar.
 * Sólo admin: el revisor recibe 403 (correos, teléfonos y pagos). Fuente: /api/admin/gobserva/*
 */
export default function PanelGobserva() {
  return (
    <AdminShell
      title="Gobserva"
      subtitle="Clientes, cobros, planes y alertas de Empleo, Licitaciones y Obras"
      actions={
        <button type="button" onClick={() => refrescarAdmin("/gobserva")} className={claseBoton("secundario")}>
          <RefreshCw size={15} aria-hidden /> Actualizar
        </button>
      }
    >
      <Suspense fallback={<SkeletonPanel lineas={6} />}>
        <Contenido />
      </Suspense>
    </AdminShell>
  );
}

function Contenido() {
  const { data: r, error, isLoading, mutate } = useAdmin<Resumen>("/gobserva/resumen");
  const [tab, setTab] = usePestana(PESTANAS);
  const activos = (r?.porProducto ?? []).reduce((a, p) => a + p.activos, 0);
  const porProducto = (r?.porProducto ?? []).map((p) => `${p.nombre.replace("Gobserva ", "")} ${p.activos}`).join(", ");
  const fundadores = (r?.porProducto ?? []).reduce((a, p) => a + p.fundadores, 0);
  const pendientes = r?.pendientes.n ?? null;

  const panel: Record<Pestana, React.ReactNode> = {
    cobros: <CobrosGobserva />,
    clientes: <ClientesGobserva />,
    envios: <EnviosGobserva correo={r?.correo} />,
    config: <ConfiguracionGobserva />,
    inscritos: <InscritosGobserva />,
  };

  return (
    <div className="space-y-5">
      {error && <ErrorBanner error={error} titulo="No se pudo cargar el resumen" onReintentar={() => mutate()} />}
      <StatGrid columnas={5}>
        <StatCard
          etiqueta="Entró este mes"
          valor={r ? soles(r.ingresos.esteMes) : null}
          pista={r ? `${soles(r.ingresos.total)} desde el inicio, ${plural(r.ingresos.cobros, "cobro", "cobros")}` : undefined}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Se renueva cada mes"
          valor={r ? soles(r.mensualTotal) : null}
          pista={r ? (r.tarjetaActiva ? "Con tarjeta, por Mercado Pago" : "La tarjeta no tiene llaves") : undefined}
          tono={r && !r.tarjetaActiva ? "warn" : "neutral"}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Clientes activos"
          valor={r ? activos : null}
          pista={r ? [porProducto, fundadores ? `${fundadores} con precio de fundador` : ""].filter(Boolean).join("; ") || "Todavía ninguno" : undefined}
          onClick={() => setTab("clientes")}
          activo={tab === "clientes"}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Pagos por validar"
          valor={pendientes}
          pista={r ? `${r.pendientes.conOperacion} con número de operación` : undefined}
          tono={pendientes ? "warn" : "neutral"}
          destacado={!!pendientes}
          onClick={() => setTab("cobros")}
          activo={tab === "cobros"}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Cuentas"
          valor={r ? r.cuentas.cuentas : null}
          pista={r ? `${r.cuentas.semana} esta semana, ${r.cuentas.verificadas} con correo verificado; ${plural(r.alertas.activas, "alerta activa", "alertas activas")}` : undefined}
          cargando={isLoading}
        />
      </StatGrid>

      <Pestanas<Pestana>
        etiqueta="Secciones de Gobserva"
        activa={tab}
        onCambiar={setTab}
        pestanas={[
          { clave: "cobros", etiqueta: "Cobros", conteo: pendientes, tono: pendientes ? "warn" : undefined },
          { clave: "clientes", etiqueta: "Clientes", conteo: r ? activos : null },
          { clave: "envios", etiqueta: "Avisos", conteo: r ? r.envios.enviados + r.envios.enLaWeb : null, tono: r?.envios.fallidos ? "danger" : undefined },
          { clave: "config", etiqueta: "Configuración", tono: r && !r.correoActivo ? "warn" : undefined },
          { clave: "inscritos", etiqueta: "Lista de espera" },
        ]}
      />
      <PanelPestana clave={tab}>{panel[tab]}</PanelPestana>
    </div>
  );
}
