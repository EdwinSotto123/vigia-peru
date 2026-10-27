import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ContratoDetalle } from "@/components/contratos/ContratoDetalle";
import { VistasContrato } from "@/components/contratos/VistasContrato";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { DossierCliente } from "@/components/convocatoria/DossierCliente";
import { ResultadoView } from "@/components/convocatoria/ResultadoView";
import { getProcesamiento } from "@/lib/auditoria";
import { cargarDossier, idLegible } from "@/lib/dossier-servidor";
import { rutaContrato, type VistaContrato } from "@/lib/rutas";
import { recortar as corto } from "@/components/contratos/recortar";
import { Pagina } from "@/components/patrones";
import { leerDesde } from "@/lib/desde";
import { getContratos, getResumenContratos, getResumenVivo, resolverContrato } from "@/lib/contratos";
import { getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { soles } from "@/lib/formato";
import { OG_BASE, TWITTER_BASE } from "@/lib/compartir";

export const revalidate = 60;

/** Las pestañas del dictamen que existen (`?tab=`); cualquier otra abre la primera. */
const TABS_DICTAMEN = new Set(["resumen", "dictamen", "items", "proveedor", "documentos", "prensa", "trace"]);

const vistaDe = (v: unknown): VistaContrato => (v === "dictamen" || v === "vivo" ? v : "ficha");

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { ocid: string };
  searchParams?: { vista?: string | string[] };
}): Promise<Metadata> {
  const { contrato: c } = await resolverContrato(decodeURIComponent(params.ocid));
  if (!c) return { title: "Contrato no encontrado" };
  const vista = vistaDe(searchParams?.vista);
  // Solo la parte de la página: el layout raíz agrega " | Vigía Perú".
  const objeto = corto(c.titulo ?? `Contrato ${c.codigo}`, 70);
  const base = c.entidad ? `${objeto}, ${corto(c.entidad, 48)}` : objeto;
  const titulo = vista === "dictamen" ? `Análisis: ${base}` : vista === "vivo" ? `${base}, lectura en vivo` : base;
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
 * /app/contratos/[ocid]: LA página de un contrato. Acepta el OCID (2026-425-9, 1249514), el OCID largo
 * (ocds-dgv273-seacev3-1249514) o el código SEACE (1235259), que redirige a su OCID.
 *   · ficha (por defecto); `?seccion=` abre esa pestaña (items, participantes, postores, adjudicacion, precios,
 *     cronograma, citas, documentos);
 *   · `?vista=dictamen` (`&tab=`): el informe de la lectura, armado en el servidor (antes /app/convocatoria/[id]);
 *   · `?vista=vivo`: la lectura en vivo (antes /app/auditoria/[ocid]).
 * Las tres llevan arriba el selector de vistas (VistasContrato) con las que existen.
 */
export default async function ContratoPage({
  params,
  searchParams,
}: {
  params: { ocid: string };
  searchParams?: { seccion?: string | string[]; vista?: string | string[]; tab?: string | string[]; desde?: string | string[] };
}) {
  const param = decodeURIComponent(params.ocid);
  const seccion = typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined;
  const desde = leerDesde(searchParams);
  const vista = vistaDe(searchParams?.vista);
  const tab = typeof searchParams?.tab === "string" && TABS_DICTAMEN.has(searchParams.tab) ? searchParams.tab : undefined;
  const [{ contrato: c, redirigirA }, vivo, catalogo] = await Promise.all([
    resolverContrato(param),
    getResumenVivo(),
    getCatalogoReglas().catch(() => ({}) as CatalogoReglas),
  ]);
  // La pestaña pedida sobrevive a la redirección del código SEACE a su OCID.
  if (redirigirA) redirect(rutaContrato(redirigirA, vista, { seccion, tab }));
  if (!c) {
    // El dictamen también se pide por el código de la alerta (OECE-…): su propio estado de "no encontrado".
    if (vista === "dictamen") return <VistaDictamen id={param} tab={tab ?? null} />;
    notFound();
  }
  const selector = <VistasContrato ocid={c.ocid} actual={vista} dictamen={!!c.alerta} vivo={!!c.procesamiento} />;
  if (vista === "dictamen") return <VistaDictamen id={c.ocid} tab={tab ?? null} selector={selector} />;
  if (vista === "vivo") {
    const data = await getProcesamiento(c.ocid);
    if (!data) redirect(rutaContrato(c.ocid));
    return (
      <Pagina className="space-y-4">
        {selector}
        <ContratoEnVivo ocid={c.ocid} initial={{ ...data, eventos: Array.isArray(data.eventos) ? data.eventos : [] }} />
      </Pagina>
    );
  }
  // La columna lateral (otros contratos de la entidad, sus cifras y contratos parecidos de la provincia) se pide YA,
  // pero no se espera: ContratoDetalle la pinta por streaming cuando llega. Antes la ficha esperaba esta segunda
  // ronda de consultas antes de mandar el primer byte.
  const provincia = c.ubigeo && c.ubigeo.length >= 4 ? c.ubigeo.slice(0, 4) : null;
  const relacionados = c.entidadRuc
    ? getContratos({ entidad: c.entidadRuc, size: 9, orden: "fecha" })
        .then((otros) => (otros ? { contratos: otros.data.filter((x) => x.ocid !== c.ocid).slice(0, 8), total: Math.max(0, otros.total - 1) } : null))
        .catch(() => null)
    : null;
  const entidadEnVigia = c.entidadRuc
    ? getResumenContratos({ entidad: c.entidadRuc })
        .then((r) =>
          r
            ? {
                total: r.total,
                leidos: r.total - (r.porRiesgo.sin_analizar ?? 0),
                conSenales: (r.porRiesgo.alto ?? 0) + (r.porRiesgo.medio ?? 0),
                // De los no leídos (la API vieja sólo trae porOperativo, que cuenta también a los leídos).
                esperando: (r.porOperativoSinLeer ?? r.porOperativo).en_cola ?? 0,
                listos: r.porOperativoSinLeer?.documentos_listos ?? 0,
              }
            : null,
        )
        .catch(() => null)
    : null;
  // Contratos del mismo tipo en la misma provincia, de otras entidades: con qué se puede comparar este.
  const parecidos =
    provincia && c.tipo
      ? getContratos({ ubigeo: provincia, tipo: c.tipo, size: 9, orden: "fecha" })
          .then((pp) =>
            pp ? { contratos: pp.data.filter((x) => x.ocid !== c.ocid && x.entidadRuc !== c.entidadRuc).slice(0, 5), total: pp.total, provincia } : null,
          )
          .catch(() => null)
      : null;
  return (
    <Pagina>
      <ContratoDetalle vistas={selector} c={c} alcance={vivo?.procesamientoActivo ?? null} catalogo={catalogo} seccion={seccion} relacionados={relacionados} entidadEnVigia={entidadEnVigia} parecidos={parecidos} desde={desde} />
    </Pagina>
  );
}

/** El informe de la lectura, armado en el servidor (lib/dossier-servidor.ts); sus estados de error, en DossierCliente. */
async function VistaDictamen({ id, tab, selector }: { id: string; tab: string | null; selector?: React.ReactNode }) {
  const carga = await cargarDossier(id);
  if (carga.estado === "ok") {
    return (
      <Pagina className="space-y-4">
        {selector}
        <ResultadoView result={carga.result} tabInicial={tab} />
      </Pagina>
    );
  }
  // Sólo datos planos hacia el client component: nunca una función.
  return (
    <DossierCliente
      id={idLegible(id)}
      inicial={carga.estado === "error" ? "error" : carga.demo ? "demo" : "not_found"}
      mensaje={carga.estado === "error" ? carga.mensaje : undefined}
      tabInicial={tab}
    />
  );
}
