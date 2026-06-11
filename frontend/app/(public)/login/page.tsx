"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  AtSign,
  Lock,
  Loader2,
  LogIn,
  AlertCircle,
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import { signInWithUserId } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";

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
  const next = search.get("next") || "/app";
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
    setSubmitting(true);
    try {
      await signInWithUserId(userId, password);
      router.replace(next);
    } catch (e: any) {
      setError(e.message ?? "Error de autenticación");
      setSubmitting(false);
    }
  };

  return (
    <div className="container-page flex min-h-[calc(100vh-200px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-paper">
            <Shield size={22} strokeWidth={2.2} />
          </div>
          <h1 className="font-serif text-3xl font-bold text-ink">
            Bienvenido de vuelta
          </h1>
          <p className="mt-1 text-sm text-mute">
            Entrá con tu user-id y contraseña para acceder a Vigía.
          </p>
        </div>

        <form onSubmit={submit} className="surface space-y-4 p-6">
          {/* userId */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">
              User-id
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
                placeholder="tu_user_id"
                autoComplete="username"
                spellCheck={false}
                className="w-full rounded-xl border border-line bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:border-clay focus:outline-none"
              />
            </div>
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
                placeholder="••••••"
                autoComplete="current-password"
                className="w-full rounded-xl border border-line bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:border-clay focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-xs text-rust">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
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
                <Loader2 size={16} className="animate-spin" /> Entrando…
              </>
            ) : (
              <>
                <LogIn size={16} /> Entrar
              </>
            )}
          </Button>

          <p className="text-center text-xs text-mute">
            ¿Sin cuenta?{" "}
            <Link href="/signup" className="font-medium text-clay hover:underline">
              Crear una →
            </Link>
          </p>
        </form>

        <p className="mt-4 text-center text-[11px] text-mute">
          Tu user-id es único y privado. No usamos email para el demo.
        </p>
      </div>
    </div>
  );
}
