import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Database, EyeOff, FileSearch, ListOrdered, Receipt, Scale, ShieldCheck, Users } from "lucide-react";
import { EncabezadoPagina, FuenteDato, Migas, Pagina, Seccion } from "@/components/patrones";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { AporteVigilancia, type ParaAporte } from "@/components/financiar/AporteVigilancia";
import { MetaDelMes } from "@/components/financiar/MetaDelMes";
import { numero } from "@/lib/formato";
import { dolares, getPago, getVigilancia } from "@/lib/financiamiento";

export const metadata: Metadata = {
  title: "Ayúdanos a seguir vigilando",
  description:
    "Vigía cruza todos los días las órdenes, los contratos y las compras menores del Estado y lee a fondo lo más grave. Tu aporte de cada mes la mantiene encendida, con las cuentas abiertas.",
};

export const revalidate = 300;

/** En qué se usa lo que entra, en el orden en que se paga (las cifras, en /app/cuanto-cuesta). */
const USOS = [
  { Icono: Database, titulo: "La base de datos y los servidores", texto: "Millones de órdenes, contratos, planillas y visitas, cruzados entre sí todos los días." },
  { Icono: FileSearch, titulo: "La captura de datos", texto: "Bajar y ordenar cada semana lo que publican el OECE, el MEF, la Contraloría, el JNE, la ONPE y más." },
  { Icono: Bot, titulo: "La lectura a fondo con IA", texto: "Leer el expediente de los contratos con banderas graves, contra la norma y los precios de mercado." },
];

/** Lo que no cambia aunque cambie quién aporta (las reglas de independencia de siempre). */
const REGLAS = [
  { Icono: EyeOff, titulo: "El que paga no elige", texto: "Tu aporte va al fondo común. Ningún aporte decide qué entidad, empresa o contrato se revisa." },
  { Icono: ListOrdered, titulo: "Lo más grave primero", texto: "La lectura a fondo sigue el orden del riesgo: primero los contratos con más antecedentes graves." },
  { Icono: Scale, titulo: "Cuentas abiertas", texto: "Cuánto cuesta cada mes, de dónde sale cada cifra y cuánto entró, a la vista de todos." },
  { Icono: Receipt, titulo: "Comprobante público", texto: "Cada aporte tiene su código y su comprobante. Sin ranking por plata." },
  { Icono: ShieldCheck, titulo: "Conflicto de interés", texto: "Una empresa con sanción vigente o con alertas puede aportar, pero no recibe reconocimiento público." },
];

/**
 * /app/apoyar — «Ayúdanos a seguir vigilando» (pedido del usuario del 2026-10-28; migración 206): el pedido principal
 * deja de ser «S/ 3 por contrato» y pasa a ser un aporte de cada mes al fondo común. Arriba la meta del mes (lo que
 * cuesta seguir encendidos y leer a fondo lo más grave) y el formulario; abajo, lo que se vigila, en qué se usa y las
 * reglas que no cambian. `?para=<RUC o ubigeo>&nombre=` dice qué te trajo (la entidad o la región que mirabas): sólo
 * informa, no dirige lecturas. Financiar la lectura de una zona, entidad o partido sigue en /app/financiar.
 */
