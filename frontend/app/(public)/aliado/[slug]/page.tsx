import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { AvatarAliado, Proporcion } from "@/components/aliados/TarjetaAliado";
import { CadenaAliado } from "@/components/aliados/CadenaAliado";
import { PruebaIndependencia } from "@/components/aliados/ReglasIndependencia";
import { QueSalio } from "@/components/aliados/ResumenAliado";
import { RegionesDeAliado, SenalesDeAliado, senalesDeComprobantes } from "@/components/aliados/PerfilAliado";
import { AvisoMaqueta, SelloMaqueta } from "@/components/aliados/AvisoMaqueta";
import {
  ContactoAliado,
  IdentidadAliado,
  Insignias,
  insigniasDe,
  mesesDesde,
} from "@/components/aliados/IdentidadAliado";
import { Cifras } from "@/components/ui/Cifras";
import { getComprobanteDe, getPerfilAliado, resumirContribuciones } from "@/components/aliados/perfil";
import { getEstadoGlobal, type Comprobante } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { hrefSinMaqueta, maquetaActiva, queryMaqueta } from "@/lib/maqueta-aliados";

export const revalidate = 30;

/**
 * Ficha pública de un aliado. Es la única superficie del producto donde quien
 * financia tiene página propia, y se gana el lugar por una razón concreta: acá
 * sí se puede construir la cadena entera —aporte → contratos asignados →
 * entidad → señal— que es trazabilidad, no agradecimiento.
 *
 * Lo que faltaba y ahora está, porque la ficha tiene que valer el viaje desde
 * el muro: **en qué regiones cayó** lo que pagó, **qué salió** en el conjunto
 * de sus contratos (antes había que abrir los cinco paneles uno por uno para
 * enterarse) y **las señales concretas**, ordenadas por score, con su enlace al
 * dossier. La prueba de independencia sigue pegada a la lista de contratos y no
 * en la letra chica: la asignación es FIFO por antigüedad en SQL y el pipeline
 * no sabe quién financió. Mostrarlo donde el lector está mirando los contratos
 * es la diferencia entre demostrarlo y declararlo.
 *
 * Son ~1 + N fetches (perfil + comprobante por aporte). Con N acotado es
 * aceptable; pasado el tope, la fila enlaza al comprobante en vez de traerlo.
 */

/** Aportes cuyo detalle por contrato se trae para abrir en el panel. Más allá, se enlaza. */
const MAX_DETALLE = 12;

const TIPO_LABEL: Record<"empresa" | "organizacion" | "persona", string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

const num = (n: number) => n.toLocaleString("es-PE");

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { maqueta?: string };
}) {
  const data = await getPerfilAliado(params.slug, maquetaActiva(searchParams?.maqueta));
  if (!data) return { title: "Aliado no encontrado" };
  const r = resumirContribuciones(data.contribuciones);
  if (data.esMaqueta) {
    return {
      title: `${data.aliado.nombre} (maqueta)`,
      description: "Aliado inventado para probar el diseño. No existe y sus cifras no son reales.",
      robots: { index: false, follow: false },
    };
  }
  const description = `${data.aliado.nombre} financió la lectura de ${r.financiados} contratos públicos; ${r.leidos} ya fueron leídos por los agentes. No eligió cuáles: se asignan por antigüedad.`;
  return {
    title: `${data.aliado.nombre}, aliado de transparencia`,
    description,
    openGraph: { title: `${data.aliado.nombre}, aliado de transparencia`, description },
    twitter: { card: "summary" },
  };
}

