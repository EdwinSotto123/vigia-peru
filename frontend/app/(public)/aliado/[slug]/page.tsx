import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { AvatarAliado, Proporcion } from "@/components/aliados/TarjetaAliado";
import { CadenaAliado, type ContribucionAliado } from "@/components/aliados/CadenaAliado";
import { PruebaIndependencia } from "@/components/aliados/ReglasIndependencia";
import { getComprobante, getEstadoGlobal, type Comprobante } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { API_BASE } from "@/lib/api-client";

export const revalidate = 30;

/**
 * Ficha pública de un aliado. Es la única superficie del producto donde quien
 * financia tiene página propia, y se gana el lugar por una razón concreta: acá
 * sí se puede construir la cadena entera —aporte → contratos asignados →
 * entidad → señal— que es trazabilidad, no agradecimiento.
 *
 * Por eso la prueba de independencia vive al lado de los contratos y no en la
 * letra chica: la asignación es FIFO por antigüedad en SQL y el pipeline no
 * sabe quién financió. Mostrarlo donde el lector está mirando los contratos es
 * la diferencia entre demostrarlo y declararlo.
 *
 * Son ~1 + N fetches (perfil + comprobante por aporte). Con N acotado es
 * aceptable; pasado el tope, la fila enlaza al comprobante en vez de traerlo.
 */

/** Aportes cuyo detalle por contrato se trae para abrir en el panel. Más allá, se enlaza. */
const MAX_DETALLE = 12;

interface Aliado {
  id: number;
  tipo: "empresa" | "persona" | "organizacion";
  nombre: string;
  slug: string;
  logoUrl: string | null;
  desde: string;
}

const TIPO_LABEL: Record<Aliado["tipo"], string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

const num = (n: number) => n.toLocaleString("es-PE");

