import type { Metadata } from "next";

// La página es un client component (usa useSearchParams): el título vive acá.
export const metadata: Metadata = { title: "Crear cuenta", robots: { index: false } };

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
