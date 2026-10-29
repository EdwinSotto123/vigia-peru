import type { Metadata } from "next";
import { CalendarClock, CircleDollarSign, Info, Receipt } from "lucide-react";
import { EncabezadoPagina, FuenteDato, Migas, Nota, Pagina, Seccion } from "@/components/patrones";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { MetaDelMes } from "@/components/financiar/MetaDelMes";
import { fechaCorta, numero, soles } from "@/lib/formato";
import { dolares, getVigilancia, nombreMes, type ResumenVigilancia } from "@/lib/financiamiento";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Cuánto cuesta Vigía",
  description: "Lo que cuesta mantener Vigía cada mes, rubro por rubro y con la fuente de cada cifra, y en qué se usa lo que aportas.",
};

export const revalidate = 300;

/**
 * /app/cuanto-cuesta — las cuentas abiertas de Vigía (migración 206; GET /financiamiento/vigilancia): lo que cuesta
 * cada mes por rubro (la factura de AWS por Cost Explorer, la tarifa de Cloudflare), lo que costó la IA en cada lectura,
 * la meta del mes, lo recaudado y la historia mes a mes. Cada cifra dice de dónde sale; lo que no está, se dice.
 */
export default async function CuantoCuestaPage() {
  const v = await getVigilancia();
  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Ayúdanos a seguir vigilando", href: "/app/apoyar" },
          { etiqueta: "Cuánto cuesta Vigía", href: "/app/cuanto-cuesta" },
        ]}
      />
      <EncabezadoPagina
        titulo="Cuánto cuesta Vigía"
        bajada="Lo que cuesta mantenerla cada mes, de dónde sale cada cifra y en qué se usa lo que aportas."
        acciones={
          <EnlaceAccion href="/app/apoyar" flecha prefetch={false}>
            Aportar
          </EnlaceAccion>
        }
      />
      {!v ? (
        <EstadoVacio variante="compacta" tono="error">No pudimos leer los costos ahora. Vuelve a intentarlo en un momento.</EstadoVacio>
      ) : (
        <div className="space-y-8">
          <MetaDelMes v={v} conEnlace={false} />
          <Costos v={v} />
          <LecturaIA v={v} />
          <MesAMes v={v} />
          <Seccion titulo="Lo que no está en estas cifras">
            <ul className="space-y-2 text-dato leading-relaxed text-inkSoft">
              <li className="flex gap-2">
                <Info size={16} aria-hidden className="mt-1 shrink-0 text-inkSoft" />
                Hoy AWS lo cubren créditos promocionales: las cifras de AWS son lo que costará cuando se acaben, no lo que se paga hoy.
              </li>
              <li className="flex gap-2">
                <Info size={16} aria-hidden className="mt-1 shrink-0 text-inkSoft" />
                La base de datos incluye una copia de pruebas, donde se revisa cada cambio antes de publicarlo.
              </li>
              <li className="flex gap-2">
                <Info size={16} aria-hidden className="mt-1 shrink-0 text-inkSoft" />
                No están el trabajo de quienes mantienen Vigía ni la IA de otras tareas (leer declaraciones juradas), que todavía no medimos.
              </li>
            </ul>
          </Seccion>
          <FuenteDato
            fuente={`Factura de AWS (Cost Explorer), tarifa de Cloudflare, costo medido en cada lectura y ${v.tipoCambio.fuente}`}
          />
        </div>
      )}
    </Pagina>
  );
}

