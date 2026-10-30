"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Search, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, type FinanciadorAdmin, type FinanciadoresRespuesta } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Ruc } from "@/components/Redact";
import {
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageSection,
  StatCard,
  fmtDia,
  mensajeError,
  motivoNoVisibleLabel,
  tipoFinanciadorLabel,
  type Columna,
} from "@/components/admin/ui";
import { resumenPerfil } from "@/lib/perfilAliado";
import { DetalleFinanciador, LogoFinanciador } from "./DetalleFinanciador";

/**
 * Financiadores: quién aporta, cuánto y quién queda sin reconocimiento público por conflicto de
 * interés (regla 3 de independencia). Aquí sólo se MODERA: ocultar o mostrar, con motivo. El perfil
 * público (nombre, tipo, logo, descripción, web, correo público, redes, portada, RUC) lo define
 * quien aporta desde su cuenta (/app/configuracion); el panel lo muestra tal cual, sin editarlo.
 * Ocultar no toca dinero ni asignaciones.
 *
 * Rediseño del 2026-10-30 (celular 5.1 pantallas, cuatro cajas anidadas): las cifras van en tarjetas sueltas, sin la
 * caja que las envolvía; lo que explica «Ocultar» está en el ⓘ del título; la fila abre el detalle y moderar se hace
 * ahí (antes, un botón rojo «Ocultar» en cada fila); la lista va de 25 en 25, con buscador, y en el celular cada
 * financiador ocupa dos renglones.
 * Fuente: GET /api/admin/financiadores · PATCH /api/admin/financiadores/:id (sólo visible y motivo)
 */

type F = FinanciadorAdmin;

