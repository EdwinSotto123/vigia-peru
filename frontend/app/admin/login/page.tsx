"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/admin";
  const [token, setToken] = useState("");
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, actor }) });
      if (!r.ok) throw new Error(r.status === 401 ? "Token inválido" : "No se pudo iniciar sesión");
      router.replace(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-line bg-paper p-8 shadow-sm">
      <div className="flex items-center gap-2">
        <Logo height={30} />
        <span className="rounded bg-amber px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-coal">admin</span>
      </div>
      <h1 className="mt-5 font-serif text-2xl font-bold text-ink">Acceso al panel</h1>
      <p className="mt-1 text-sm text-mute">Validación de aportes, financiadores, medios de pago y monitoreo.</p>

      <label className="mt-6 block text-sm">
        <span className="text-mute">Tu nombre (para la bitácora)</span>
        <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Ej. Edwin" className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
      </label>
      <label className="mt-3 block text-sm">
        <span className="text-mute">Token de administrador</span>
        <div className="relative mt-1">
          <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input type="password" required value={token} onChange={(e) => setToken(e.target.value)} className="w-full rounded-lg border border-line py-2 pl-9 pr-3 font-mono" autoComplete="current-password" />
        </div>
      </label>
      {error && <p className="mt-3 text-sm text-rust">{error}</p>}
      <button type="submit" disabled={loading || !token} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper disabled:opacity-50">
        {loading && <Loader2 size={14} className="animate-spin" />} Entrar
      </button>
      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-mute">
        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
        El token vive en Secret Manager (<code>admin-token</code>). La sesión dura 12 h y se guarda en una cookie que el navegador no puede leer.
      </p>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paperDeep p-6">
      <Suspense><LoginForm /></Suspense>
    </div>
  );
}
