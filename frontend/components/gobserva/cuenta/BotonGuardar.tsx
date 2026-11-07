"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { ErrorCuenta, cargarGuardados, guardar, quitarGuardado, type Guardado, type TipoGuardado } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { useSesion } from "./comun";

/**
 * «Guardar» en la ficha de una plaza, una oportunidad o un proyecto. Sin cuenta lleva a crearla (y vuelve a la ficha).
 * `codigo` es lo que identifica la cosa en su producto (el aviso, el OCID, el CUI); no se llama `ref` porque React se queda
 * con esa prop (una cadena ahí rompe la página). `datos` lleva lo que el recordatorio necesita sin otra consulta: `cierre`
 * (YYYY-MM-DD) y `entidad`.
 */
export function BotonGuardar({
  producto, base, tipo, codigo, titulo, datos, className,
}: {
  producto: Producto;
  base: string;
  tipo: TipoGuardado;
  codigo: string;
  titulo: string;
  datos?: Guardado["datos"];
  className?: string;
}) {
  const { user, loading, conCuenta } = useSesion();
  const ruta = usePathname();
  const sp = useSearchParams();
  const { data, mutate } = useSWR(conCuenta && user ? ["gobserva-guardados", producto] : null, () => cargarGuardados(producto), { revalidateOnFocus: false });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardado = data?.data.find((g) => g.tipo === tipo && g.ref === codigo) ?? null;

  if (loading) return <span aria-hidden className={cn("inline-block h-11 w-32 animate-pulse rounded-full bg-paperDeep", className)} />;
  if (!conCuenta) {
    // La ruta de la ficha sin la base del producto (en su subdominio ya va sin ella).
    const aqui = `${base && ruta.startsWith(base) ? ruta.slice(base.length) || "/" : ruta}${sp.size ? `?${sp}` : ""}`;
    // La misma caja que con sesión, para que el botón mida igual con o sin cuenta.
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <Link href={rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent(aqui)}`)} className={claseAccion("secundario", "min-h-11 w-full")}>
          <Bookmark size={16} aria-hidden /> Guardar
        </Link>
      </div>
    );
  }

  async function alternar() {
    setError(null);
    setOcupado(true);
    try {
      if (guardado) await quitarGuardado(producto, tipo, codigo);
      else await guardar({ producto, tipo, ref: codigo, titulo: titulo.slice(0, 300), datos });
      await mutate();
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos guardarlo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button type="button" onClick={() => void alternar()} disabled={ocupado} aria-pressed={!!guardado} className={claseAccion(guardado ? "primario" : "secundario", "min-h-11 w-full")}>
        {ocupado ? <Loader2 size={16} aria-hidden className="animate-spin" /> : guardado ? <BookmarkCheck size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
        {guardado ? "Guardado" : "Guardar"}
      </button>
      {guardado && (
        <Link href={rutaEn(base, producto === "licitaciones" ? "/cuenta?tab=seguimiento" : "/cuenta?tab=guardados")} className="text-center text-meta font-semibold text-granate hover:underline">
          {producto === "licitaciones" ? "Ver mi seguimiento" : "Ver mis guardados"}
        </Link>
      )}
      {error && (
        <p role="alert" className="text-meta text-crimsonTexto">
          {error} {/limite/.test(error) || error.includes("plan") ? <Link href={rutaEn(base, "/planes")} className="font-semibold underline">Ver los planes</Link> : null}
        </p>
      )}
    </div>
  );
}
