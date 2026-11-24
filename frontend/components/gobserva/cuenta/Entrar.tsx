"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft, BellRing, Bookmark, Check, ChevronRight, Download, Eye, EyeOff, KeyRound, Loader2, Mail, MailCheck, ShieldCheck, Sparkles,
} from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, urlCanonica, type Producto } from "@/lib/gobserva";
import { NOMBRE_APP, appDelProducto } from "@/lib/apps-gobserva";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { confirmarCuenta, crearCuentaConCorreo, elegirClave, entrarConCorreo, mensajeAuth, recuperarClave, reenviarCodigo, tipoError } from "@/lib/gobserva-auth";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, ETIQUETA, marcarSesion, useSesion } from "./comun";

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
// `de` y `pie`: de dónde sale el ejemplo (por defecto, un correo de Gobserva). Salud no manda correos: lo marca en «Mis guardados».
const GANAS: Record<Producto, { titulo: string; puntos: Promesa[]; ejemplo: { asunto: string; lineas: string[]; de?: string; pie?: string } }> = {
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
      { Icono: Download, titulo: "En Excel", texto: COBROS_EN_PAUSA ? "Gratis con tu cuenta: descargas tus búsquedas." : "Con un plan de pago, descargas tus búsquedas." },
    ],
    ejemplo: { asunto: "2 proyectos nuevos de agua potable en Puno", lineas: ["Mejoramiento del servicio de agua potable", "Pasó a ejecución"] },
  },
  // Gobserva Salud (2026-11-21): la cuenta es gratis y sirve para guardar; todo lo demás se ve sin cuenta.
  salud: {
    titulo: "Lo que verificas, guardado y al día",
    puntos: [
      { Icono: Bookmark, titulo: "Tus clínicas, médicos y medicamentos", texto: "Guárdalos al verificarlos y vuelve a ellos en un toque." },
      { Icono: BellRing, titulo: "Lo nuevo, marcado", texto: "Si a una clínica le ponen una sanción o DIGEMID emite una alerta de tu medicamento." },
      { Icono: ShieldCheck, titulo: "Gratis, sin planes", texto: "Todo lo demás de Gobserva Salud se ve sin cuenta." },
    ],
    ejemplo: {
      asunto: "Tu medicamento: alerta nueva de DIGEMID",
      lineas: ["Productos falsificados incautados", "Revisa el lote de tu caja"],
      de: "En «Mis guardados»",
      pie: "Ejemplo de cómo se marca lo nuevo en lo que guardaste.",
    },
  },
  // Gobserva Car (2026-11-22): abierto y sin cuenta, como Salud.
  car: {
    titulo: "Lo que verificas, a mano",
    puntos: [
      { Icono: Bookmark, titulo: "Tus placas y consultas", texto: "Guárdalas y vuelve a ellas en un toque." },
      { Icono: BellRing, titulo: "Lo nuevo, marcado", texto: "Cuando se actualice una fuente oficial de lo que guardaste." },
      { Icono: ShieldCheck, titulo: "Gratis, sin planes", texto: "Todo lo demás de Gobserva Car se ve sin cuenta." },
    ],
    ejemplo: {
      asunto: "Tu revisión técnica: vence pronto",
      lineas: ["Busca un centro autorizado cerca", "Lleva tu SOAT vigente"],
      de: "En «Mis guardados»",
      pie: "Ejemplo de cómo se marca lo nuevo en lo que guardaste.",
    },
  },
};

type Modo = "entrar" | "crear" | "codigo" | "recuperar" | "nueva";

const MIN_CLAVE = 8;

/**
 * Entrar a una app de Gobserva, crear la cuenta o recuperar la contraseña (2026-11-07: cada app con su cuenta, en AWS
 * Cognito). Una sola pieza con el formulario a la izquierda (Entrar y Crear cuenta como pestañas) y, a la derecha, lo
 * que se gana con la cuenta. Crear la cuenta pide confirmar el correo con un código de 6 dígitos; olvidar la contraseña
 * manda otro código para elegir una nueva. Abajo, que la otra app tiene su propia cuenta.
 */
