"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Sparkles } from "lucide-react";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { rutaEn } from "@/lib/gobserva";
import { cargarLineas } from "@/lib/gobserva-cuenta";

/** Sin perfil todavía: arriba de la bandeja, el paso que la hace útil (el onboarding, 2 minutos). Con perfil, nada. */
export function AvisoPerfil({ base }: { base: string }) {
  const { conCuenta } = useSesion();
  const { data } = useSWR(conCuenta ? ["gobserva-lineas"] : null, () => cargarLineas(), { revalidateOnFocus: false });
  if (!data || data.data.length > 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-granate/40 bg-granate-50 p-4 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate text-paper">
          <Sparkles size={19} />
        </span>
        <div>
          <p className="text-dato font-bold text-ink">Arma tu perfil y la bandeja trabaja para ti</p>
          <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">Qué vendes, dónde y qué contratos te interesan: te mostramos lo que calza contigo y te avisamos de lo nuevo.</p>
        </div>
      </div>
      <Link href={rutaEn(base, "/app/bienvenida")} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-granate px-5 text-dato font-semibold text-paper hover:bg-granate-deep">
        Empezar (2 minutos) <ArrowRight size={16} aria-hidden />
      </Link>
    </div>
  );
}
