"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { useAvisos } from "@/components/gobserva/ui/Avisos";
import { rutaEn } from "@/lib/gobserva";
import { ErrorCuenta, guardar, quitar, refNormal, useGuardados, type TipoGuardado } from "@/lib/salud-cuenta";
import { cn } from "@/lib/utils";

/**
 * «Guardar» en una ficha de Gobserva Salud (2026-11-21): un establecimiento, un médico (su colegiatura) o un medicamento.
 * Sin cuenta, lleva a crearla (gratis) y vuelve a la ficha; con cuenta, guarda o quita al toque. `oscuro`: sobre una
 * banda oscura.
 */
export function BotonGuardarSalud({
  tipo,
  codigo,
  nombre,
  base,
  className,
}: {
  tipo: TipoGuardado;
  codigo: string;
  nombre: string | null;
  base: string;
  className?: string;
}) {
  const { guardados, conCuenta, cargandoSesion, mutate } = useGuardados();
  const avisar = useAvisos();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aqui, setAqui] = useState("/");
  useEffect(() => {
    const c = window.location.pathname;
    setAqui((base && c.startsWith(base) ? c.slice(base.length) || "/" : c) + window.location.search);
  }, [base]);

  const ref = refNormal(tipo, codigo);
  const guardado = !!guardados?.some((g) => g.tipo === tipo && g.ref === ref);
  const clase = cn(
    "gs-hunde inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-dato font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:opacity-60",
    guardado ? "border-granate bg-granate text-paper hover:bg-granate-deep" : "border-line bg-paper text-ink hover:border-granate/50 hover:bg-granate-50",
    className,
  );

  if (cargandoSesion) return <span aria-hidden className={cn("inline-block h-11 w-28 animate-pulse rounded-full bg-paperDeep", className)} />;

  if (!conCuenta) {
    return (
      <a href={rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent(aqui)}`)} className={clase} title="Crea tu cuenta gratis para guardarlo">
        <Bookmark size={16} aria-hidden /> Guardar
      </a>
    );
  }

  async function alternar() {
    setOcupado(true);
    setError(null);
    try {
      if (guardado) {
        await quitar(tipo, ref);
        avisar({ tono: "ok", texto: "Lo quitaste de tus guardados." });
      } else {
        await guardar(tipo, ref, nombre);
        avisar({ tono: "ok", texto: `${nombre ?? "Lo"} quedó en Mis guardados: te marcamos ahí lo nuevo.`, accion: { etiqueta: "Ver mis guardados", href: rutaEn(base, "/cuenta") } });
      }
      await mutate();
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos guardarlo ahora.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={() => void alternar()} disabled={ocupado || guardados === null} aria-pressed={guardado} className={clase}>
        {ocupado ? <Loader2 size={16} aria-hidden className="animate-spin" /> : guardado ? <BookmarkCheck size={16} aria-hidden className="gs-marca" /> : <Bookmark size={16} aria-hidden />}
        {guardado ? "Guardado" : "Guardar"}
      </button>
      {error && (
        <span role="alert" className="text-meta text-crimsonTexto">
          {error}
        </span>
      )}
    </span>
  );
}
