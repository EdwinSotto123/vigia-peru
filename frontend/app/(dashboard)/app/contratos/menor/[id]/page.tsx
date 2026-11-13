import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ayuda, BanderasFicha, CapitulosRelato, EncabezadoPagina, Migas, Pagina, type CapituloRelato } from "@/components/patrones";
import {
  BajadaMenor,
  CronologiaMenor,
  DatosMenor,
  FraseMenor,
  FuentesMenor,
  PedidoYContrato,
  ProveedorMenor,
  SenalesMenor,
  banderasMenor,
  tituloMenor,
} from "@/components/menores/FichaMenor";
import { oracion, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getFichaMenor, rutaMenor } from "@/lib/menores";
import { canonica } from "@/lib/seo";

export const revalidate = 300;

const idDe = (s: string) => (/^\d{1,10}$/.test(s) ? Number(s) : null);
const corto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const id = idDe(params.id);
  const f = id ? await getFichaMenor(id) : null;
  if (!f) return { title: "Contrato menor no encontrado" };
  const m = f.menor;
  const titulo = `${corto(oracion(m.descripcion ?? `Contrato menor ${m.codigo ?? id}`), 70)}${m.entidad ? `, ${corto(tituloNatural(m.entidad), 48)}` : ""}`;
  return {
    title: titulo,
    description: `Contrato menor ${m.codigo ?? ""} por ${soles(m.monto)}: lo que se pidió, a qué precio y sus señales (SEACE).`,
    alternates: canonica(rutaMenor(m.id)),
  };
}

/**
 * /app/contratos/menor/[id]: la ficha de un contrato menor (≤8 UIT), contada como una historia. Pedido del usuario del
 * 2026-11-05: «veo que solo apilamos y demás sin dar orden o contar una historia». El veredicto en una frase y, debajo,
 * los capítulos, que se leen de a uno («divídelo por subsecciones, menos scroll»): qué pasó paso a paso con cada señal
 * en su momento, lo que se pidió frente a lo que se firmó, por qué llama la atención con su evidencia, quién es el
 * proveedor y qué más le compraron, y de dónde sale cada dato.
 *
 * Los capítulos van bajo la frase y no pegados al encabezado: el encabezado ya termina en una fila de banderas (chips) y
 * dos filas de chips seguidas se leían como una sola; además, la frase es lo primero que se lee (Relato.tsx).
 *
 * Desde xl, la historia a la izquierda y, a la derecha, fija al bajar, «Datos del contrato»: la entidad, el proveedor, el
 * monto, la firma y el código siempre a la vista mientras se lee la evidencia (y sin la media pantalla vacía de una sola
 * columna en un monitor ancho: el pedido anterior del mismo día). Es una tarjeta corta, no la cronología: «Qué pasó»
 * es ahora el capítulo 1, con lo que pasó en cada fecha. Debajo de xl, una sola columna y esa tarjeta va dentro del
 * capítulo 5 (la página la dibuja en los dos lugares y esconde uno; no lleva ids). Desde xl y no desde lg: con la barra
 * lateral del sitio, a 1024 px la historia quedaba en ~600 px y la comparación de dos columnas, apretada.
 */
export default async function FichaMenorPagina({ params }: { params: { id: string } }) {
  const id = idDe(params.id);
  const f = id ? await getFichaMenor(id) : null;
  if (!f) notFound();
  const conSenales = f.senales.length > 0;
  const peor = (["alta", "media", "baja"] as const).find((sv) => f.senales.some((x) => x.severidad === sv));
  const capitulos: CapituloRelato[] = [
    {
      id: "que-paso",
      titulo: "Qué pasó",
      bajada: "Paso a paso, del pedido de cotizaciones a la orden de pago, con lo que llama la atención en cada momento.",
      contenido: <CronologiaMenor f={f} />,
    },
    {
      id: "pedido-y-contrato",
      titulo: "Pedido y contrato",
      tituloLargo: "Lo que se pidió y lo que se firmó",
      bajada: "El requerimiento frente al contrato u orden, leídos por la IA, y lo que la entidad registró en el SEACE.",
      contenido: <PedidoYContrato f={f} />,
    },
    {
      id: "senales",
      titulo: conSenales ? "Por qué llama la atención" : "Lo que revisamos",
      conteo: f.senales.length,
      tono: peor,
      bajada: conSenales ? "Cada señal con su evidencia, de la más grave a la más leve." : "Lo que buscamos en este contrato menor y no encontramos.",
      contenido: <SenalesMenor f={f} />,
    },
    {
      id: "proveedor",
      titulo: "El proveedor",
      tituloLargo: "Quién es el proveedor y qué más le compraron",
      bajada: "Lo que dice de él la SUNAT y todos sus contratos menores con esta entidad.",
      contenido: <ProveedorMenor f={f} />,
    },
    {
      id: "fuentes",
      titulo: "Las fuentes",
      tituloLargo: "De dónde sale cada dato",
      bajada: "El registro del SEACE, los documentos que subió la entidad y lo que la IA leyó en ellos.",
      contenido: <FuentesMenor f={f} />,
    },
  ];
  return (
    <Pagina className="space-y-6">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Contratos", href: "/app/contratos" },
          { etiqueta: "Menores", href: "/app/contratos?vista=menores" },
        ]}
      />
      <EncabezadoPagina
        // Corto (110 caracteres, en una palabra): la descripción entera medía 13 líneas en escritorio y 22 en el celular.
        // Entera va en el cuerpo: «Datos del contrato» desde xl y «Pedido y contrato» debajo.
        titulo={tituloMenor(f)}
        bajada={<BajadaMenor f={f} />}
        ayuda={
          <Ayuda titulo="¿Qué es un contrato menor?">
            Una compra del Estado de hasta 8 UIT (S/ 44,000 en 2026), que por ley se contrata sin procedimiento de selección:
            la entidad publica su requerimiento, deja cotizar unas horas o días y elige. Partir una compra en varias para
            quedar bajo ese tope está prohibido.
          </Ayuda>
        }
        banderas={<BanderasFicha banderas={banderasMenor(f)} etiqueta="Señales de este contrato menor" />}
      />
      <div className="grid items-start gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <FraseMenor f={f} />
          <CapitulosRelato capitulos={capitulos} etiqueta="Capítulos del contrato menor" />
        </div>

        {/* Sólo desde xl (debajo, la misma tarjeta va en el capítulo 5). Con scroll propio si no entra en la pantalla. */}
        <aside
          aria-label="Datos del contrato menor"
          className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto xl:overscroll-contain"
        >
          <DatosMenor f={f} conObjeto />
        </aside>
      </div>
    </Pagina>
  );
}
