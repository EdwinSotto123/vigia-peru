import { cn } from "@/lib/utils";

/**
 * La llamita de Vigía (DESIGN_SYSTEM.md §2): la MISMA llama blanca del isotipo
 * (public/assets/logo/lupa-llama.webp), vectorizada desde el logo —su ojo, sus dos
 * orejas y su paso alerta—, no un dibujo nuevo. 100 vértices, ~1 KB: se colorea con
 * `currentColor`, escala sin perder nitidez y sirve desde 16 px.
 *
 * Mira siempre a la derecha, hacia el contenido. Acompaña vacíos, esperas y errores;
 * nunca aparece junto a una señal, una entidad o una persona: la llamita vigila, la
 * evidencia acusa (o no).
 *
 * Sin `titulo` es decorativa (aria-hidden). Con `titulo`, se anuncia como imagen.
 * `caminando` la hace dar pasitos en su lugar (se detiene con prefers-reduced-motion).
 */
export const LLAMITA_PATH =
  "M23.6 63.7 22.3 67.4 16.3 73.7 16.3 79.1 26.7 96.8 32.3 97.7 32.6 97.2 31.4 95.1 29.1 94.2 28.2 93.3 22.1 79.8 22.1 79.1 28.7 66.5 28.4 65.9ZM58.7 62.1 53.2 69.2 60.3 74.2 60.6 74.8 56.6 83.2 55.8 83.9 53.1 84.8 53.2 89.3 57 87 59.3 85 65.1 76.6 66.1 74.6 65.1 71.2 59.8 63.8 59.5 62.7ZM61.2 3.2 60.6 3.4 59.4 4.3 58.3 5.5 58.1 5.9 58 7.8 58.1 8.1 58.5 8.4 58.7 8.5 59 8.6 59.4 8.8 59.8 8.8 59.9 8.6 60 8 60.6 6.4 60.7 5.9 60.8 5.5 61.2 3.9 61.3 3.7 61.3 3.4ZM56 2.4 52 6.6 46.4 38.9 7.1 39.5 3 42.3 2.4 50.6 8.2 45.8 6.5 49.5 6.3 67.8 2.3 76.4 2.5 84.8 5 87.2 7.2 79.1 20 66 22.5 60.3 41.7 68.1 42 97.6 47 97 45.1 92.2 50.8 68.2 62.2 53.8 60.9 26.9 55.8 21 62 22.3 70 20.4 71.9 17.9 70.8 14.8 56.2 10ZM58.2 13.9 58.5 13.6 58.7 13.5 59.5 13.5 59.5 13.4 59.7 13.4 59.9 13.3 60.4 13.3 60.6 13.4 60.9 13.5 61.3 13.7 61.7 14.1 61.7 14.3 61.6 14.6 61.2 14.7 60.8 15.1 60.6 15.2 60.1 15.5 59.7 15.5 59.2 15.3 58.4 14.6 58.1 14.2 58.1 14Z";

export function Llamita({
  className,
  titulo,
  caminando = false,
}: {
  className?: string;
  titulo?: string;
  caminando?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 74 100"
      fill="currentColor"
      className={cn("h-auto w-10 shrink-0", caminando && "motion-safe:animate-caminar", className)}
      {...(titulo ? { role: "img", "aria-label": titulo } : { "aria-hidden": true })}
      focusable="false"
    >
      {titulo && <title>{titulo}</title>}
      <path fillRule="evenodd" d={LLAMITA_PATH} />
    </svg>
  );
}
