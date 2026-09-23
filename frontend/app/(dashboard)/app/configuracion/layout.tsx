import type { Metadata } from "next";

// La página es un client component: el título vive acá.
export const metadata: Metadata = { title: "Tu cuenta", robots: { index: false } };

export default function ConfiguracionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
