import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ayuda, BanderasFicha, EncabezadoPagina, Migas, Pagina, Seccion } from "@/components/patrones";
import {
  CifrasMenor,
  Cronologia,
  FuenteMenor,
  HistorialProveedor,
  LoQueDiceElContrato,
  LoQueSeCompro,
  LoQueSePidio,
  OrdenesMenor,
  PartesMenor,
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
 * /app/contratos/menor/[id]: la ficha de un contrato menor (≤8 UIT). Lo que antes era un panel con dos PDF: sus señales
 * con la evidencia, lo que se pidió (leído por la IA), los ítems y su precio frente a otras entidades, lo que dice el
 * contrato, la cronología y los demás contratos de la entidad con ese proveedor.
 */
export default async function FichaMenorPagina({ params }: { params: { id: string } }) {
  const id = idDe(params.id);
  const f = id ? await getFichaMenor(id) : null;
  if (!f) notFound();
  const m = f.menor;
  const entidad = m.entidad ? tituloNatural(m.entidad) : "la entidad";
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
        bajada={`Contrato menor ${m.codigo ?? ""} de ${entidad}, por ${soles(m.monto)}.`}
        ayuda={
          <Ayuda titulo="¿Qué es un contrato menor?">
            Una compra del Estado de hasta 8 UIT (S/ 44,000 en 2026), que por ley se contrata sin procedimiento de selección:
            la entidad publica su requerimiento, deja cotizar unas horas o días y elige. Partir una compra en varias para
            quedar bajo ese tope está prohibido.
          </Ayuda>
        }
        banderas={<BanderasFicha banderas={banderasMenor(f)} etiqueta="Señales de este contrato menor" />}
      />
      <CifrasMenor f={f} />
      <Seccion id="senales" titulo="Señales" descripcion="Lo que encontramos en este contrato y la evidencia de cada señal.">
        <SenalesMenor f={f} />
      </Seccion>
      <Seccion id="pedido" titulo="Lo que se pidió" descripcion="El requerimiento que la entidad publicó para pedir cotizaciones, leído por la IA.">
        <LoQueSePidio f={f} />
      </Seccion>
      <Seccion id="items" titulo="Qué se compró y a qué precio" descripcion="Los ítems adjudicados, frente a lo que pagan otras entidades por lo mismo.">
        <LoQueSeCompro f={f} />
      </Seccion>
      <Seccion id="contrato" titulo="Lo que dice el contrato u orden" descripcion="El documento firmado que la entidad registró en el SEACE, leído por la IA.">
        <LoQueDiceElContrato f={f} />
      </Seccion>
      <Seccion id="cronologia" titulo="Cronología">
        <Cronologia f={f} />
      </Seccion>
      <Seccion id="partes" titulo="La entidad y el proveedor">
        <PartesMenor f={f} />
      </Seccion>
      <Seccion
        id="historial"
        titulo="Este proveedor en esta entidad"
        descripcion="Todos sus contratos menores con la entidad: una compra partida se ve aquí."
      >
        <HistorialProveedor f={f} />
      </Seccion>
      <Seccion id="ordenes" titulo="Su orden de pago">
        <OrdenesMenor f={f} />
      </Seccion>
      <FuenteMenor f={f} />
    </Pagina>
  );
}
