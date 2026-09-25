"use client";

/**
 * La pantalla de "algo no cargó" que muestran app/error.tsx y
 * app/(dashboard)/error.tsx (DESIGN_SYSTEM.md §14, estados de sistema): qué
 * pasó en palabras, qué hacer, y la referencia técnica plegada.
 *
 * Antes de este límite un error de render caía en la pantalla genérica de Next
 * ("Application error: a client-side exception has occurred"), en inglés y sin
 * salida. El caso más común y más inofensivo: publicamos una actualización
 * mientras alguien tenía la página abierta, y su navegador pide un pedazo de JS
 * que ya no existe (`ChunkLoadError`). Eso se cura solo recargando, así que se
 * recarga automáticamente UNA vez (con un candado en sessionStorage para no
 * entrar en bucle si el error de verdad persiste).
 *
 * `conMarca`: en la raíz el límite reemplaza también a la cabecera y al pie, así
 * que la pantalla trae su propia firma. Dentro del dashboard la barra lateral
 * sigue en su lugar y la firma sobraría.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Map, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Cargando, EstadoError } from "@/components/patrones";
import { FranjaTextil, Marca } from "@/components/marca";

const CANDADO = "vigia_recarga_por_chunk";
const CHUNK_VIEJO = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i;

export function PantallaError({
  error,
  reset,
  conMarca = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  conMarca?: boolean;
}) {
  const [recargando, setRecargando] = useState(false);

  useEffect(() => {
    console.error("[vigia] error de render capturado:", error);
    if (CHUNK_VIEJO.test(`${error.name} ${error.message}`) && typeof window !== "undefined") {
      let yaRecargo = false;
      try { yaRecargo = window.sessionStorage.getItem(CANDADO) === "1"; } catch { /* modo privado: seguimos igual */ }
      if (!yaRecargo) {
        try { window.sessionStorage.setItem(CANDADO, "1"); } catch { /* no bloquea la recarga */ }
        setRecargando(true);
        window.location.reload();
      }
    }
  }, [error]);

  // En la raíz no hay layout debajo: el contenido principal es esta pantalla.
  const Contenedor = conMarca ? "main" : "div";

  return (
    <div className={conMarca ? "flex min-h-screen flex-col bg-paper" : undefined}>
      {conMarca && (
        <header className="border-b border-line bg-paper">
          <FranjaTextil alto={4} />
          <div className="container-page flex h-[60px] items-center">
            <Link href="/" aria-label="Vigía Perú, ir al inicio" className="rounded-lg transition-opacity duration-rapido hover:opacity-80">
              <Marca />
            </Link>
          </div>
        </header>
      )}

      <Contenedor
        {...(conMarca ? { id: "contenido", tabIndex: -1 } : {})}
        className="flex flex-1 justify-center px-4 py-12 focus:outline-none sm:px-6 sm:py-16 lg:px-10"
      >
        <div className="w-full max-w-lg">
          {recargando ? (
            <Cargando texto="Actualizamos el sitio hace un momento. Recargando…" lineas={2} />
          ) : (
            <EstadoError
              // El título del estado es el h1: esta pantalla reemplaza a la página entera.
              nivel="h1"
              titulo="Algo no cargó bien"
              detalle={error.digest ? `Referencia: ${error.digest}` : null}
              accion={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button type="button" onClick={() => reset()}>
                    <RefreshCw size={15} aria-hidden /> Reintentar
                  </Button>
                  <Link
                    href="/app/mapa"
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
                  >
                    <Map size={15} aria-hidden /> Ir al mapa
                  </Link>
                </div>
              }
            >
              Puede haber sido una actualización del sitio justo mientras tenías esta página abierta. Reintenta; si
              vuelve a pasar en el mismo lugar,{" "}
              {/* TODO(contacto): reemplazar cuando exista un correo del equipo */}
              <a
                href="https://github.com/EdwinSotto123/vigia-peru/issues"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-granate underline underline-offset-2 hover:text-granate-deep"
              >
                escríbenos<span className="sr-only"> (se abre en otra pestaña)</span>
              </a>{" "}
              contando qué estabas viendo.
            </EstadoError>
          )}
        </div>
      </Contenedor>
    </div>
  );
}
