"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUp, Building2, FileSearch, Landmark, LogIn, MessageSquarePlus, PanelLeft, Square, TriangleAlert, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { BurbujaUsuario } from "@/components/admin/chat/Turno";
import {
  aplicarEvento, cerrarTurno, comoEvento, historial, nuevoId, turnoVacio, type EventoChat, type Mensaje, type MensajeAsistente,
  type MensajeUsuario,
} from "@/components/admin/chat/conversacion";
import { authFetch } from "@/lib/cuentas";
import { cn } from "@/lib/utils";
import { Ajustes, BotonNueva, CupoChip, CupoDia, ListaConversaciones, SelectorModo, costoDe } from "./controles";
import {
  borrarConversacion, borrarTodas, cuandoSeLibera, guardarAjustes, guardarConversacion, leerAjustes, leerConversacion, leerIndice,
  type Ajustes as AjustesAsistente, type CupoChat, type ModoVigia, type ResumenConversacion,
} from "./historial";
import { Avatar, BurbujaAsistente, Sugerencias, Turno } from "./piezas";

/**
 * El asistente de investigación de Vigía (auditoría de producto del 2026-11-12, decisión D5): una pregunta en palabras
 * y una respuesta armada sólo con los datos de Vigía, con sus enlaces, lo que consultó para darla y la revisión
 * automática de enlaces y montos. Es el motor del chat del panel (POST /cuentas/me/chat) con tope de preguntas por día.
 *
 * Desde el 2026-11-25 (el usuario: «¿no debería haber un tipo de chat y configuración: selección de modelo, créditos
 * restantes por día, historial de chat?») es una app de chat: a la izquierda las conversaciones, guardadas SÓLO en este
 * navegador (components/asistente/historial.ts: el servidor sigue sin guardar lo que se pregunta) y las preguntas que
 * quedan hoy; arriba el contador y los ajustes; junto al cuadro de escribir, el modo (Rápido gasta 1 pregunta, Profundo
 * 3). El contador lo da el servidor (GET /cuentas/me/chat/cupo y el evento `cupo` del stream).
 *
 * Sin cuenta también se escribe: la pregunta se guarda en esta pestaña (sessionStorage, nunca en la URL ni en el
 * servidor) y se envía sola al volver de entrar.
 */

const PENDIENTE = "vigia-asistente-pendiente";

/** Las preguntas de ejemplo, con el tipo de dato que tocan (su ícono). */
const EJEMPLOS = [
  { icono: Building2, texto: "¿Qué proveedores ganaron más contratos con la Municipalidad Provincial de Cajamarca?" },
  { icono: FileSearch, texto: "Encuentra contratos de 2026 con una sola oferta válida en Áncash" },
  { icono: TriangleAlert, texto: "¿Qué evidencia respalda las señales del contrato 1255784?" },
  { icono: Landmark, texto: "Compara lo que gastan en consultorías los gobiernos regionales de Cusco y Arequipa" },
];

/** Cómo seguir después de una respuesta: valen para cualquier pregunta. */
const SEGUIR = ["¿De dónde sale cada dato?", "¿Qué no pudiste verificar?", "Explícamelo más simple", "¿Qué debería revisar primero?"];

const esCupo = (o: unknown): o is CupoChat =>
  !!o && typeof o === "object" && typeof (o as CupoChat).quedan === "number" && typeof (o as CupoChat).tope === "number";

/** Lee el NDJSON del asistente línea por línea; el evento `cupo` va aparte (no es de la conversación). */
async function leer(r: Response, aplicar: (e: EventoChat) => void, alCupo: (c: CupoChat) => void) {
  const procesar = (linea: string) => {
    const t = linea.trim();
    if (!t) return;
    try {
      const o = JSON.parse(t) as { tipo?: unknown };
      if (o?.tipo === "cupo") {
        if (esCupo(o)) alCupo(o);
        return;
      }
      const e = comoEvento(o);
      if (e) aplicar(e);
    } catch {
      /* una línea rota no corta la respuesta */
    }
  };
  if (!r.body) {
    (await r.text()).split("\n").forEach(procesar);
    return;
  }
  const lector = r.body.getReader();
  const deco = new TextDecoder();
  let resto = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    resto += deco.decode(value, { stream: true });
    const lineas = resto.split("\n");
    resto = lineas.pop() ?? "";
    lineas.forEach(procesar);
  }
  procesar(resto);
}

