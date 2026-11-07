"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, BellRing, Bookmark, Check, ChevronRight, Download, Eye, EyeOff, KeyRound, Loader2, LogOut, Mail, MailCheck, ShieldCheck, Sparkles,
} from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import { crearCuentaConCorreo, entrarConCorreo, entrarConGoogle, mensajeAuth, recuperarClave, salir } from "@/lib/gobserva-auth";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, ETIQUETA, useSesion } from "./comun";

/** Una ruta interna del producto para volver después de entrar («/checkout?plan=pro»); cualquier otra cosa, a la cuenta. */
function destino(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001F\u007F]/.test(next)) return "/cuenta";
  return next;
}

interface Promesa {
  Icono: typeof BellRing;
  titulo: string;
  texto: string;
}

/** Lo que gana quien tiene cuenta, por producto, y un ejemplo de cómo le llega un aviso. */
const GANAS: Record<Producto, { titulo: string; puntos: Promesa[]; ejemplo: { asunto: string; lineas: string[] } }> = {
  empleo: {
    titulo: "No se te pasa ninguna plaza",
    puntos: [
      { Icono: BellRing, titulo: "Alertas de plazas nuevas", texto: "Las que buscas, cada semana o cada mañana." },
      { Icono: Bookmark, titulo: "Tus postulaciones en un lugar", texto: "Postulé, entrevista, descartada." },
      { Icono: Mail, titulo: "Recordatorios", texto: "Te avisamos 2 días antes de que cierre una plaza guardada." },
    ],
    ejemplo: { asunto: "3 plazas nuevas para «enfermera» en Cusco", lineas: ["Enfermera asistencial, hospital regional", "Cierra en 4 días"] },
  },
  licitaciones: {
    titulo: "Lo que el Estado compra de tu rubro, sin buscarlo",
    puntos: [
      { Icono: Sparkles, titulo: "«Para ti»", texto: "Las oportunidades ordenadas por cuánto se parecen a lo que vendes." },
      { Icono: BellRing, titulo: "Alertas de tu rubro y tu región", texto: "Licitaciones y contratos menores nuevos, en tu correo." },
      { Icono: Bookmark, titulo: "Tus procesos en un lugar", texto: "Preparando, presentada, ganada o perdida, con sus plazos." },
    ],
    ejemplo: { asunto: "4 oportunidades nuevas de «tóner» en Cusco", lineas: ["Adquisición de tóner para impresoras", "Consultas hasta el jueves"] },
  },
  obras: {
    titulo: "Las obras que te interesan, al día",
    puntos: [
      { Icono: BellRing, titulo: "Alertas de proyectos nuevos", texto: "De tu región y tu sector." },
      { Icono: Bookmark, titulo: "Sigue su avance", texto: "Guarda proyectos y mira cuándo cambian de fase." },
      { Icono: Download, titulo: "En Excel", texto: "Con un plan de pago, descargas tus búsquedas." },
    ],
    ejemplo: { asunto: "2 proyectos nuevos de agua potable en Puno", lineas: ["Mejoramiento del servicio de agua potable", "Pasó a ejecución"] },
  },
};

type Modo = "entrar" | "crear" | "recuperar";

/**
 * Entrar, crear la cuenta o recuperar la contraseña (rediseño 2026-11-07): una sola pieza con el formulario a la
 * izquierda (Entrar y Crear cuenta como pestañas) y, a la derecha, lo que se gana con la cuenta y un ejemplo de aviso.
 * Cuando el correo ya tiene cuenta o la contraseña no entra, ofrece las dos salidas con un clic: entrar con Google
 * (quien entró así no tiene contraseña) o recibir el enlace para elegir una.
 */
