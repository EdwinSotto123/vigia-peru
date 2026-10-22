import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ayuda, CabeceraPestana, EncabezadoPagina, Migas, Pagina, Pestanas } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { InicioRegion } from "@/components/inicio/InicioRegion";
import { HistoriaGobiernos, ResumenRegion, TerritorioRegion } from "@/components/regiones/GobiernosRegion";
import { regionDe, rutaRegion } from "@/lib/regiones";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const r = regionDe(params.id);
  return { title: r ? `Región ${r.nombre}` : "Región" };
}

const uno = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * /region/[ubigeo o nombre corto] — la ficha de una región (pedido del usuario, 2026-10-22: «las regiones deberían poder
 * clickearse: su historial, cuántos distritos tiene, quiénes gobernaron, casos de corrupción»). Antes esta ruta llevaba
 * al panel del mapa. Pestañas (?seccion=):
 *   · Inicio: en qué gasta (MEF), sus contratos y banderas, personas contratadas y casos de corrupción (los mismos
 *     bloques que la entidad y el partido).
 *   · Gobiernos: quién la gobernó en cada período y qué partidos ganaron sus provincias y distritos.
 *   · Provincias y distritos: cada uno con su alcalde y su partido en cada período, con buscador (?tq= lo trae puesto).
 */
export default function RegionPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const r = regionDe(params.id);
  if (!r) notFound();
  const seccion = uno(searchParams?.seccion) ?? (uno(searchParams?.tq) ? "territorio" : undefined);
  const ruta = rutaRegion(r.ubigeo);

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Partidos y gobiernos", href: "/app/partidos" },
          { etiqueta: r.nombre, href: ruta },
        ]}
        pestanas={{ primera: "inicio", activa: seccion ?? "inicio", etiquetas: { gobiernos: "Gobiernos", territorio: "Provincias y distritos" } }}
      />
      <EncabezadoPagina
        titulo={`Región ${r.nombre}`}
        bajada="Quién la gobernó desde 2015, sus provincias y distritos, en qué gasta, qué contrata y sus casos de corrupción."
        ayuda={
          <Ayuda titulo="¿De dónde sale esto?">
            <span className="block">
              Los gobiernos, del JNE (elecciones de 2014, 2018 y 2022). El gasto, del MEF. Los contratos, del SEACE y CONOSCE
              (OECE). Los casos de corrupción, de la Procuraduría Anticorrupción y la Contraloría.
            </span>
          </Ayuda>
        }
        acciones={
          <span className="flex flex-wrap gap-2">
            <EnlaceAccion href={`/app/mapa?region=${r.id}`} variante="secundario">Ver en el mapa</EnlaceAccion>
            <EnlaceAccion href={`/app/financiar/${r.ubigeo}`} flecha>Financiar sus lecturas</EnlaceAccion>
          </span>
        }
      />
      <ResumenRegion ubigeo={r.ubigeo} />
      <Pestanas
        key={seccion ?? "inicio"}
        etiqueta={`Secciones de la región ${r.nombre}`}
        activa={seccion}
        pestanas={[
          {
            clave: "inicio",
            etiqueta: "Inicio",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>En qué gasta {r.nombre}, qué contrata, a quién contrata y sus casos de corrupción.</CabeceraPestana>
                <InicioRegion ubigeo={r.ubigeo} nombre={r.nombre} mefDept={r.mefDept} />
              </div>
            ),
          },
          {
            clave: "gobiernos",
            etiqueta: "Gobiernos",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Quién gobernó {r.nombre} en cada período y qué partidos ganaron sus provincias y distritos.</CabeceraPestana>
                <HistoriaGobiernos ubigeo={r.ubigeo} nombre={r.nombre} />
              </div>
            ),
          },
          {
            clave: "territorio",
            etiqueta: "Provincias y distritos",
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Cada provincia y cada distrito de {r.nombre}, con su alcalde y su partido en cada período.</CabeceraPestana>
                <TerritorioRegion ubigeo={r.ubigeo} nombre={r.nombre} buscar={uno(searchParams?.tq)} />
              </div>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
