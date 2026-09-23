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
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import { destinoSeguro, signInWithUserId } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="container-page py-20">Cargando…</div>}>
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
    "w-full rounded-xl border bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:outline-none";
  const etiqueta = "text-[10px] font-semibold uppercase tracking-wider text-mute";

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

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-paper">
            <Shield size={22} strokeWidth={2.2} aria-hidden />
          </div>
          <h1 className="font-serif text-3xl font-bold text-ink">
            Inicia sesión
          </h1>
          <p className="mt-1 text-sm text-mute">
            Ingresa con tu nombre de usuario y contraseña. La cuenta es opcional: sirve para seguir tus denuncias y aportes.
          </p>
        </div>

        <form onSubmit={submit} className="surface space-y-4 p-6" noValidate>
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
                className={cn(campo, error ? "border-rust focus:border-rust" : "border-line focus:border-heroViolet")}
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
                className="inline-flex items-center gap-1 rounded text-[10px] font-semibold uppercase tracking-wider text-heroViolet hover:underline"
              >
                {showPw ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
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
                className={cn(campo, error ? "border-rust focus:border-rust" : "border-line focus:border-heroViolet")}
              />
            </div>
            <p id="login-sin-recuperacion" className="mt-1 text-[11px] text-mute">
              No pedimos correo, así que una contraseña olvidada no se puede recuperar.
            </p>
          </div>

          {error && (
            <div id="login-error" role="alert" className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-xs text-crimsonTexto">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            full
            variant="ink"
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

          <p className="text-center text-xs text-mute">
            ¿Sin cuenta?{" "}
            <Link href={signupHref} className="font-medium text-heroViolet hover:underline">
              Crear una →
            </Link>
          </p>
        </form>

        <p className="mt-4 text-center text-[11px] text-mute">
          Tu nombre de usuario es único y privado. No pedimos correo electrónico.
        </p>
      </div>
    </div>
  );
}
