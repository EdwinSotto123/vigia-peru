"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";

/**
 * Compartir una página de Vigía (DESIGN_SYSTEM.md §14.5): el perfil de un aliado, un
 * comprobante, un informe. Enlaces directos a cada red (funcionan sin JS y sin permisos) +
 * copiar el enlace + la hoja nativa del teléfono cuando existe.
 *
 * `ruta` es relativa ("/aliado/mi-empresa"): la URL absoluta se arma con el origen actual,
 * así sirve igual en local, en la previsualización y en producción.
 *
 * `compacto`: un solo botón "Compartir" que abre las mismas opciones en un flotante (para
 * tarjetas y barras de acciones, donde la fila completa no cabe). En el celular, si existe,
 * abre directo la hoja nativa.
 */
export function BarraCompartir({
  ruta,
  texto,
  titulo,
  variante = "claro",
  compacto = false,
  className,
}: {
  ruta: string;
  /** El mensaje que acompaña al enlace: "Mi empresa financia la lectura de contratos públicos en Vigía Perú". */
  texto: string;
  titulo?: string;
  variante?: "claro" | "oscuro";
  compacto?: boolean;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  // El origen y la hoja nativa se conocen sólo en el navegador: se leen después de montar,
  // así el primer render es idéntico en el servidor y en el cliente (sin error de hidratación).
  const [origen, setOrigen] = useState("");
  const [nativa, setNativa] = useState(false);
  useEffect(() => {
    setOrigen(window.location.origin);
    setNativa(typeof navigator.share === "function");
  }, []);
  const url = () => (origen ? new URL(ruta, origen).toString() : ruta);
  const enc = encodeURIComponent;
  const redes = [
    { nombre: "WhatsApp", href: () => `https://wa.me/?text=${enc(`${texto} ${url()}`)}`, letra: "WA" },
    { nombre: "Facebook", href: () => `https://www.facebook.com/sharer/sharer.php?u=${enc(url())}`, letra: "f" },
    { nombre: "LinkedIn", href: () => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url())}`, letra: "in" },
    { nombre: "X", href: () => `https://x.com/intent/post?text=${enc(texto)}&url=${enc(url())}`, letra: "X" },
  ];
  const oscuro = variante === "oscuro";
  const boton = cn(
    "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors duration-rapido",
    oscuro ? "border-paper/25 text-paper hover:bg-paper/10" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
  );

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    } catch {
      /* sin permiso de portapapeles: los enlaces de cada red siguen sirviendo */
    }
  };
  const nativo = async () => {
    try {
      await navigator.share({ title: titulo ?? texto, text: texto, url: url() });
    } catch {
      /* el usuario cerró la hoja: nada que hacer */
    }
  };

  if (compacto) {
    const opcion = "flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 text-[14px] text-ink transition-colors duration-rapido hover:bg-granate-50";
    return nativa ? (
      <button type="button" onClick={nativo} className={cn(boton, className)}>
        <Share2 size={15} aria-hidden /> Compartir
      </button>
    ) : (
      <Popover
        titulo="Compartir"
        lado="abajo"
        anchoClase="w-60"
        className={cn(boton, className)}
        trigger={
          <>
            <Share2 size={15} aria-hidden /> Compartir
          </>
        }
      >
        <span className="block space-y-0.5">
          {redes.map((r) => (
            <a key={r.nombre} href={r.href()} target="_blank" rel="noopener noreferrer" className={opcion}>
              <span aria-hidden className="w-5 font-display text-[12px] font-extrabold text-granate">
                {r.letra}
              </span>
              {r.nombre}
            </a>
          ))}
          <button type="button" onClick={copiar} className={opcion} aria-live="polite">
            {copiado ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
            {copiado ? "Enlace copiado" : "Copiar enlace"}
          </button>
        </span>
      </Popover>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {nativa && (
        <button type="button" onClick={nativo} className={cn(boton, "sm:hidden")}>
          <Share2 size={15} aria-hidden /> Compartir
        </button>
      )}
      {redes.map((r) => (
        <a
          key={r.nombre}
          href={r.href()}
          target="_blank"
          rel="noopener noreferrer"
          className={boton}
        >
          <span aria-hidden className={cn("font-display text-[12px] font-extrabold", oscuro ? "text-maiz" : "text-granate")}>
            {r.letra}
          </span>
          {r.nombre}
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      ))}
      <button type="button" onClick={copiar} className={boton} aria-live="polite">
        {copiado ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
        {copiado ? "Enlace copiado" : "Copiar enlace"}
      </button>
    </div>
  );
}
