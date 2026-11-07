"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Bot, CalendarClock, ChevronDown, FolderOpen, MessagesSquare, Trash2, User } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { actorCorto, Badge, claseBoton, ErrorBanner, fmtFechaHora, plural, SkeletonPanel } from "@/components/admin/ui";
import { Dato } from "@/components/ui/Dato";
import { cn } from "@/lib/utils";
import { adminFetch } from "@/lib/admin";
import { BurbujaUsuario, TurnoAsistente } from "@/components/admin/chat/Turno";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { leerStream } from "@/components/admin/chat/useChat";
import {
  aplicarEvento,
  cerrarTurno,
  CLAVE_GUARDADO,
  leerGuardado,
  nuevoId,
  turnoDeEventos,
  type Guardado,
  type Mensaje,
  type MensajeAsistente,
} from "@/components/admin/chat/conversacion";
import { ESTADO_INFORME, NOMBRE_MODELO, type InformeCompleto } from "@/components/admin/chat/informes";

/**
 * Un informe guardado del chat de investigación (sólo administradores): la pregunta, la respuesta con sus pasos, su
 * revisión automática y sus descargas, tal como se vio en el chat. Si todavía corre, se sigue en vivo. «Seguir en el
 * chat» abre la conversación (con este informe al final) para hacer preguntas de seguimiento.
 *
 * Fuente: GET /api/admin/chat/informes/:id; si corre, GET …/:id/eventos (NDJSON en vivo). Borrar: DELETE …/:id.
 */
export default function InformeChatPage({ params }: { params: { id: string } }) {
  return (
    <AdminShell
      title="Informe del chat"
      subtitle="La pregunta, la respuesta, sus pasos y su revisión, como se vieron en el chat."
      actions={
        <Link href="/admin/chat/informes" className={claseBoton("secundario", "sm")}>
          <FolderOpen size={14} aria-hidden /> Informes guardados
        </Link>
      }
    >
      <Ficha id={params.id} />
    </AdminShell>
  );
}