export function Entrar({ producto, base, next, crear }: { producto: Producto; base: string; next: string | null; crear: boolean }) {
  const router = useRouter();
  const { user, loading, esVigia, conCuenta } = useSesion();
  const [modo, setModo] = useState<Modo>(crear ? "crear" : "entrar");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [enviando, setEnviando] = useState<"correo" | "google" | "enlace" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El correo ya tiene cuenta o la contraseña no entra. Firebase no dice si esa cuenta se creó con Google (lo protege la
  // enumeración de correos): quien entró con Google en Vigía o en Gobserva no tiene contraseña, así que se le ofrecen las
  // dos salidas con un clic, en vez de un «no coinciden» sin camino.
  const [ayuda, setAyuda] = useState<"existe" | "noCoincide" | null>(null);
  // El correo al que se mandó el enlace para elegir contraseña: con él, la pantalla de «Revisa tu correo».
  const [enviadoA, setEnviadoA] = useState<string | null>(null);
  const volver = rutaEn(base, destino(next));
  const p = PRODUCTOS[producto];

  // Con la sesión lista (recién entró o ya tenía una), a donde iba.
  useEffect(() => {
    if (!loading && conCuenta) router.replace(volver);
  }, [loading, conCuenta, router, volver]);

  const urlVolver = () => `${window.location.origin}${volver}`;

  function cambiarModo(m: Modo) {
    setModo(m);
    setError(null);
    setAyuda(null);
    setEnviadoA(null);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAyuda(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Escribe un correo válido.");
    if (modo !== "recuperar" && clave.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (modo === "recuperar") return enlaceClave();
    setEnviando("correo");
    try {
      if (modo === "entrar") await entrarConCorreo(email, clave);
      else await crearCuentaConCorreo(email, clave, nombre, urlVolver());
    } catch (err) {
      const codigo = (err as { code?: string })?.code ?? "";
      if (modo === "crear" && codigo === "auth/email-already-in-use") {
        setModo("entrar");
        setClave("");
        setAyuda("existe");
      } else if (modo === "entrar" && ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(codigo)) {
        setAyuda("noCoincide");
      } else setError(mensajeAuth(err));
    } finally {
      setEnviando(null);
    }
  }

  /** El enlace para elegir contraseña, al correo ya escrito: sirve también a una cuenta que sólo entraba con Google. */
  async function enlaceClave() {
    setError(null);
    setEnviando("enlace");
    try {
      await recuperarClave(email, urlVolver());
      setAyuda(null);
      setEnviadoA(email.trim());
    } catch (err) {
      setError(mensajeAuth(err));
    } finally {
      setEnviando(null);
    }
  }

  async function google() {
    setError(null);
    setAyuda(null);
    setEnviando("google");
    try {
      await entrarConGoogle();
    } catch (err) {
      setError(mensajeAuth(err));
    } finally {
      setEnviando(null);
    }
  }

  if (!loading && esVigia && user) {
    return (
      <div className="container-page max-w-xl py-12">
        <div className="rounded-3xl border border-line bg-paper p-6 sm:p-8">
          <h1 className="font-display text-seccion font-bold leading-tight text-ink">Tu sesión es de Vigía</h1>
          <p className="mt-2 text-cuerpo leading-relaxed text-inkSoft">
            Entraste con un usuario de Vigía. {p.titulo} necesita tu correo de verdad, porque ahí llegan tus alertas y tus recibos. Sal y entra con tu
            correo o con Google.
          </p>
          <button type="button" onClick={() => void salir()} className={claseAccion("primario", "mt-5")}>
            <LogOut size={16} aria-hidden /> Salir de la cuenta de Vigía
          </button>
        </div>
      </div>
    );
  }

  const ocupado = enviando !== null;
  const titulo = modo === "crear" ? "Crea tu cuenta gratis" : modo === "recuperar" ? "Elige una contraseña nueva" : "Entra a tu cuenta";
  const bajada =
    modo === "crear"
      ? "Sirve para los tres productos de Gobserva. Es gratis y no pide tarjeta."
      : modo === "recuperar"
        ? "Escribe tu correo y te mandamos un enlace para elegirla. Sirve también si antes entrabas con Google."
        : `Tus alertas, tus guardados y tu plan de ${p.titulo}.`;

  return (
    <div className="container-page py-6 sm:py-10 lg:py-14">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-line bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <section aria-labelledby="entrar-t" className="min-w-0 px-5 py-7 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-[26rem]">
            {enviadoA ? (
              <Revisa
                correo={enviadoA}
                ocupado={enviando === "enlace"}
                onReenviar={() => void enlaceClave()}
                onVolver={() => cambiarModo("entrar")}
              />
            ) : (
              <>
                {modo === "recuperar" ? (
                  <button
                    type="button"
                    onClick={() => cambiarModo("entrar")}
                    className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-dato font-semibold text-inkSoft hover:text-ink"
                  >
                    <ArrowLeft size={16} aria-hidden /> Volver a entrar
                  </button>
                ) : (
                  <Pestanas modo={modo} onCambio={cambiarModo} />
                )}

                <h1 id="entrar-t" className="mt-6 text-balance font-display text-titulo font-bold leading-tight tracking-tight text-ink">{titulo}</h1>
                <p className="mt-2 text-pretty text-dato leading-relaxed text-inkSoft">{bajada}</p>

                {modo !== "recuperar" && (
                  <>
                    <button
                      type="button"
                      onClick={google}
                      disabled={ocupado}
                      className="mt-6 flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-line bg-paper px-5 text-destacado font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft disabled:opacity-60"
                    >
                      {enviando === "google" ? <Loader2 size={18} aria-hidden className="animate-spin" /> : <LogoGoogle />}
                      Continuar con Google
                    </button>
                    <p className="my-5 flex items-center gap-3 text-meta text-mute">
                      <span aria-hidden className="h-px flex-1 bg-line" /> o con tu correo <span aria-hidden className="h-px flex-1 bg-line" />
                    </p>
                  </>
                )}

                <form onSubmit={enviar} noValidate className={cn("space-y-4", modo === "recuperar" && "mt-6")}>
                  {modo === "crear" && (
                    <div>
                      <label htmlFor="g-nombre" className={ETIQUETA}>Tu nombre</label>
                      <input id="g-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" className={CAMPO} maxLength={80} />
                    </div>
                  )}
                  <div>
                    <label htmlFor="g-email" className={ETIQUETA}>Correo</label>
                    <input
                      id="g-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      inputMode="email"
                      required
                      className={CAMPO}
                      placeholder="tu@empresa.pe"
                    />
                  </div>
                  {modo !== "recuperar" && (
                    <div>
                      <div className="flex items-baseline justify-between gap-3">
                        <label htmlFor="g-clave" className={ETIQUETA}>Contraseña</label>
                        {modo === "entrar" && (
                          <button type="button" onClick={() => cambiarModo("recuperar")} className="mb-1.5 text-meta font-semibold text-granate underline-offset-2 hover:underline">
                            ¿La olvidaste?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          id="g-clave"
                          type={verClave ? "text" : "password"}
                          value={clave}
                          onChange={(e) => setClave(e.target.value)}
                          autoComplete={modo === "crear" ? "new-password" : "current-password"}
                          minLength={6}
                          required
                          aria-describedby={modo === "crear" ? "g-clave-ayuda" : undefined}
                          className={cn(CAMPO, "pr-12")}
                        />
                        <button
                          type="button"
                          onClick={() => setVerClave((v) => !v)}
                          aria-label={verClave ? "Ocultar la contraseña" : "Mostrar la contraseña"}
                          className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-mute hover:text-ink"
                        >
                          {verClave ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                        </button>
                      </div>
                      {modo === "crear" && (
                        <p id="g-clave-ayuda" className={cn("mt-1.5 flex items-center gap-1.5 text-meta", clave.length >= 6 ? "text-mossTexto" : "text-mute")}>
                          <Check size={14} aria-hidden className={clave.length >= 6 ? "" : "opacity-40"} /> Al menos 6 caracteres
                        </p>
                      )}
                    </div>
                  )}

                  {error && <Aviso tono="error">{error}</Aviso>}
                  {ayuda && <AyudaCuenta caso={ayuda} ocupado={ocupado} google={google} enlace={() => void enlaceClave()} enviandoEnlace={enviando === "enlace"} />}

                  <button type="submit" disabled={ocupado} className={claseAccion("primario", "w-full", "md")}>
                    {(enviando === "correo" || (modo === "recuperar" && enviando === "enlace")) && <Loader2 size={17} aria-hidden className="animate-spin" />}
                    {modo === "crear" ? "Crear mi cuenta" : modo === "recuperar" ? "Mandarme el enlace" : "Entrar"}
                  </button>
                </form>

                {modo === "crear" && (
                  <p className="mt-5 flex items-start gap-2 text-meta leading-relaxed text-mute">
                    <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
                    Tu correo sólo se usa para tus alertas, tus recibos y avisos de tu cuenta. No lo vendemos ni lo compartimos.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <Ganas producto={producto} />
      </div>
    </div>
  );
}

/** Entrar y Crear cuenta como dos pestañas: se ve en cuál estás y se cambia sin perder el correo escrito. */
function Pestanas({ modo, onCambio }: { modo: Modo; onCambio: (m: Modo) => void }) {
  const opciones: { m: Modo; etiqueta: string }[] = [
    { m: "entrar", etiqueta: "Entrar" },
    { m: "crear", etiqueta: "Crear cuenta" },
  ];
  return (
    <div role="group" aria-label="Entrar o crear una cuenta" className="grid grid-cols-2 gap-1 rounded-full bg-paperDeep p-1">
      {opciones.map(({ m, etiqueta }) => (
        <button
          key={m}
          type="button"
          onClick={() => onCambio(m)}
          aria-pressed={modo === m}
          className={cn(
            "min-h-10 rounded-full px-4 text-dato font-semibold transition-colors duration-rapido",
            modo === m ? "bg-paper text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
          )}
        >
          {etiqueta}
        </button>
      ))}
    </div>
  );
}

/** Las dos salidas cuando el correo ya tiene cuenta o la contraseña no entra, como opciones de un clic. */
function AyudaCuenta({
  caso, ocupado, google, enlace, enviandoEnlace,
}: {
  caso: "existe" | "noCoincide";
  ocupado: boolean;
  google: () => void;
  enlace: () => void;
  enviandoEnlace: boolean;
}) {
  return (
    <div role={caso === "noCoincide" ? "alert" : "status"} className="overflow-hidden rounded-2xl border border-line">
      <div className={cn("px-4 py-3", caso === "noCoincide" ? "bg-crimson-soft" : "bg-paperSoft")}>
        <p className={cn("text-dato font-semibold", caso === "noCoincide" ? "text-crimsonTexto" : "text-ink")}>
          {caso === "existe" ? "Ya tienes una cuenta con ese correo." : "El correo o la contraseña no coinciden."}
        </p>
        <p className={cn("mt-0.5 text-meta leading-relaxed", caso === "noCoincide" ? "text-crimsonTexto" : "text-inkSoft")}>
          {caso === "existe" ? "Escribe tu contraseña arriba. " : ""}Si antes entraste con Google, en Gobserva o en Vigía, tu cuenta no tiene contraseña.
        </p>
      </div>
      <ul className="divide-y divide-line">
        <li>
          <Salida onClick={google} disabled={ocupado} icono={<LogoGoogle />} titulo="Entrar con Google" texto="Con la misma cuenta de Google de antes." />
        </li>
        <li>
          <Salida
            onClick={enlace}
            disabled={ocupado}
            icono={enviandoEnlace ? <Loader2 size={18} aria-hidden className="animate-spin text-granate" /> : <KeyRound size={18} aria-hidden className="text-granate" />}
            titulo="Elegir una contraseña"
            texto="Te mandamos un enlace a tu correo para elegirla."
          />
        </li>
      </ul>
    </div>
  );
}

function Salida({ onClick, disabled, icono, titulo, texto }: { onClick: () => void; disabled: boolean; icono: ReactNode; titulo: string; texto: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 w-full items-center gap-3 bg-paper px-4 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft disabled:opacity-60"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-paper">{icono}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-dato font-semibold text-ink">{titulo}</span>
        <span className="block text-meta text-inkSoft">{texto}</span>
      </span>
      <ChevronRight size={17} aria-hidden className="shrink-0 text-mute" />
    </button>
  );
}

/** Después de mandar el enlace: a qué correo fue, qué hacer y cómo reenviarlo. */
function Revisa({ correo, ocupado, onReenviar, onVolver }: { correo: string; ocupado: boolean; onReenviar: () => void; onVolver: () => void }) {
  return (
    <div role="status" className="py-4 text-center">
      <span aria-hidden className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-granate-50 text-granate">
        <MailCheck size={30} />
      </span>
      <h1 id="entrar-t" className="mt-5 font-display text-titulo font-bold leading-tight tracking-tight text-ink">Revisa tu correo</h1>
      <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-dato leading-relaxed text-inkSoft">
        Te mandamos un enlace a <b className="font-semibold text-ink [overflow-wrap:anywhere]">{correo}</b> para elegir tu contraseña. Si no llega en unos
        minutos, revisa el spam.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={onVolver} className={claseAccion("primario", "w-full", "md")}>Volver a entrar</button>
        <button type="button" onClick={onReenviar} disabled={ocupado} className={claseAccion("fantasma", "w-full", "md")}>
          {ocupado && <Loader2 size={16} aria-hidden className="animate-spin" />} Mandarlo otra vez
        </button>
      </div>
    </div>
  );
}

/**
 * La mitad oscura: lo que se gana con la cuenta, en tres puntos, y un aviso de ejemplo tal como llega. En el celular va
 * debajo del formulario.
 */
function Ganas({ producto }: { producto: Producto }) {
  const g = GANAS[producto];
  return (
    <aside aria-labelledby="ganas-t" className="sobre-oscuro relative min-w-0 overflow-hidden bg-ink px-5 py-8 text-paper sm:px-10 sm:py-10">
      <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative flex h-full flex-col">
        <h2 id="ganas-t" className="text-balance font-display text-seccion font-bold leading-tight">{g.titulo}</h2>
        <ul className="mt-6 space-y-5">
          {g.puntos.map(({ Icono, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper/10 text-maiz">
                <Icono size={19} aria-hidden />
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block text-dato font-semibold text-paper">{titulo}</span>
                <span className="mt-0.5 block text-meta leading-relaxed text-paper/70">{texto}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* Un aviso tal como llega (ejemplo, no un proceso real). */}
        <figure className="mt-8 lg:mt-auto lg:pt-8">
          <div className="rounded-2xl border border-paper/15 bg-paper/[0.07] p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maiz text-sobreMaiz">
                <BellRing size={17} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-meta font-semibold text-paper">{g.ejemplo.asunto}</p>
                <p className="text-rotulo text-paper/60">Gobserva, 7:00</p>
              </div>
            </div>
            <div className="mt-3 space-y-1 border-t border-paper/10 pt-3">
              {g.ejemplo.lineas.map((l, i) => (
                <p key={l} className={cn("text-meta", i === 0 ? "text-paper/85" : "text-maiz")}>{l}</p>
              ))}
            </div>
          </div>
          <figcaption className="mt-2 text-rotulo text-paper/55">Ejemplo de cómo te llega una alerta.</figcaption>
        </figure>
      </div>
    </aside>
  );
}

/** La «G» de Google en sus colores (lo que la gente reconoce en ese botón). */
function LogoGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
