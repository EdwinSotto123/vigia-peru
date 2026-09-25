"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AtSign,
  Lock,
  Loader2,
  LogIn,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { destinoSeguro, signInWithUserId } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Cargando } from "@/components/patrones";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="container-page flex justify-center py-16"><Cargando className="w-full max-w-md" /></div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const nextCrudo = search.get("next");
  // Sólo rutas internas: /login?next=https://otro-sitio no puede sacar a nadie de Vigía.
  const next = destinoSeguro(nextCrudo);
  // Al saltar a "Crear cuenta" se conserva el destino, si era válido.
  const signupHref = nextCrudo && next === nextCrudo ? `/signup?next=${encodeURIComponent(next)}` : "/signup";
  // Llega desde "Borrar cuenta" en /app/configuracion.
  const cuentaBorrada = search.get("cuenta") === "borrada";
  const accesoPendiente = search.get("acceso") === "pendiente";
  const { user, loading } = useAuth();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [user, loading, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!userId.trim()) { setError("Ingresa tu nombre de usuario."); return; }
    if (!password) { setError("Escribe tu contraseña."); return; }
    setSubmitting(true);
    try {
      await signInWithUserId(userId, password);
      router.replace(next);
    } catch (e: any) {
      setError(e?.message || "No pudimos iniciar sesión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  const campo =
    "w-full rounded-xl border bg-paperSoft px-9 py-2.5 text-base text-ink placeholder:text-mute transition-colors duration-rapido focus:bg-paper focus:outline-none focus:ring-1";
  const etiqueta = "text-sm font-medium text-ink";

  return (
    <div className="container-page flex min-h-[calc(100vh-200px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        {cuentaBorrada && (
          <div role="status" className="mb-6 flex items-start gap-2 rounded-2xl border border-moss/30 bg-moss/10 px-4 py-3 text-sm text-ink">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
            <span>
              <strong className="font-semibold">Tu cuenta se borró.</strong> Tus aportes se conservan y aparecen como
              “Anónimo”; tus denuncias quedaron sin autor.
              {accesoPendiente && (
                <>
                  {" "}No pudimos eliminar tu usuario por un problema de conexión: si vuelves a entrar con él, bórralo
                  otra vez desde Tu cuenta.
                </>
              )}
            </span>
          </div>
        )}

        {/* Sin ícono encima: la firma ya está en la cabecera, y el escudo que
            había acá no es de Vigía (DESIGN_SYSTEM.md §1: nada de íconos de policía). */}
        <div className="mb-6 text-center">
          <h1 className="text-balance font-display text-[30px] font-bold leading-tight tracking-tight text-ink">
            Inicia sesión
          </h1>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-inkSoft">
            Ingresa con tu nombre de usuario y contraseña. La cuenta es opcional: sirve para seguir tus denuncias y aportes.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-paper p-5 sm:p-6" noValidate>
          {/* Nombre de usuario */}
          <div>
            <label htmlFor="login-usuario" className={cn("mb-1 block", etiqueta)}>
              Nombre de usuario
            </label>
            <div className="relative">
              <AtSign
                size={15}
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                id="login-usuario"
                name="username"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="tu_usuario"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
                className={cn(campo, error ? "border-crimson focus:border-crimson focus:ring-crimson" : "border-line focus:border-granate focus:ring-granate")}
              />
            </div>
          </div>

          {/* Contraseña. El botón mostrar/ocultar vive FUERA del <label>: adentro,
              su texto se sumaba al nombre accesible del campo. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="login-password" className={etiqueta}>
                Contraseña
              </label>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-controls="login-password"
                aria-pressed={showPw}
                className="inline-flex min-h-6 items-center gap-1 rounded-full px-1.5 text-xs font-medium text-granate hover:underline"
              >
                {showPw ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                {showPw ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            <div className="relative">
              <Lock
                size={15}
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                id="login-password"
                name="password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                autoComplete="current-password"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error login-sin-recuperacion" : "login-sin-recuperacion"}
                className={cn(campo, error ? "border-crimson focus:border-crimson focus:ring-crimson" : "border-line focus:border-granate focus:ring-granate")}
              />
            </div>
            <p id="login-sin-recuperacion" className="mt-1 text-xs text-mute">
              No pedimos correo, así que una contraseña olvidada no se puede recuperar.
            </p>
          </div>

          {error && (
            <div id="login-error" role="alert" className="flex items-start gap-2 rounded-xl border border-crimson/30 bg-crimson-soft px-3 py-2 text-[13px] text-crimsonTexto">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            full
            variant="primary"
            className="!py-3"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden /> Entrando…
              </>
            ) : (
              <>
                <LogIn size={16} aria-hidden /> Entrar
              </>
            )}
          </Button>

          <p className="text-center text-[13px] text-mute">
            ¿Sin cuenta?{" "}
            <Link href={signupHref} className="font-semibold text-granate hover:underline">
              Crear una →
            </Link>
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-mute">
          Tu nombre de usuario es único y privado. No pedimos correo electrónico.
        </p>
      </div>
    </div>
  );
}