async function getAliado(slug: string): Promise<{ aliado: Aliado; contribuciones: ContribucionAliado[] } | null> {
  try {
    const r = await fetch(`${API_BASE}/financiamiento/aliados/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } } as any);
    if (r.ok) return await r.json();
  } catch { /* 404 abajo */ }
  return null;
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getAliado(params.slug);
  if (!data) return { title: "Aliado no encontrado — Vigía Perú" };
  const total = data.contribuciones.reduce((n, c) => n + c.contratos, 0);
  const leidos = data.contribuciones.reduce((n, c) => n + c.procesados, 0);
  const description = `${data.aliado.nombre} financió la lectura de ${total} contratos públicos; ${leidos} ya fueron leídos por los agentes. No eligió cuáles: se asignan por antigüedad.`;
  return {
    title: `${data.aliado.nombre} — Aliado de transparencia · Vigía Perú`,
    description,
    openGraph: { title: `${data.aliado.nombre} — Aliado de transparencia`, description },
    twitter: { card: "summary" },
  };
}

export default async function AliadoPage({ params }: { params: { slug: string } }) {
  const data = await getAliado(params.slug);
  if (!data) notFound();
  const { aliado, contribuciones } = data;

  const financiados = contribuciones.reduce((n, c) => n + c.contratos, 0);
  const leidos = contribuciones.reduce((n, c) => n + c.procesados, 0);
  const conSenal = contribuciones.reduce((n, c) => n + c.senales, 0);
  const enRevision = contribuciones.reduce((n, c) => n + (c.enRevision ?? 0), 0);
  const zonas = new Set(contribuciones.map((c) => c.ubigeo)).size;

  const conDetalle = contribuciones.slice(0, MAX_DETALLE);
  const [estado, resumen, comprobantes] = await Promise.all([
    getEstadoGlobal(),
    getResumenContratos(),
    Promise.all(conDetalle.map((c) => getComprobante(c.codigo))),
  ]);
  const porCodigo = new Map<string, Comprobante | null>(conDetalle.map((c, i) => [c.codigo, comprobantes[i] ?? null]));
  const items = contribuciones.map((contribucion) => ({
    contribucion,
    comprobante: porCodigo.get(contribucion.codigo) ?? null,
  }));

  const publicados = resumen?.total ?? 0;
  const regionesConCola = estado?.regionesConCola ?? 0;
  const esPlataforma = aliado.slug === "vigia-peru";

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <Link href="/app/aliados" className="inline-flex items-center gap-1.5 text-sm text-mute transition-colors duration-rapido hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Aliados de transparencia
        </Link>

        {/* Identidad. Sin kicker sobre el título: lo que antes era una píldora en
            versalitas encima del h1 ahora es la línea de contexto debajo, que es
            donde informa en vez de competir con el nombre. */}
        <header className="flex flex-wrap items-center gap-5">
          <AvatarAliado tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} size="xl" />
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">{aliado.nombre}</h1>
            <p className="mt-1 text-sm text-mute">
              {esPlataforma ? "La propia plataforma · capital semilla" : TIPO_LABEL[aliado.tipo]}
              {aliado.desde && ` · aporta desde ${new Date(aliado.desde).toLocaleDateString("es-PE", { month: "long", year: "numeric" })}`}
              {` · ${num(zonas)} de las ${num(regionesConCola)} regiones con cola abierta`}
            </p>
          </div>
        </header>

        {/* Cifras con su denominador, no cuatro cajas con un número grande cada una.
            La tercera compara contra el país entero: es el único contexto que vuelve
            legible un "45" en un producto con 18.394 contratos por leer. */}
        <section aria-label="Qué hizo posible este aporte" className="grid gap-4 sm:grid-cols-3">
          <Proporcion
            parte={leidos}
            total={financiados}
            leyenda={`de sus ${num(financiados)} contratos financiados ya leídos`}
            tono="leido"
          />
          <Proporcion
            parte={conSenal}
            total={leidos}
            leyenda="de los leídos traían al menos una señal"
            tono="neutro"
          />
          {publicados > 0 && (
            <Proporcion
              parte={financiados}
              total={publicados}
              leyenda={`de los ${num(publicados)} contratos públicos descargados`}
              tono="financiado"
            />
          )}
        </section>

        {enRevision > 0 && (
          <p className="flex items-start gap-2 rounded-2xl bg-paperDeep px-4 py-3.5 text-[12px] leading-relaxed text-inkSoft">
            <Eye size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            <span>
              <span className="font-mono font-semibold text-ink">{num(enRevision)}</span> de los {num(leidos)} leídos
              {enRevision === 1 ? " espera" : " esperan"} revisión humana: la autoevaluación del análisis no
              alcanzó el umbral para publicar y decide una persona. No cuentan como señal hasta entonces.
            </span>
          </p>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-2">
            <h2 className="font-serif text-lg font-bold text-ink">Aporte por aporte, contrato por contrato</h2>
            <p className="font-mono text-[12px] text-mute">
              {num(contribuciones.length)} {contribuciones.length === 1 ? "aporte" : "aportes"} ·{" "}
              {num(financiados)} contratos
            </p>
          </div>
          <PruebaIndependencia nombre={aliado.nombre} />
          <CadenaAliado nombre={aliado.nombre} items={items} />
          {contribuciones.length > MAX_DETALLE && (
            <p className="text-[12px] leading-relaxed text-mute">
              Los primeros {num(MAX_DETALLE)} aportes abren su lista de contratos acá mismo; el resto se
              consulta en su comprobante público, que trae exactamente el mismo detalle.
            </p>
          )}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-line bg-paperSoft px-5 py-4">
          <p className="max-w-[58ch] text-sm leading-relaxed text-inkSoft">
            Desde 5 contratos. Con tu nombre, como colectivo o sin nombre —{" "}
            <span className="text-mute">se cuenta en contratos leídos, nunca en soles.</span>
          </p>
          <Link
            href="/app/financiar"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-heroViolet-deep"
          >
            Financiar una auditoría <ArrowRight size={14} aria-hidden />
          </Link>
        </section>
      </div>
    </div>
  );
}
