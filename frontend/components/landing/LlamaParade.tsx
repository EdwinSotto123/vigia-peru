import { Marquee } from "@/components/magicui/Marquee";
import { AndeanStripe } from "./AndeanStripe";
import { LlamaMascot } from "./LlamaMascot";

/**
 * Franja de llamas caminando entre el hero y el ticker "en vivo" — la marca ya tiene una
 * llama en el isotipo; esto le da vida sin distraer del contenido real. Reutiliza el
 * mismo Marquee que ya usa la franja de alertas, así que el loop y el patrón visual son
 * consistentes con el resto de la página. Puramente decorativo: `aria-hidden`.
 */
export function LlamaParade() {
  return (
    <div aria-hidden="true" className="overflow-hidden border-y border-line bg-warm0/40">
      <AndeanStripe />
      <Marquee className="[--duration:28s] [--gap:4rem] py-2.5" repeat={6}>
        <LlamaMascot size={34} className="text-brand/60" />
      </Marquee>
      <AndeanStripe />
    </div>
  );
}
