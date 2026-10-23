"use client";

import { useState } from "react";
import { ExternalLink, Lock, Mail } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";
import { Aviso, Badge, Card, claseBoton, EmptyState, ErrorBanner, FilterChips, fmtFechaHora, hace, SkeletonPanel, type OpcionChip, type Tone } from "@/components/admin/ui";

/**
 * Pedidos de privacidad (Ley 29733): personas que aparecen en un análisis y piden corregir, retirar,
 * conocer u oponerse al uso de un dato suyo. Llegan desde /privacidad (formulario público) y se
 * atienden acá. Sólo perfil admin (llevan el correo de la persona). Cada cambio queda en la bitácora.
 * Fuente: GET/PATCH /api/admin/privacidad (backend/api/src/routes/admin_privacidad.ts, migración 45).
 */

type Estado = "pendiente" | "en_revision" | "resuelta" | "rechazada";
type Filtro = Estado | "todas";

interface Solicitud {
  id: string;
  codigo: string;
  tipo: "correccion" | "retiro" | "acceso" | "oposicion" | "otro";
  nombre: string;
  email: string;
  enlace: string | null;
  mensaje: string;
  estado: Estado;
  respuesta: string | null;
  atendidaPor: string | null;
  atendidaAt: string | null;
  createdAt: string;
}

interface Respuesta {
  data: Solicitud[];
  total: number;
  porEstado: Record<Estado, number>;
  tabla: boolean;
}

const TIPO: Record<Solicitud["tipo"], string> = {
  correccion: "Corregir un dato",
  retiro: "Retirar un dato",
  acceso: "Saber qué datos hay",
  oposicion: "Oponerse al uso",
  otro: "Otro pedido",
};

const ESTADO: Record<Estado, { etiqueta: string; tono: Tone }> = {
  pendiente: { etiqueta: "Pendiente", tono: "warn" },
  en_revision: { etiqueta: "En revisión", tono: "pending" },
  resuelta: { etiqueta: "Resuelta", tono: "ok" },
  rechazada: { etiqueta: "Rechazada", tono: "muted" },
};

/** Días hábiles (lunes a viernes) desde que llegó: el plazo de respuesta que se fija Vigía es 10. */
function diasHabiles(desde: string): number {
  const inicio = new Date(desde);
  const hoy = new Date();
  let n = 0;
  for (const d = new Date(inicio); d < hoy; d.setDate(d.getDate() + 1)) {
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) n++;
  }
  return Math.max(0, n - 1);
}

