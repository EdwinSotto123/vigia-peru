import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ContratoDetalle, ETIQUETAS_FICHA } from "@/components/contratos/ContratoDetalle";
import { CabeceraContrato, antecedentesEnCabecera } from "@/components/contratos/CabeceraContrato";
import { VistasContrato, type VistaDisponible } from "@/components/contratos/VistasContrato";
import { fichaConSenalesQueCuentan, lecturaDelContrato, procesamientoConSenalesQueCuentan } from "@/components/contratos/lecturaContrato";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { DossierCliente } from "@/components/convocatoria/DossierCliente";
import { ResultadoView } from "@/components/convocatoria/ResultadoView";
import { TrazaContrato } from "@/components/convocatoria/TrazaContrato";
import { ETIQUETAS_DICTAMEN, PRIMERA_DICTAMEN, esClaveDictamen } from "@/components/convocatoria/pestanasDictamen";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { NotaPrivacidad } from "@/components/privacidad/NotaPrivacidad";
import { getProcesamiento } from "@/lib/auditoria";
import { cargarDossier, idLegible } from "@/lib/dossier-servidor";
import { rutaContrato, type VistaContrato } from "@/lib/rutas";
import { canonica } from "@/lib/seo";
import { limpiarObjeto, recortar as corto } from "@/components/contratos/recortar";
import { EstadoError, Nota, Pagina } from "@/components/patrones";
import { leerDesde, migasConDesde } from "@/lib/desde";
import { getContratos, getResumenContratos, getResumenVivo, resolverContrato } from "@/lib/contratos";
import { getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { soles } from "@/lib/formato";
import { OG_BASE, TWITTER_BASE } from "@/lib/compartir";

export const revalidate = 60;

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
  // Solo la parte de la página: el layout raíz agrega " | Vigía by Gobserva".
  // Sin los «¿» que el SEACE dejó donde iban comillas (la pestaña del navegador también lo muestra).
  const objeto = corto(c.titulo ? limpiarObjeto(c.titulo) : `Contrato ${c.codigo}`, 70);
  const base = c.entidad ? `${objeto}, ${corto(c.entidad, 48)}` : objeto;
  const titulo = vista === "dictamen" ? `Análisis: ${base}` : vista === "vivo" ? `${base}, cómo se leyó` : base;
  const desc = [
    c.entidad,
    c.zona,
    c.montoPen ? `valor referencial ${soles(c.montoPen)}` : null,
    `código SEACE ${c.codigo}`,
  ].filter(Boolean).join(", ");
  return {
    title: titulo,
    description: desc || "Contrato público del SEACE en Vigía Perú.",
    // Las tres vistas y las pestañas son la misma ficha: la canónica es la ruta por su OCID, sin consulta.
    alternates: canonica(rutaContrato(c.ocid)),
    openGraph: { ...OG_BASE, title: titulo, description: desc, type: "article" },
    twitter: { ...TWITTER_BASE, title: titulo, description: desc },
  };
}

