import { Info } from "lucide-react";

export interface DisclaimerBannerProps {
  className?: string;
}

export function DisclaimerBanner({ className }: DisclaimerBannerProps) {
  return (
    <div
      className={
        "flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ash " +
        (className ?? "")
      }
    >
      <Info size={16} className="mt-0.5 shrink-0 text-navy" />
      <p>
        <strong className="text-ink">Vigía Perú no acusa a nadie.</strong>{" "}
        Las señales que ves aquí surgen del cruce automatizado de datos públicos.
        Cada bandera roja debe ser verificada por periodistas, fiscales o la
        Contraloría antes de cualquier conclusión.
      </p>
    </div>
  );
}
