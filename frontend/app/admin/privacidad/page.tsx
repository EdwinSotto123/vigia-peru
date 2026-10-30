"use client";

import { useRef, useState } from "react";
import { ExternalLink, Lock, Mail, X } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";
import {
  Aviso,
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterChips,
  fmtFechaHora,
  hace,
  KeyValue,
  type Columna,
  type OpcionChip,
  type ParClave,
  type Tone,
} from "@/components/admin/ui";

/**
 * Pedidos de privacidad (Ley 29733): personas que aparecen en un análisis y piden corregir, retirar,
 * conocer u oponerse al uso de un dato suyo. Llegan desde /privacidad (formulario público) y se
 * atienden acá. Sólo perfil admin (llevan el correo de la persona). Cada cambio queda en la bitácora.
 *
 * Como Contribuciones: arriba el estado en chips con su conteo (una fila) y el plazo, con el cómo se atiende en el ⓘ
 * (antes un aviso de tres oraciones abierto); después la lista paginada (código, tipo, quién, estado y plazo) y, al
 * elegir un pedido, su detalle al costado (en el teléfono, debajo) con el mensaje, el correo, dónde aparece y las
 * decisiones. Antes cada pedido era una tarjeta entera con sus botones al pie, todos desplegados uno tras otro.
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

/** Chips en UNA fila que se desliza de costado, sin barra; el margen negativo con su relleno deja ver el anillo de foco. */
const FILA_CHIPS = "-m-1 min-w-0 flex-nowrap overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const ENLACE = "inline-flex items-center gap-1 break-all text-ink underline decoration-line underline-offset-2 hover:decoration-granate";

const abierta = (s: Solicitud) => s.estado === "pendiente" || s.estado === "en_revision";

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

/** El plazo de un pedido abierto: desde el día hábil 7 lleva la cuenta (ámbar) y a los 10 se marca vencido (rojo). */
function Plazo({ s }: { s: Solicitud }) {
  if (!abierta(s)) return null;
  const dias = diasHabiles(s.createdAt);
  if (dias < 7) return null;
  return <Badge tono={dias >= 10 ? "danger" : "warn"}>{dias >= 10 ? "Plazo vencido" : `${dias} de 10 días hábiles`}</Badge>;
}

const columnas: Columna<Solicitud>[] = [
  {
    clave: "pedido",
    titulo: "Pedido",
    principal: true,
    // El código y el tipo no se parten: van juntos en una línea y, si la columna es angosta (con el detalle abierto),
    // el tipo baja entero al renglón de abajo.
    celda: (s) => (
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="whitespace-nowrap font-mono text-rotulo font-medium text-ink">{s.codigo}</span>
        <span className="whitespace-nowrap text-meta text-inkSoft">{TIPO[s.tipo]}</span>
      </span>
    ),
  },
  {
    clave: "quien",
    titulo: "Quién escribe",
    // Ancho acotado: un nombre largo se recorta (entero en el `title` y en el detalle) en vez de apretar las demás columnas.
    celda: (s) => (
      <span className="block max-w-[14rem] truncate text-meta text-ink" title={s.nombre}>
        {s.nombre}
      </span>
    ),
  },
  {
    clave: "estado",
    titulo: "Estado",
    celda: (s) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Badge tono={ESTADO[s.estado].tono} punto>{ESTADO[s.estado].etiqueta}</Badge>
        <Plazo s={s} />
      </span>
    ),
  },
  {
    clave: "llego",
    titulo: "Llegó",
    className: "whitespace-nowrap text-rotulo text-mute",
    celda: (s) => <span title={fmtFechaHora(s.createdAt) ?? undefined}>{hace(s.createdAt)}</span>,
  },
];

