import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Activity, Database, FileText, Gavel, History, MessageSquareWarning, Stethoscope } from "lucide-react";
import { Migas } from "@/components/patrones/Migas";
import { Pestanas, type Pestana } from "@/components/patrones/Pestanas";
import { AccionesFicha } from "@/components/salud/ficha/Acciones";
import { CabeceraFicha } from "@/components/salud/ficha/Cabecera";
import { PestanaDenuncias } from "@/components/salud/ficha/PestanaDenuncias";
import { PestanaDocumentos } from "@/components/salud/ficha/PestanaDocumentos";
import { PestanaFuentes } from "@/components/salud/ficha/PestanaFuentes";
import { PestanaHistorial } from "@/components/salud/ficha/PestanaHistorial";
import { PestanaRecursos } from "@/components/salud/ficha/PestanaRecursos";
import { PestanaSanciones } from "@/components/salud/ficha/PestanaSanciones";
import { PestanaServicios } from "@/components/salud/ficha/PestanaServicios";
import { RelacionadosFicha } from "@/components/salud/ficha/Relacionados";
import { VerificacionFicha, resumenVerificacion } from "@/components/salud/ficha/Verificacion";
import { detalleLeido } from "@/components/salud/ficha/piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { getFichaIpress, nombrePropio, rutaFicha } from "@/lib/gobserva-salud";

/** La ficha se pide a la API con 15 minutos de caché (getFichaIpress); la página se arma en cada pedido (el host da la base). */
export const revalidate = 900;

type Props = { params: { codigo: string }; searchParams: { seccion?: string | string[] } };

/** El código como lo guarda RENIPRESS: 8 cifras con ceros a la izquierda. */
const codigoDe = (crudo: string) => (/^\d{1,8}$/.test(crudo) ? crudo.padStart(8, "0") : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const codigo = codigoDe(params.codigo);
  const f = codigo ? await getFichaIpress(codigo) : null;
  if (!f) return { title: "Establecimiento no encontrado", robots: { index: false } };
  const nombre = nombrePropio(f.nombre);
  const cat = f.categoria ? `categoría ${f.categoria}${f.categoriaInfo ? ` (${f.categoriaInfo.nombre.toLowerCase()})` : ""}` : "sin categoría en RENIPRESS";
  const lugar = [nombrePropio(f.distrito), nombrePropio(f.departamento)].filter(Boolean).join(", ");
  return {
    title: `${nombre}: verificación en RENIPRESS y SUSALUD`,
    description: `${nombre}${lugar ? ` (${lugar})` : ""}, ${cat}. ${resumenVerificacion(f)} Servicios, documentos declarados, denuncias y fuentes oficiales con su fecha.`.slice(0, 300),
    alternates: { canonical: urlCanonica("salud", rutaFicha(f.codigo)) },
    openGraph: { title: `${nombre} en Gobserva Salud`, description: resumenVerificacion(f), type: "article" },
  };
}

/**
 * La ficha de un establecimiento de salud (IPRESS) en Gobserva Salud, en el orden decidir → actuar → detalle: arriba
 * quién es (nombre, categoría con lo que significa, sector, estado, dirección, teléfono y horario); luego la verificación
 * (una frase hecha con los chequeos y cada chequeo con su fuente y su fecha) y lo que se puede hacer (llegar, el mapa,
 * la consulta oficial, denunciar, copiar el enlace, preguntar); y en pestañas fijas el detalle: servicios, sanciones
 * firmes, denuncias, recursos y cirugías, documentos, historial y fuentes. Al final, lo que Vigía sabe de su RUC y sus
 * otras sedes. GET /salud/establecimiento/:codigo.
 */
export default async function FichaEstablecimiento({ params, searchParams }: Props) {
  const codigo = codigoDe(params.codigo);
  if (!codigo) notFound();
  const f = await getFichaIpress(codigo);
  if (!f) notFound();
  const base = baseProducto("salud");
  const nombre = nombrePropio(f.nombre);
  const seccion = typeof searchParams.seccion === "string" ? searchParams.seccion : undefined;
  const leido = detalleLeido(f);
  const ico = (I: typeof Gavel) => <I size={15} aria-hidden />;

  const pestanas: Pestana[] = [
    { clave: "servicios", etiqueta: "Servicios", icono: ico(Stethoscope), conteo: leido ? f.detalle!.upss.length || null : null, contenido: <PestanaServicios f={f} base={base} /> },
    { clave: "sanciones", etiqueta: "Sanciones", icono: ico(Gavel), conteo: f.registroSanciones.length || null, contenido: <PestanaSanciones f={f} /> },
    { clave: "denuncias", etiqueta: "Denuncias", icono: ico(MessageSquareWarning), contenido: <PestanaDenuncias f={f} /> },
    { clave: "recursos", etiqueta: "Recursos y cirugías", icono: ico(Activity), contenido: <PestanaRecursos f={f} /> },
    { clave: "documentos", etiqueta: "Documentos", icono: ico(FileText), conteo: leido ? f.detalle!.documentos.length || null : null, contenido: <PestanaDocumentos f={f} base={base} /> },
    { clave: "historial", etiqueta: "Historial", icono: ico(History), conteo: f.cambios.length || null, contenido: <PestanaHistorial f={f} /> },
    { clave: "fuentes", etiqueta: "Fuentes", icono: ico(Database), contenido: <PestanaFuentes f={f} base={base} /> },
  ];

  return (
    <div className="container-page pb-6 pt-5 sm:pt-8">
      <Migas
        items={[
          { etiqueta: "Inicio", href: rutaEn(base, "/") },
          { etiqueta: "Establecimientos", href: rutaEn(base, "/establecimientos") },
          { etiqueta: nombre },
        ]}
        pestanas={{ etiquetas: Object.fromEntries(pestanas.map((p) => [p.clave, p.etiqueta])), primera: pestanas[0].clave, activa: seccion }}
      />

      <div className="mt-4">
        <CabeceraFicha f={f} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <VerificacionFicha f={f} base={base} />
        <AccionesFicha f={f} base={base} className="lg:sticky lg:top-20" />
      </div>

      {/* Las pestañas se pegan bajo la cabecera del producto (64 px), no detrás de ella. */}
      <div id="secciones" className="mt-10 scroll-mt-16">
        <Pestanas
          pestanas={pestanas}
          activa={seccion}
          etiqueta={`Secciones de la ficha de ${nombre}`}
          fija
          className="[&>div:first-child]:top-16"
        />
      </div>

      <RelacionadosFicha f={f} base={base} />

    </div>
  );
}
