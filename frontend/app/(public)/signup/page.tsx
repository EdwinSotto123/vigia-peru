"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AtSign,
  Lock,
  Loader2,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import {
  destinoSeguro,
  signUpWithUserId,
  validateUserId,
  validatePassword,
} from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Cargando } from "@/components/patrones";
import { cn } from "@/lib/utils";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="container-page flex justify-center py-16"><Cargando className="w-full max-w-md" /></div>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const router = useRouter();
  const search = useSearchParams();
  const nextCrudo = search.get("next");
  // Sólo rutas internas: /signup?next=https://otro-sitio no puede sacar a nadie de Vigía.
  const next = destinoSeguro(nextCrudo);
  // Al saltar a "Entrar" se conserva el destino, si era válido.
  const loginHref = nextCrudo && next === nextCrudo ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const { user, loading } = useAuth();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [user, loading, next, router]);

  const userIdError = userId ? validateUserId(userId) : null;
  const pwError = password ? validatePassword(password) : null;
  const pwMatch = password2 ? password === password2 : true;
  const canSubmit =
    userId && password && password2 && !userIdError && !pwError && pwMatch;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await signUpWithUserId(userId, password);
      router.replace(next);
    } catch (e: any) {
      setError(e?.message || "No se pudo crear la cuenta. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  const campo =
    "w-full rounded-xl border bg-paperSoft px-9 py-2.5 text-base text-ink placeholder:text-mute transition-colors duration-rapido focus:bg-paper focus:outline-none focus:ring-1";
  const etiqueta = "text-sm font-medium text-ink";
  const conError = (malo: boolean) => (malo ? "border-crimson focus:border-crimson focus:ring-crimson" : "border-line focus:border-granate focus:ring-granate");

  return (
    <div className="container-page flex min-h-[calc(100vh-200px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        {/* Sin ícono encima: la firma ya está en la cabecera, y el escudo que
            había acá no es de Vigía (DESIGN_SYSTEM.md §1: nada de íconos de policía). */}
        <div className="mb-6 text-center">
          <h1 className="text-balance font-display text-[30px] font-bold leading-tight tracking-tight text-ink">
            Crea tu cuenta
          </h1>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-inkSoft">
            Elige un nombre de usuario y una contraseña. Sin correo y sin rastreo: la cuenta solo sirve para seguir tus denuncias y aportes.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-paper p-5 sm:p-6" noValidate>
          {/* Nombre de usuario */}
          <div>
            <label htmlFor="signup-usuario" className={cn("mb-1 block", etiqueta)}>
              Nombre de usuario
            </label>
            <div className="relative">
              <AtSign
                size={15}
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                id="signup-usuario"
                name="username"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="ej. vecina_cusco"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-invalid={userIdError ? true : undefined}
                aria-describedby="signup-usuario-ayuda"
                className={cn(campo, conError(!!userIdError))}
              />
              {userId && !userIdError && (
                <CheckCircle2
                  size={15}
                  aria-hidden
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mossTexto"
                />
              )}
            </div>
            <p
              id="signup-usuario-ayuda"
              className={cn(
                "mt-1 text-xs",
                userIdError ? "text-crimsonTexto" : "text-mute",
              )}
            >
              {userIdError ??
                "De 3 a 30 caracteres: letras, números o guion bajo. No distingue mayúsculas."}
            </p>
          </div>

          {/* Contraseña. El botón mostrar/ocultar vive FUERA del <label>: adentro,
              su texto se sumaba al nombre accesible del campo. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="signup-password" className={etiqueta}>
                Contraseña
              </label>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-controls="signup-password signup-password2"
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
                id="signup-password"
                name="new-password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="al menos 6 caracteres"
                autoComplete="new-password"
                required
                aria-invalid={pwError ? true : undefined}
                aria-describedby={pwError ? "signup-password-error signup-sin-recuperacion" : "signup-sin-recuperacion"}
                className={cn(campo, conError(!!pwError))}
              />
            </div>
            {pwError && (
              <p id="signup-password-error" className="mt-1 text-xs text-crimsonTexto">{pwError}</p>
            )}
          </div>

          {/* Repetir contraseña */}
          <div>
            <label htmlFor="signup-password2" className={cn("mb-1 block", etiqueta)}>
              Repite la contraseña
            </label>
            <div className="relative">
              <Lock
                size={15}
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                id="signup-password2"
                name="new-password-confirm"
                type={showPw ? "text" : "password"}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="la misma de arriba"
                autoComplete="new-password"
                required
                aria-invalid={password2 && !pwMatch ? true : undefined}
                aria-describedby={password2 && !pwMatch ? "signup-password2-error" : undefined}
                className={cn(campo, conError(!!password2 && !pwMatch))}
              />
              {password2 && pwMatch && (
                <CheckCircle2
                  size={15}
                  aria-hidden
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mossTexto"
                />
              )}
            </div>
            {password2 && !pwMatch && (
              <p id="signup-password2-error" className="mt-1 text-xs text-crimsonTexto">Las contraseñas no coinciden</p>
            )}
          </div>

          {/* Sin correo no hay recuperación: se dice antes de crear la cuenta, no después de perderla. */}
          <p
            id="signup-sin-recuperacion"
            className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber-soft/60 px-3 py-2 text-[12px] leading-snug text-ink"
          >
            <KeyRound size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
            <span>
              <strong className="font-semibold">Guarda tu contraseña.</strong> Como no pedimos correo, si la olvidas no hay
              forma de recuperarla.
            </span>
          </p>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-crimson/30 bg-crimson-soft px-3 py-2 text-[13px] text-crimsonTexto">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={!canSubmit || submitting}
            full
            variant="primary"
            className="!py-3"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden /> Creando cuenta…
              </>
            ) : (
              <>
                <UserPlus size={16} aria-hidden /> Crear cuenta
              </>
            )}
          </Button>

          <p className="text-center text-[13px] text-mute">
            ¿Ya tienes cuenta?{" "}
            <Link href={loginHref} className="font-semibold text-granate hover:underline">
              Entrar →
            </Link>
          </p>
        </form>

        <div className="mt-4 space-y-1 text-center text-xs text-mute">
          <p>Si el nombre de usuario ya existe, te avisamos al crear la cuenta.</p>
          <p>No pedimos correo ni usamos cookies de rastreo.</p>
        </div>
      </div>
    </div>
  );
}