export default function PrivacidadAdmin() {
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const { data, error, isLoading, mutate } = useAdmin<Respuesta>(`/privacidad?estado=${filtro}`);
  const { open, toast } = useDialog();
  // El elegido se sigue por id: tras cambiarle el estado se ve su versión nueva o, si ya no es de este filtro, se cierra.
  const [elegidoId, setElegidoId] = useState<string | null>(null);
  const sel = (elegidoId && data?.data.find((s) => s.id === elegidoId)) || null;
  const detalleRef = useRef<HTMLElement>(null);

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

  function filtrar(f: Filtro) {
    setFiltro(f);
    setElegidoId(null);
  }

  function elegir(s: Solicitud) {
    setElegidoId(s.id);
    // Por debajo de xl el detalle va después de la lista: llevar la vista hasta él.
    if (window.matchMedia("(max-width: 1279px)").matches) setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

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
        {/* Una fila: el estado (con su conteo) y el plazo; en el teléfono los chips se deslizan y el plazo baja. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <FilterChips etiqueta="Estado del pedido" opciones={opciones} valor={filtro} onCambiar={filtrar} className={FILA_CHIPS} />
          <p className="flex shrink-0 items-center gap-1 text-rotulo text-inkSoft">
            Respuesta en 10 días hábiles como máximo
            <Ayuda titulo="¿Cómo se atiende un pedido?">
              <span className="block">
                Escríbele a la persona desde el correo del equipo. Para corregir o retirar un dato, se corrige en la base y
                se vuelve a publicar el análisis.
              </span>
              <span className="mt-1.5 block">
                Nunca le pidas su DNI: con el enlace y su nombre alcanza para ubicarlo. Desde el día hábil 7 el pedido
                muestra los días que lleva; a los 10, «Plazo vencido».
              </span>
            </Ayuda>
          </p>
        </div>

        <ErrorBanner error={error} onReintentar={() => mutate()} />

        {data?.tabla === false ? (
          <Aviso tono="warn" titulo="Falta la tabla de pedidos">
            La base no tiene la migración 45 (solicitudes_privacidad): el formulario público responde que no está disponible.
          </Aviso>
        ) : (
          // Sin pedido elegido, la lista ocupa todo el ancho; con uno, su detalle al costado (en xl) o debajo.
          <div className={sel ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : "grid gap-4"}>
            <div className="min-w-0 space-y-2 self-start">
              <DataTable
                etiqueta="Pedidos de privacidad"
                columnas={columnas}
                filas={data ? data.data : null}
                claveFila={(s) => s.id}
                onFila={elegir}
                filaActiva={(s) => s.id === sel?.id}
                cargando={isLoading}
                porPagina={25}
                compactoMovil
                vacio={
                  <EmptyState
                    compacto
                    icono={<Lock size={16} />}
                    titulo={filtro === "pendiente" ? "No hay pedidos pendientes" : "No hay pedidos en este estado"}
                    descripcion="Llegan desde /privacidad del sitio público y desde el enlace «¿Apareces aquí?» de cada análisis."
                  />
                }
              />
              {/* El API trae hasta 50 por estado: si hay más, se dice cuántos quedan fuera. */}
              {data && data.total > data.data.length && (
                <p className="text-rotulo text-mute">
                  Se muestran {data.data.length.toLocaleString("es-PE")} de {data.total.toLocaleString("es-PE")} pedidos.
                </p>
              )}
            </div>

            {sel && (
              <aside ref={detalleRef} className="scroll-mt-28 xl:sticky xl:top-24 xl:self-start" aria-label="Detalle del pedido">
                <Detalle key={sel.id} s={sel} onCambiar={(estado) => cambiar(sel, estado)} onCerrar={() => setElegidoId(null)} />
              </aside>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

/**
 * El pedido elegido: quién escribe, cómo contestarle, dónde aparece, su mensaje y lo anotado al cerrarlo; al pie, las
 * decisiones de siempre (tomar, marcar resuelta, no procede, reabrir), cada una con su diálogo.
 */
function Detalle({ s, onCambiar, onCerrar }: { s: Solicitud; onCambiar: (estado: Estado) => void; onCerrar: () => void }) {
  const items: ParClave[] = [
    { etiqueta: "Quién escribe", valor: s.nombre, completo: true },
    {
      etiqueta: "Correo",
      completo: true,
      valor: (
        <a href={`mailto:${s.email}?subject=${encodeURIComponent(`Vigía Perú: tu pedido ${s.codigo}`)}`} className={ENLACE}>
          <Mail size={12} aria-hidden /> {s.email}
        </a>
      ),
    },
    ...(s.enlace
      ? [
          {
            etiqueta: "Dónde aparece",
            completo: true,
            valor: (
              <a href={s.enlace} target="_blank" rel="noreferrer" className={ENLACE}>
                <ExternalLink size={12} aria-hidden /> {s.enlace.replace(/^https?:\/\/[^/]+/, "")}
              </a>
            ),
          },
        ]
      : []),
    { etiqueta: "Llegó", valor: fmtFechaHora(s.createdAt), pista: hace(s.createdAt) },
  ];
  // Lo anotado al cerrarlo: «qué se hizo» si se resolvió, «por qué no procede» si se rechazó (y se conserva al reabrirlo).
  const rotuloRespuesta = s.estado === "resuelta" ? "Qué se hizo" : s.estado === "rechazada" ? "Por qué no procede" : "Lo anotado al cerrarlo";

  return (
    <section className="rounded-2xl border border-line bg-paperSoft">
      <header className="flex items-start justify-between gap-3 px-4 pt-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-mono text-bloque font-bold leading-7 text-ink">{s.codigo}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tono={ESTADO[s.estado].tono} punto>{ESTADO[s.estado].etiqueta}</Badge>
            <Badge>{TIPO[s.tipo]}</Badge>
            <Plazo s={s} />
          </div>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar detalle"
          className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5">
        <KeyValue items={items} />

        <div>
          <p className="text-micro font-medium text-mute">Su pedido</p>
          {/* Una cita (filete a la izquierda), no una caja dentro de la tarjeta. */}
          <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-paperEdge pl-3 text-dato leading-relaxed text-ink">{s.mensaje}</p>
        </div>

        {s.respuesta && (
          <div>
            <p className="text-micro font-medium text-mute">{rotuloRespuesta}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">{s.respuesta}</p>
            {s.atendidaPor && (
              <p className="mt-0.5 text-rotulo text-mute">
                {s.atendidaPor}
                {s.atendidaAt ? `, ${fmtFechaHora(s.atendidaAt)}` : ""}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {s.estado === "pendiente" && (
            <button type="button" onClick={() => onCambiar("en_revision")} className={claseBoton("secundario", "sm")}>
              Tomar
            </button>
          )}
          {abierta(s) ? (
            <>
              <button type="button" onClick={() => onCambiar("resuelta")} className={claseBoton("primario", "sm")}>
                Marcar resuelta
              </button>
              <button type="button" onClick={() => onCambiar("rechazada")} className={claseBoton("fantasma", "sm")}>
                No procede
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onCambiar("en_revision")} className={claseBoton("secundario", "sm")}>
              Reabrir
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
