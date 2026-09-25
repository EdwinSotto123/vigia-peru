import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ContratoDetalle } from "@/components/contratos/ContratoDetalle";
import { recortar as corto } from "@/components/contratos/recortar";
import { Pagina } from "@/components/patrones";
import { getResumenVivo, resolverContrato } from "@/lib/contratos";
import { getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { soles } from "@/lib/formato";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ocid: string } }): Promise<Metadata> {
  const { contrato: c } = await resolverContrato(decodeURIComponent(params.ocid));
  if (!c) return { title: "Contrato no encontrado" };
  // Solo la parte de la página: el layout raíz agrega " | Vigía Perú".
  const objeto = corto(c.titulo ?? `Contrato ${c.codigo}`, 70);
  const titulo = c.entidad ? `${objeto}, ${corto(c.entidad, 48)}` : objeto;
  const desc = [
    c.entidad,
    c.zona,
    c.montoPen ? `valor referencial ${soles(c.montoPen)}` : null,
    `código SEACE ${c.codigo}`,
  ].filter(Boolean).join(", ");
  return {
    title: titulo,
    description: desc || "Contrato público del SEACE en Vigía Perú.",
    openGraph: { title: titulo, description: desc, type: "article" },
  };
}

/**
 * /app/contratos/[ocid]: acepta el OCID (2026-425-9, 1249514), el OCID largo
 * (ocds-dgv273-seacev3-1249514) o el código SEACE (1235259), que redirige a su OCID.
 * `?seccion=` abre esa pestaña de la ficha (items, postores, precios, citas, documentos).
 */
export default async function ContratoPage({
  params,
  searchParams,
}: {
  params: { ocid: string };
  searchParams?: { seccion?: string | string[] };
}) {
  const param = decodeURIComponent(params.ocid);
  const seccion = typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined;
  const [{ contrato: c, redirigirA }, vivo, catalogo] = await Promise.all([
    resolverContrato(param),
    getResumenVivo(),
    getCatalogoReglas().catch(() => ({}) as CatalogoReglas),
  ]);
  // La pestaña pedida sobrevive a la redirección del código SEACE a su OCID.
  if (redirigirA) redirect(`/app/contratos/${encodeURIComponent(redirigirA)}${seccion ? `?seccion=${encodeURIComponent(seccion)}` : ""}`);
  if (!c) notFound();
  return (
    <Pagina>
      <ContratoDetalle c={c} alcance={vivo?.procesamientoActivo ?? null} catalogo={catalogo} seccion={seccion} />
    </Pagina>
  );
}
