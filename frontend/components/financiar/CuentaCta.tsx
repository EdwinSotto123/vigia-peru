"use client";

/**
 * "Crea una cuenta para seguir tu aporte" — solo SIN sesión y solo después de que el aporte
 * existe (nunca antes de pagar). Con sesión no muestra nada (o un enlace a Mi impacto).
 */

import Link from "next/link";
import { UserPlus, ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

export function CuentaCta({ codigo }: { codigo: string }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) {
    return (
      <Link href="/app/mi-impacto" className="inline-flex items-center gap-1 text-[12px] text-mute hover:text-ink hover:underline">
        Ver todos mis aportes en Mi impacto <ArrowRight size={12} aria-hidden />
      </Link>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] text-mute">
      <UserPlus size={14} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
      <span>
        <strong className="text-ink">¿Financiaste este aporte? Crea una cuenta para seguirlo</strong>: progreso, señales halladas y tus zonas en un solo lugar. No es obligatorio: con el código <span className="font-mono">{codigo}</span> siempre puedes volver a este comprobante.{" "}
        <Link href={`/signup?next=${encodeURIComponent(`/app/mi-impacto?aporte=${codigo}`)}`} className="underline">Crear cuenta</Link>
        <Link href={`/login?next=${encodeURIComponent(`/app/mi-impacto?aporte=${codigo}`)}`} className="ml-3 underline">Ya tengo una</Link>
      </span>
    </div>
  );
}