/**
 * /app/contratos/[ocid]: LA página de un contrato. Acepta el OCID (2026-425-9, 1249514), el OCID largo
 * (ocds-dgv273-seacev3-1249514) o el código SEACE (1235259), que redirige a su OCID.
 *
 * Una cabecera ÚNICA (CabeceraContrato: el objeto, quién compra y quién ganó, el estado, las banderas y las cifras) y,
 * debajo, las vistas en pestañas (VistasContrato, `?vista=`):
 *   - ficha (por defecto): el registro del proceso; `?seccion=` abre esa pestaña (items, participantes, postores,
 *     adjudicacion, precios, cronograma, citas, documentos, antecedentes, historia);
 *   - `?vista=dictamen` (`&tab=`): el informe de la lectura, armado en el servidor (antes /app/convocatoria/[id]);
 *   - `?vista=vivo`: cómo se leyó. Con un procesamiento financiado, la lectura en vivo (antes /app/auditoria/[ocid]); sin
 *     él (la mayoría: los lee el lote), el registro de los agentes, que era la pestaña «Cómo se hizo» del dictamen
 *     (`&tab=trace` llega aquí). Antes, sin procesamiento, redirigía a la ficha sin decir nada.
 * Una vista que el contrato no tiene (dictamen sin lectura) abre la ficha con una nota que lo dice.
 *
 * Las señales y el puntaje se cuentan UNA vez para toda la página (lecturaContrato.ts), con el informe como fuente: la
 * ficha lo pide también cuando la lectura está publicada (en la caché de datos, el mismo pedido que el dictamen).
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
  const tabPedida = typeof searchParams?.tab === "string" ? searchParams.tab : undefined;
  let vista = vistaDe(searchParams?.vista);
  // «Cómo se hizo» era la última pestaña del dictamen; ahora es la vista «Cómo se leyó»: los enlaces viejos llegan ahí.
  if (vista === "dictamen" && tabPedida === "trace") vista = "vivo";
  const tab = esClaveDictamen(tabPedida) && tabPedida !== "trace" ? tabPedida : undefined;
  const [{ contrato: base, redirigirA }, vivoResumen, catalogo] = await Promise.all([
    resolverContrato(param),
    getResumenVivo(60),
    getCatalogoReglas().catch(() => ({}) as CatalogoReglas),
  ]);
  // La pestaña pedida sobrevive a la redirección del código SEACE a su OCID.
  if (redirigirA) redirect(rutaContrato(redirigirA, vista, { seccion, tab }));
  if (!base) {
    // El dictamen también se pide por el código de la alerta (OECE-…): su propio estado de "no encontrado".
    if (vista === "dictamen") return <VistaDictamenSuelta id={param} tab={tab ?? null} />;
    notFound();
  }

  // La lectura publicada: su informe es la fuente de las señales y del puntaje de toda la página. En revisión humana no
  // se pide (§10.4: no se muestra nada de lo que encontró).
  const publicada = !!base.alerta && base.alerta.estado !== "revision";
  const [carga, proceso] = await Promise.all([
    publicada ? cargarDossier(base.ocid) : Promise.resolve(null),
    vista === "vivo" ? getProcesamiento(base.ocid) : Promise.resolve(null),
  ]);
  const informe = carga?.estado === "ok" ? carga.result : null;
  const lectura = lecturaDelContrato(base, informe);
  const c = fichaConSenalesQueCuentan(base, informe);

  const enCurso = !!base.procesamiento && base.procesamiento.estado !== "procesado";
  const vistas: VistaDisponible[] = [
    { clave: "ficha", etiqueta: "Ficha del contrato" },
    ...(publicada ? [{ clave: "dictamen" as const, etiqueta: "Dictamen" }] : []),
    ...(base.procesamiento || informe || proceso ? [{ clave: "vivo" as const, etiqueta: enCurso ? "Lectura en vivo" : "Cómo se leyó" }] : []),
  ];
  const activa: VistaContrato = vistas.some((v) => v.clave === vista) ? vista : "ficha";

  const migas = migasConDesde(desde, [{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contratos", href: "/app/contratos" }, { etiqueta: `Contrato ${c.codigo ?? c.ocid}` }]);
  // El último paso de la ruta es la pestaña abierta de la vista (cada vista tiene las suyas).
  const ruta =
    activa === "ficha"
      ? { param: "seccion", primera: "resumen", activa: seccion ?? "resumen", etiquetas: ETIQUETAS_FICHA }
      : activa === "dictamen"
        ? { param: "tab", primera: PRIMERA_DICTAMEN, activa: tab ?? PRIMERA_DICTAMEN, etiquetas: ETIQUETAS_DICTAMEN }
        : undefined;

  let contenido: ReactNode;
  if (activa === "dictamen") {
    // El capítulo «Postores y ofertas» de la historia lee los postores de la ficha (con la evaluación leída por pieza).
    const postoresContrato = c.postoresDetalle?.length
      ? { ocid: c.ocid, moneda: c.moneda ?? null, postores: c.postoresDetalle, evaluacion: c.evaluacion ?? null, conPerfil: !!c.perfilContratista }
      : null;
    contenido = informe ? (
      <ResultadoView result={informe} embebido tabInicial={tab ?? null} postoresContrato={postoresContrato} />
    ) : (
      <EstadoError
        titulo="No pudimos cargar el dictamen"
        detalle={carga?.estado === "error" ? carga.mensaje : null}
        accion={
          <Link href={rutaContrato(c.ocid, "dictamen")} prefetch={false} className="inline-flex min-h-[40px] items-center rounded-full bg-granate px-4 py-2 text-dato font-semibold text-paper hover:bg-granate-deep">
            Volver a intentarlo
          </Link>
        }
      >
        La conexión con el servidor falló antes de traer el informe. La ficha del contrato sí está: ábrela arriba.
      </EstadoError>
    );
  } else if (activa === "vivo") {
    // Mientras se lee (o si no hay informe), la lectura en vivo con sus carriles y su bitácora. Terminada, el registro de
    // los agentes: la tarjeta del resultado de la lectura en vivo repetía la cabecera (puntaje y cada señal).
    contenido = proceso && (enCurso || !informe) ? (
      // La versión compacta: la página ya tiene su cabecera (la ancha traía otra, con su título y sus cifras).
      <ContratoEnVivo
        ocid={c.ocid}
        initial={procesamientoConSenalesQueCuentan({ ...proceso, eventos: Array.isArray(proceso.eventos) ? proceso.eventos : [] }, informe)}
        compacto
      />
    ) : informe ? (
      <TrazaContrato result={informe} ocid={c.ocid} />
    ) : (
      <Nota>No pudimos traer cómo se leyó este contrato. Vuelve a intentarlo en unos segundos.</Nota>
    );
  } else {
    contenido = <Ficha c={c} lectura={lectura} seccion={seccion} alcance={vivoResumen?.procesamientoActivo ?? null} catalogo={catalogo} />;
  }

  // La vista pedida no existe para este contrato: se dice, y se abre la ficha.
  const sinVista =
    vista !== activa
      ? vista === "dictamen"
        ? base.alerta?.estado === "revision"
          ? "La lectura de este contrato está en revisión: su dictamen se publica cuando una persona del equipo la revise. Aquí está su ficha."
          : "Este contrato todavía no tiene dictamen: no se ha leído. Aquí está su ficha."
        : "Este contrato todavía no tiene una lectura que mostrar. Aquí está su ficha."
      : null;

  return (
    <Pagina className="space-y-5">
      <CabeceraContrato c={c} lectura={lectura} migas={migas} ruta={ruta} />
      {sinVista && <Nota>{sinVista}</Nota>}
      <VistasContrato activa={activa} vistas={vistas}>
        {contenido}
      </VistasContrato>
      {/* Al pie, una vez para las tres vistas (antes el aviso iba arriba en la ficha y abajo en el dictamen). */}
      <div className="space-y-3 border-t border-line pt-4">
        <DisclaimerBanner />
        <NotaPrivacidad />
      </div>
    </Pagina>
  );
}

