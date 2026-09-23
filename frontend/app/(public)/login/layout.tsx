import type { Metadata } from "next";

// La página es un client component (usa useSearchParams): el título vive acá.
export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
