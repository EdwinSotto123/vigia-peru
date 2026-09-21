import { AndeanStripe } from "./AndeanStripe";
import { LogoLlamaBadge } from "./LogoLlamaBadge";

/**
 * Reemplaza a LlamaParade (retirada): en vez de una silueta dibujada a mano repetida
 * seis veces, un solo medallón con el arte real del isotipo, flotando suave — menos es
 * más cuando la pieza es la marca misma, no una ocurrencia nueva.
 */
export function MascotBand() {
  return (
    <div className="overflow-hidden border-y border-line bg-warm0/40">
      <AndeanStripe />
      <div className="flex items-center justify-center gap-3 py-3">
        <LogoLlamaBadge size={44} className="animate-floatYSm shadow-sm ring-1 ring-black/10" />
        <p className="font-serif text-sm italic text-inkSoft">El vigía andino no se distrae.</p>
      </div>
      <AndeanStripe />
    </div>
  );
}
