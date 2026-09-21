/**
 * Silueta de llama caminando — motivo propio de la marca (el isotipo de Vigía Perú ya
 * lleva una llama dentro de la lupa). El ciclo de paso es puramente CSS: las patas
 * delanteras y traseras rotan en direcciones opuestas desde su unión con el cuerpo
 * (`transform-origin` en cada `<g>`), y el cuerpo sube y baja levemente en la mitad del
 * ciclo — nada de librería de animación, mismo enfoque que el resto del sitio
 * (NumberTicker, PulseDot, BlurFade son CSS/RAF a mano, sin framer-motion/gsap).
 * Respeta prefers-reduced-motion vía la clase `motion-reduce:animate-none` de Tailwind.
 */
export function LlamaMascot({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 96"
      width={size}
      height={(size * 96) / 120}
      fill="currentColor"
      className={`llama-mascot motion-reduce:[&_.llama-leg]:animate-none motion-reduce:[&_.llama-body]:animate-none ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* patas traseras */}
      <g className="llama-leg llama-leg-back animate-llamaStepBack" style={{ transformOrigin: "44px 60px" }}>
        <path d="M38 60 L35 88 L31 88 L35 60 Z" />
        <path d="M50 60 L48 88 L44 88 L46 60 Z" />
      </g>
      {/* patas delanteras */}
      <g className="llama-leg llama-leg-front animate-llamaStepFront" style={{ transformOrigin: "74px 58px" }}>
        <path d="M69 58 L67 88 L63 88 L66 58 Z" />
        <path d="M81 58 L80 88 L76 88 L77 58 Z" />
      </g>

      <g className="llama-body animate-llamaBob" style={{ transformOrigin: "58px 50px" }}>
        {/* cola */}
        <path d="M32 44 Q 21 39 19 27" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" />
        {/* cuerpo */}
        <ellipse cx="57" cy="50" rx="29" ry="17" />
        {/* cuello + cabeza (perfil, mirando a la derecha) */}
        <path d="M78 39 C 85 25 89 15 93 9 L100 3 L107 8 C 100 14 94 24 89 41 Z" />
        <ellipse cx="102" cy="11" rx="9" ry="6.5" />
        {/* hocico */}
        <path d="M108 9 L117 11 L108 15 Z" />
        {/* orejas (largas, verticales — el rasgo distintivo de la llama) */}
        <path d="M96 6 Q 93 -7 98 -12 Q 102 -7 99 5 Z" />
        <path d="M104 4 Q 105 -8 110 -12 Q 113 -6 108 4 Z" />
      </g>
    </svg>
  );
}
