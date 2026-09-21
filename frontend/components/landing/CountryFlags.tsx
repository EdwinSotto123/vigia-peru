/**
 * Banderas simplificadas (mismo viewBox 0 0 3 2 para todas, así se alinean en fila).
 * Colores oficiales; el escudo de México y el detalle fino de Paraguay se omiten a
 * este tamaño — convención estándar de cualquier set de banderas en ícono pequeño —
 * pero la estructura de franjas y el cantón+estrella de Chile sí se mantienen, porque
 * sin eso la bandera deja de ser reconocible como tal.
 */

type FlagProps = { size?: number; className?: string };
const vb = "0 0 3 2";

export function PeruFlag({ size = 28, className = "" }: FlagProps) {
  return (
    <svg viewBox={vb} width={size} height={(size * 2) / 3} className={className} aria-hidden="true">
      <rect width="3" height="2" fill="#D91023" />
      <rect x="1" width="1" height="2" fill="#FFFFFF" />
    </svg>
  );
}

export function ColombiaFlag({ size = 28, className = "" }: FlagProps) {
  return (
    <svg viewBox={vb} width={size} height={(size * 2) / 3} className={className} aria-hidden="true">
      <rect width="3" height="2" fill="#FCD116" />
      <rect y="1" width="3" height="0.5" fill="#003893" />
      <rect y="1.5" width="3" height="0.5" fill="#CE1126" />
    </svg>
  );
}

export function ChileFlag({ size = 28, className = "" }: FlagProps) {
  return (
    <svg viewBox={vb} width={size} height={(size * 2) / 3} className={className} aria-hidden="true">
      <rect width="3" height="1" fill="#FFFFFF" />
      <rect y="1" width="3" height="1" fill="#D52B1E" />
      <rect width="1.5" height="1" fill="#0039A6" />
      <polygon
        fill="#FFFFFF"
        points="0.75,0.20 0.8176,0.4070 1.0353,0.4073 0.8594,0.5355 0.9263,0.7427 0.75,0.615 0.5737,0.7427 0.6406,0.5355 0.4647,0.4073 0.6824,0.4070"
      />
    </svg>
  );
}

export function MexicoFlag({ size = 28, className = "" }: FlagProps) {
  return (
    <svg viewBox={vb} width={size} height={(size * 2) / 3} className={className} aria-hidden="true">
      <rect width="1" height="2" fill="#006847" />
      <rect x="1" width="1" height="2" fill="#FFFFFF" />
      <rect x="2" width="1" height="2" fill="#CE1126" />
    </svg>
  );
}

export function ParaguayFlag({ size = 28, className = "" }: FlagProps) {
  return (
    <svg viewBox={vb} width={size} height={(size * 2) / 3} className={className} aria-hidden="true">
      <rect width="3" height="0.667" fill="#D52B1E" />
      <rect y="0.667" width="3" height="0.667" fill="#FFFFFF" />
      <rect y="1.333" width="3" height="0.667" fill="#0038A8" />
    </svg>
  );
}
