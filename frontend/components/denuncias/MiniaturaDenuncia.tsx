"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

/**
 * La foto de una denuncia en su fila (40 px). Es cliente sólo por el `onError`: una
 * foto que ya no existe muestra la cámara en vez del ícono roto del navegador. Si
 * falló antes de hidratar (el `onError` todavía no estaba), se detecta al montar.
 * Decorativa: la fila se lee por su texto.
 */
export function MiniaturaDenuncia({ src }: { src: string | null }) {
  const [falla, setFalla] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFalla(true);
  }, [src]);
  return (
    <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-paperDeep text-mute sm:flex">
      {src && !falla ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={src} alt="" loading="lazy" onError={() => setFalla(true)} className="h-full w-full object-cover" />
      ) : (
        <Camera size={14} />
      )}
    </span>
  );
}
