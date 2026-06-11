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
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  signUpWithUserId,
  validateUserId,
  validatePassword,
} from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="container-page py-20">Cargando…</div>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/app";
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
      setError(e.message ?? "No se pudo crear la cuenta");
      setSubmitting(false);
    }
  };

  return (
    <div className="container-page flex min-h-[calc(100vh-200px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-clay text-paper">
            <Shield size={22} strokeWidth={2.2} />
          </div>
          <h1 className="font-serif text-3xl font-bold text-ink">
            Creá tu cuenta
          </h1>
          <p className="mt-1 text-sm text-mute">
            Elige un user-id único y una contraseña. Sin email — sin tracking.
          </p>
        </div>

        <form onSubmit={submit} className="surface space-y-4 p-6">
          {/* userId */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">
              User-id (único)
            </label>
            <div className="relative">
              <AtSign
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="elige_uno_que_no_exista"
                autoComplete="username"
                spellCheck={false}
                className={cn(
                  "w-full rounded-xl border bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:outline-none",
                  userIdError
                    ? "border-rust focus:border-rust"
                    : "border-line focus:border-clay",
                )}
              />
              {userId && !userIdError && (
                <CheckCircle2
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-moss"
                />
              )}
            </div>
            <p
              className={cn(
                "mt-1 text-[10px]",
                userIdError ? "text-rust" : "text-mute",
              )}
            >
              {userIdError ??
                "3-30 caracteres · letras, números o guion bajo · case-insensitive"}
            </p>
          </div>

          {/* password */}
          <div>
            <label className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-mute">
              <span>Contraseña</span>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="inline-flex items-center gap-1 text-clay hover:underline"
              >
                {showPw ? <EyeOff size={11} /> : <Eye size={11} />}
                {showPw ? "ocultar" : "mostrar"}
              </button>
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="al menos 6 caracteres"
                autoComplete="new-password"
                className={cn(
                  "w-full rounded-xl border bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:outline-none",
                  pwError
                    ? "border-rust focus:border-rust"
                    : "border-line focus:border-clay",
                )}
              />
            </div>
            {pwError && (
              <p className="mt-1 text-[10px] text-rust">{pwError}</p>
            )}
          </div>

          {/* password confirm */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">
              Repetí la contraseña
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              />
              <input
                type={showPw ? "text" : "password"}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="confirmar"
                autoComplete="new-password"
                className={cn(
                  "w-full rounded-xl border bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:outline-none",
                  password2 && !pwMatch
                    ? "border-rust focus:border-rust"
                    : "border-line focus:border-clay",
                )}
              />
              {password2 && pwMatch && (
                <CheckCircle2
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-moss"
                />
              )}
            </div>
            {password2 && !pwMatch && (
              <p className="mt-1 text-[10px] text-rust">No coincide</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-xs text-rust">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
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
                <Loader2 size={16} className="animate-spin" /> Creando cuenta…
              </>
            ) : (
              <>
                <UserPlus size={16} /> Crear cuenta
              </>
            )}
          </Button>

          <p className="text-center text-xs text-mute">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-medium text-clay hover:underline">
              Entrar →
            </Link>
          </p>
        </form>

        <div className="mt-4 space-y-1 text-center text-[11px] text-mute">
          <p>El user-id es único — si está tomado te avisamos al instante.</p>
          <p>No pedimos email · No usamos cookies de tracking.</p>
        </div>
      </div>
    </div>
  );
}
