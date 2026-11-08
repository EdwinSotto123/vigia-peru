"use client";

import { useState } from "react";
import { Loader2, Star } from "lucide-react";
import { ESTADOS } from "@/components/gobserva/cuenta/PanelGuardados";
import { ErrorCuenta, type EstadoGuardado } from "@/lib/gobserva-cuenta";
import { useSeguimiento, type TipoSeguido } from "@/lib/licitaciones-app/useSeguimiento";
import { cn } from "@/lib/utils";
import { useAvisos } from "../ui/Avisos";

interface Datos {
  id: string;
  codigo: string | null;
  titulo: string | null;
}

const mensaje = (e: unknown) => (e instanceof ErrorCuenta ? e.message : "No pudimos guardarlo ahora. Vuelve a intentarlo.");
/** «el proceso» o «la plaza», para los avisos. */
const cosa = (tipo: TipoSeguido) => (tipo === "plaza" ? "la plaza" : "el proceso");

/**
 * La estrella de una fila: sigue el proceso en tu cuenta (entra al tablero de Seguimiento y al Calendario) o lo deja de
 * seguir. Confirma con un aviso que lleva al tablero; si el plan no deja guardar más, lo dice.
 */
export function EstrellaSeguir({ id, codigo, titulo, tipo = "oportunidad" }: Datos & { tipo?: TipoSeguido }) {
  const { item, seguir, dejar, isLoading } = useSeguimiento();
  const avisar = useAvisos();
  const sigue = !!item(tipo, id);
  const nombre = codigo ?? cosa(tipo);
  async function alternar() {
    try {
      if (sigue) {
        await dejar(id, tipo);
        avisar({ tono: "ok", texto: `Dejaste de seguir ${nombre}.` });
      } else {
        await seguir(id, titulo, tipo);
        avisar({ tono: "ok", texto: `Sigues ${nombre}: está en tu tablero y su plazo, en tu calendario.`, accion: { etiqueta: "Ver mi tablero", href: "/cuenta?tab=seguimiento" } });
      }
    } catch (e) {
      avisar({ tono: "error", texto: mensaje(e), accion: { etiqueta: "Ver los planes", href: "/planes" } });
    }
  }
  return (
    <button
      type="button"
      onClick={() => void alternar()}
      disabled={isLoading}
      aria-pressed={sigue}
      aria-label={sigue ? `Dejar de seguir ${codigo ?? (tipo === "plaza" ? "esta plaza" : "este proceso")}` : `Seguir ${codigo ?? (tipo === "plaza" ? "esta plaza" : "este proceso")}`}
      title={sigue ? "Lo sigues: quitar del seguimiento" : tipo === "plaza" ? "Guardar esta plaza" : "Seguir este proceso"}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors duration-rapido disabled:opacity-50",
        sigue ? "text-granate hover:bg-granate-50" : "text-mute hover:bg-ink/[0.06] hover:text-ink",
      )}
    >
      <Star size={18} aria-hidden fill={sigue ? "currentColor" : "none"} />
    </button>
  );
}

/** En el detalle: «Seguir» y, si ya lo sigues, su etapa (la del tablero: guardada, preparando, presentada, ganada, perdida). */
export function SeguirConEtapa({ id, codigo, titulo, tipo = "oportunidad" }: Datos & { tipo?: TipoSeguido }) {
  const { item, seguir, dejar, etapa, isLoading, producto } = useSeguimiento();
  const avisar = useAvisos();
  const [ocupado, setOcupado] = useState(false);
  const s = item(tipo, id);
  const estados = ESTADOS[producto];
  const nombre = codigo ?? cosa(tipo);
  async function hacer(f: () => Promise<unknown>, ok: string, conTablero = false) {
    setOcupado(true);
    try {
      await f();
      avisar({ tono: "ok", texto: ok, ...(conTablero ? { accion: { etiqueta: "Ver mi tablero", href: "/cuenta?tab=seguimiento" } } : {}) });
    } catch (e) {
      avisar({ tono: "error", texto: mensaje(e) });
    } finally {
      setOcupado(false);
    }
  }
  if (isLoading) return <span aria-hidden className="inline-block h-10 w-28 animate-pulse rounded-lg bg-ink/[0.07]" />;
  if (!s) {
    return (
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void hacer(() => seguir(id, titulo, tipo), `Sigues ${nombre}: está en tu tablero.`, true)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-70"
      >
        {ocupado ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <Star size={16} aria-hidden />} {tipo === "plaza" ? "Guardar" : "Seguir"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 rounded-lg border border-granate/40 bg-granate-50 p-1">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void hacer(() => dejar(id, tipo), `Dejaste de seguir ${nombre}.`)}
        aria-label="Dejar de seguir"
        title="Dejar de seguir"
        className="grid h-8 w-8 place-items-center rounded-md text-granate hover:bg-caja"
      >
        <Star size={16} aria-hidden fill="currentColor" />
      </button>
      <label className="sr-only" htmlFor={`etapa-${id}`}>
        Etapa en tu tablero
      </label>
      <select
        id={`etapa-${id}`}
        value={s.estado}
        disabled={ocupado}
        onChange={(e) => {
          const etiqueta = estados.find((x) => x.valor === e.target.value)?.etiqueta ?? e.target.value;
          void hacer(() => etapa(id, titulo, e.target.value as EstadoGuardado, tipo), `Pasó a «${etiqueta}» en tu tablero.`, true);
        }}
        className="h-8 rounded-md border border-line bg-caja px-2 text-dato font-semibold text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
      >
        {estados.map((e) => (
          <option key={e.valor} value={e.valor}>
            {e.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}
