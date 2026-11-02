"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BellOff, CheckCircle2, Loader2 } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { pausarAlerta } from "@/lib/gobserva-cuenta";
import { Aviso } from "./comun";

/**
 * Pausar una alerta desde el enlace de su correo, sin entrar a la cuenta. Con un botón: los filtros de correo abren los
 * enlaces solos y no deben pausar nada.
 */
export function Pausar({ base }: { producto: Producto; base: string }) {
  const token = useSearchParams().get("t") ?? "";
  const [estado, setEstado] = useState<"" | "pausando" | "listo">("");
  const [nombre, setNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function pausar() {
    setError(null);
    setEstado("pausando");
    try {
      const r = await pausarAlerta(token);
      setNombre(r.nombre);
      setEstado("listo");
    } catch (e) {
      setError((e as Error).message);
      setEstado("");
    }
  }
  return (
    <div className="container-page max-w-xl py-14">
      <div className="rounded-3xl border border-line bg-paper p-6 text-center sm:p-10">
        {estado === "listo" ? (
          <>
            <CheckCircle2 size={36} aria-hidden className="mx-auto text-granate" />
            <h1 className="mt-3 font-display text-seccion font-bold text-ink">Pausamos «{nombre}»</h1>
            <p className="mt-2 text-cuerpo text-inkSoft">No te escribimos más por esa alerta. Puedes reanudarla o cambiarla cuando quieras desde tu cuenta.</p>
            <Link href={rutaEn(base, "/cuenta?tab=alertas")} className={claseAccion("primario", "mt-6")}>Ver mis alertas</Link>
          </>
        ) : (
          <>
            <BellOff size={36} aria-hidden className="mx-auto text-granate" />
            <h1 className="mt-3 font-display text-seccion font-bold text-ink">¿Pausar esta alerta?</h1>
            <p className="mt-2 text-cuerpo text-inkSoft">Dejamos de enviarte lo nuevo de esa búsqueda. Tus otras alertas siguen igual.</p>
            {token ? (
              <button type="button" onClick={() => void pausar()} disabled={estado === "pausando"} className={claseAccion("primario", "mt-6")}>
                {estado === "pausando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Sí, pausarla
              </button>
            ) : (
              <Aviso className="mt-5">Este enlace está incompleto. Entra a tu cuenta para ver tus alertas.</Aviso>
            )}
            {error && <Aviso tono="error" className="mt-4">{error}</Aviso>}
            <p className="mt-5 text-meta text-mute">
              <Link href={rutaEn(base, "/cuenta?tab=alertas")} className="font-semibold text-granate hover:underline">Ir a mi cuenta</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
