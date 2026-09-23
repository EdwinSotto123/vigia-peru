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
      <Link href={miImpacto} className="inline-flex items-center gap-1 text-[12px] text-inkSoft hover:text-ink hover:underline">
        ¿Es tuyo? Velo o asócialo en Mi impacto <ArrowRight size={12} aria-hidden />
      </Link>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] text-inkSoft">
      <UserPlus size={14} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
      <span>
        <strong className="text-ink">¿Financiaste este aporte? Crea una cuenta para seguirlo</strong>: progreso, señales halladas y tus zonas en un solo lugar. No es obligatorio: con el código <span className="font-mono">{codigo}</span> siempre puedes volver a este comprobante.{" "}
        <Link href={`/signup?next=${encodeURIComponent(miImpacto)}`} className="underline">Crear cuenta</Link>
        <Link href={`/login?next=${encodeURIComponent(miImpacto)}`} className="ml-3 underline">Ya tengo una</Link>
      </span>
    </div>
  );
}