export default async function ApoyarPage({ searchParams }: { searchParams?: { para?: string; nombre?: string } }) {
  const [v, pago] = await Promise.all([getVigilancia(), getPago()]);
  const p = searchParams?.para ?? "";
  const nombre = (searchParams?.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const para: ParaAporte | null =
    nombre && /^\d{11}$/.test(p) ? { ruc: p, nombre } : nombre && /^\d{2}(\d{2}(\d{2})?)?$/.test(p) ? { ubigeo: p, nombre } : null;

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Ayúdanos a seguir vigilando", href: "/app/apoyar" }]} />
      <EncabezadoPagina
        titulo="Ayúdanos a seguir vigilando"
        bajada="Vigía cruza todos los días las órdenes, los contratos y las compras menores del Estado con sanciones, visitas, aportes y planillas, y lee a fondo lo más grave. Tu aporte de cada mes la mantiene encendida."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          {v ? <MetaDelMes v={v} /> : null}

          {v && (
            <Seccion titulo={`Lo que vigilamos en ${v.vigilamos.anio}`} descripcion="Todo, no una muestra: cada orden y cada contrato se cruza con los registros oficiales.">
              <CifrasEnFila
                items={[
                  { valor: numero(v.vigilamos.ordenes), etiqueta: "órdenes de compra y servicio", contexto: "cruzadas con sanciones, fechas y topes" },
                  { valor: numero(v.vigilamos.procesos), etiqueta: "procesos con buena pro", contexto: "con su ganador y sus postores" },
                  { valor: numero(v.vigilamos.contratosConBanderas), etiqueta: "contratos con banderas", contexto: `${numero(v.vigilamos.graves)} con algún antecedente grave`, tono: "media" },
                  {
                    valor: v.ia.costoMedioUsd != null ? dolares(v.ia.costoMedioUsd) : "Sin dato",
                    etiqueta: "cuesta leer uno a fondo con IA",
                    contexto: `promedio de ${numero(v.ia.lecturasTotal)} lecturas`,
                  },
                ]}
              />
            </Seccion>
          )}

          <Seccion titulo="En qué se usa tu aporte" descripcion="En este orden: primero lo que mantiene encendida a Vigía, después la lectura a fondo.">
            <ul className="grid gap-3 sm:grid-cols-3">
              {USOS.map(({ Icono, titulo, texto }) => (
                <li key={titulo} className="rounded-2xl border border-line bg-paper p-4">
                  <Icono size={18} aria-hidden className="text-granate" />
                  <p className="mt-2 text-dato font-semibold text-ink">{titulo}</p>
                  <p className="mt-1 text-meta leading-relaxed text-inkSoft">{texto}</p>
                </li>
              ))}
            </ul>
            <Link href="/app/cuanto-cuesta" prefetch={false} className="mt-3 inline-flex min-h-[32px] items-center gap-1 text-meta font-semibold text-granate hover:underline">
              Las cifras de cada rubro <ArrowRight size={14} aria-hidden />
            </Link>
          </Seccion>

          <Seccion titulo="Lo que no cambia">
            <ul className="grid gap-3 sm:grid-cols-2">
              {REGLAS.map(({ Icono, titulo, texto }) => (
                <li key={titulo} className="flex gap-3 rounded-2xl border border-line bg-paper p-4">
                  <Icono size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                  <span className="min-w-0">
                    <span className="block text-dato font-semibold text-ink">{titulo}</span>
                    <span className="mt-0.5 block text-meta leading-relaxed text-inkSoft">{texto}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Seccion>

          {v && (v.aliados.nombres.length > 0 || v.aliados.anonimos > 0) && (
            <Seccion titulo="Quiénes sostienen Vigía" descripcion="Quienes aportaron en los dos últimos meses y eligieron aparecer. Sin montos ni puestos.">
              <ul className="flex flex-wrap gap-2">
                {v.aliados.nombres.map((a) => (
                  <li key={`${a.nombre}-${a.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-meta text-ink">
                    <Users size={13} aria-hidden className="text-inkSoft" />
                    {a.slug ? <Link href={`/aliado/${a.slug}`} prefetch={false} className="hover:underline">{a.nombre}</Link> : a.nombre}
                    {a.periodicidad === "mensual" && <span className="text-rotulo text-mute">cada mes</span>}
                  </li>
                ))}
                {v.aliados.anonimos > 0 && (
                  <li className="inline-flex items-center rounded-full border border-dashed border-line px-3 py-1 text-meta text-inkSoft">
                    y {numero(v.aliados.anonimos)} {v.aliados.anonimos === 1 ? "persona anónima" : "personas anónimas"}
                  </li>
                )}
              </ul>
            </Seccion>
          )}

          <div className="rounded-2xl border border-dashed border-line p-4 text-meta text-inkSoft">
            ¿Prefieres financiar la lectura de los contratos de una región, una entidad o un partido? Sigue disponible para
            organizaciones.{" "}
            <Link href="/app/financiar" prefetch={false} className="font-semibold text-granate underline underline-offset-2">
              Financiar lecturas
            </Link>
          </div>

          <FuenteDato fuente="Factura de AWS, tarifa de Cloudflare, costo medido en cada lectura y tipo de cambio del BCRP (detalle en Cuánto cuesta Vigía)" />
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24">
          {pago ? (
            <AporteVigilancia pago={pago} para={para} />
          ) : (
            <p className="rounded-2xl border border-line bg-paper p-5 text-dato text-inkSoft">No pudimos leer los medios de pago ahora. Vuelve a intentarlo en un momento.</p>
          )}
        </aside>
      </div>
    </Pagina>
  );
}
