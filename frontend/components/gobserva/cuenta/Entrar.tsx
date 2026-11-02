"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Bookmark, Download, Eye, EyeOff, KeyRound, Loader2, LogOut, Mail, ShieldCheck } from "lucide-react";
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

const GANAS: Record<Producto, { titulo: string; puntos: { Icono: typeof BellRing; texto: string }[] }> = {
  empleo: {
    titulo: "Con tu cuenta no se te pasa ninguna plaza",
    puntos: [
      { Icono: BellRing, texto: "Alertas con las plazas nuevas que buscas, en tu correo y en tu celular." },
      { Icono: Bookmark, texto: "Guarda plazas y lleva tus postulaciones: postulé, entrevista, descartada." },
      { Icono: Mail, texto: "Te recordamos 2 días antes de que cierre una plaza guardada." },
      { Icono: Download, texto: "Con un plan de pago, descargas tus búsquedas en Excel (CSV)." },
    ],
  },
  licitaciones: {
    titulo: "Con tu cuenta, tu rubro te avisa a ti",
    puntos: [
      { Icono: BellRing, texto: "Alertas con las convocatorias nuevas de tu rubro y tu región." },
      { Icono: Bookmark, texto: "Sigue procesos: preparando, presentada, ganada o perdida." },
      { Icono: Mail, texto: "Te recordamos 2 días antes de que cierren las consultas de lo que guardaste." },
      { Icono: Download, texto: "Con un plan de pago, descargas oportunidades en Excel (CSV)." },
    ],
  },
  obras: {
    titulo: "Con tu cuenta sigues las obras que te interesan",
    puntos: [
      { Icono: BellRing, texto: "Alertas con los proyectos nuevos de tu región y tu sector." },
      { Icono: Bookmark, texto: "Guarda proyectos y sigue su avance." },
      { Icono: Download, texto: "Con un plan de pago, descargas en Excel (CSV)." },
    ],
  },
};

export function Entrar({ producto, base, next, crear }: { producto: Producto; base: string; next: string | null; crear: boolean }) {
  const router = useRouter();
  const { user, loading, esVigia, conCuenta } = useSesion();
  const [modo, setModo] = useState<"entrar" | "crear" | "recuperar">(crear ? "crear" : "entrar");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [enviando, setEnviando] = useState<"correo" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const volver = rutaEn(base, destino(next));
  const p = PRODUCTOS[producto];

  // Con la sesión lista (recién entró o ya tenía una), a donde iba.
  useEffect(() => {
    if (!loading && conCuenta) router.replace(volver);
  }, [loading, conCuenta, router, volver]);

  const urlVolver = () => `${window.location.origin}${volver}`;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNota(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Escribe un correo válido.");
    if (modo !== "recuperar" && clave.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    setEnviando("correo");
    try {
      if (modo === "entrar") await entrarConCorreo(email, clave);
      else if (modo === "crear") await crearCuentaConCorreo(email, clave, nombre, urlVolver());
      else {
        await recuperarClave(email, urlVolver());
        setNota(`Te enviamos un correo a ${email.trim()} para elegir una contraseña nueva. Si no llega en unos minutos, revisa el spam.`);
        setModo("entrar");
      }
    } catch (err) {
      setError(mensajeAuth(err));
    } finally {
      setEnviando(null);
    }
  }

  async function google() {
    setError(null);
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

  const g = GANAS[producto];
  const titulo = modo === "crear" ? "Crea tu cuenta gratis" : modo === "recuperar" ? "Recupera tu contraseña" : "Entra a tu cuenta";
  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start lg:py-14">
      <section aria-labelledby="entrar-t" className="rounded-3xl border border-line bg-paper p-5 sm:p-8">
        <h1 id="entrar-t" className="font-display text-titulo font-bold leading-tight text-ink">{titulo}</h1>
        <p className="mt-2 text-dato leading-relaxed text-inkSoft">
          {modo === "crear"
            ? `Una cuenta sirve para los tres productos de Gobserva. Crearla es gratis y no pide tarjeta.`
            : modo === "recuperar"
              ? "Te mandamos un enlace para elegir una contraseña nueva."
              : `Entra con Google o con tu correo para ver tus alertas, tus guardados y tu plan de ${p.titulo}.`}
        </p>

        {modo !== "recuperar" && (
          <>
            <button
              type="button"
              onClick={google}
              disabled={enviando !== null}
              className="mt-6 flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-line bg-paper px-5 text-destacado font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 disabled:opacity-60"
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
            <input id="g-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required className={CAMPO} />
          </div>
          {modo !== "recuperar" && (
            <div>
              <label htmlFor="g-clave" className={ETIQUETA}>Contraseña</label>
              <div className="relative">
                <input
                  id="g-clave"
                  type={verClave ? "text" : "password"}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  autoComplete={modo === "crear" ? "new-password" : "current-password"}
                  minLength={6}
                  required
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
              {modo === "crear" && <p className="mt-1.5 text-meta text-mute">Al menos 6 caracteres.</p>}
            </div>
          )}
          {error && <Aviso tono="error">{error}</Aviso>}
          {nota && <Aviso tono="ok">{nota}</Aviso>}
          <button type="submit" disabled={enviando !== null} className={claseAccion("primario", "w-full", "md")}>
            {enviando === "correo" && <Loader2 size={17} aria-hidden className="animate-spin" />}
            {modo === "crear" ? "Crear mi cuenta" : modo === "recuperar" ? "Enviar el enlace" : "Entrar"}
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-dato">
          {modo === "entrar" ? (
            <>
              <button type="button" onClick={() => { setModo("crear"); setError(null); }} className="font-semibold text-granate underline-offset-2 hover:underline">
                Crear una cuenta
              </button>
              <button type="button" onClick={() => { setModo("recuperar"); setError(null); }} className="inline-flex items-center gap-1.5 text-inkSoft underline-offset-2 hover:text-ink hover:underline">
                <KeyRound size={15} aria-hidden /> Olvidé mi contraseña
              </button>
            </>
          ) : (
            <button type="button" onClick={() => { setModo("entrar"); setError(null); }} className="font-semibold text-granate underline-offset-2 hover:underline">
              Ya tengo una cuenta
            </button>
          )}
        </div>
        {modo === "crear" && (
          <p className="mt-5 flex items-start gap-2 text-meta leading-relaxed text-mute">
            <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
            Tu correo sólo se usa para tus alertas, tus recibos y avisos de tu cuenta. No lo vendemos ni lo compartimos.
          </p>
        )}
      </section>

      <aside aria-labelledby="ganas-t" className="rounded-3xl bg-ink p-6 text-paper sm:p-8 sobre-oscuro">
        <h2 id="ganas-t" className="font-display text-seccion font-bold leading-tight">{g.titulo}</h2>
        <ul className="mt-5 space-y-4">
          {g.puntos.map(({ Icono, texto }) => (
            <li key={texto} className="flex items-start gap-3 text-dato leading-relaxed text-paper/85">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper/10 text-maiz">
                <Icono size={18} aria-hidden />
              </span>
              <span className="pt-1.5">{texto}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-paper/15 pt-4 text-meta leading-relaxed text-paper/65">
          La misma cuenta sirve en empleo, licitaciones y obras.gobserva.cloud. Puedes borrarla cuando quieras desde tu perfil.
        </p>
      </aside>
    </div>
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
