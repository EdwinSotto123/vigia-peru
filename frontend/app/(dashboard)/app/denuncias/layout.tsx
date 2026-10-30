import type { Metadata } from "next";
import { NO_INDEXAR } from "@/lib/seo";

// Las denuncias ciudadanas no están verificadas: se ven en Vigía, pero no salen en un buscador.
export const metadata: Metadata = { robots: NO_INDEXAR };

export default function DenunciasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
