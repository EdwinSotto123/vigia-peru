/**
 * Recorte directo de referencias/fondollama.jpg (provisto por el usuario como
 * referencia visual — 1024x481) — la llama + fondo de Machu Picchu que pidió usar tal
 * cual, no un dibujo nuevo: background-position/-size sobre el archivo real, sin
 * regenerar arte (no hay herramienta de generación de imágenes disponible).
 */
const NATURAL_W = 1024;
const NATURAL_H = 481;
const CROP_X = 600;
const CROP_Y = 0;
const CROP_W = 424;
const CROP_H = 481;

export function LlamaHero({ width = 260, className = "" }: { width?: number; className?: string }) {
  const scale = width / CROP_W;
  const height = CROP_H * scale;
  return (
    <div
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={{
        width,
        height,
        backgroundImage: "url(/assets/referencias/fondollama.jpg)",
        backgroundSize: `${NATURAL_W * scale}px ${NATURAL_H * scale}px`,
        backgroundPosition: `${-CROP_X * scale}px ${-CROP_Y * scale}px`,
        maskImage: "linear-gradient(to bottom, black 82%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 82%, transparent 100%)",
      }}
    />
  );
}