function Ficha({ id }: { id: string }) {
  const router = useRouter();
  const { open, toast } = useDialog();
  const [informe, setInforme] = useState<InformeCompleto | null>(null);
  const [turno, setTurno] = useState<MensajeAsistente | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);
  // Si corría al abrirlo, su estado sale del turno que se sigue en vivo; si no, del guardado.
  const [enVivo, setEnVivo] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const i = await adminFetch<InformeCompleto>(`/chat/informes/${encodeURIComponent(id)}`, { signal: ac.signal });
        if (ac.signal.aborted) return;
        const corriendo = i.estado === "corriendo";
        setInforme(i);
        setEnVivo(corriendo);
        setTurno(turnoDeEventos(i.id, i.modelo_pedido, Date.parse(i.creado), i.eventos, !corriendo));
        setError(null);
        if (!corriendo) return;
        // Todavía corre: los eventos llegan en vivo (los guardados se escriben al terminar, así que se pide desde el 0).
        setTurno(turnoDeEventos(i.id, i.modelo_pedido, Date.parse(i.creado), [], false));
        const r = await fetch(`/api/admin/chat/informes/${encodeURIComponent(id)}/eventos?desde=0`, {
          headers: { Accept: "application/x-ndjson" },
          cache: "no-store",
          signal: ac.signal,
        });
        if (r.ok) await leerStream(r, (e) => setTurno((t) => (t ? aplicarEvento(t, e) : t)));
        if (!ac.signal.aborted) setTurno((t) => (t ? cerrarTurno(t, false) : t));
      } catch (e) {
        if (!ac.signal.aborted) setError(e);
      }
    })();
    return () => ac.abort();
  }, [id, intento]);

  if (error) return <ErrorBanner error={error} titulo="No se pudo abrir el informe" onReintentar={() => setIntento((n) => n + 1)} />;
  if (!informe || !turno) return <SkeletonPanel />;

  const corriendo = turno.estado === "corriendo";

  /** La conversación con este informe al final, en el chat (sessionStorage de esta pestaña) para seguir preguntando. */
  const seguirEnElChat = () => {
    const mensajes: Mensaje[] = [];
    for (const h of informe.historial) {
      mensajes.push(
        h.rol === "usuario"
          ? { id: nuevoId(), rol: "usuario", texto: h.texto }
          : { ...turnoDeEventos(nuevoId(), informe.modelo_pedido, Date.parse(informe.creado), [], true), estado: "listo", texto: h.texto },
      );
    }
    mensajes.push({ id: nuevoId(), rol: "usuario", texto: informe.pregunta }, turno);
    const guardado: Guardado = { modelo: informe.modelo_pedido, conversacion: informe.conversacion ?? nuevoId(), mensajes };
    const ir = () => {
      try {
        window.sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify(guardado));
      } catch {
        toast("El navegador no dejó guardar la conversación.", "error");
        return;
      }
      router.push("/admin/chat");
    };
    let abierta: Guardado | null = null;
    try {
      abierta = leerGuardado(window.sessionStorage.getItem(CLAVE_GUARDADO));
    } catch {
      /* sin almacenamiento: se va igual */
    }
    if (!abierta?.mensajes.length) return ir();
    open({
      title: "¿Reemplazar la conversación abierta?",
      body: "En el chat de esta pestaña hay otra conversación. Sus respuestas siguen en Informes guardados.",
      confirmLabel: "Seguir con este informe",
      onConfirm: ir,
    });
  };

  const borrar = () =>
    open({
      title: "¿Borrar este informe?",
      body: "Se borra para todo el equipo y su enlace deja de funcionar. No se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "danger",
      onConfirm: async () => {
        await adminFetch(`/chat/informes/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Informe borrado.");
        router.push("/admin/chat/informes");
      },
    });

  const est = ESTADO_INFORME[enVivo ? turno.estado : informe.estado];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
          <Badge tono={est.tono}>{est.etiqueta}</Badge>
          <Dato icono={CalendarClock} nombre="Cuándo">
            {fmtFechaHora(informe.creado)}
          </Dato>
          <Dato icono={User} nombre="Quién preguntó">
            {actorCorto(informe.actor)}
          </Dato>
          <Dato icono={Bot} nombre="Modelo">
            {NOMBRE_MODELO[informe.modelo_pedido]}
          </Dato>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={seguirEnElChat} className={claseBoton("primario", "sm")}>
            <MessagesSquare size={14} aria-hidden /> Seguir en el chat
          </button>
          <button type="button" onClick={borrar} disabled={corriendo} title={corriendo ? "Espera a que termine para borrarlo" : undefined} className={claseBoton("fantasma", "sm")}>
            <Trash2 size={14} aria-hidden /> Borrar
          </button>
        </div>
      </div>

      {informe.historial.length > 0 && <Anteriores mensajes={informe.historial} />}

      <BurbujaUsuario texto={informe.pregunta} />
      <TurnoAsistente m={turno} pregunta={informe.pregunta} ultimo={false} onReintentar={() => undefined} />
    </div>
  );
}

/** Los mensajes de la conversación antes de esta pregunta, plegados. */
function Anteriores({ mensajes }: { mensajes: InformeCompleto["historial"] }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  return (
    <section className="rounded-2xl border border-line bg-paperSoft">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((a) => !a)}
        className="flex min-h-10 w-full items-center gap-2 px-4 py-2 text-left text-meta font-medium text-inkSoft transition-colors duration-rapido hover:text-ink sm:px-5"
      >
        <MessagesSquare size={13} className="shrink-0 text-mute" aria-hidden />
        <span>Conversación anterior ({plural(mensajes.length, "mensaje", "mensajes")})</span>
        <ChevronDown size={15} className={cn("ml-auto shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />
      </button>
      <div id={id} hidden={!abierto} className="space-y-3 border-t border-line px-4 py-3 sm:px-5">
        {mensajes.map((m, i) =>
          m.rol === "usuario" ? (
            <BurbujaUsuario key={i} texto={m.texto} />
          ) : (
            <Respuesta key={i} texto={m.texto} className="rounded-2xl border border-line bg-paper px-4 py-3" />
          ),
        )}
      </div>
    </section>
  );
}
