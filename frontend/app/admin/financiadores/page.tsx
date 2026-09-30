"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, MousePointerClick, RefreshCw, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, type FinanciadorAdmin, type FinanciadoresRespuesta } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { Ruc } from "@/components/Redact";
import {
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageSection,
  StatCard,
  StatGrid,
  fmtDia,
  mensajeError,
  motivoNoVisibleLabel,
  tipoFinanciadorLabel,
  type Columna,
} from "@/components/admin/ui";
import { resumenPerfil } from "@/lib/perfilAliado";
import { DetalleFinanciador } from "./DetalleFinanciador";

/**
 * Financiadores: quién aporta, cuánto y quién queda sin reconocimiento público por conflicto de
 * interés (regla 3 de independencia). Aquí sólo se MODERA: ocultar o mostrar, con motivo. El perfil
 * público (nombre, tipo, logo, descripción, web, correo público, redes, portada, RUC) lo define
 * quien aporta desde su cuenta (/app/configuracion); el panel lo muestra tal cual, sin editarlo.
 * Ocultar no toca dinero ni asignaciones.
 * Fuente: GET /api/admin/financiadores · PATCH /api/admin/financiadores/:id (sólo visible y motivo)
 */

type F = FinanciadorAdmin;

export default function FinanciadoresPage() {
  const { data, error, isLoading, isValidating, mutate } = useAdmin<FinanciadoresRespuesta>("/financiadores");
  const rows = data?.data ?? null;
  // Sin `perfil` en la respuesta, la API desplegada es anterior a la migración 30; con `false`, falta aplicarla.
  const perfilDisponible = data?.perfil === true;
  const { open, toast } = useDialog();

  // El elegido se sigue por id: tras ocultar o refrescar se ve su versión nueva.
  const [elegidoId, setElegidoId] = useState<number | null>(null);
  const sel = (elegidoId != null && rows?.find((f) => f.id === elegidoId)) || null;
  const detalleRef = useRef<HTMLDivElement>(null);

  function elegir(f: F) {
    setElegidoId(f.id);
    // Por debajo de lg el detalle va después de la lista: llevar la vista hasta él.
    if (window.matchMedia("(max-width: 1023px)").matches) setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const moderar = async (f: F, body: { visible: boolean; motivoNoVisible?: string }) => {
    try {
      await adminFetch(`/financiadores/${f.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } catch (e) { throw new Error(mensajeError(e)); }
    refrescarAdmin("/financiadores", "/log");
  };

  function toggle(f: F) {
    const nombre = f.nombrePublico ?? f.email;
    if (f.visible) {
      open({
        title: `Ocultar a ${nombre}`, tone: "danger", confirmLabel: "Ocultar del ranking y del muro",
        body: <>No toca su dinero ni sus asignaciones: solo deja de aparecer en ranking, muro, su página y comprobantes públicos (regla 3 de independencia).</>,
        fields: [{ name: "motivo", label: "Motivo", type: "select", defaultValue: "decision_admin", options: [
          { value: "decision_admin", label: "Decisión del equipo" }, { value: "sancion_vigente_osce", label: "Sanción OSCE vigente" },
          { value: "proveedor_con_alertas_activas", label: "Proveedor con alertas activas" }, { value: "solicitud_del_financiador", label: "Lo pidió el financiador" }] }],
        onConfirm: async (v) => { await moderar(f, { visible: false, motivoNoVisible: v.motivo }); toast(`${nombre} oculto`); },
      });
    } else {
      open({
        title: `Volver visible a ${nombre}`, tone: "success", confirmLabel: "Mostrar",
        body: <>{f.sancionVigente && <p className="text-crimsonTexto">Ojo: tiene sanción OSCE vigente.</p>}{f.alertasActivas && <p className="text-crimsonTexto">Ojo: aparece como proveedor en alertas activas.</p>}<p>Volverá a aparecer en ranking, muro, su página y comprobantes.</p></>,
        onConfirm: async () => { await moderar(f, { visible: true }); toast(`${nombre} visible`); },
      });
    }
  }

  const tot = useMemo(() => {
    const r = rows ?? [];
    return {
      n: r.length,
      visibles: r.filter((f) => f.visible).length,
      ocultos: r.filter((f) => !f.visible).length,
      conConflicto: r.filter((f) => f.sancionVigente || f.alertasActivas).length,
      monto: r.reduce((a, f) => a + Number(f.montoPen || 0), 0),
      contratos: r.reduce((a, f) => a + Number(f.contratosFinanciados || 0), 0),
    };
  }, [rows]);

  const columnas: Columna<F>[] = [
    {
      clave: "financiador",
      titulo: "Financiador",
      principal: true,
      // Sin enlaces propios: la celda entera abre el detalle (ahí está "Ver perfil público").
      celda: (f) => (
        <div className="flex items-start gap-2.5">
          {f.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={f.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-line bg-paper object-contain" />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paperDeep text-inkSoft" aria-hidden><Users size={14} /></span>
          )}
          <span className="min-w-0">
            <span className="block font-medium text-ink">{f.nombrePublico ?? <span className="text-mute">Anónimo</span>}</span>
            <span className="block text-[11px] text-mute">{tipoFinanciadorLabel(f.tipo)}</span>
            {perfilDisponible && f.slug && (
              <span className="block text-[11px] text-mute">{resumenPerfil(f) ? `Publicó ${resumenPerfil(f)}` : "Perfil público sin completar"}</span>
            )}
            {(f.sancionVigente || f.alertasActivas) && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-crimsonTexto">
                <AlertTriangle size={11} aria-hidden />{f.sancionVigente ? "Sanción OSCE vigente" : "Proveedor con alertas activas"}
              </span>
            )}
          </span>
        </div>
      ),
    },
    {
      clave: "contacto",
      titulo: "Contacto",
      className: "text-[12px]",
      celda: (f) => (
        <>
          <span className="block break-all text-ink">{f.email}</span>
          <span className="block font-mono text-[11px] text-mute">{f.ruc ? <>RUC <Ruc value={f.ruc} /></> : "Sin RUC"}</span>
        </>
      ),
    },
    { clave: "aportes", titulo: "Aportes", alinear: "derecha", celda: (f) => f.aportes },
    { clave: "contratos", titulo: "Contratos", alinear: "derecha", celda: (f) => f.contratosFinanciados },
    { clave: "monto", titulo: "Monto", alinear: "derecha", celda: (f) => fmtPEN(f.montoPen) },
    {
      clave: "visible",
      titulo: "En público",
      celda: (f) =>
        f.visible ? (
          <Badge tono="ok" punto>Visible</Badge>
        ) : (
          <span className="inline-flex flex-col items-start gap-0.5">
            <Badge tono="danger" punto>Oculto</Badge>
            <span className="text-[11px] text-mute">{motivoNoVisibleLabel(f.motivoNoVisible) ?? "sin motivo registrado"}</span>
          </span>
        ),
    },
    { clave: "alta", titulo: "Alta", className: "whitespace-nowrap text-[12px] text-mute", celda: (f) => fmtDia(f.createdAt) },
    {
      clave: "acciones",
      titulo: "Acciones",
      acciones: true,
      celda: (f) => (
        <button onClick={() => toggle(f)} className={claseBoton(f.visible ? "peligro" : "secundario", "xs")}>
          {f.visible ? <><EyeOff size={11} aria-hidden /> Ocultar</> : <><Eye size={11} aria-hidden /> Mostrar</>}
        </button>
      ),
    },
  ];

  return (
    <AdminShell
      title="Financiadores"
      subtitle="Quién aporta, cuánto y quién queda oculto. El perfil lo edita quien aporta desde su cuenta; aquí solo se modera."
      actions={
        <button onClick={() => mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-8">
        <ErrorBanner error={error} onReintentar={() => mutate()} />

        <StatGrid columnas={4}>
          <StatCard etiqueta="Financiadores" valor={rows ? tot.n : null} cargando={isLoading} pista={rows ? `${tot.visibles} visibles en público` : undefined} />
          <StatCard etiqueta="Ocultos" valor={rows ? tot.ocultos : null} cargando={isLoading} tono={tot.ocultos ? "danger" : "neutral"} pista={rows ? (tot.conConflicto ? `${tot.conConflicto} con sanción o alertas` : "ninguno con sanción ni alertas") : undefined} />
          <StatCard etiqueta="Recaudado" valor={rows ? fmtPEN(tot.monto) : null} cargando={isLoading} tono="ok" pista="suma de aportes confirmados" />
          <StatCard etiqueta="Contratos financiados" valor={rows ? tot.contratos : null} cargando={isLoading} />
        </StatGrid>

        <PageSection
          titulo="Todos los financiadores"
          meta={rows ? `${rows.length}` : undefined}
          descripcion="Elige uno para ver lo que publicó. Ocultar no toca su dinero ni sus asignaciones: solo lo saca del ranking, del muro, de su página y de los comprobantes públicos."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <DataTable
              etiqueta="Financiadores"
              columnas={columnas}
              filas={rows}
              claveFila={(f) => String(f.id)}
              onFila={elegir}
              filaActiva={(f) => sel?.id === f.id}
              cargando={isLoading}
              apilarHasta="lg"
              className="self-start"
              vacio={<EmptyState compacto icono={<Users size={18} />} titulo="Todavía no hay financiadores" descripcion="Aparecen cuando alguien registra su primer aporte en la página pública de financiar." />}
            />

            <aside ref={detalleRef} className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start" aria-label="Perfil del financiador">
              {sel ? (
                <DetalleFinanciador key={sel.id} f={sel} perfilDisponible={perfilDisponible} onModerar={() => toggle(sel)} onCerrar={() => setElegidoId(null)} />
              ) : (
                <div className="rounded-2xl border border-dashed border-line bg-paper/60">
                  <EmptyState compacto icono={<MousePointerClick size={18} />} titulo="Elige un financiador" descripcion="Verás lo que publicó en su perfil, sus cifras y el botón para ocultarlo o mostrarlo." />
                </div>
              )}
            </aside>
          </div>
        </PageSection>
      </div>
    </AdminShell>
  );
}
