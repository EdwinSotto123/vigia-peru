"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { ArrowLeft, Loader2, Mail, MailCheck, ShieldCheck } from "lucide-react";
import { Marca } from "@/components/marca";
import { auth } from "@/lib/firebase";
import { destinoSeguro } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Acceso al panel con una cuenta de Firebase: Google, o correo y contraseña.
 *
 * Crear una cuenta NO da acceso: el servidor sólo deja entrar a los correos
 * del equipo (administradores de ADMIN_EMAILS y miembros de /admin/equipo)
 * y con el correo verificado. Por eso el
 * registro manda el enlace de verificación antes de intentar entrar.
 *
 * Al entrar se cierra la sesión de Firebase del navegador: la del panel vive
 * en una cookie httpOnly firmada, y así el sitio público no te trata como una
 * cuenta ciudadana.
 */

type Modo = "entrar" | "crear";
type Paso = { tipo: "formulario" } | { tipo: "verificar"; correo: string } | { tipo: "recuperar" } | { tipo: "recuperacion_enviada"; correo: string };

const MENSAJE_FIREBASE: Record<string, string> = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "Ese correo no es válido.",
  "auth/email-already-in-use": "Ese correo ya tiene cuenta. Entra con tu contraseña o con Google.",
  "auth/weak-password": "La contraseña es muy débil.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos y vuelve a probar.",
  "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permítela e intenta de nuevo.",
  "auth/unauthorized-domain": "Este sitio todavía no está autorizado para entrar con Google. Usa tu correo y contraseña.",
  "auth/operation-not-allowed": "Ese método de acceso no está habilitado.",
  "auth/network-request-failed": "Sin conexión. Revisa tu internet.",
};

const MENSAJE_SERVIDOR: Record<string, string> = {
  no_autorizado: "Esta cuenta no es parte del equipo. Pide a un administrador que te agregue en Equipo con este mismo correo.",
  token_invalido: "No se pudo verificar tu cuenta. Vuelve a intentarlo.",
  sin_correo: "Esta cuenta no tiene un correo asociado.",
  sin_configurar: "El acceso con cuenta todavía no está configurado en este servidor.",
  api_no_responde: "El servidor de Vigía no responde. Intenta en un momento.",
};

const silenciosos = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

