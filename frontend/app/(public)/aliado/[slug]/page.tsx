import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
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
import { InvitacionFinanciar } from "@/components/aliados/InvitacionFinanciar";
import { Cifras } from "@/components/ui/Cifras";
import { Ayuda } from "@/components/patrones";
import { FranjaTextil } from "@/components/marca";
import { getComprobanteDe, getPerfilAliado, resumirContribuciones } from "@/components/aliados/perfil";
import { getEstadoGlobal, type Comprobante } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { fecha, numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
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
 *
 * Contenedor: el `container-page` de la cabecera pública (esta ruta no tiene barra
 * lateral), sin la columna angosta centrada de antes: la ficha usa el ancho y queda
 * alineada con el logo de la cabecera. Las explicaciones, a un clic (§10.7).
 */

/** Aportes cuyo detalle por contrato se trae para abrir en el panel. Más allá, se enlaza. */
const MAX_DETALLE = 12;

const TIPO_LABEL: Record<"empresa" | "organizacion" | "persona", string> = {
  empresa: "Empresa",
  organizacion: "Organización",
  persona: "Persona",
};

const num = numero;

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
  const description = `${data.aliado.nombre} financió la lectura de ${plural(r.financiados, "contrato público", "contratos públicos")}; ${numero(r.leidos)} ya se leyeron. No eligió cuáles: se asignan por antigüedad.`;
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
    <div className="container-page space-y-8 py-8 sm:py-10">
      <Link href={volver} className="inline-flex min-h-[24px] items-center gap-1.5 text-sm text-inkSoft transition-colors duration-rapido hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Aliados de transparencia
      </Link>

      {esMaqueta && <AvisoMaqueta volverHref={hrefSinMaqueta("/app/aliados")} />}

      {/* Identidad, en su tarjeta de marca: la franja textil de 8 px es el
          reconocimiento de Vigía (DESIGN_SYSTEM.md §6). Un aliado de maqueta no la
          lleva: es un borrador y tiene que verse como tal. Sin kicker sobre el
          título: el contexto va debajo, donde informa en vez de competir con el nombre. */}
      <section
        aria-label={`Quién es ${aliado.nombre}`}
        className={cn(
          "overflow-hidden rounded-2xl border bg-paper",
          esMaqueta ? "border-dashed border-amber/60" : "border-line",
        )}
      >
        {!esMaqueta && <FranjaTextil alto={8} />}
        <div className="space-y-5 p-5 sm:p-7">
          <header className="flex items-center gap-4 sm:gap-5">
            <AvatarAliado tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} size="xl" maqueta={esMaqueta} />
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
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
                        texto: `Aporta desde el ${fecha(aliado.desde)}`,
                      }]
                    : []),
                  { icono: "aportes", texto: plural(r.aportes, "aporte", "aportes") },
                  {
                    icono: "regiones",
                    texto: `${num(r.regionesDistintas)} de ${num(regionesConCola)} regiones con cola`,
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
              regiones: r.regionesDistintas,
              regionesConCola,
              mesesAportando,
            })}
          />

          {aliado.descripcion && (
            <p className="max-w-[70ch] text-[15px] leading-relaxed text-inkSoft">{aliado.descripcion}</p>
          )}

          <ContactoAliado web={aliado.web} email={aliado.email} />
        </div>
      </section>

      {/* Lo que hizo leer: cifras con su denominador, no cuatro cajas con un número
          grande cada una. La tercera compara contra el país entero: es el único
          contexto que vuelve legible un "45" en un producto con 18 mil contratos. */}
      <section aria-labelledby="que-hizo-leer" className="space-y-6">
        <h2 id="que-hizo-leer" className="border-b border-line pb-2 font-display text-lg font-bold text-ink">
          Lo que hizo leer
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Proporcion
            parte={r.leidos}
            total={r.financiados}
            leyenda={`de sus ${num(r.financiados)} contratos financiados ya leídos`}
            tono="leido"
          />
          <Proporcion
            parte={r.conSenal}
            total={r.leidos}
            leyenda={`de sus ${num(r.leidos)} financiados leídos tienen señales`}
            tono="neutro"
          />
          {publicados > 0 && (
            <Proporcion
              parte={r.financiados}
              total={publicados}
              leyenda={`de los ${num(publicados)} contratos publicados`}
              tono="financiado"
            />
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <QueSalio leidos={r.leidos} conSenal={r.conSenal} enRevision={r.enRevision} sinSenal={r.sinSenal} />
          <RegionesDeAliado regiones={r.regiones} financiados={r.financiados} />
        </div>

        {r.enRevision > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-inkSoft">
            <Eye size={14} className="shrink-0 text-mute" aria-hidden />
            <span>
              <span className="font-mono font-semibold tabular-nums text-ink">{num(r.enRevision)}</span> de sus{" "}
              {num(r.leidos)} financiados leídos {r.enRevision === 1 ? "está" : "están"} en revisión
            </span>
            <Ayuda titulo="¿Por qué en revisión?">
              La autoevaluación de la lectura no alcanzó el umbral para publicar y decide una persona. No cuentan como
              señal hasta entonces.
            </Ayuda>
          </p>
        )}
      </section>

      <SenalesDeAliado senales={senales} nombre={aliado.nombre} esMaqueta={esMaqueta} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-2">
          <h2 className="font-display text-lg font-bold text-ink">Aporte por aporte, contrato por contrato</h2>
          <Cifras
            items={[
              { n: r.aportes, texto: r.aportes === 1 ? "aporte" : "aportes" },
              { n: r.financiados, texto: r.financiados === 1 ? "contrato" : "contratos" },
            ]}
          />
        </div>
        <PruebaIndependencia nombre={aliado.nombre} />
        <CadenaAliado nombre={aliado.nombre} items={items} esMaqueta={esMaqueta} />
        {contribuciones.length > MAX_DETALLE && (
          <p className="text-[12px] text-mute">
            Desde el aporte {num(MAX_DETALLE + 1)}, el detalle está en su comprobante público.
          </p>
        )}
      </section>

      <InvitacionFinanciar />
    </div>
  );
}