export default async function AliadoPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { maqueta?: string };
}) {
  const maqueta = maquetaActiva(searchParams?.maqueta);
  // Sin el interruptor, un slug de maqueta es un 404 igual que cualquier slug
  // inexistente: los aliados inventados no existen por defecto.
  const data = await getPerfilAliado(params.slug, maqueta);
  if (!data) notFound();
  const { aliado, contribuciones, esMaqueta } = data;

  const r = resumirContribuciones(contribuciones);
  const conDetalle = contribuciones.slice(0, MAX_DETALLE);
  const [estado, resumen, comprobantes] = await Promise.all([
    getEstadoGlobal(),
    getResumenContratos(),
    Promise.all(conDetalle.map((c) => getComprobanteDe(c.codigo, esMaqueta))),
  ]);
  const porCodigo = new Map<string, Comprobante | null>(conDetalle.map((c, i) => [c.codigo, comprobantes[i] ?? null]));
  const items = contribuciones.map((contribucion) => ({
    contribucion,
    comprobante: porCodigo.get(contribucion.codigo) ?? null,
  }));
  const senales = senalesDeComprobantes(items);

  const publicados = resumen?.total ?? 0;
  const regionesConCola = estado?.regionesConCola ?? 0;
  const esPlataforma = aliado.slug === "vigia-peru";
  const mesesAportando = mesesDesde(aliado.desde);
  const volver = `/app/aliados${queryMaqueta(esMaqueta)}`;

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <Link href={volver} className="inline-flex items-center gap-1.5 text-sm text-mute transition-colors duration-rapido hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Aliados de transparencia
        </Link>

        {esMaqueta && <AvisoMaqueta volverHref={hrefSinMaqueta("/app/aliados")} />}

        {/* Identidad. Sin kicker sobre el título: lo que antes era una píldora en
            versalitas encima del h1 ahora es la línea de contexto debajo, que es
            donde informa en vez de competir con el nombre. */}
        <header className="flex items-center gap-4 sm:gap-5">
          <AvatarAliado tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} size="xl" maqueta={esMaqueta} />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
              {aliado.nombre}
              {esMaqueta && <SelloMaqueta />}
            </h1>
            {/* Antes acá había una cadena de texto plano unida por puntos
                medios: "Organización · aporta desde junio de 2026 · 3 aportes ·
                3 de las 25 regiones con cola abierta". Cuatro datos de
                naturaleza distinta pegados con un separador que no es ni una
                coma ni una lista, y que obliga a parsear el renglón entero para
                sacar uno solo. Cada dato es ahora su propio elemento con su
                ícono. */}
            <IdentidadAliado
              className="mt-1.5"
              datos={[
                {
                  icono: aliado.tipo === "empresa" ? "tipo-empresa" : aliado.tipo === "persona" ? "tipo-persona" : "tipo-organizacion",
                  texto: esPlataforma ? "La propia plataforma, con capital semilla" : TIPO_LABEL[aliado.tipo],
                },
                ...(aliado.desde
                  ? [{
                      icono: "fecha" as const,
                      texto: `Desde ${new Date(aliado.desde).toLocaleDateString("es-PE", { month: "long", year: "numeric" })}`,
                    }]
                  : []),
                { icono: "aportes", texto: `${num(r.aportes)} ${r.aportes === 1 ? "aporte" : "aportes"}` },
                {
                  icono: "regiones",
                  texto: `${num(r.regiones.length)} de ${num(regionesConCola)} regiones con cola`,
                  titulo: "Regiones con cola abierta que alcanzaron sus aportes. La zona sí se elige; los contratos concretos, no.",
                },
              ]}
            />
          </div>
        </header>

        {/* Insignias: todas derivadas de sus propias cifras, ninguna a dedo. */}
        <Insignias
          insignias={insigniasDe({
            esFundador: esPlataforma,
            financiados: r.financiados,
            leidos: r.leidos,
            regiones: r.regiones.length,
            regionesConCola,
            mesesAportando,
          })}
        />

        {aliado.descripcion && (
          <p className="max-w-[70ch] text-[15px] leading-relaxed text-inkSoft">{aliado.descripcion}</p>
        )}

        <ContactoAliado web={aliado.web} email={aliado.email} />

        {/* Cifras con su denominador, no cuatro cajas con un número grande cada una.
            La tercera compara contra el país entero: es el único contexto que vuelve
            legible un "45" en un producto con 18.394 contratos por leer. */}
        <section aria-label="Qué hizo posible este aporte" className="grid gap-4 sm:grid-cols-3">
          <Proporcion
            parte={r.leidos}
            total={r.financiados}
            leyenda={`de sus ${num(r.financiados)} contratos financiados ya leídos`}
            tono="leido"
          />
          <Proporcion
            parte={r.conSenal}
            total={r.leidos}
            leyenda="de los leídos traían al menos una señal"
            tono="neutro"
          />
          {publicados > 0 && (
            <Proporcion
              parte={r.financiados}
              total={publicados}
              leyenda={`de los ${num(publicados)} contratos públicos descargados`}
              tono="financiado"
            />
          )}
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          <QueSalio leidos={r.leidos} conSenal={r.conSenal} enRevision={r.enRevision} sinSenal={r.sinSenal} />
          <RegionesDeAliado regiones={r.regiones} financiados={r.financiados} />
        </div>

        {r.enRevision > 0 && (
          <p className="flex items-start gap-2 rounded-2xl bg-paperDeep px-4 py-3.5 text-[12px] leading-relaxed text-inkSoft">
            <Eye size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            <span>
              <span className="font-mono font-semibold text-ink">{num(r.enRevision)}</span> de los {num(r.leidos)} leídos
              {r.enRevision === 1 ? " espera" : " esperan"} revisión humana: la autoevaluación del análisis no
              alcanzó el umbral para publicar y decide una persona. No cuentan como señal hasta entonces.
            </span>
          </p>
        )}

        <SenalesDeAliado senales={senales} nombre={aliado.nombre} esMaqueta={esMaqueta} />

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-2">
            <h2 className="font-serif text-lg font-bold text-ink">Aporte por aporte, contrato por contrato</h2>
            <Cifras
              items={[
                { n: r.aportes, texto: r.aportes === 1 ? "aporte" : "aportes" },
                { n: r.financiados, texto: "contratos" },
              ]}
            />
          </div>
          <PruebaIndependencia nombre={aliado.nombre} />
          <CadenaAliado nombre={aliado.nombre} items={items} esMaqueta={esMaqueta} />
          {contribuciones.length > MAX_DETALLE && (
            <p className="text-[12px] leading-relaxed text-mute">
              Los primeros {num(MAX_DETALLE)} aportes abren su lista de contratos acá mismo; el resto se
              consulta en su comprobante público, que trae exactamente el mismo detalle.
            </p>
          )}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-line bg-paperSoft px-5 py-4">
          <p className="max-w-[58ch] text-sm leading-relaxed text-inkSoft">
            Desde 5 contratos. Con tu nombre, como colectivo o sin nombre: se cuenta en contratos
            leídos, nunca en soles.
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