/**
 * La vista «Ficha»: lo de la entidad y la provincia (otros contratos, sus cifras y contratos parecidos) se pide YA, pero
 * no se espera: ContratoDetalle lo pinta por streaming cuando llega. Sólo en esta vista (antes se pedía también para el
 * dictamen y la lectura en vivo, que no lo muestran).
 */
function Ficha({
  c,
  lectura,
  seccion,
  alcance,
  catalogo,
}: {
  c: NonNullable<Awaited<ReturnType<typeof resolverContrato>>["contrato"]>;
  lectura: ReturnType<typeof lecturaDelContrato>;
  seccion?: string;
  alcance: { tipos_activos: string[]; etapas_activas: string[]; nota?: string } | null;
  catalogo: CatalogoReglas;
}) {
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
    <ContratoDetalle
      c={c}
      lectura={lectura}
      antecedentesArriba={antecedentesEnCabecera(lectura)}
      alcance={alcance}
      catalogo={catalogo}
      seccion={seccion}
      relacionados={relacionados}
      entidadEnVigia={entidadEnVigia}
      parecidos={parecidos}
    />
  );
}

/**
 * El informe pedido por un código que no es un contrato del registro (el código de la alerta, OECE-…): sin cabecera
 * del contrato, con la identidad del propio informe. Sus estados de error, en DossierCliente.
 */
async function VistaDictamenSuelta({ id, tab }: { id: string; tab: string | null }) {
  const carga = await cargarDossier(id);
  if (carga.estado === "ok") {
    return (
      <Pagina className="space-y-4">
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
