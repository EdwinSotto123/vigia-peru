"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, Eye, EyeOff, ExternalLink, Globe, Pencil, RefreshCw, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminError, adminFetch, editarPerfilAliado, fmtPEN, type FinanciadorAdmin, type FinanciadoresRespuesta } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import {
  Aviso,
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
import { cambiosPerfil, camposPerfil, resumenPerfil } from "./perfil";

/**
 * Financiadores: quién aporta, cuánto y quién queda sin reconocimiento público por
 * conflicto de interés (regla 3 de independencia). Ocultar no toca dinero ni asignaciones.
 * Además, el perfil público que cada aliado muestra en /aliado/<slug> (migración 30):
 * descripción, web, correo de contacto, redes y portada.
 * Fuente: GET /api/admin/financiadores · PATCH /api/admin/financiadores/:id
 */

type F = FinanciadorAdmin;

export default function FinanciadoresPage() {
  const { data, error, isLoading, isValidating, mutate } = useAdmin<FinanciadoresRespuesta>("/financiadores");
  const rows = data?.data ?? null;
  // Sin `perfil` en la respuesta, la API desplegada es anterior a esta función; con `false`, falta la migración 30.
  const perfilDisponible = data?.perfil === true;
  const { open, toast } = useDialog();
  const guardar = async (f: F, body: Record<string, unknown>) => {
    try {
      await adminFetch(`/financiadores/${f.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } catch (e) { throw new Error(mensajeError(e)); }
    refrescarAdmin("/financiadores");
  };

  function toggle(f: F) {
    const nombre = f.nombrePublico ?? f.email;
    if (f.visible) {
      open({
        title: `Ocultar a ${nombre}`, tone: "danger", confirmLabel: "Ocultar del ranking y muro",
        body: <>No toca su dinero ni sus asignaciones: solo deja de aparecer en ranking, muro y comprobantes públicos (regla 3 de independencia).</>,
        fields: [{ name: "motivo", label: "Motivo", type: "select", defaultValue: "decision_admin", options: [
          { value: "decision_admin", label: "Decisión del equipo" }, { value: "sancion_vigente_osce", label: "Sanción OSCE vigente" },
          { value: "proveedor_con_alertas_activas", label: "Proveedor con alertas activas" }, { value: "solicitud_del_financiador", label: "Lo pidió el financiador" }] }],
        onConfirm: async (v) => { await guardar(f, { visible: false, motivoNoVisible: v.motivo }); toast(`${nombre} oculto`); },
      });
    } else {
      open({
        title: `Volver visible a ${nombre}`, tone: "success", confirmLabel: "Mostrar",
        body: <>{f.sancionVigente && <p className="text-crimsonTexto">Ojo: tiene sanción OSCE vigente.</p>}{f.alertasActivas && <p className="text-crimsonTexto">Ojo: aparece como proveedor en alertas activas.</p>}<p>Volverá a aparecer en ranking, muro y comprobantes.</p></>,
        onConfirm: async () => { await guardar(f, { visible: true }); toast(`${nombre} visible`); },
      });
    }
  }

  // Hoy el API sólo cambia valores: un campo vacío deja el que había (no lo borra). Por eso sólo se
  // manda lo que cambió y el formulario no promete "vacío = anónimo" ni quitar el logo.
  function editar(f: F) {
    open({
      title: "Nombre y logo", confirmLabel: "Guardar",
      fields: [
        { name: "nombre", label: "Nombre público", defaultValue: f.nombrePublico ?? "", placeholder: "Nombre que se muestra en el sitio", hint: "Si lo dejas vacío, se mantiene el nombre actual." },
        { name: "logo", label: "URL del logo", defaultValue: f.logoUrl ?? "", placeholder: "https://…/logo.png", hint: "PNG/SVG cuadrado, fondo transparente. Si lo dejas vacío, se mantiene el logo actual." },
      ],
      onConfirm: async (v) => {
        const nombre = v.nombre.trim(), logo = v.logo.trim();
        const cambios = {
          ...(nombre && nombre !== (f.nombrePublico ?? "") ? { nombrePublico: nombre } : {}),
          ...(logo && logo !== (f.logoUrl ?? "") ? { logoUrl: logo } : {}),
        };
        if (!Object.keys(cambios).length) { toast("No había cambios que guardar"); return; }
        await guardar(f, cambios);
        toast("Financiador actualizado");
      },
    });
  }

  // Acá, a diferencia de "Nombre y logo", vaciar un campo SÍ lo borra: el aliado decide qué publica.
  function editarPerfil(f: F) {
    const nombre = f.nombrePublico ?? "este aliado";
    open({
      title: `Editar perfil público de ${nombre}`, confirmLabel: "Guardar perfil",
      body: (
        <>
          <p>Lo que {nombre} quiere mostrar en su página, como un perfil de red social. Sólo aparece lo que completes: deja un campo vacío para quitarlo.</p>
          {f.slug && (
            <p className="mt-2">
              <Link href={`/aliado/${f.slug}`} target="_blank" className="inline-flex items-center gap-1 font-medium text-granate underline-offset-2 hover:underline">
                Ver /aliado/{f.slug} <ExternalLink size={12} aria-hidden /><span className="sr-only">(se abre en otra pestaña)</span>
              </Link>
              <span className="block text-[11px]">Después de guardar, los cambios tardan hasta un minuto en verse ahí.</span>
            </p>
          )}
          {!f.visible && <p className="mt-2 text-crimsonTexto">Está oculto: su página no se ve hasta que vuelva a ser visible.</p>}
        </>
      ),
      fields: camposPerfil(f),
      onConfirm: async (v) => {
        const cambios = cambiosPerfil(f, v); // tira con el primer dato inválido: el diálogo lo muestra
        if (!Object.keys(cambios).length) { toast("No había cambios que guardar"); return; }
        try {
          await editarPerfilAliado(f.id, cambios);
        } catch (e) {
          // 400 (dato rechazado) y 503 (falta la migración 30) traen el motivo en palabras desde el API.
          throw new Error(e instanceof AdminError && (e.status === 400 || e.status === 503) && e.message ? e.message : mensajeError(e));
        }
        refrescarAdmin("/financiadores", "/log");
        toast(`Perfil de ${nombre} guardado`);
      },
    });
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
      celda: (f) => (
        <div className="flex items-start gap-2.5">
          {f.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={f.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-line bg-paper object-contain" />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paperDeep text-inkSoft" aria-hidden><Users size={14} /></span>
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-ink">{f.nombrePublico ?? <span className="text-mute">Anónimo</span>}</span>
              {f.slug && (
                <Link href={`/aliado/${f.slug}`} target="_blank" className="text-mute hover:text-ink" aria-label={`Página pública de ${f.nombrePublico ?? "este financiador"}`}>
                  <ExternalLink size={12} aria-hidden />
                </Link>
              )}
            </span>
            <span className="block text-[11px] text-mute">{tipoFinanciadorLabel(f.tipo)}</span>
            {perfilDisponible && f.slug && (
              <span className="block text-[11px] text-mute">{resumenPerfil(f) ? `Perfil: ${resumenPerfil(f)}` : "Perfil público sin completar"}</span>
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
          <span className="block font-mono text-[11px] text-mute">{f.ruc ? `RUC ${f.ruc}` : "Sin RUC"}</span>
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
        <div className="inline-flex items-center justify-end gap-1">
          <button onClick={() => editar(f)} className={claseBoton("secundario", "xs")}><Pencil size={11} aria-hidden /> Nombre y logo</button>
          {/* Sin slug (anónimo) no hay página donde mostrar el perfil; sin la migración 30, no hay dónde guardarlo. */}
          <button
            onClick={() => editarPerfil(f)}
            disabled={!perfilDisponible || !f.slug}
            title={!f.slug ? "Es anónimo: no tiene página pública" : !perfilDisponible ? "Todavía no se puede editar (ver el aviso arriba)" : undefined}
            className={claseBoton("secundario", "xs")}
          >
            <Globe size={11} aria-hidden /> Perfil público
          </button>
          <button onClick={() => toggle(f)} className={claseBoton(f.visible ? "peligro" : "secundario", "xs")}>
            {f.visible ? <><EyeOff size={11} aria-hidden /> Ocultar</> : <><Eye size={11} aria-hidden /> Mostrar</>}
          </button>
        </div>
      ),
    },
  ];

  return (
    <AdminShell
      title="Financiadores"
      subtitle="Quién aporta, cuánto, y quién queda sin reconocimiento público por conflicto de interés"
      actions={
        <button onClick={() => mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-8">
        <ErrorBanner error={error} onReintentar={() => mutate()} />
        {data && !perfilDisponible && (
          <Aviso tono="warn" titulo="El perfil público de los aliados todavía no se puede editar">
            <p>
              {data.perfil === false
                ? "Falta aplicar la migración 30 (perfil del aliado) en la base."
                : "La API en producción es anterior a esta función: falta desplegarla."}{" "}
              Nombre, logo y visibilidad funcionan igual.
            </p>
          </Aviso>
        )}

        <StatGrid columnas={4}>
          <StatCard etiqueta="Financiadores" valor={rows ? tot.n : null} cargando={isLoading} pista={rows ? `${tot.visibles} visibles en público` : undefined} />
          <StatCard etiqueta="Ocultos" valor={rows ? tot.ocultos : null} cargando={isLoading} tono={tot.ocultos ? "danger" : "neutral"} pista={rows ? (tot.conConflicto ? `${tot.conConflicto} con sanción o alertas` : "ninguno con sanción ni alertas") : undefined} />
          <StatCard etiqueta="Recaudado" valor={rows ? fmtPEN(tot.monto) : null} cargando={isLoading} tono="ok" pista="suma de aportes confirmados" />
          <StatCard etiqueta="Contratos financiados" valor={rows ? tot.contratos : null} cargando={isLoading} />
        </StatGrid>

        <PageSection
          titulo="Todos los financiadores"
          meta={rows ? `${rows.length}` : undefined}
          descripcion="Ocultar a alguien no toca su dinero ni sus asignaciones: solo lo saca del ranking, del muro de aliados y de los comprobantes públicos."
        >
          <DataTable
            etiqueta="Financiadores"
            columnas={columnas}
            filas={rows}
            claveFila={(f) => String(f.id)}
            cargando={isLoading}
            apilarHasta="lg"
            vacio={<EmptyState compacto icono={<Users size={18} />} titulo="Todavía no hay financiadores" descripcion="Aparecen cuando alguien registra su primer aporte en la página pública de financiar." />}
          />
        </PageSection>
      </div>
    </AdminShell>
  );
}
