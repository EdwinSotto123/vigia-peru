import type { Metadata } from "next";

/** La página es un client component (necesita la sesión): el título vive acá. */
export const metadata: Metadata = {
  title: "Mi impacto",
  description: "Tus aportes con su progreso en vivo, tus denuncias y las zonas que sigues.",
  robots: { index: false, follow: false },
};

export default function MiImpactoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
