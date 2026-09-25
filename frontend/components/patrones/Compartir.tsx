"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compartir una página de Vigía (DESIGN_SYSTEM.md §14.5): el perfil de un aliado, un
 * comprobante, un informe. Enlaces directos a cada red (funcionan sin JS y sin permisos) +
 * copiar el enlace + la hoja nativa del teléfono cuando existe.
 *
 * `ruta` es relativa ("/aliado/mi-empresa"): la URL absoluta se arma con el origen actual,
 * así sirve igual en local, en la previsualización y en producción.
 */
export function BarraCompartir({
  ruta,
  texto,
  titulo,
  variante = "claro",
  className,
}: {
  ruta: string;
  /** El mensaje que acompaña al enlace: "Mi empresa financia la lectura de contratos públicos en Vigía Perú". */
  texto: string;
  titulo?: string;
  variante?: "claro" | "oscuro";
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