function LoginForm() {
  const params = useSearchParams();
  const destino = destinoSeguro(params.get("next"), "/admin");

  const [modo, setModo] = useState<Modo>("entrar");
  const [paso, setPaso] = useState<Paso>({ tipo: "formulario" });
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [cargando, setCargando] = useState<null | "google" | "correo" | "reenviar" | "comprobar" | "recuperar">(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fallar = (e: unknown) => {
    const code = (e as { code?: string })?.code ?? "";
    if (silenciosos.has(code)) return;
    if (code) console.warn("[admin login]", code);
    setError(MENSAJE_FIREBASE[code] ?? "No se pudo iniciar sesión.");
  };

  /** Con la cuenta ya verificada en el navegador, pide la sesión del panel al servidor. */
  async function entrarAlPanel(user: User) {
    if (!user.emailVerified) {
      setPaso({ tipo: "verificar", correo: user.email ?? correo });
      return;
    }
    const idToken = await user.getIdToken(true);
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    const body = await r.json().catch(() => ({}));
    await signOut(auth).catch(() => {});
    if (r.ok) {
      // Carga completa (no del router): el panel arranca sin nada guardado de otra sesión.
      window.location.replace(destino);
      return;
    }
    if (body?.error === "correo_no_verificado") {
      setPaso({ tipo: "verificar", correo: user.email ?? correo });
      return;
    }
    setError(MENSAJE_SERVIDOR[body?.error] ?? "No se pudo iniciar sesión.");
  }

  async function conGoogle() {
    setError(null);
    setCargando("google");
    try {
      // El resolver de popup se carga sólo acá: lib/firebase lo omite a propósito
      // para no sumar ~140 KB a cada página del sitio público.
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
      await entrarAlPanel(user);
    } catch (e) {
      fallar(e);
    } finally {
      setCargando(null);
    }
  }

  async function conCorreo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (modo === "crear") {
      if (clave.length < 8) return setError("La contraseña necesita al menos 8 caracteres.");
      if (clave !== clave2) return setError("Las contraseñas no coinciden.");
    }
    setCargando("correo");
    try {
      if (modo === "crear") {
        const { user } = await createUserWithEmailAndPassword(auth, correo.trim(), clave);
        await sendEmailVerification(user);
        setPaso({ tipo: "verificar", correo: user.email ?? correo });
      } else {
        const { user } = await signInWithEmailAndPassword(auth, correo.trim(), clave);
        await entrarAlPanel(user);
      }
    } catch (err) {
      fallar(err);
    } finally {
      setCargando(null);
    }
  }

  async function reenviar() {
    setError(null);
    setAviso(null);
    const user = auth.currentUser;
    if (!user) return setPaso({ tipo: "formulario" });
    setCargando("reenviar");
    try {
      await sendEmailVerification(user);
      setAviso("Te enviamos otro enlace.");
    } catch (e) {
      fallar(e);
    } finally {
      setCargando(null);
    }
  }

  async function yaLoAbri() {
    setError(null);
    setAviso(null);
    const user = auth.currentUser;
    if (!user) return setPaso({ tipo: "formulario" });
    setCargando("comprobar");
    try {
      await user.reload();
      if (!auth.currentUser?.emailVerified) {
        setAviso("Todavía no aparece verificado. Abre el enlace del correo y vuelve a intentar.");
        return;
      }
      await entrarAlPanel(auth.currentUser);
    } catch (e) {
      fallar(e);
    } finally {
      setCargando(null);
    }
  }

  async function recuperar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando("recuperar");
    try {
      await sendPasswordResetEmail(auth, correo.trim());
    } catch (err) {
      // No se dice si el correo existe: la respuesta es la misma para todos.
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/invalid-email" || code === "auth/network-request-failed" || code === "auth/too-many-requests") {
        fallar(err);
        setCargando(null);
        return;
      }
    }
    setPaso({ tipo: "recuperacion_enviada", correo: correo.trim() });
    setCargando(null);
  }

  const volver = async () => {
    await signOut(auth).catch(() => {});
    setPaso({ tipo: "formulario" });
    setError(null);
    setAviso(null);
  };

  return (
    <div className="w-full max-w-[26rem] rounded-3xl border border-line bg-paper p-7 shadow-card sm:p-8">
      <div className="flex items-center gap-2">
        <Marca />
        <span className="rounded bg-amber px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">equipo</span>
      </div>

      {paso.tipo === "formulario" && (
        <>
          <h1 className="mt-6 font-display text-2xl font-bold text-ink">{modo === "entrar" ? "Acceso al panel" : "Crear cuenta"}</h1>
          <p className="mt-1 text-sm text-mute">Aportes, revisión humana y monitoreo del sistema.</p>

          <button
            type="button"
            onClick={conGoogle}
            disabled={!!cargando}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-rapido hover:bg-paperSoft active:translate-y-px disabled:opacity-60"
          >
            {cargando === "google" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LogoGoogle />}
            Continuar con Google
          </button>

          <div className="my-5 flex items-center gap-3 text-[12px] text-mute" aria-hidden>
            <span className="h-px flex-1 bg-line" />o con tu correo<span className="h-px flex-1 bg-line" />
          </div>

          {/* Entrar o crear cuenta: la misma caja, dos modos. Botones con aria-pressed (no pestañas:
              no hay paneles de pestaña, es el mismo formulario que cambia). */}
          <div role="group" aria-label="Modo de acceso" className="grid grid-cols-2 rounded-xl bg-paperSoft p-1 text-sm">
            {(["entrar", "crear"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => {
                  setModo(m);
                  setError(null);
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 font-medium transition-colors duration-rapido",
                  modo === m ? "bg-paper text-ink shadow-sm" : "text-mute hover:text-ink",
                )}
              >
                {m === "entrar" ? "Entrar" : "Crear cuenta"}
              </button>
            ))}
          </div>

          <form onSubmit={conCorreo} className="mt-4 space-y-3">
            <Campo etiqueta="Correo" tipo="email" valor={correo} onCambio={setCorreo} autocompletar="email" />
            <Campo
              etiqueta="Contraseña"
              tipo="password"
              valor={clave}
              onCambio={setClave}
              autocompletar={modo === "entrar" ? "current-password" : "new-password"}
              ayuda={modo === "crear" ? "Al menos 8 caracteres." : undefined}
            />
            {modo === "crear" && <Campo etiqueta="Repite la contraseña" tipo="password" valor={clave2} onCambio={setClave2} autocompletar="new-password" />}

            {error && (
              <p role="alert" className="rounded-lg bg-crimson-soft px-3 py-2 text-[13px] text-crimsonTexto">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!!cargando || !correo || !clave}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-transform duration-rapido active:translate-y-px disabled:opacity-50"
            >
              {cargando === "correo" && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {modo === "entrar" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          {modo === "entrar" && (
            <button
              type="button"
              onClick={() => {
                setPaso({ tipo: "recuperar" });
                setError(null);
              }}
              className="mt-3 text-[13px] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}

          <p className="mt-6 flex items-start gap-1.5 border-t border-line pt-4 text-[12px] leading-relaxed text-mute">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
            Solo entra el equipo: administradores y revisores. Tu correo queda como autor de cada acción en la bitácora.
          </p>
        </>
      )}

      {paso.tipo === "verificar" && (
        <div className="mt-6">
          <MailCheck size={28} className="text-granate" aria-hidden />
          <h1 className="mt-3 font-display text-2xl font-bold text-ink">Verifica tu correo</h1>
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">
            Te enviamos un enlace a <strong className="font-semibold text-ink">{paso.correo}</strong>. Ábrelo y vuelve acá para entrar.
          </p>
          {aviso && <p className="mt-3 rounded-lg bg-paperSoft px-3 py-2 text-[13px] text-inkSoft">{aviso}</p>}
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-crimson-soft px-3 py-2 text-[13px] text-crimsonTexto">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={yaLoAbri}
            disabled={!!cargando}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper disabled:opacity-50"
          >
            {cargando === "comprobar" && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Ya lo abrí, entrar
          </button>
          <div className="mt-3 flex items-center justify-between text-[13px]">
            <button type="button" onClick={volver} className="inline-flex items-center gap-1 text-mute hover:text-ink">
              <ArrowLeft size={13} aria-hidden /> Volver
            </button>
            <button type="button" onClick={reenviar} disabled={!!cargando} className="text-mute underline-offset-4 hover:text-ink hover:underline disabled:opacity-50">
              {cargando === "reenviar" ? "Enviando…" : "Reenviar enlace"}
            </button>
          </div>
        </div>
      )}

      {paso.tipo === "recuperar" && (
        <form onSubmit={recuperar} className="mt-6 space-y-3">
          <h1 className="font-display text-2xl font-bold text-ink">Recuperar contraseña</h1>
          <p className="text-sm text-mute">Te enviamos un enlace para crear una nueva.</p>
          <Campo etiqueta="Correo" tipo="email" valor={correo} onCambio={setCorreo} autocompletar="email" />
          {error && (
            <p role="alert" className="rounded-lg bg-crimson-soft px-3 py-2 text-[13px] text-crimsonTexto">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!!cargando || !correo}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper disabled:opacity-50"
          >
            {cargando === "recuperar" && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Enviar enlace
          </button>
          <button type="button" onClick={volver} className="inline-flex items-center gap-1 text-[13px] text-mute hover:text-ink">
            <ArrowLeft size={13} aria-hidden /> Volver
          </button>
        </form>
      )}

      {paso.tipo === "recuperacion_enviada" && (
        <div className="mt-6">
          <Mail size={28} className="text-granate" aria-hidden />
          <h1 className="mt-3 font-display text-2xl font-bold text-ink">Revisa tu correo</h1>
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">
            Si <strong className="font-semibold text-ink">{paso.correo}</strong> tiene cuenta, te llegó un enlace para crear una contraseña nueva.
          </p>
          <button type="button" onClick={volver} className="mt-5 inline-flex items-center gap-1 text-[13px] text-mute hover:text-ink">
            <ArrowLeft size={13} aria-hidden /> Volver a entrar
          </button>
        </div>
      )}
    </div>
  );
}

function Campo({
  etiqueta,
  tipo,
  valor,
  onCambio,
  autocompletar,
  ayuda,
}: {
  etiqueta: string;
  tipo: "email" | "password";
  valor: string;
  onCambio: (v: string) => void;
  autocompletar: string;
  ayuda?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-inkSoft">{etiqueta}</span>
      <input
        type={tipo}
        required
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        autoComplete={autocompletar}
        className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink outline-none transition-shadow duration-rapido focus:border-granate/50 focus:ring-2 focus:ring-granate/20"
      />
      {ayuda && <span className="mt-1 block text-[12px] text-mute">{ayuda}</span>}
    </label>
  );
}

/** El logo de Google, tal como pide su guía de marca para el botón de acceso. */
function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-paperDeep p-5">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
