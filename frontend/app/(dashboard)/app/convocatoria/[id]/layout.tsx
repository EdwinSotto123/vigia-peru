import type { Metadata } from "next";

/**
 * Envoltorio de servidor del dossier: la página es un client component (lee el
 * análisis en el navegador), así que el título que ve quien recibe el enlace
 * compartido se arma acá, con la ficha liviana del contrato (/contratos/{id},
 * ~16 KB) y no con el análisis completo (~400 KB).
 */

const API_BASE =
  process.env.VIGIA_API_URL || process.env.NEXT_PUBLIC_VIGIA_API_URL || "https://vigia-peru-api-36169102688.us-central1.run.app";

const recortar = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const corte = t.slice(0, n);
  const esp = corte.lastIndexOf(" ");
  return (esp > n * 0.6 ? corte.slice(0, esp) : corte) + "…";
};

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const id = decodeURIComponent(params.id || "").replace(/^OECE-/i, "").trim();
  const base: Metadata = { title: `Análisis del contrato ${id}` };
  if (!id || /^ALT-/i.test(id)) return base;
  try {
    const r = await fetch(`${API_BASE}/contratos/${encodeURIComponent(id)}`, { next: { revalidate: 600 } } as RequestInit);
    if (!r.ok) return base;
    const c = await r.json();
    const objeto = typeof c?.titulo === "string" && c.titulo.trim() ? c.titulo : typeof c?.descripcion === "string" ? c.descripcion : "";
    const entidad = typeof c?.entidad === "string" ? c.entidad : "";
    if (!objeto && !entidad) return base;
    const title = [objeto && recortar(objeto, 70), entidad && recortar(entidad, 45)].filter(Boolean).join(", ");
    const description = `Análisis de riesgo del contrato ${id}${entidad ? ` de ${entidad}` : ""}: señales, precios de mercado, documentos y red de personas, con su fuente.`;
    return {
      title,
      description,
      openGraph: { title, description },
    };
  } catch {
    return base;
  }
}

export default function DossierLayout({ children }: { children: React.ReactNode }) {
  return children;
}
