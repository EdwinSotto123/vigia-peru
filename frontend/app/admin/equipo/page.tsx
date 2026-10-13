"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, KeyRound, Minus, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { ROLES, puedeVerSeccion, type Rol } from "@/lib/permisos";
import {
  Aviso,
  Badge,
  Card,
  claseBoton,
  actorCorto,
  DataTable,
  EmptyState,
  ErrorBanner,
  fmtFechaHora,
  hace,
  leerAccion,
  PageSection,
  Punto,
  type Columna,
  type EntradaBitacora,
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

/** Las secciones del panel, en el orden del menú: la matriz sale de lib/permisos (la misma regla que aplica el proxy). */
const SECCIONES: { nombre: string; ruta: string }[] = [
  { nombre: "Resumen", ruta: "/admin" },
  { nombre: "Revisión humana", ruta: "/admin/revision" },
  { nombre: "Procesamiento", ruta: "/admin/procesamientos" },
  { nombre: "Clasificación", ruta: "/admin/clasificacion" },
  { nombre: "Cobertura", ruta: "/admin/cobertura" },
  { nombre: "Análisis a demanda", ruta: "/admin/analisis" },
  { nombre: "Contribuciones", ruta: "/admin/contribuciones" },
  { nombre: "Financiadores", ruta: "/admin/financiadores" },
  { nombre: "Medios de pago", ruta: "/admin/pagos" },
  { nombre: "Bitácora", ruta: "/admin/bitacora" },
  { nombre: "Equipo", ruta: "/admin/equipo" },
  { nombre: "Privacidad", ruta: "/admin/privacidad" },
];

function MatrizSecciones() {
  const mitad = Math.ceil(SECCIONES.length / 2);
  return (
    <div className="mt-3 grid overflow-hidden rounded-2xl border border-line bg-paperSoft md:grid-cols-2 md:divide-x md:divide-line">
      {[SECCIONES.slice(0, mitad), SECCIONES.slice(mitad)].map((grupo, g) => (
      <table key={g} className="w-full self-start text-[13px]">
        <caption className="sr-only">Qué secciones del panel ve cada perfil</caption>
        <thead>
          <tr className="border-b border-line bg-paperSoft text-left text-[11.5px] font-medium text-inkSoft">
            <th scope="col" className="px-3 py-1.5 font-medium">Sección del panel</th>
            <th scope="col" className="w-16 px-1 py-1.5 text-center font-medium">Revisor</th>
            <th scope="col" className="w-16 px-1 py-1.5 text-center font-medium">Admin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {grupo.map((s) => (
            <tr key={s.ruta}>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink">{s.nombre}</th>
              {(["revisor", "admin"] as Rol[]).map((r) => (
                <td key={r} className="px-3 py-1.5 text-center">
                  {puedeVerSeccion(r, s.ruta) ? (
                    <><Check size={14} className="mx-auto text-moss" aria-hidden /><span className="sr-only">Sí</span></>
                  ) : (
                    <><Minus size={14} className="mx-auto text-mute" aria-hidden /><span className="sr-only">No</span></>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      ))}
    </div>
  );
}

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
      <div className="space-y-5">
        {data?.tabla === false && (
          <Aviso tono="warn" titulo="La lista del equipo todavía no está activa">
            Falta crear la tabla del equipo en la base de datos (migración 29). Mientras tanto sólo entran los administradores principales.
          </Aviso>
        )}
        <ErrorBanner error={error} titulo="No se pudo leer el equipo" onReintentar={() => mutate()} />

        <PageSection titulo="Personas" meta={filas ? `${filas.length}` : undefined}>
          {filas && filas.length > 0 && filas.length <= 3 ? (
            // Un equipo chico no necesita una tabla de columnas con una fila perdida: una línea por persona.
            <ul aria-label="Personas del equipo" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paperSoft">
              {filas.map((m) => (
                <li key={m.correo} className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5">
                  <div className="min-w-0 flex-1 basis-56 text-sm">{columnas[0].celda(m)}</div>
                  <div className="text-sm">{columnas[1].celda(m)}</div>
                  <div className="text-[12px] leading-snug text-inkSoft">
                    <span className="block">{columnas[2].celda(m)}</span>
                    <span className="block text-mute">{columnas[3].celda(m)}</span>
                  </div>
                  <div className="ml-auto text-sm">{columnas[4].celda(m)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <DataTable
              columnas={columnas}
              filas={filas}
              claveFila={(m) => m.correo}
              etiqueta="Personas del equipo"
              cargando={isLoading}
              vacio={<Aviso tono="neutral" titulo="Todavía no agregaste a nadie">Con «Agregar persona» le das acceso a un revisor o a otro administrador.</Aviso>}
            />
          )}
        </PageSection>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PageSection titulo="Perfiles" descripcion="Lo que puede hacer cada uno. El servidor lo hace cumplir: un revisor no puede saltarse esto aunque conozca la dirección.">
          <Card relleno="sm" className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {(["revisor", "admin"] as Rol[]).map((r) => (
              <div key={r} className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  {r === "admin" ? <KeyRound size={14} aria-hidden /> : <ShieldCheck size={14} aria-hidden />} {ROLES[r].nombre}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {PUEDE[r].map((x) => <li key={x} className="rounded-full bg-paperSoft px-2.5 py-0.5 text-[12px] leading-snug text-inkSoft">{x}</li>)}
                </ul>
                {r === "revisor" && <p className="mt-1.5 text-[12px] text-mute">No ve aportes, financiadores, medios de pago, configuración ni equipo.</p>}
              </div>
            ))}
          </Card>
          <MatrizSecciones />
        </PageSection>

        <PageSection
          titulo="Lo último que hizo el equipo"
          descripcion="Tomado de la bitácora: cada acción queda con quién la hizo."
          acciones={<Link href="/admin/bitacora" className={claseBoton("secundario")}>Ver la bitácora</Link>}
        >
          <ActividadReciente />
        </PageSection>
        </div>
      </div>
    </AdminShell>
  );
}

/** Las últimas acciones de la bitácora, en frases: quién hizo qué y cuándo. Sirve para ver que el equipo está activo. */
function ActividadReciente() {
  const { data, error, isLoading } = useAdmin<{ data: EntradaBitacora[] }>("/log");
  const filas = (data?.data ?? []).slice(0, 14).map((e) => ({ e, a: leerAccion(e) }));
  if (error && !data) return <ErrorBanner error={error} titulo="No se pudo leer la bitácora" />;
  if (!data) return isLoading ? <div className="h-24 animate-pulse rounded-2xl bg-paperDeep" aria-hidden /> : null;
  if (!filas.length) return <EmptyState compacto titulo="Todavía no hay acciones" descripcion="Validar un aporte o publicar una alerta deja aquí una línea con quién lo hizo." />;
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paperSoft">
      {filas.map(({ e, a }, i) => (
        <li key={`${e.createdAt}-${i}`} className="flex items-start gap-3 px-4 py-2 text-[13px] leading-snug">
          <Punto tono={a.tono} className="mt-1.5" />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-ink" title={e.actor}>{actorCorto(e.actor)}</span> <span className="text-inkSoft">{a.frase}</span>
            {a.objeto && <span className="text-ink">: {a.objeto}</span>}
          </span>
          <span className="shrink-0 text-[11px] text-mute" title={fmtFechaHora(e.createdAt) ?? undefined}>{hace(e.createdAt)}</span>
        </li>
      ))}
    </ol>
  );
}
