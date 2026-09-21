/**
 * Franja decorativa inspirada en el borde textil andino del isotipo (el aro de colores
 * alrededor de la lupa/llama en el logo). Puramente ornamental — `aria-hidden` — y hecha
 * con un solo `repeating-linear-gradient` en los colores que YA existen en la paleta
 * (marca, alerta, ámbar, verificado, terracota): sin imagen ni SVG adicional que cargar.
 */
export function AndeanStripe({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-[5px] w-full ${className}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, #6E1F2F 0 16px, #CF3A2C 16px 28px, #BE7B26 28px 40px, #3F7D43 40px 48px, #B26A2E 48px 64px)",
      }}
    />
  );
}