export default function PrivacidadAdmin() {
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const { data, error, isLoading, mutate } = useAdmin<Respuesta>(`/privacidad?estado=${filtro}`);
  const { open, toast } = useDialog();

  const cambiar = (s: Solicitud, estado: Estado) => {
    const cierra = estado === "resuelta" || estado === "rechazada";
    open({
      title: estado === "resuelta" ? `Resolver ${s.codigo}` : estado === "rechazada" ? `Rechazar ${s.codigo}` : `Tomar ${s.codigo}`,
      body: cierra
        ? "Anota qué se hizo (o por qué no procede). Queda en el panel, no se publica. La respuesta a la persona va por correo."
        : "Queda marcado como en revisión: el resto del equipo sabe que alguien lo está viendo.",
      fields: cierra
        ? [{ name: "respuesta", label: estado === "resuelta" ? "Qué se hizo" : "Por qué no procede", type: "textarea", required: true, minimo: 10, defaultValue: s.respuesta ?? "" }]
        : [],
      confirmLabel: estado === "resuelta" ? "Marcar resuelta" : estado === "rechazada" ? "Rechazar" : "Tomar",
      tone: estado === "rechazada" ? "danger" : estado === "resuelta" ? "success" : "normal",
      onConfirm: async (v) => {
        await adminFetch(`/privacidad/${s.id}`, { method: "PATCH", body: JSON.stringify({ estado, respuesta: v.respuesta ?? null }) });
        toast(`${s.codigo}: ${ESTADO[estado].etiqueta.toLowerCase()}`);
        await mutate();
      },
    });
  };

  const cuenta = (e: Estado) => data?.porEstado?.[e] ?? null;
  const opciones: OpcionChip<Filtro>[] = [
    { valor: "pendiente", etiqueta: "Pendientes", cuenta: cuenta("pendiente"), tono: "warn" },
    { valor: "en_revision", etiqueta: "En revisión", cuenta: cuenta("en_revision"), tono: "pending" },
    { valor: "resuelta", etiqueta: "Resueltas", cuenta: cuenta("resuelta"), tono: "ok" },
    { valor: "rechazada", etiqueta: "Rechazadas", cuenta: cuenta("rechazada") },
    { valor: "todas", etiqueta: "Todas" },
  ];

  return (
    <AdminShell title="Privacidad" subtitle="Pedidos de personas que aparecen en Vigía (Ley 29733)">
      <div className="space-y-4">
        <Aviso tono="neutral" titulo="Respuesta en 10 días hábiles como máximo">
          Escríbele a la persona desde el correo del equipo. Para corregir o retirar un dato, se corrige en la base y se
          vuelve a publicar el análisis. Nunca le pidas su DNI: con el enlace y su nombre alcanza para ubicarlo.
        </Aviso>

        <FilterChips etiqueta="Estado del pedido" opciones={opciones} valor={filtro} onCambiar={setFiltro} />

        {error && <ErrorBanner error={error} onReintentar={() => mutate()} />}
        {data?.tabla === false && (
          <Aviso tono="warn" titulo="Falta la tabla de pedidos">
            La base no tiene la migración 45 (solicitudes_privacidad): el formulario público responde que no está disponible.
          </Aviso>
        )}
        {isLoading && !data && <SkeletonPanel lineas={4} />}

        {data && data.data.length === 0 && data.tabla !== false && (
          <Card relleno="none">
            <EmptyState
              icono={<Lock size={16} />}
              titulo={filtro === "pendiente" ? "No hay pedidos pendientes" : "No hay pedidos en este estado"}
              descripcion="Llegan desde vigia-peru.web.app/privacidad y desde el enlace «¿Apareces aquí?» de cada análisis."
            />
          </Card>
        )}

        <ul className="space-y-3">
          {data?.data.map((s) => {
            const abierta = s.estado === "pendiente" || s.estado === "en_revision";
            const dias = diasHabiles(s.createdAt);
            return (
              <li key={s.id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-meta font-semibold text-ink">{s.codigo}</span>
                    <Badge tono={ESTADO[s.estado].tono} punto>{ESTADO[s.estado].etiqueta}</Badge>
                    <Badge>{TIPO[s.tipo]}</Badge>
                    <span className="text-rotulo text-mute" title={fmtFechaHora(s.createdAt) ?? undefined}>
                      Llegó {hace(s.createdAt)}
                    </span>
                    {abierta && dias >= 7 && (
                      <Badge tono={dias >= 10 ? "danger" : "warn"}>{dias >= 10 ? "Plazo vencido" : `${dias} de 10 días hábiles`}</Badge>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <dl className="space-y-1.5 text-meta">
                      <div>
                        <dt className="text-rotulo text-mute">Quién escribe</dt>
                        <dd className="font-medium text-ink">{s.nombre}</dd>
                      </div>
                      <div>
                        <dt className="text-rotulo text-mute">Correo</dt>
                        <dd>
                          <a
                            href={`mailto:${s.email}?subject=${encodeURIComponent(`Vigía Perú · tu pedido ${s.codigo}`)}`}
                            className="inline-flex items-center gap-1 break-all text-ink underline decoration-line underline-offset-2 hover:decoration-granate"
                          >
                            <Mail size={12} aria-hidden /> {s.email}
                          </a>
                        </dd>
                      </div>
                      {s.enlace && (
                        <div>
                          <dt className="text-rotulo text-mute">Dónde aparece</dt>
                          <dd>
                            <a
                              href={s.enlace}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 break-all text-ink underline decoration-line underline-offset-2 hover:decoration-granate"
                            >
                              <ExternalLink size={12} aria-hidden /> {s.enlace.replace(/^https?:\/\/[^/]+/, "")}
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="min-w-0">
                      <p className="text-rotulo text-mute">Su pedido</p>
                      <p className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-line bg-paperDeep px-3 py-2 text-dato leading-relaxed text-ink">
                        {s.mensaje}
                      </p>
                      {s.respuesta && (
                        <p className="mt-2 text-meta leading-relaxed text-inkSoft">
                          <span className="font-semibold text-ink">Qué se hizo: </span>
                          {s.respuesta}
                          {s.atendidaPor && <span className="text-mute"> · {s.atendidaPor}{s.atendidaAt ? `, ${fmtFechaHora(s.atendidaAt)}` : ""}</span>}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {s.estado === "pendiente" && (
                      <button type="button" onClick={() => cambiar(s, "en_revision")} className={claseBoton("secundario", "sm")}>
                        Tomar
                      </button>
                    )}
                    {abierta && (
                      <>
                        <button type="button" onClick={() => cambiar(s, "resuelta")} className={claseBoton("primario", "sm")}>
                          Marcar resuelta
                        </button>
                        <button type="button" onClick={() => cambiar(s, "rechazada")} className={claseBoton("fantasma", "sm")}>
                          No procede
                        </button>
                      </>
                    )}
                    {!abierta && (
                      <button type="button" onClick={() => cambiar(s, "en_revision")} className={claseBoton("secundario", "sm")}>
                        Reabrir
                      </button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </AdminShell>
  );
}