/** Para buscar sin tildes ni mayúsculas: «Ávila» se encuentra escribiendo «avila». */
const plano = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function FinanciadoresPage() {
  const { data, error, isLoading, isValidating, mutate } = useAdmin<FinanciadoresRespuesta>("/financiadores");
  const rows = data?.data ?? null;
  // Sin `perfil` en la respuesta, la API desplegada es anterior a la migración 30; con `false`, falta aplicarla.
  const perfilDisponible = data?.perfil === true;
  const { open, toast } = useDialog();

  // Buscar corre en el navegador, sobre la lista que ya llegó (el API devuelve hasta 500): por nombre, correo o RUC.
  const [q, setQ] = useState("");
  const filas = useMemo(() => {
    const t = plano(q.trim());
    if (!rows || !t) return rows;
    return rows.filter((f) => [f.nombrePublico ?? "Anónimo", f.email, f.ruc].some((v) => plano(v).includes(t)));
  }, [rows, q]);

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

  // Contacto, sólo en la tabla de escritorio: en el celular el segundo renglón son aportes, monto, si se ve y el alta.
  const colContacto: Columna<F> = {
    clave: "contacto",
    titulo: "Contacto",
    soloEscritorio: true,
    className: "max-w-[230px] text-rotulo",
    celda: (f) => (
      <>
        <span className="block truncate text-ink" title={f.email}>{f.email}</span>
        <span className="block truncate font-mono text-micro text-mute">{f.ruc ? <>RUC <Ruc value={f.ruc} /></> : "Sin RUC"}</span>
      </>
    ),
  };

  const columnas: Columna<F>[] = [
    {
      clave: "financiador",
      titulo: "Financiador",
      principal: true,
      // Sin enlaces propios: la celda entera abre el detalle (ahí están «Ocultar» y «Ver perfil público»).
      celda: (f) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <LogoFinanciador url={f.logoUrl} />
          <span className="min-w-0">
            <span className={f.nombrePublico ? "block truncate font-medium text-ink" : "block truncate text-mute"}>{f.nombrePublico ?? "Anónimo"}</span>
            <span className="block max-w-[280px] truncate text-micro text-mute" title={perfilDisponible && f.slug && resumenPerfil(f) ? `Publicó ${resumenPerfil(f)}` : undefined}>
              {[tipoFinanciadorLabel(f.tipo), perfilDisponible && f.slug ? (resumenPerfil(f) ? `publicó ${resumenPerfil(f)}` : "perfil sin completar") : null].filter(Boolean).join(", ")}
            </span>
            {(f.sancionVigente || f.alertasActivas) && (
              <span className="flex items-center gap-1 text-micro text-crimsonTexto">
                <AlertTriangle size={11} aria-hidden />{f.sancionVigente ? "Sanción OSCE vigente" : "Proveedor con alertas activas"}
              </span>
            )}
          </span>
        </span>
      ),
    },
    // Con el detalle abierto, el correo y el RUC del elegido se leen ahí: sin esta columna la tabla cabe a su lado sin
    // deslizarse de costado.
    ...(sel ? [] : [colContacto]),
    // En la tabla, el número bajo su título; en el renglón del celular (sin títulos) dice qué es.
    { clave: "aportes", titulo: "Aportes", alinear: "derecha", celda: (f) => <>{f.aportes}<span className="font-sans lg:hidden"> {f.aportes === 1 ? "aporte" : "aportes"}</span></> },
    { clave: "monto", titulo: "Monto", alinear: "derecha", celda: (f) => fmtPEN(f.montoPen) },
    {
      clave: "visible",
      titulo: "En público",
      celda: (f) =>
        f.visible ? (
          <Badge tono="ok" punto>Visible</Badge>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 lg:flex-col lg:items-start">
            <Badge tono="danger" punto>Oculto</Badge>
            <span className="text-micro text-mute">{motivoNoVisibleLabel(f.motivoNoVisible) ?? "sin motivo registrado"}</span>
          </span>
        ),
    },
    { clave: "alta", titulo: "Alta", className: "whitespace-nowrap text-rotulo text-mute", celda: (f) => <><span className="lg:hidden">desde </span>{fmtDia(f.createdAt)}</> },
  ];

  const buscando = !!q.trim();

  return (
    <AdminShell
      title="Financiadores"
      subtitle="Quién aporta, cuánto y quién queda oculto"
      actions={
        <button onClick={() => mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-5">
        <ErrorBanner error={error} onReintentar={() => mutate()} />

        {/* Las cifras en una franja de tarjetas sueltas. No va StatGrid: con tarjetas de sólo lectura las mete en una
            caja propia, y eran cuatro cajas dentro de otra (medición del 2026-10-30). */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard etiqueta="Financiadores" valor={rows ? tot.n : null} cargando={isLoading} pista={rows ? `${tot.visibles} visibles en público` : undefined} />
          <StatCard etiqueta="Ocultos" valor={rows ? tot.ocultos : null} cargando={isLoading} tono={tot.ocultos ? "danger" : "neutral"} pista={rows ? (tot.conConflicto ? `${tot.conConflicto} con sanción o alertas` : "ninguno con sanción ni alertas") : undefined} />
          <StatCard etiqueta="Recaudado" valor={rows ? fmtPEN(tot.monto) : null} cargando={isLoading} tono="ok" pista="suma de aportes confirmados" />
          <StatCard etiqueta="Contratos financiados" valor={rows ? tot.contratos : null} cargando={isLoading} pista="de los aportes por contrato" />
        </div>

        <PageSection
          titulo="Todos los financiadores"
          meta={rows && filas ? (buscando ? `${filas.length} de ${rows.length}` : `${rows.length}`) : undefined}
          ayuda={
            <Ayuda titulo="¿Qué hace Ocultar?">
              Elige un financiador para ver lo que publicó y ocultarlo o mostrarlo. Ocultar no toca su dinero ni sus asignaciones: solo lo saca del
              ranking, del muro, de su página y de los comprobantes públicos. El perfil lo edita quien aporta desde su cuenta; aquí solo se modera.
            </Ayuda>
          }
          acciones={
            <label className="relative block w-64 max-w-full">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, correo o RUC" aria-label="Buscar financiador" className="min-h-[34px] w-full rounded-full border border-line bg-paperDeep py-1.5 pl-8 pr-3 text-meta text-ink placeholder:text-mute focus:border-granate/60" />
            </label>
          }
        >
          {/* La columna del perfil existe sólo con alguien elegido: reservada vacía, angostaba la tabla y la hacía
              deslizar de costado (como en Contribuciones). */}
          <div className={sel ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" : "grid gap-4"}>
            <DataTable
              etiqueta="Financiadores"
              columnas={columnas}
              filas={filas}
              claveFila={(f) => String(f.id)}
              onFila={elegir}
              filaActiva={(f) => sel?.id === f.id}
              cargando={isLoading}
              apilarHasta="lg"
              porPagina={25}
              compactoMovil
              className="self-start"
              vacio={
                buscando ? (
                  <EmptyState compacto titulo="Ningún financiador coincide con la búsqueda" />
                ) : (
                  <EmptyState compacto icono={<Users size={18} />} titulo="Todavía no hay financiadores" descripcion="Aparecen con su primer aporte." />
                )
              }
            />

            {sel && (
              <aside ref={detalleRef} className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start" aria-label="Perfil del financiador">
                <DetalleFinanciador key={sel.id} f={sel} perfilDisponible={perfilDisponible} onModerar={() => toggle(sel)} onCerrar={() => setElegidoId(null)} />
              </aside>
            )}
          </div>
        </PageSection>
      </div>
    </AdminShell>
  );
}
