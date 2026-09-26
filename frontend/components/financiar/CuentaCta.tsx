"use client";

/**
 * "Crea una cuenta para seguir tu aporte": solo SIN sesión y solo después de que el aporte
 * existe (nunca antes de pagar). Con sesión, un enlace a Mi impacto que ya trae el código,
 * para que un aporte hecho como invitado se pueda asociar a la cuenta desde ahí.
 */

import Link from "next/link";
import { UserPlus, ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

export function CuentaCta({ codigo }: { codigo: string }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  const miImpacto = `/app/mi-impacto?aporte=${encodeURIComponent(codigo)}`;
  if (user) {
    return (
      <Link href={miImpacto} className="inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline">
        ¿Es tuyo? Velo o asócialo en Mi impacto <ArrowRight size={12} aria-hidden />
      </Link>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-inkSoft">
      <UserPlus size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
      <span>
        <strong className="text-ink">¿Es tuyo? Crea una cuenta para seguirlo.</strong> No es obligatorio: con el código{" "}
        <span className="font-mono">{codigo}</span> vuelves a este comprobante.{" "}
        <Link href={`/signup?next=${encodeURIComponent(miImpacto)}`} prefetch={false} className="font-semibold text-granate underline underline-offset-2">Crear cuenta</Link>
        <Link href={`/login?next=${encodeURIComponent(miImpacto)}`} prefetch={false} className="ml-3 text-granate underline underline-offset-2">Ya tengo una</Link>
      </span>
    </div>
  );
}