function Costos({ v }: { v: ResumenVigilancia }) {
  if (!v.costos || !v.mesCostos) {
    return (
      <Seccion titulo="Lo que cuesta cada mes">
        <Nota>Todavía no cargamos los costos de este mes.</Nota>
      </Seccion>
    );
  }
  const tc = v.tipoCambio.penPorUsd;
  const parcial = v.costos.rubros.some((r) => r.parcial);
  const proyeccion = v.costos.rubros.every((r) => r.fuente === "estimado");
  const al = v.costos.rubros.find((r) => r.al)?.al ?? null;
  return (
    <Seccion
      titulo={`Lo que cuesta ${nombreMes(v.mesCostos)}`}
      descripcion={
        proyeccion
          ? "Proyección con el ritmo de los últimos días, hasta que llegue la factura del mes."
          : parcial
            ? `Facturado hasta el ${al ? fechaCorta(al) : "último día"} y proyectado al mes entero.`
            : "El mes cerrado, según la factura."
      }
    >
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[34rem] text-left text-dato">
          <thead>
            <tr className="border-b border-line text-meta text-inkSoft">
              <th scope="col" className="px-4 py-2.5 font-semibold">Rubro</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Proveedor</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Al mes</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">De dónde sale</th>
            </tr>
          </thead>
          <tbody>
            {v.costos.rubros.map((r) => (
              <tr key={r.rubro} className="border-b border-line/70 last:border-0">
                <td className="px-4 py-3 align-top">
                  <span className="block font-semibold text-ink">{r.titulo}</span>
                  {r.detalle && <span className="block text-meta text-inkSoft">{r.detalle}</span>}
                </td>
                <td className="px-4 py-3 align-top text-ink">{r.proveedor}</td>
                <td className="px-4 py-3 text-right align-top">
                  <span className="block font-mono tabular-nums text-ink">{dolares(r.montoUsd)}</span>
                  <span className="block font-mono text-meta tabular-nums text-inkSoft">{soles(Math.round(r.montoUsd * tc))}</span>
                </td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-rotulo font-semibold",
                      r.fuente === "factura" ? "bg-moss/10 text-mossTexto" : "bg-paperDeep text-inkSoft",
                    )}
                  >
                    {r.fuente === "factura" ? <Receipt size={12} aria-hidden /> : <CalendarClock size={12} aria-hidden />}
                    {r.fuente === "factura" ? "Factura" : "Estimado"}
                  </span>
                  {r.nota && <span className="mt-1 block text-rotulo leading-snug text-mute">{r.nota}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-paperSoft">
              <th scope="row" colSpan={2} className="px-4 py-3 text-left font-semibold text-ink">Total del mes</th>
              <td className="px-4 py-3 text-right">
                <span className="block font-mono font-semibold tabular-nums text-ink">{dolares(v.costos.totalUsd)}</span>
                <span className="block font-mono text-meta tabular-nums text-inkSoft">{soles(v.costos.totalPen)}</span>
              </td>
              <td className="px-4 py-3 text-rotulo text-mute">
                {v.tipoCambio.referencial ? "Tipo de cambio referencial" : `A ${v.tipoCambio.penPorUsd.toFixed(3)} soles por dólar (BCRP)`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Seccion>
  );
}

function LecturaIA({ v }: { v: ResumenVigilancia }) {
  const tc = v.tipoCambio.penPorUsd;
  return (
    <Seccion
      titulo="La lectura a fondo con IA"
      descripcion="Leer el expediente de un contrato contra la norma, los precios de mercado y sus antecedentes. Se mide en cada lectura."
    >
      <CifrasEnFila
        items={[
          {
            valor: v.ia.costoMedioUsd != null ? dolares(v.ia.costoMedioUsd) : "Sin dato",
            etiqueta: "cuesta, en promedio, leer un contrato",
            contexto: v.ia.costoMedioUsd != null ? `${soles(v.ia.costoMedioUsd * tc)}; ${numero(v.ia.lecturasTotal)} lecturas${v.ia.desde ? ` desde ${fechaCorta(v.ia.desde)}` : ""}` : undefined,
          },
          {
            valor: numero(v.ia.lecturasMes),
            etiqueta: v.ia.lecturasMes === 1 ? "lectura este mes" : "lecturas este mes",
            contexto: `${dolares(v.ia.costoMesUsd)} en IA`,
          },
          {
            valor: `~${numero(v.graves.porMes)}`,
            etiqueta: "contratos con banderas graves cada mes",
            contexto: "el promedio de los tres últimos meses",
            tono: "media",
          },
          {
            valor: v.graves.costoLeerlosUsd != null ? dolares(v.graves.costoLeerlosUsd) : "Sin dato",
            etiqueta: "costaría leerlos todos",
            contexto: v.graves.costoLeerlosUsd != null ? `${soles(v.graves.costoLeerlosUsd * tc)} al mes` : undefined,
          },
        ]}
      />
      <p className="mt-3 inline-flex items-start gap-1.5 text-meta text-inkSoft">
        <CircleDollarSign size={15} aria-hidden className="mt-0.5 shrink-0" />
        Por eso ya no pedimos «S/ 3 por contrato»: la lectura cuesta menos, y lo que sostiene a Vigía es lo de arriba, que se paga
        igual lea uno o mil.
      </p>
    </Seccion>
  );
}

function MesAMes({ v }: { v: ResumenVigilancia }) {
  if (!v.historial.length) return null;
  const tc = v.tipoCambio.penPorUsd;
  return (
    <Seccion titulo="Mes a mes" descripcion="Desde que Vigía corre en AWS (octubre de 2026).">
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[30rem] text-left text-dato">
          <thead>
            <tr className="border-b border-line text-meta text-inkSoft">
              <th scope="col" className="px-4 py-2.5 font-semibold">Mes</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Infraestructura</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">IA (lecturas)</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Recaudado</th>
            </tr>
          </thead>
          <tbody>
            {[...v.historial].reverse().map((m) => (
              <tr key={m.mes} className="border-b border-line/70 last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-semibold capitalize text-ink">{nombreMes(m.mes)}</th>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                  {m.costoUsd != null ? (
                    <>
                      {dolares(m.costoUsd)}
                      <span className="block text-meta text-inkSoft">{soles(Math.round(m.costoUsd * tc))}</span>
                    </>
                  ) : (
                    <span className="text-mute">Sin dato</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                  {dolares(m.iaUsd)}
                  <span className="block text-meta text-inkSoft">{`${numero(m.lecturas)} ${m.lecturas === 1 ? "lectura" : "lecturas"}`}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{soles(m.recaudadoPen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}
