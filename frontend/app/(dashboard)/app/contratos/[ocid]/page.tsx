import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContratoDetalle } from "@/components/contratos/ContratoDetalle";
import { getContrato } from "@/lib/contratos";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ocid: string } }): Promise<Metadata> {
  const c = await getContrato(decodeURIComponent(params.ocid));
  if (!c) return { title: "Contrato — Vigía Perú" };
  const titulo = (c.titulo ?? c.codigo).slice(0, 90);
  const desc = [c.entidad, c.zona, c.montoPen ? `S/ ${Math.round(c.montoPen).toLocaleString("es-PE")}` : null].filter(Boolean).join(" · ");
  return {
    title: `${c.codigo} · ${titulo} — Vigía Perú`,
    description: desc || "Contrato público del SEACE en Vigía Perú.",
    openGraph: { title: `${c.codigo} · ${titulo}`, description: desc, type: "article" },
  };
}

/** /app/contratos/[ocid] — acepta OCID corto (1249514) o largo (ocds-dgv273-seacev3-1249514). */
export default async function ContratoPage({ params }: { params: { ocid: string } }) {
  const c = await getContrato(decodeURIComponent(params.ocid));
  if (!c) notFound();
  return (
    <div className="px-6 py-8 lg:px-10">
      <ContratoDetalle c={c} />
    </div>
  );
}
