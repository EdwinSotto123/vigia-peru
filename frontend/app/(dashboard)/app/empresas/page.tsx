import type { Metadata } from "next";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { ListaEmpresas } from "@/components/empresas/ListaEmpresas";
import { TablaReglas } from "@/components/empresas/PuntajeEmpresa";
import { getReglasPuntaje } from "@/lib/empresas";

export const metadata: Metadata = { title: "Empresas" };
export const revalidate = 600;

/**
 * /app/empresas — las empresas (RUC 20) que le venden al Estado: lo que ganaron en contratos (solas y en consorcio), lo
 * que les compraron por órdenes, a cuántas entidades, y su puntaje de antecedentes (0 a 100) con lo que dicen otros
 * registros públicos. Buscador por nombre o RUC; filtros por nivel, antecedente, rubro, región, inhabilitadas y visitas.
 * Cada fila abre /empresa/<RUC>.
 */
export default async function EmpresasPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const ruta = "/app/empresas";
  const reglas = await getReglasPuntaje();
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Empresas", href: ruta }]} />
      <EncabezadoPagina
        titulo="Empresas"
        bajada="Quién le vende al Estado, cuánto ganó en contratos y órdenes, y qué dicen de cada empresa otros registros públicos."
        ayuda={
          <Ayuda titulo="¿De dónde sale esto?">
            <span className="block">
              Los contratos, las órdenes de compra y de servicio y los postores, de CONOSCE (OECE), desde 2018. Los socios,
              representantes y directivos, del Registro Nacional de Proveedores. Las sanciones, del Tribunal de Contrataciones; los
              aportes y gastos de campaña, de la ONPE; las autoridades y candidatos, del JNE; las visitas, del registro de visitas
              de las entidades.
            </span>
            <span className="mt-2 block">
              Las personas naturales que le venden al Estado no están aquí: están en Personas contratadas, con sus reglas de
              privacidad.
            </span>
          </Ayuda>
        }
      />
      <ListaEmpresas sp={searchParams} ruta={ruta} />
      <TablaReglas reglas={reglas} />
      <Aviso tono="neutro">
        El puntaje no es una acusación ni prueba una falta: suma lo que otros registros públicos dicen de la empresa, para
        saber qué revisar primero. Un dato con posible error de carga se muestra tal como lo publicó el Estado y no se suma.
      </Aviso>
    </Pagina>
  );
}
