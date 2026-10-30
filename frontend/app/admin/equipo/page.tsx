"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { Check, KeyRound, Minus, Pause, Play, RefreshCw, ShieldCheck, UserCog, UserMinus, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ayuda } from "@/components/patrones/Ayuda";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { ROLES, puedeVerSeccion, type Rol } from "@/lib/permisos";
import {
  Aviso,
  Badge,
  claseBoton,
  actorCorto,
  DataTable,
  EmptyState,
  ErrorBanner,
  fmtFechaHora,
  hace,
  leerAccion,
  MenuFila,
  Panel,
  PanelPestana,
  Pestanas,
  Punto,
  SkeletonFilas,
  SkeletonPanel,
  usePestana,
  type AccionMenu,
  type Columna,
  type EntradaBitacora,
} from "@/components/admin/ui";

/**
 * Equipo: quién entra al panel y con qué perfil (admin o revisor, lib/permisos.ts). Los administradores principales
 * vienen del secreto `admin-emails` y no se tocan desde acá; el resto se agrega, cambia, pausa o quita en esta página.
 * Cada cambio queda en la bitácora.
 *
 * Tres pestañas (`?tab=`), una a la vez; antes se apilaban las personas, los perfiles con la matriz y la actividad.
 *  - Personas (por defecto): la lista, «Agregar persona» en la cabecera y, en cada fila, el menú «⋯» con cambiar
 *    perfil, pausar o reactivar y quitar (eran tres botones por fila).
 *  - Permisos: qué puede hacer cada perfil y qué secciones ve; por qué no se puede saltar, en el ⓘ.
 *  - Actividad: las 10 acciones más recientes del equipo y el enlace a la bitácora (que es donde está el resto).
 * Fuente: GET/PUT/DELETE /api/admin/equipo (sólo perfil admin); la pestaña Actividad, GET /api/admin/log al abrirla.
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

const PESTANAS = ["personas", "permisos", "actividad"] as const;

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

const OPCIONES_ROL = (["revisor", "admin"] as Rol[]).map((r) => ({ value: r, label: ROLES[r].nombre }));
const AYUDA_ROL = "Revisor: revisa y publica alertas y procesa contratos. Administrador: además aportes, pagos, configuración y equipo.";

function Page() {
  const [tab, setTab] = usePestana(PESTANAS);
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

  /** Lo que se puede hacer con alguien del equipo: un menú «⋯» por fila. Cada opción abre su diálogo de siempre. */
  const accionesDe = (m: Miembro): AccionMenu[] => [
    { etiqueta: "Cambiar perfil", icono: <UserCog size={14} aria-hidden />, onClick: () => cambiarPerfil(m) },
    m.activo
      ? { etiqueta: "Pausar acceso", icono: <Pause size={14} aria-hidden />, onClick: () => pausar(m) }
      : { etiqueta: "Reactivar acceso", icono: <Play size={14} aria-hidden />, onClick: () => pausar(m) },
    { etiqueta: "Quitar del equipo", icono: <UserMinus size={14} aria-hidden />, onClick: () => quitar(m), peligro: true },
  ];

  const columnas: Columna<Miembro>[] = [
    {
      clave: "persona",
      titulo: "Persona",
      principal: true,
      celda: (m) => (
        <div className="min-w-0">
          <p className={`truncate font-medium ${m.activo ? "text-ink" : "text-mute line-through"}`}>{m.nombre ?? m.correo}</p>
          {m.nombre && <p className="truncate text-rotulo text-mute">{m.correo}</p>}
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
      className: "whitespace-nowrap text-rotulo text-inkSoft",
      celda: (m) => (m.principal ? "—" : m.ultimoIngreso ? <span title={fmtFechaHora(m.ultimoIngreso) ?? undefined}>{hace(m.ultimoIngreso)}</span> : "Todavía no entró"),
    },
    {
      clave: "alta",
      titulo: "Agregado",
      soloEscritorio: true,
      className: "text-rotulo text-inkSoft",
      celda: (m) => (m.principal ? "Desde la configuración" : [m.creadoAt && hace(m.creadoAt), m.creadoPor && `por ${m.creadoPor}`].filter(Boolean).join(" ") || "—"),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      acciones: true,
      // Los principales no tienen menú: no se tocan desde el panel.
      celda: (m) => (m.principal ? null : <MenuFila acciones={accionesDe(m)} etiqueta={`Acciones para ${m.nombre ?? m.correo}`} />),
    },
  ];
  const celda = (clave: string, m: Miembro) => columnas.find((c) => c.clave === clave)?.celda(m);

  /**
   * Una línea por persona, con el «⋯» a la derecha del primer renglón. Es la lista de un equipo chico (una tabla de
   * columnas con una fila perdida no hace falta) y la del teléfono siempre: en la tabla apilada el menú bajaba a un
   * renglón propio en cada persona.
   */
  const listaCorta = (personas: Miembro[], className?: string) => (
    <ul aria-label="Personas del equipo" className={cn("divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paperSoft", className)}>
      {personas.map((m) => (
        <li key={m.correo} className="flex items-start gap-3 px-4 py-2.5 sm:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1.5">
            <div className="min-w-0 flex-1 basis-56 text-dato leading-5">{celda("persona", m)}</div>
            <div className="text-dato leading-5">{celda("perfil", m)}</div>
            <div className="text-rotulo leading-snug text-inkSoft">
              <span className="block">{celda("ingreso", m)}</span>
              <span className="block text-mute">{celda("alta", m)}</span>
            </div>
          </div>
          {/* El hueco del «⋯» queda también en los principales (sin menú): las filas terminan parejas. */}
          <div className="flex w-8 shrink-0 justify-end">{celda("acciones", m)}</div>
        </li>
      ))}
    </ul>
  );

  function actualizar() {
    void mutate();
    // La pestaña Actividad lee la bitácora: ahí «Actualizar» también trae lo último de esa lista.
    if (tab === "actividad") void refrescarAdmin("/log");
  }

  return (
    <AdminShell
      title="Equipo"
      subtitle="Quién entra al panel y con qué perfil"
      actions={
        <>
          {/* Agregar es de la pestaña Personas: desde Permisos o Actividad no se vería a quien se acaba de agregar. */}
          {tab === "personas" && (
            <button onClick={agregar} disabled={data?.tabla === false} className={claseBoton("primario")}>
              <UserPlus size={12} aria-hidden /> Agregar persona
            </button>
          )}
          <button onClick={actualizar} className={claseBoton("secundario")}>
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {data?.tabla === false && (
          <Aviso tono="warn" titulo="La lista del equipo todavía no está activa">
            Falta crear la tabla del equipo en la base de datos (migración 29). Mientras tanto sólo entran los administradores principales.
          </Aviso>
        )}
        <ErrorBanner error={error} titulo="No se pudo leer el equipo" onReintentar={() => mutate()} />

        <Pestanas
          etiqueta="Secciones de Equipo"
          pestanas={[
            { clave: "personas", etiqueta: "Personas", conteo: filas ? filas.length : null },
            { clave: "permisos", etiqueta: "Permisos" },
            { clave: "actividad", etiqueta: "Actividad" },
          ]}
          activa={tab}
          onCambiar={setTab}
        />
        <PanelPestana clave={tab}>
          {tab === "permisos" ? (
            <Permisos />
          ) : tab === "actividad" ? (
            <Actividad />
          ) : filas && filas.length > 0 ? (
            filas.length <= 3 ? (
              listaCorta(filas)
            ) : (
              // Más de tres: en pantalla ancha, la tabla con sus columnas alineadas (paginada); en el teléfono, la lista.
              <>
                {listaCorta(filas, "md:hidden")}
                <DataTable
                  columnas={columnas}
                  filas={filas}
                  claveFila={(m) => m.correo}
                  etiqueta="Personas del equipo"
                  cargando={isLoading}
                  porPagina={25}
                  className="hidden md:block"
                />
              </>
            )
          ) : (
            // Todavía sin la lista (cargando) o vacía: el esqueleto o el vacío de la tabla.
            <DataTable
              columnas={columnas}
              filas={filas}
              claveFila={(m) => m.correo}
              etiqueta="Personas del equipo"
              cargando={isLoading}
              vacio={
                <EmptyState
                  compacto
                  icono={<UserPlus size={16} />}
                  titulo="Todavía no agregaste a nadie"
                  descripcion="Con «Agregar persona» le das acceso a un revisor o a otro administrador."
                />
              }
            />
          )}
        </PanelPestana>
      </div>
    </AdminShell>
  );
}

/** Qué puede hacer cada perfil y qué secciones ve: dos bloques, cada uno en su tarjeta. */
function Permisos() {
  return (
    <div className="space-y-4">
      <Panel
        titulo="Perfiles"
        ayuda={
          <Ayuda titulo="¿Quién hace cumplir los perfiles?">
            El servidor, no la pantalla: cada pedido al API se revisa con el perfil de quien lo hace. Un revisor no puede
            saltarse esto aunque conozca la dirección de una sección.
          </Ayuda>
        }
      >
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {(["revisor", "admin"] as Rol[]).map((r) => (
            <div key={r} className="min-w-0">
              <p className="flex items-center gap-2 text-dato font-semibold leading-5 text-ink">
                {r === "admin" ? <KeyRound size={14} aria-hidden /> : <ShieldCheck size={14} aria-hidden />} {ROLES[r].nombre}
              </p>
              <ul className="mt-2 space-y-1.5">
                {PUEDE[r].map((x) => (
                  <li key={x} className="flex items-start gap-2 text-meta leading-snug text-inkSoft">
                    <Check size={14} className="mt-px shrink-0 text-moss" aria-hidden /> {x}
                  </li>
                ))}
                {r === "revisor" && (
                  <li className="flex items-start gap-2 text-meta leading-snug text-mute">
                    <Minus size={14} className="mt-px shrink-0" aria-hidden /> No ve aportes, financiadores, medios de pago, configuración ni equipo.
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
      <Panel titulo="Qué secciones ve cada perfil" sinRelleno>
        <MatrizSecciones />
      </Panel>
    </div>
  );
}

function MatrizSecciones() {
  const mitad = Math.ceil(SECCIONES.length / 2);
  return (
    // Dos medias tablas lado a lado en pantalla ancha; en el teléfono, una debajo de la otra. Sin caja propia: vive
    // dentro de su Panel.
    <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
      {[SECCIONES.slice(0, mitad), SECCIONES.slice(mitad)].map((grupo, g) => (
        <table key={g} className="w-full self-start text-meta">
          <caption className="sr-only">Qué secciones del panel ve cada perfil{g ? " (continuación)" : ""}</caption>
          <thead>
            <tr className="border-b border-line bg-paperDeep/50 text-left text-rotulo text-mute">
              <th scope="col" className="px-4 py-1.5 font-medium sm:px-5">Sección del panel</th>
              <th scope="col" className="w-16 px-1 py-1.5 text-center font-medium">Revisor</th>
              <th scope="col" className="w-16 px-1 py-1.5 text-center font-medium">Admin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {grupo.map((s) => (
              <tr key={s.ruta}>
                <th scope="row" className="px-4 py-1.5 text-left font-normal text-ink sm:px-5">{s.nombre}</th>
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

/**
 * Las últimas 10 acciones de la bitácora, en frases: quién hizo qué y cuándo. Sirve para ver que el equipo está
 * activo; el resto (con filtros por tipo y por persona) está en la bitácora, enlazada en la cabecera del bloque.
 */
function Actividad() {
  const { data, error, isLoading } = useAdmin<{ data: EntradaBitacora[] }>("/log");
  const filas = (data?.data ?? []).slice(0, 10).map((e) => ({ e, a: leerAccion(e) }));
  if (error && !data) return <ErrorBanner error={error} titulo="No se pudo leer la bitácora" />;
  return (
    <Panel
      titulo="Lo último que hizo el equipo"
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          De la bitácora: cada acción del panel queda con quién la hizo y cuándo. Aquí van las 10 más recientes; en la
          bitácora está el resto, con filtros por tipo y por persona.
        </Ayuda>
      }
      acciones={<Link href="/admin/bitacora" className={claseBoton("secundario")}>Ver la bitácora</Link>}
      sinRelleno
    >
      {!data ? (
        isLoading ? <SkeletonFilas filas={4} columnas={2} /> : null
      ) : !filas.length ? (
        <EmptyState compacto titulo="Todavía no hay acciones" descripcion="Validar un aporte o publicar una alerta deja aquí una línea con quién lo hizo." />
      ) : (
        <ol className="divide-y divide-line">
          {filas.map(({ e, a }, i) => (
            <li key={`${e.createdAt}-${i}`} className="flex items-start gap-3 px-4 py-2 text-meta leading-snug sm:px-5">
              <Punto tono={a.tono} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink" title={e.actor}>{actorCorto(e.actor)}</span> <span className="text-inkSoft">{a.frase}</span>
                {a.objeto && <span className="text-ink">: {a.objeto}</span>}
              </span>
              <span className="shrink-0 text-micro text-mute" title={fmtFechaHora(e.createdAt) ?? undefined}>{hace(e.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function EquipoPage() {
  // usePestana lee la pestaña de la URL (useSearchParams), que pide un límite de Suspense; mientras tanto, el esqueleto.
  return (
    <Suspense
      fallback={
        <AdminShell title="Equipo" subtitle="Quién entra al panel y con qué perfil">
          <SkeletonPanel lineas={4} />
        </AdminShell>
      }
    >
      <Page />
    </Suspense>
  );
}
