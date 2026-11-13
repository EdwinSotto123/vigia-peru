import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pagina } from "@/components/gobserva/app/Caja";
import { Cabecera } from "@/components/licitaciones-app/detalle/Cabecera";
import { PestanaAnalisis } from "@/components/licitaciones-app/detalle/PestanaAnalisis";
import { PestanaAsistente } from "@/components/licitaciones-app/detalle/PestanaAsistente";
import { PestanaCronograma } from "@/components/licitaciones-app/detalle/PestanaCronograma";
import { PestanaDocumentos } from "@/components/licitaciones-app/detalle/PestanaDocumentos";
import { PestanaItems } from "@/components/licitaciones-app/detalle/PestanaItems";
import { PestanaResumen } from "@/components/licitaciones-app/detalle/PestanaResumen";
import { PestanaHistorial, PestanaNotas, PestanaPostulacion } from "@/components/licitaciones-app/detalle/PestanasCliente";
import { Pestanas, leerPestana, type Pestana } from "@/components/licitaciones-app/detalle/Pestanas";
import { AvisoDemo } from "@/components/gobserva/ui/AvisoDemo";
import { limpiar } from "@/lib/licitaciones";
import { leerFiltros, aParams } from "@/lib/licitaciones-app/filtros";
import { instante } from "@/lib/licitaciones-app/formato";
import { getFuente } from "@/lib/licitaciones-app/fuente";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

type Props = { params: { id: string }; searchParams?: { tab?: string; volver?: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const o = await getFuente().oportunidad(decodeURIComponent(params.id));
  return { title: o ? `${o.codigo ?? o.id}: ${limpiar(o.objeto).slice(0, 60)}` : "Proceso no encontrado", robots: { index: false, follow: false } };
}

/**
 * El detalle de un proceso: la cabecera con lo que decide si mirar más, y ocho pestañas en la URL (?tab=). «Bandeja»
 * vuelve con los mismos filtros (?volver=, la búsqueda de la bandeja tal cual, validada).
 */
export default async function Detalle({ params, searchParams }: Props) {
  const base = baseProducto("licitaciones");
  const id = decodeURIComponent(params.id);
  const o = await getFuente().oportunidad(id);
  if (!o) notFound();

  const tab = leerPestana(searchParams?.tab);
  // La vuelta se rearma desde los filtros (nunca se usa un texto cualquiera como enlace).
  const volverQs = searchParams?.volver ? aParams(leerFiltros(new URLSearchParams(searchParams.volver))).toString() : "";
  const volver = rutaEn(base, `/app/bandeja${volverQs ? `?${volverQs}` : ""}`);
  const href = (p: Pestana) => {
    const q = new URLSearchParams();
    if (p !== "resumen") q.set("tab", p);
    if (volverQs) q.set("volver", volverQs);
    const s = q.toString();
    return rutaEn(base, `/app/oportunidad/${encodeURIComponent(o.id)}${s ? `?${s}` : ""}`);
  };
  const ahora = Date.now();
  const titulo = limpiar(o.objeto) || null;
  const eventos = [
    { fecha: new Date(instante(o.publicada, "inicio")).toISOString(), texto: "La entidad publicó la convocatoria en el SEACE." },
    ...(o.consultasHasta && instante(o.consultasHasta) < ahora ? [{ fecha: new Date(instante(o.consultasHasta)).toISOString(), texto: "Cerró el plazo de consultas y observaciones." }] : []),
  ];

  return (
    <Pagina>
      <AvisoDemo tomada={getFuente().tomada} />
      <Cabecera o={o} volver={volver} ahora={ahora} />
      <Pestanas
        actual={tab}
        href={href}
        cuentas={{ items: o.itemsDetalle.length, documentos: o.documentos.length, analisis: o.senales.filter((s) => s.nivel !== "info").length }}
      />
      <div id="pestana" role="region" aria-label={`Pestaña ${tab}`}>
        {tab === "resumen" && <PestanaResumen o={o} ahora={ahora} href={href} />}
        {tab === "items" && <PestanaItems o={o} />}
        {tab === "documentos" && <PestanaDocumentos o={o} />}
        {tab === "cronograma" && <PestanaCronograma o={o} ahora={ahora} />}
        {tab === "analisis" && <PestanaAnalisis o={o} />}
        {tab === "asistente" && <PestanaAsistente id={o.id} />}
        {tab === "notas" && <PestanaNotas id={o.id} titulo={titulo} />}
        {tab === "historial" && <PestanaHistorial id={o.id} eventos={eventos} />}
        {tab === "postulacion" && <PestanaPostulacion id={o.id} codigo={o.codigo} titulo={titulo} />}
      </div>
    </Pagina>
  );
}
