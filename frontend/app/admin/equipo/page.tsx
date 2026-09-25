"use client";

import { useMemo } from "react";
import { KeyRound, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { ROLES, type Rol } from "@/lib/permisos";
import {
  Aviso,
  Badge,
  Card,
  claseBoton,
  DataTable,
  ErrorBanner,
  fmtFechaHora,
  hace,
  PageSection,
  type Columna,
} from "@/components/admin/ui";

/**
 * Equipo: quién entra al panel y con qué perfil (admin o revisor, lib/permisos.ts). Los
 * administradores principales vienen del secreto `admin-emails` y no se tocan desde acá; el resto
 * se agrega, cambia, pausa o quita en esta página. Cada cambio queda en la bitácora.
 * Fuente: GET/PUT/DELETE /api/admin/equipo (sólo perfil admin).
 */

interface Miembro {
  correo: string;
  rol: Rol;
  nombre: string | null;
  activo: boolean;
  creadoPor: string | null;
  creadoAt: string | null;
  actualizadoAt: string | null;
  ultimoIngreso: string | null;
  principal?: boolean;
}

const PUEDE: Record<Rol, string[]> = {
  admin: ["Todo lo del revisor", "Validar y rechazar aportes", "Financiadores y medios de pago", "Umbrales y qué tipos se procesan", "Gestionar el equipo"],
  revisor: ["Revisar alertas y publicarlas o descartarlas", "Leer el informe y los documentos", "Procesar: lotes de hasta 50 contratos, re-análisis, reintentos y análisis a demanda", "Ver cobertura, clasificación y bitácora"],
};

const OPCIONES_ROL = (["revisor", "admin"] as Rol[]).map((r) => ({ value: r, label: ROLES[r].nombre }));
const AYUDA_ROL = "Revisor: revisa y publica alertas y procesa contratos. Administrador: además aportes, pagos, configuración y equipo.";

export default function EquipoPage() {
  const { data, error, isLoading, isValidating, mutate } = useAdmin<{ data: Miembro[]; tabla: boolean }>("/equipo");
  const { sesion } = useSesionEquipo();
  const { open, toast } = useDialog();

  const filas = useMemo<Miembro[] | null>(() => {
    if (!data) return null;
    const principales = (sesion?.principales ?? []).map<Miembro>((correo) => ({
      correo, rol: "admin", nombre: null, activo: true, creadoPor: null, creadoAt: null, actualizadoAt: null, ultimoIngreso: null, principal: true,
    }));
    return [...principales, ...data.data.filter((m) => !principales.some((p) => p.correo === m.correo))];
  }, [data, sesion?.principales]);

  async function guardar(correo: string, cuerpo: { rol: Rol; nombre?: string | null; activo?: boolean }, hecho: string) {
    await adminFetch(`/equipo/${encodeURIComponent(correo)}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    toast(hecho);
    await refrescarAdmin("/equipo");
  }

  function agregar() {
    open({
      title: "Agregar a alguien al equipo",
      confirmLabel: "Agregar",
      body: <>La persona entra en <strong>/admin/login</strong> con Google o creando su cuenta con este mismo correo (tiene que verificarlo). Queda en la bitácora con tu correo.</>,
      fields: [
        { name: "correo", label: "Correo", placeholder: "nombre@dominio.pe", required: true },
        { name: "nombre", label: "Nombre (opcional)", placeholder: "Para reconocerlo en la lista" },
        { name: "rol", label: "Perfil", type: "select", options: OPCIONES_ROL, defaultValue: "revisor", required: true, hint: AYUDA_ROL },
      ],
      onConfirm: async (v) => {
        const correo = v.correo.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error("Escribe un correo válido.");
        await guardar(correo, { rol: v.rol as Rol, nombre: v.nombre?.trim() || null, activo: true }, `${correo} ya es parte del equipo como ${ROLES[v.rol as Rol].nombre.toLowerCase()}.`);
      },
    });
  }

  function cambiarPerfil(m: Miembro) {
    open({
      title: `Perfil de ${m.nombre ?? m.correo}`,
      confirmLabel: "Guardar",
      body: <>El cambio rige en menos de un minuto, sin que tenga que volver a entrar.</>,
      fields: [{ name: "rol", label: "Perfil", type: "select", options: OPCIONES_ROL, defaultValue: m.rol, required: true, hint: AYUDA_ROL }],
      onConfirm: (v) => guardar(m.correo, { rol: v.rol as Rol }, `${m.correo} ahora es ${ROLES[v.rol as Rol].nombre.toLowerCase()}.`),
    });
  }

  function pausar(m: Miembro) {
    const activar = !m.activo;
    open({
      title: activar ? `Reactivar a ${m.correo}` : `Pausar a ${m.correo}`,
      tone: activar ? "success" : "danger",
      confirmLabel: activar ? "Reactivar" : "Pausar acceso",
      body: activar
        ? <>Vuelve a entrar con su perfil de {ROLES[m.rol].nombre.toLowerCase()}.</>
        : <>Deja de entrar en menos de un minuto. Sigue en la lista para reactivarlo cuando haga falta.</>,
      onConfirm: () => guardar(m.correo, { rol: m.rol, activo: activar }, activar ? `${m.correo} reactivado.` : `${m.correo} ya no entra al panel.`),
    });
  }

  function quitar(m: Miembro) {
    open({
      title: `Quitar a ${m.correo}`,
      tone: "danger",
      confirmLabel: "Quitar del equipo",
      body: <>Deja de entrar en menos de un minuto y sale de la lista. Lo que hizo sigue en la bitácora.</>,
      onConfirm: async () => {
        await adminFetch(`/equipo/${encodeURIComponent(m.correo)}`, { method: "DELETE" });
        toast(`${m.correo} salió del equipo.`);
        await refrescarAdmin("/equipo");
      },
    });
  }

  const columnas: Columna<Miembro>[] = [
    {
      clave: "persona",
      titulo: "Persona",
      principal: true,
      celda: (m) => (
        <div className="min-w-0">
          <p className={`truncate font-medium ${m.activo ? "text-ink" : "text-mute line-through"}`}>{m.nombre ?? m.correo}</p>
          {m.nombre && <p className="truncate text-[12px] text-mute">{m.correo}</p>}
        </div>
      ),
    },
    {
      clave: "perfil",
      titulo: "Perfil",
      celda: (m) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Badge tono={m.rol === "admin" ? "brand" : "neutral"}>{ROLES[m.rol].nombre}</Badge>
          {m.principal && <Badge tono="muted" title="Viene del secreto admin-emails: no se cambia desde el panel">Principal</Badge>}
          {!m.activo && <Badge tono="warn" punto>Pausado</Badge>}
        </span>
      ),
    },
    {
      clave: "ingreso",
      titulo: "Último ingreso",
      className: "whitespace-nowrap text-[12px] text-inkSoft",
      celda: (m) => (m.principal ? "—" : m.ultimoIngreso ? <span title={fmtFechaHora(m.ultimoIngreso) ?? undefined}>{hace(m.ultimoIngreso)}</span> : "Todavía no entró"),
    },
    {
      clave: "alta",
      titulo: "Agregado",
      soloEscritorio: true,
      className: "text-[12px] text-inkSoft",
      celda: (m) => (m.principal ? "Desde la configuración" : [m.creadoAt && hace(m.creadoAt), m.creadoPor && `por ${m.creadoPor}`].filter(Boolean).join(" ") || "—"),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      acciones: true,
      celda: (m) =>
        m.principal ? null : (
          <div className="inline-flex flex-wrap items-center justify-end gap-1">
            <button type="button" onClick={() => cambiarPerfil(m)} className={claseBoton("secundario", "xs")}>Cambiar perfil</button>
            <button type="button" onClick={() => pausar(m)} className={claseBoton("secundario", "xs")}>{m.activo ? "Pausar" : "Reactivar"}</button>
            <button type="button" onClick={() => quitar(m)} className={claseBoton("peligro", "xs")}>Quitar</button>
          </div>
        ),
    },
  ];

  return (
    <AdminShell
      title="Equipo"
      subtitle="Quién entra al panel y con qué perfil"
      actions={
        <>
          <button onClick={agregar} disabled={data?.tabla === false} className={claseBoton("primario")}>
            <UserPlus size={12} aria-hidden /> Agregar persona
          </button>
          <button onClick={() => mutate()} className={claseBoton("secundario")}>
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
          </button>
        </>
      }
    >
      <div className="space-y-8">
        {data?.tabla === false && (
          <Aviso tono="warn" titulo="La lista del equipo todavía no está activa">
            Falta crear la tabla del equipo en la base de datos (migración 29). Mientras tanto sólo entran los administradores principales.
          </Aviso>
        )}
        <ErrorBanner error={error} titulo="No se pudo leer el equipo" onReintentar={() => mutate()} />

        <PageSection titulo="Perfiles" descripcion="Lo que puede hacer cada uno. El servidor lo hace cumplir: un revisor no puede saltarse esto aunque conozca la dirección.">
          <div className="grid gap-3 md:grid-cols-2">
            {(["revisor", "admin"] as Rol[]).map((r) => (
              <Card key={r}>
                <p className="flex items-center gap-2 font-medium text-ink">
                  {r === "admin" ? <KeyRound size={15} aria-hidden /> : <ShieldCheck size={15} aria-hidden />} {ROLES[r].nombre}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-inkSoft marker:text-mute">
                  {PUEDE[r].map((x) => <li key={x}>{x}</li>)}
                </ul>
                {r === "revisor" && <p className="mt-2 text-[12px] text-mute">No ve aportes, financiadores, medios de pago, configuración ni equipo.</p>}
              </Card>
            ))}
          </div>
        </PageSection>

        <PageSection titulo="Personas" meta={filas ? `${filas.length}` : undefined}>
          <DataTable
            columnas={columnas}
            filas={filas}
            claveFila={(m) => m.correo}
            etiqueta="Personas del equipo"
            cargando={isLoading}
            vacio={<Aviso tono="neutral" titulo="Todavía no agregaste a nadie">Con «Agregar persona» le das acceso a un revisor o a otro administrador.</Aviso>}
          />
        </PageSection>
      </div>
    </AdminShell>
  );
}
