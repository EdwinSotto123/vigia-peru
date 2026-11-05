import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ayuda, BanderasFicha, EncabezadoPagina, Migas, Pagina, Seccion } from "@/components/patrones";
import {
  BajadaMenor,
  CifrasMenor,
  CronologiaMenor,
  DatosMenor,
  HistorialProveedor,
  LoQueDiceElContrato,
  LoQueSeCompro,
  LoQueSePidio,
  SenalesMenor,
  banderasMenor,
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
 * /app/contratos/menor/[id]: la ficha de un contrato menor (≤8 UIT), en la plantilla de dos columnas de la ficha de un
 * contrato (ContratoDetalle). Pedido del usuario del 2026-11-05: eran nueve secciones apiladas (5,4 pantallas en
 * escritorio, 9,2 en el celular), con cajas grandes y poca información y media pantalla vacía.
 *
 * Desde xl, a la izquierda las cifras y las señales (fila 1) y, debajo, lo que se pidió, los ítems (sólo si el SEACE los
 * publica), el contrato con sus líneas y el historial con el proveedor (fila 2); a la derecha, fija al bajar y a lo alto de
 * las dos filas, quién es quién y la cronología con su orden de pago. La segunda fila es `1fr`: si la columna lateral es
 * más alta que las señales, el sobrante va abajo del historial, nunca entre las señales y lo que se pidió. Desde xl y no
 * desde lg: con la barra lateral del sitio, a 1024 px la columna principal quedaba en ~316 px, angosta para el historial.
 * Debajo de xl, una sola columna en el orden del DOM (cifras, señales, los datos y la cronología lado a lado desde lg,
 * y lo demás): el proveedor y la entidad ya están en la bajada del encabezado, en verde.
 */
export default async function FichaMenorPagina({ params }: { params: { id: string } }) {
  const id = idDe(params.id);
  const f = id ? await getFichaMenor(id) : null;
  if (!f) notFound();
  const m = f.menor;
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
        titulo={oracion(m.descripcion ?? `Contrato menor ${m.codigo ?? m.id}`)}
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
      <div className="grid items-start gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <CifrasMenor f={f} />
          <Seccion id="senales" titulo="Señales" descripcion="Lo que encontramos en este contrato y la evidencia de cada señal.">
            <SenalesMenor f={f} />
          </Seccion>
        </div>

        {/* La columna lateral: con scroll propio si no entra en la pantalla (si no, lo de abajo quedaba fuera de vista
            mientras está fija). Debajo de xl, sus dos tarjetas lado a lado desde lg: a todo el ancho dejaban media
            pantalla vacía. */}
        <aside
          aria-label="Datos y cronología del contrato menor"
          className="grid min-w-0 items-start gap-5 lg:grid-cols-2 xl:sticky xl:top-4 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:max-h-[calc(100dvh-2rem)] xl:grid-cols-1 xl:overflow-y-auto xl:overscroll-contain"
        >
          <DatosMenor f={f} />
          <CronologiaMenor f={f} />
        </aside>

        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-2">
          <Seccion id="pedido" titulo="Lo que se pidió" descripcion="El requerimiento que la entidad publicó para pedir cotizaciones, leído por la IA.">
            <LoQueSePidio f={f} />
          </Seccion>
          {/* Sin ítems no hay sección: la cifra «ítems» de arriba ya dice que el SEACE todavía no los publica. */}
          {f.items.length > 0 && (
            <Seccion id="items" titulo="Qué se compró y a qué precio" descripcion="Los ítems adjudicados, frente a lo que pagan otras entidades por lo mismo.">
              <LoQueSeCompro f={f} />
            </Seccion>
          )}
          <Seccion id="contrato" titulo="Lo que dice el contrato u orden" descripcion="El documento firmado que la entidad registró en el SEACE, leído por la IA.">
            <LoQueDiceElContrato f={f} />
          </Seccion>
          <Seccion
            id="historial"
            titulo="Este proveedor en esta entidad"
            descripcion="Todos sus contratos menores con la entidad: una compra partida se ve aquí."
          >
            <HistorialProveedor f={f} />
          </Seccion>
        </div>
      </div>
    </Pagina>
  );
}