export function Entrar({ producto, base, next, crear }: { producto: Producto; base: string; next: string | null; crear: boolean }) {
  const { loading, conCuenta } = useSesion();
  const [modo, setModo] = useState<Modo>(crear ? "crear" : "entrar");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [enviando, setEnviando] = useState<"correo" | "otro" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [noCoincide, setNoCoincide] = useState(false);
  // Quien acaba de crear su cuenta va al onboarding de la app; quien entra, a donde iba.
  const [recienCreada, setRecienCreada] = useState(false);
  const volver = rutaEn(base, destino(next));
  const p = PRODUCTOS[producto];
  const app = appDelProducto(producto);
  const otra = app === "empleo" ? "licitaciones" : "empleo";
  const esSalud = app === "salud";

  // Con la sesión lista (recién entró o ya tenía una), a donde iba. Carga entera, con la marca de sesión ya puesta: así el
  // servidor arma el marco de la app (MarcoApp) y no queda el de visitantes alrededor.
  useEffect(() => {
    if (!loading && conCuenta) {
      marcarSesion(true);
      window.location.replace((producto === "licitaciones" || producto === "empleo") && recienCreada ? rutaEn(base, "/app/bienvenida") : volver);
    }
  }, [loading, conCuenta, volver, producto, recienCreada, base]);

  function cambiarModo(m: Modo) {
    setModo(m);
    setError(null);
    setAviso(null);
    setNoCoincide(false);
    setCodigo("");
  }

  async function hacer(f: () => Promise<unknown>, cual: "correo" | "otro" = "correo") {
    setError(null);
    setNoCoincide(false);
    setEnviando(cual);
    try {
      await f();
    } catch (err) {
      const tipo = tipoError(err);
      if (modo === "entrar" && tipo === "UserNotConfirmedException") {
        // Creó la cuenta y no la confirmó: otro código y a confirmarla, con la contraseña que ya escribió.
        await reenviarCodigo(email).catch(() => undefined);
        setRecienCreada(true);
        setModo("codigo");
        setAviso(`Falta confirmar tu correo. Te mandamos un código nuevo a ${email.trim()}.`);
      } else if (modo === "entrar" && tipo === "NotAuthorizedException") {
        setNoCoincide(true);
      } else if (modo === "entrar" && tipo === "PasswordResetRequiredException") {
        await pedirCodigoClave();
      } else if (modo === "crear" && tipo === "UsernameExistsException") {
        setModo("entrar");
        setClave("");
        setError("Ya tienes una cuenta en esta app con ese correo. Entra con tu contraseña.");
      } else setError(mensajeAuth(err));
    } finally {
      setEnviando(null);
    }
  }

  /** Olvidé mi contraseña: el código al correo ya escrito, y a elegir la nueva. */
  async function pedirCodigoClave() {
    await recuperarClave(email);
    setModo("nueva");
    setClave("");
    setCodigo("");
    setNoCoincide(false);
    setAviso(`Si ${email.trim()} tiene una cuenta en ${NOMBRE_APP[app]}, te llegó un código de 6 dígitos. Escríbelo con tu contraseña nueva.`);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Escribe un correo válido.");
    if ((modo === "crear" || modo === "nueva") && clave.length < MIN_CLAVE) return setError(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`);
    if (modo === "entrar" && !clave) return setError("Escribe tu contraseña.");
    if ((modo === "codigo" || modo === "nueva") && !/^\d{6}$/.test(codigo.trim())) return setError("Escribe los 6 números del código.");
    if (modo === "entrar") return void hacer(() => entrarConCorreo(email, clave));
    if (modo === "crear")
      return void hacer(async () => {
        await crearCuentaConCorreo(email, clave, nombre);
        setRecienCreada(true);
        setModo("codigo");
        setAviso(`Te mandamos un código de 6 dígitos a ${email.trim()}. Si no llega en unos minutos, revisa el spam.`);
      });
    if (modo === "codigo") return void hacer(() => confirmarCuenta(email, codigo, clave));
    if (modo === "recuperar") return void hacer(pedirCodigoClave);
    return void hacer(() => elegirClave(email, codigo, clave));
  }

  const ocupado = enviando !== null;
  const nombreApp = NOMBRE_APP[app];
  const titulo = {
    crear: `Crea tu cuenta de ${nombreApp}`,
    entrar: `Entra a tu cuenta de ${nombreApp}`,
    codigo: "Confirma tu correo",
    recuperar: "¿Olvidaste tu contraseña?",
    nueva: "Elige tu contraseña nueva",
  }[modo];
  const bajada = {
    crear: esSalud
      ? "Para guardar lo que verificas. Es gratis, sin planes ni tarjeta."
      : `Es sólo para ${app === "empleo" ? "Empleo" : producto === "obras" ? "Obras y Licitaciones" : "Licitaciones"}. ${
          COBROS_EN_PAUSA ? "Es gratis, no pide tarjeta y trae todo: alertas cada mañana, Excel y el asistente." : "Es gratis y no pide tarjeta."
        }`,
    entrar: esSalud
      ? "Tus clínicas, médicos y medicamentos guardados."
      : `Tus alertas, tus guardados y tu ${COBROS_EN_PAUSA ? "asistente" : "plan"} de ${p.titulo}.`,
    codigo: "Escribe el código que te mandamos para terminar de crear tu cuenta.",
    recuperar: "Escribe tu correo y te mandamos un código para elegir una nueva.",
    nueva: "Escribe el código que te llegó y tu contraseña nueva.",
  }[modo];
  const conClave = modo === "entrar" || modo === "crear" || modo === "nueva";
  const conCodigo = modo === "codigo" || modo === "nueva";

  return (
    <div className="container-page py-6 sm:py-10 lg:py-14">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-line bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <section aria-labelledby="entrar-t" className="min-w-0 px-5 py-7 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-[26rem]">
            {modo === "entrar" || modo === "crear" ? (
              <Pestanas modo={modo} onCambio={cambiarModo} />
            ) : (
              <button
                type="button"
                onClick={() => cambiarModo(modo === "codigo" ? "crear" : "entrar")}
                className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-dato font-semibold text-inkSoft hover:text-ink"
              >
                <ArrowLeft size={16} aria-hidden /> {modo === "codigo" ? "Cambiar el correo" : "Volver a entrar"}
              </button>
            )}

            {conCodigo ? (
              <span aria-hidden className="mt-6 grid h-14 w-14 place-items-center rounded-full bg-granate-50 text-granate">
                <MailCheck size={26} />
              </span>
            ) : null}
            <h1 id="entrar-t" className="mt-6 text-balance font-display text-titulo font-bold leading-tight tracking-tight text-ink">{titulo}</h1>
            <p className="mt-2 text-pretty text-dato leading-relaxed text-inkSoft">{bajada}</p>
            {aviso && (
              <p role="status" className="mt-4 rounded-xl border border-granate/30 bg-granate-50 px-3.5 py-3 text-meta leading-relaxed text-ink [overflow-wrap:anywhere]">
                {aviso}
              </p>
            )}

            <form onSubmit={enviar} noValidate className="mt-6 space-y-4">
              {modo === "crear" && (
                <div>
                  <label htmlFor="g-nombre" className={ETIQUETA}>Tu nombre</label>
                  <input id="g-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" className={CAMPO} maxLength={80} />
                </div>
              )}
              {modo !== "codigo" && (
                <div>
                  <label htmlFor="g-email" className={ETIQUETA}>Correo</label>
                  <input
                    id="g-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete={modo === "nueva" ? "username" : "email"}
                    inputMode="email"
                    required
                    readOnly={modo === "nueva"}
                    className={cn(CAMPO, modo === "nueva" && "bg-paperDeep")}
                    placeholder="tu@correo.pe"
                  />
                </div>
              )}
              {conCodigo && (
                <div>
                  <label htmlFor="g-codigo" className={ETIQUETA}>Código de 6 dígitos</label>
                  <input
                    id="g-codigo"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                    className={cn(CAMPO, "text-center font-mono text-cifra tracking-[0.4em]")}
                    placeholder="000000"
                  />
                </div>
              )}
              {conClave && (
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="g-clave" className={ETIQUETA}>{modo === "nueva" ? "Contraseña nueva" : "Contraseña"}</label>
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
                      autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                      minLength={modo === "entrar" ? undefined : MIN_CLAVE}
                      required
                      aria-describedby={modo !== "entrar" ? "g-clave-ayuda" : undefined}
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
                  {modo !== "entrar" && (
                    <p id="g-clave-ayuda" className={cn("mt-1.5 flex items-center gap-1.5 text-meta", clave.length >= MIN_CLAVE ? "text-mossTexto" : "text-mute")}>
                      <Check size={14} aria-hidden className={clave.length >= MIN_CLAVE ? "" : "opacity-40"} /> Al menos {MIN_CLAVE} caracteres
                    </p>
                  )}
                </div>
              )}

              {error && <Aviso tono="error">{error}</Aviso>}
              {noCoincide && <AyudaCuenta ocupado={ocupado} onElegir={() => void hacer(pedirCodigoClave, "otro")} />}

              <button type="submit" disabled={ocupado} className={claseAccion("primario", "w-full", "md")}>
                {enviando === "correo" && <Loader2 size={17} aria-hidden className="animate-spin" />}
                {{ crear: "Crear mi cuenta", entrar: "Entrar", codigo: "Confirmar y entrar", recuperar: "Mandarme el código", nueva: "Guardar y entrar" }[modo]}
              </button>
              {conCodigo && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() =>
                    void hacer(async () => {
                      if (modo === "codigo") await reenviarCodigo(email);
                      else await recuperarClave(email);
                      setAviso(`Te mandamos otro código a ${email.trim()}.`);
                    }, "otro")
                  }
                  className={claseAccion("fantasma", "w-full", "md")}
                >
                  {enviando === "otro" && <Loader2 size={16} aria-hidden className="animate-spin" />} Mandarme otro código
                </button>
              )}
            </form>

            {modo === "crear" && (
              <p className="mt-5 flex items-start gap-2 text-meta leading-relaxed text-mute">
                <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
                Tu correo sólo se usa para tus alertas, tus recibos y avisos de tu cuenta. No lo vendemos ni lo compartimos.
              </p>
            )}
            {(modo === "entrar" || modo === "crear") && !esSalud && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-ink/[0.035] px-3.5 py-3 text-meta leading-relaxed text-inkSoft">
                <KeyRound size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                <span>
                  {producto === "obras" ? <>Obras usa tu cuenta de {NOMBRE_APP.licitaciones}. </> : null}
                  {NOMBRE_APP[otra]} tiene su propia cuenta, con su correo y su contraseña.{" "}
                  <a href={urlCanonica(otra, "/entrar")} className="font-semibold text-ink underline-offset-4 hover:underline">
                    Ir a {otra === "empleo" ? "Empleo" : "Licitaciones"}
                  </a>
                </span>
              </p>
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

/** Cuando la contraseña no entra: elegir una nueva con un clic (las cuentas de antes del cambio la necesitan). */
function AyudaCuenta({ ocupado, onElegir }: { ocupado: boolean; onElegir: () => void }) {
  return (
    <div role="alert" className="overflow-hidden rounded-2xl border border-line">
      <div className="bg-crimson-soft px-4 py-3">
        <p className="text-dato font-semibold text-crimsonTexto">El correo o la contraseña no coinciden.</p>
        <p className="mt-0.5 text-meta leading-relaxed text-crimsonTexto">
          Desde el 8 de noviembre cada app de Gobserva tiene su propia cuenta. Si tu cuenta es de antes, elige una contraseña nueva: tus datos siguen ahí.
        </p>
      </div>
      <button
        type="button"
        onClick={onElegir}
        disabled={ocupado}
        className="flex min-h-14 w-full items-center gap-3 bg-paper px-4 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft disabled:opacity-60"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-paper">
          {ocupado ? <Loader2 size={18} aria-hidden className="animate-spin text-granate" /> : <KeyRound size={18} aria-hidden className="text-granate" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-dato font-semibold text-ink">Elegir una contraseña nueva</span>
          <span className="block text-meta text-inkSoft">Te mandamos un código a tu correo.</span>
        </span>
        <ChevronRight size={17} aria-hidden className="shrink-0 text-mute" />
      </button>
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
                {g.ejemplo.de ? <Bookmark size={17} aria-hidden /> : <BellRing size={17} aria-hidden />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-meta font-semibold text-paper">{g.ejemplo.asunto}</p>
                <p className="text-rotulo text-paper/75">{g.ejemplo.de ?? "Gobserva, 7:00"}</p>
              </div>
            </div>
            <div className="mt-3 space-y-1 border-t border-paper/10 pt-3">
              {g.ejemplo.lineas.map((l, i) => (
                <p key={l} className={cn("text-meta", i === 0 ? "text-paper/85" : "text-maiz")}>{l}</p>
              ))}
            </div>
          </div>
          <figcaption className="mt-2 text-rotulo text-paper/55">{g.ejemplo.pie ?? "Ejemplo de cómo te llega una alerta."}</figcaption>
        </figure>
      </div>
    </aside>
  );
}
