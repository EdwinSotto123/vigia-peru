import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ContratoDetalle } from "@/components/contratos/ContratoDetalle";
import { recortar as corto } from "@/components/contratos/recortar";
import { Pagina } from "@/components/patrones";
import { getContratos, getResumenContratos, getResumenVivo, resolverContrato } from "@/lib/contratos";
import { getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { soles } from "@/lib/formato";
import { OG_BASE, TWITTER_BASE } from "@/lib/compartir";

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
    openGraph: { ...OG_BASE, title: titulo, description: desc, type: "article" },
    twitter: { ...TWITTER_BASE, title: titulo, description: desc },
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
  // La columna lateral trae los demás contratos de la misma entidad: datos reales, una línea cada uno.
  const provincia = c.ubigeo && c.ubigeo.length >= 4 ? c.ubigeo.slice(0, 4) : null;
  const [otros, resumenEntidad, parecidosPagina] = await Promise.all([
    c.entidadRuc ? getContratos({ entidad: c.entidadRuc, size: 9, orden: "fecha" }).catch(() => null) : null,
    c.entidadRuc ? getResumenContratos({ entidad: c.entidadRuc }).catch(() => null) : null,
    // Contratos del mismo tipo en la misma provincia, de otras entidades: con qué se puede comparar este.
    provincia && c.tipo ? getContratos({ ubigeo: provincia, tipo: c.tipo, size: 9, orden: "fecha" }).catch(() => null) : null,
  ]);
  const parecidos = parecidosPagina
    ? {
        contratos: parecidosPagina.data.filter((x) => x.ocid !== c.ocid && x.entidadRuc !== c.entidadRuc).slice(0, 5),
        total: parecidosPagina.total,
        provincia,
      }
    : null;
  const relacionados = otros ? { contratos: otros.data.filter((x) => x.ocid !== c.ocid).slice(0, 8), total: Math.max(0, otros.total - 1) } : null;
  const entidadEnVigia = resumenEntidad
    ? {
        total: resumenEntidad.total,
        leidos: resumenEntidad.total - (resumenEntidad.porRiesgo.sin_analizar ?? 0),
        conSenales: (resumenEntidad.porRiesgo.alto ?? 0) + (resumenEntidad.porRiesgo.medio ?? 0),
        esperando: resumenEntidad.porOperativo.en_cola ?? 0,
      }
    : null;
  return (
    <Pagina>
      <ContratoDetalle c={c} alcance={vivo?.procesamientoActivo ?? null} catalogo={catalogo} seccion={seccion} relacionados={relacionados} entidadEnVigia={entidadEnVigia} parecidos={parecidos} />
    </Pagina>
  );
}
