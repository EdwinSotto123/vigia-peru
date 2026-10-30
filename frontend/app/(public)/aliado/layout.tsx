import type { Metadata } from "next";
import { NO_INDEXAR } from "@/lib/seo";

// El perfil de un aliado se comparte por enlace; no sale en un buscador (puede ser una persona).
export const metadata: Metadata = { robots: NO_INDEXAR };

export default function AliadoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
