import type { Metadata } from "next";
import { NO_INDEXAR } from "@/lib/seo";

// Comprobantes de aporte: se comparten por enlace, no salen en un buscador (llevan el nombre de quien aporta).
export const metadata: Metadata = { robots: NO_INDEXAR };

export default function ImpactoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
