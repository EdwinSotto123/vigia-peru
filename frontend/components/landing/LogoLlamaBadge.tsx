/**
 * El medallón de la llama, recortado del ARTE REAL del isotipo (vigia_peru.png,
 * 2816×1536) en vez de redibujado a mano — la silueta a mano (LlamaMascot, retirada)
 * se veía tosca al lado del logo real. `CROP_*` son la caja del círculo (aro textil +
 * llama) dentro del PNG completo; `size` solo cambia la escala de salida.
 */
const NATURAL_W = 2816;
const NATURAL_H = 1536;
const CROP_X = 1069;
const CROP_Y = 205;
const CROP_SIZE = 640;

export function LogoLlamaBadge({ size = 96, className = "" }: { size?: number; className?: string }) {
  const scale = size / CROP_SIZE;
  return (
    <div
      aria-hidden="true"
      className={`shrink-0 overflow-hidden rounded-full bg-paper ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: "url(/assets/logo/vigia_peru.png)",
        backgroundSize: `${NATURAL_W * scale}px ${NATURAL_H * scale}px`,
        backgroundPosition: `${-CROP_X * scale}px ${-CROP_Y * scale}px`,
      }}
    />
  );
}