function guardarPendiente(q: string) {
  try {
    sessionStorage.setItem(PENDIENTE, q);
  } catch {
    /* sin almacenamiento: la pregunta se vuelve a escribir */
  }
}
function tomarPendiente(): string | null {
  try {
    const q = sessionStorage.getItem(PENDIENTE);
    sessionStorage.removeItem(PENDIENTE);
    return q;
  } catch {
    return null;
  }
}

const preguntas = (n: number) => (n === 1 ? "1 pregunta" : `${n} preguntas`);

export function AsistenteVigia() {
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  /** Sin cuenta: la pregunta que se escribió, a la espera de entrar. */
  const [sinCuenta, setSinCuenta] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState<AjustesAsistente>({ modo: "rapido", guardar: true });
  const [cupo, setCupo] = useState<CupoChat | null>(null);
  const [conversaciones, setConversaciones] = useState<ResumenConversacion[]>([]);
  /** La conversación abierta (su id en el historial) y cuándo empezó. */
  const actual = useRef<{ id: string; creada: number } | null>(null);
  const [actualId, setActualId] = useState<string | null>(null);
  /** Hubo una pregunta nueva desde la última vez que se guardó (abrir una conversación no la guarda de nuevo). */
  const porGuardar = useRef(false);
  /** En el celular: la lista de conversaciones, en un cajón. */
  const [cajon, setCajon] = useState(false);
  const cerrarCajon = useCallback(() => setCajon(false), []);
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef<Mensaje[]>([]);
  const fin = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  ultimos.current = mensajes;

  // El modo que de verdad se usa: si Profundo no alcanza con lo que queda, Rápido (la preferencia no se pierde).
  const costoProfundo = costoDe("profundo", cupo);
  const modo: ModoVigia = ajustes.modo === "profundo" && cupo && cupo.quedan > 0 && cupo.quedan < costoProfundo ? "rapido" : ajustes.modo;
  const sinPreguntas = !!user && cupo?.quedan === 0;

  useEffect(() => setAjustes(leerAjustes()), []);
  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => {
    if (mensajes.length || sinCuenta) fin.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensajes.length, sinCuenta]);

  // El cuadro de escribir crece con el texto, hasta 10 líneas.
  useLayoutEffect(() => {
    const t = campo.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [texto]);

  const cargarCupo = useCallback(async () => {
    try {
      const r = await authFetch("/cuentas/me/chat/cupo");
      if (r.ok) {
        const c = (await r.json()) as unknown;
        if (esCupo(c)) setCupo(c);
      }
    } catch {
      /* sin contador: el servidor igual cuida el tope */
    }
  }, []);

  // Al entrar (o cambiar de cuenta): su historial y su contador.
  useEffect(() => {
    if (!uid) {
      setConversaciones([]);
      setCupo(null);
      return;
    }
    setConversaciones(leerIndice(uid));
    void cargarCupo();
  }, [uid, cargarCupo]);

  // Cuando termina una respuesta, la conversación se guarda en este navegador.
  useEffect(() => {
    if (corriendo || !porGuardar.current || !uid || !actual.current || !mensajes.length) return;
    porGuardar.current = false;
    if (!ajustes.guardar) return;
    setConversaciones(guardarConversacion(uid, actual.current.id, actual.current.creada, mensajes));
  }, [corriendo, mensajes, uid, ajustes.guardar]);

  const cambiarAjustes = (a: Partial<AjustesAsistente>) =>
    setAjustes((x) => {
      const n = { ...x, ...a };
      guardarAjustes(n);
      return n;
    });

  const enviar = useCallback(
    async (crudo: string, base?: Mensaje[]) => {
      const pregunta = crudo.trim();
      if (!pregunta || control.current) return;
      if (!user) {
        // Sin cuenta: se muestra la pregunta y el asistente pide entrar; la pregunta espera en esta pestaña.
        guardarPendiente(pregunta);
        setSinCuenta(pregunta);
        setTexto("");
        return;
      }
      if (!actual.current) {
        actual.current = { id: nuevoId(), creada: Date.now() };
        setActualId(actual.current.id);
      }
      porGuardar.current = true;
      const previos = base ?? ultimos.current;
      const usuario: MensajeUsuario = { id: nuevoId(), rol: "usuario", texto: pregunta };
      const asistente = turnoVacio(nuevoId(), modo === "profundo" ? "fino" : "rapido");
      setMensajes([...previos, usuario, asistente]);
      setTexto("");
      setCorriendo(true);
      const ac = new AbortController();
      control.current = ac;
      let conCupo = false;
      const cambiar = (fn: (m: MensajeAsistente) => MensajeAsistente) =>
        setMensajes((ms) => ms.map((m) => (m.id === asistente.id && m.rol === "asistente" ? fn(m) : m)));
      const aplicar = (e: EventoChat) => cambiar((m) => aplicarEvento(m, e));
      try {
        const r = await authFetch("/cuentas/me/chat", {
          method: "POST",
          headers: { Accept: "application/x-ndjson" },
          body: JSON.stringify({ mensajes: historial([...previos, usuario]), modo }),
          signal: ac.signal,
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { detail?: string } | null;
          aplicar({ tipo: "error", mensaje: j?.detail ?? (r.status === 401 ? "Tu sesión terminó. Vuelve a entrar." : "El asistente no pudo responder. Vuelve a intentarlo.") });
        } else {
          await leer(r, aplicar, (c) => {
            conCupo = true;
            setCupo(c);
          });
        }
      } catch {
        if (!ac.signal.aborted) aplicar({ tipo: "error", mensaje: "Se perdió la conexión. Vuelve a preguntar." });
      } finally {
        if (control.current === ac) control.current = null;
        cambiar((m) => cerrarTurno(m, ac.signal.aborted));
        setCorriendo(false);
        if (!conCupo) void cargarCupo();
      }
    },
    [user, modo, cargarCupo],
  );

  // Al volver de entrar: la pregunta que se dejó escrita se envía sola, una vez.
  useEffect(() => {
    if (loading || !user) return;
    const q = tomarPendiente();
    if (q) {
      setSinCuenta(null);
      void enviar(q);
    }
  }, [loading, user, enviar]);

  const reintentar = useCallback(() => {
    const ms = ultimos.current;
    const i = ms.map((m) => m.rol).lastIndexOf("usuario");
    if (i >= 0) void enviar((ms[i] as MensajeUsuario).texto, ms.slice(0, i));
  }, [enviar]);

  const limpiar = () => {
    control.current?.abort();
    porGuardar.current = false;
    setSinCuenta(null);
    setTexto("");
    setCajon(false);
  };

  const nueva = () => {
    limpiar();
    tomarPendiente();
    actual.current = null;
    setActualId(null);
    setMensajes([]);
    campo.current?.focus();
  };

  const abrir = (id: string) => {
    if (!uid) return;
    const ms = leerConversacion(uid, id);
    if (!ms) {
      setConversaciones(borrarConversacion(uid, id));
      return;
    }
    limpiar();
    actual.current = { id, creada: conversaciones.find((c) => c.id === id)?.creada ?? Date.now() };
    setActualId(id);
    setMensajes(ms);
  };

  const borrar = (id: string) => {
    if (!uid) return;
    setConversaciones(borrarConversacion(uid, id));
    if (actual.current?.id === id) nueva();
  };

  const borrarHistorial = () => {
    if (!uid) return;
    borrarTodas(uid);
    setConversaciones([]);
    nueva();
  };

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!sinPreguntas) void enviar(texto);
    }
  };

  const ultimoAsistente = [...mensajes].reverse().find((m): m is MensajeAsistente => m.rol === "asistente");
  const puedeSeguir = !!user && !corriendo && !sinPreguntas && ultimoAsistente?.estado === "listo" && ultimoAsistente.texto != null;
  const vacio = mensajes.length === 0 && !sinCuenta;
  const costo = costoDe(modo, cupo);
  const aviso = !user
    ? null
    : sinPreguntas && cupo?.proxima
      ? `Sin preguntas hasta ${cuandoSeLibera(cupo.proxima).replace(/^a las/, "las")}`
      : cupo
        ? `Usa ${preguntas(costo)} de ${cupo.quedan}`
        : null;

  const lateral = (
    <>
      <div className="border-b border-line p-3">
        <BotonNueva alNueva={nueva} desactivado={vacio && !corriendo} />
      </div>
      <nav aria-label="Tus conversaciones" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ListaConversaciones conversaciones={conversaciones} actual={actualId} alAbrir={abrir} alBorrar={borrar} conCuenta={!!user || loading} guardar={ajustes.guardar} />
      </nav>
      {user && (
        <div className="border-t border-line bg-paperSoft/60 p-3.5">
          <CupoDia cupo={cupo} />
        </div>
      )}
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      {/* En escritorio, la lista de conversaciones y el cupo del día a la izquierda. */}
      <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper lg:flex lg:h-[calc(100dvh-15rem)] lg:min-h-[34rem]">
        {lateral}
      </aside>
      <Cajon abierto={cajon} alCerrar={cerrarCajon}>
        {lateral}
      </Cajon>

      <section
        aria-label="Conversación con el asistente"
        className="flex min-w-0 flex-col rounded-2xl border border-line bg-paper lg:h-[calc(100dvh-15rem)] lg:min-h-[34rem] lg:overflow-hidden"
      >
        {/* Cabecera del chat: quién responde, cuántas preguntas quedan y los ajustes. */}
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setCajon(true)}
            aria-label="Tus conversaciones"
            aria-expanded={cajon}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-inkSoft transition-colors duration-rapido hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate lg:hidden"
          >
            <PanelLeft size={16} aria-hidden />
          </button>
          <span className="max-sm:hidden">
            <Avatar />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-dato font-semibold leading-tight text-ink">
              Asistente<span className="max-sm:hidden"> de Vigía</span>
            </p>
            <p className="flex items-center gap-1.5 text-rotulo text-mute max-sm:hidden">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-moss" aria-hidden />
              <span className="truncate">Responde con los datos de Vigía</span>
            </p>
          </div>
          {user && <CupoChip cupo={cupo} />}
          <Ajustes
            modo={ajustes.modo}
            alCambiarModo={(m) => cambiarAjustes({ modo: m })}
            cupo={cupo}
            guardar={ajustes.guardar}
            alCambiarGuardar={(v) => cambiarAjustes({ guardar: v })}
            hayHistorial={conversaciones.length > 0}
            alBorrarTodas={borrarHistorial}
          />
          {!vacio && (
            <button
              type="button"
              onClick={nueva}
              aria-label="Nueva conversación"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate lg:hidden"
            >
              <MessageSquarePlus size={16} aria-hidden />
            </button>
          )}
        </header>

        {/* Los mensajes. En escritorio se desplazan dentro de la caja; el cuadro de escribir queda fijo abajo. */}
        <div className="flex-1 space-y-4 px-3 py-4 sm:px-5 lg:overflow-y-auto" aria-live="polite">
          <BurbujaAsistente>
            <p className="text-cuerpo font-semibold text-ink">Hola. ¿Qué quieres saber?</p>
            <p className="mt-1 text-dato leading-relaxed text-inkSoft">
              Pregúntame por un contrato, una entidad, una empresa o un partido, en tus palabras. Busco en los mismos datos
              que ves en Vigía y te enlazo de dónde sale cada cosa.
            </p>
            {!loading && !user && (
              <p className="mt-2 text-dato leading-relaxed text-inkSoft">
                Para responderte necesito que entres con tu cuenta, que es gratis. Puedes escribir ya: guardo tu pregunta
                mientras entras.
              </p>
            )}
            <p className="mt-2 text-meta leading-snug text-mute lg:hidden">
              Puedo equivocarme: revisa los enlaces. Una señal es un indicio, no una acusación.
            </p>
          </BurbujaAsistente>

          {vacio && !sinPreguntas && <Sugerencias titulo="Prueba con una de estas" opciones={EJEMPLOS} alElegir={(q) => void enviar(q)} desactivado={loading} />}

          {mensajes.map((m) =>
            m.rol === "usuario" ? (
              <BurbujaUsuario key={m.id} texto={m.texto} />
            ) : (
              <Turno key={m.id} m={m} alReintentar={m.id === ultimoAsistente?.id && !corriendo && !sinPreguntas ? reintentar : undefined} />
            ),
          )}

          {sinCuenta && (
            <>
              <BurbujaUsuario texto={sinCuenta} />
              <BurbujaAsistente>
                <p className="text-dato leading-relaxed text-ink">
                  Buena pregunta. Entra con tu cuenta y te respondo enseguida: la guardé y la envío sola cuando vuelvas.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/login?next=/app/asistente" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-granate px-4 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
                    <LogIn size={15} aria-hidden />
                    Entrar o crear cuenta
                  </Link>
                  <button type="button" onClick={nueva} className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink">
                    Cambiar la pregunta
                  </button>
                </div>
              </BurbujaAsistente>
            </>
          )}

          {sinPreguntas && !corriendo && cupo && (
            <BurbujaAsistente>
              <p className="text-dato leading-relaxed text-ink">
                Ya usaste tus {cupo.tope} preguntas de las últimas 24 horas.
                {cupo.proxima && ` Vuelves a tener una ${cuandoSeLibera(cupo.proxima)}.`}
              </p>
              {!cupo.verificado && (
                <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">
                  Con tu correo confirmado tienes 10 cada día.{" "}
                  <Link href="/app/configuracion" className="font-semibold text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                    Confirmarlo
                  </Link>
                </p>
              )}
            </BurbujaAsistente>
          )}

          {puedeSeguir && (
            <Sugerencias titulo="¿Quieres saber más?" opciones={SEGUIR.map((t) => ({ texto: t }))} alElegir={(q) => void enviar(q)} chicas />
          )}
          {/* En el celular el cuadro de escribir va pegado abajo: al bajar hasta aquí, que no tape el último mensaje. */}
          <div ref={fin} className="scroll-mb-32 lg:scroll-mb-0" />
        </div>

        {/* El cuadro de escribir, con el modo debajo: dentro de la caja en escritorio, pegado abajo en el celular. */}
        <div className="sticky bottom-2 z-[1] mx-2 mb-2 lg:static lg:mx-0 lg:mb-0 lg:border-t lg:border-line lg:bg-paperSoft/60 lg:px-4 lg:pb-2.5 lg:pt-3">
          <form
            className="rounded-2xl border border-line bg-paper shadow-pop transition-colors duration-rapido focus-within:border-granate/50 lg:rounded-xl lg:shadow-none"
            onSubmit={(e) => {
              e.preventDefault();
              if (!sinPreguntas) void enviar(texto);
            }}
          >
            <label htmlFor="asistente-vigia" className="sr-only">Tu pregunta</label>
            <textarea
              ref={campo}
              id="asistente-vigia"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={alTeclear}
              rows={1}
              maxLength={4000}
              disabled={loading}
              placeholder={sinPreguntas ? "Ya usaste tus preguntas de hoy" : "Escribe tu pregunta…"}
              className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-destacado leading-snug text-ink placeholder:text-mute focus:outline-none"
            />
            <div className="flex items-center gap-2 px-2 pb-2">
              <SelectorModo modo={modo} alCambiar={(m) => cambiarAjustes({ modo: m })} cupo={user ? cupo : null} desactivado={corriendo} />
              {aviso && <span className="ml-auto hidden truncate text-rotulo tabular-nums text-mute sm:inline">{aviso}</span>}
              {corriendo ? (
                <button
                  type="button"
                  onClick={() => control.current?.abort()}
                  aria-label="Detener la respuesta"
                  className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-paperSoft text-ink transition-colors duration-rapido hover:border-granate/40", !aviso && "ml-auto", "max-sm:ml-auto")}
                >
                  <Square size={14} aria-hidden className="fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!texto.trim() || loading || sinPreguntas}
                  aria-label="Enviar la pregunta"
                  className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate text-paper transition-opacity duration-rapido disabled:opacity-40", !aviso && "ml-auto", "max-sm:ml-auto")}
                >
                  <ArrowUp size={18} aria-hidden />
                </button>
              )}
            </div>
          </form>
          <p className="mt-2 hidden text-center text-rotulo leading-snug text-mute lg:block">
            Responde sólo con datos de Vigía y puede equivocarse: revisa los enlaces. Una señal es un indicio, no una acusación.{" "}
            <Link href="/metodologia" className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
              Cómo trabaja Vigía
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

/** En el celular: la lista de conversaciones en un cajón desde la izquierda. Escape o tocar afuera lo cierra. */
function Cajon({ abierto, alCerrar, children }: { abierto: boolean; alCerrar: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    const alTecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") alCerrar();
    };
    document.addEventListener("keydown", alTecla);
    const desborde = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alTecla);
      document.body.style.overflow = desborde;
      previo?.focus();
    };
  }, [abierto, alCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-overlay lg:hidden" role="dialog" aria-modal="true" aria-label="Tus conversaciones">
      <button type="button" aria-label="Cerrar" onClick={alCerrar} className="absolute inset-0 bg-ink/40" tabIndex={-1} />
      <div ref={panel} className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-paper shadow-pop">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <p className="text-dato font-semibold text-ink">Tus conversaciones</p>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
            <X size={16} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
