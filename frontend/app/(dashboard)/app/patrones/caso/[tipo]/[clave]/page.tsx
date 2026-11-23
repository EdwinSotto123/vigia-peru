import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloudOff } from "lucide-react";
import { ColumnasAnio } from "@/components/charts/ColumnasAnio";
import { Ayuda, CapitulosRelato, EncabezadoPagina, EnUnaFrase, FuenteDato, Migas, Pagina, type CapituloRelato } from "@/components/patrones";
import { Indicadores } from "@/components/listado";
import { CronologiaCaso } from "@/components/patrones/caso/CronologiaCaso";
import { EvidenciaCaso } from "@/components/patrones/caso/EvidenciaCaso";
import { RedCaso } from "@/components/patrones/caso/RedCaso";
import { Badge } from "@/components/ui/Badge";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { ICONO_NIVEL, Severidad } from "@/components/ui/Severidad";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { getCasoPatron, rutaCaso, type CasoPatron, type SeveridadCaso } from "@/lib/casoPatron";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

export const revalidate = 900;

export async function generateMetadata({ params }: { params: { tipo: string; clave: string } }): Promise<Metadata> {
  const c = await getCasoPatron(params.tipo, params.clave);
  if (!c || c === "error") return { title: "Caso de un patrón" };
  // Un caso nombra a personas (con un apellido tapado): no se indexa, como las fichas de personas.
  return { title: `${c.titulo} | ${c.patron}`, description: c.frase.slice(0, 200), robots: { index: false, follow: true } };
}

const PESO: Record<SeveridadCaso, number> = { alta: 0, media: 1, baja: 2 };
const TONO: Record<SeveridadCaso, string> = {
  alta: "border-crimson/30 bg-crimson-soft/40",
  media: "border-amber/30 bg-amber-soft/40",
  baja: "border-line bg-paper",
};
const COLOR: Record<SeveridadCaso, string> = { alta: "text-crimsonTexto", media: "text-amberTexto", baja: "text-mute" };

/**
 * /app/patrones/caso/[tipo]/[clave]: la ficha de UN caso de un patrón (pedido del usuario del 2026-11-18: «esto no debería
 * llevar a la ficha de la entidad, sino que cada patrón detectado debería tener una ficha propia, que cuente una historia,
 * con nodos, secciones, involucrados, timelines y demás, fuentes»).
 *
 * La frase y las cifras arriba; debajo, los capítulos de a uno (CapitulosRelato, «menos scroll»): qué pasó hecho por hecho
 * (con lo de cada año en columnas), quiénes son en red, por qué llama la atención, cada orden con su enlace y qué revisar
 * con sus fuentes. El mismo molde para todos los patrones (lib/casoPatron.ts).
 */
export default async function CasoPatronPagina({ params }: { params: { tipo: string; clave: string } }) {
  const c = await getCasoPatron(params.tipo, params.clave);
  if (!c) notFound();
  if (c === "error") {
    return (
      <Pagina className="space-y-6">
        <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Patrones", href: "/app/patrones" }]} />
        <VacioEnLinea variante="compacta" tono="error" icono={<CloudOff size={16} />}>
          No pudimos armar este caso ahora. Vuelve a abrirlo en un momento.
        </VacioEnLinea>
      </Pagina>
    );
  }
  const razones = [...c.razones].sort((a, b) => PESO[a.severidad ?? "baja"] - PESO[b.severidad ?? "baja"]);
  const peor = razones.find((r) => r.severidad)?.severidad ?? undefined;
  const capitulos: CapituloRelato[] = [
    {
      id: "que-paso",
      titulo: "Qué pasó",
      tituloLargo: "La historia, hecho por hecho",
      bajada: "Lo que pasó, en orden: cuándo nacieron las empresas y entró su gente, cada compra o proceso y lo que llama la atención en su fecha.",
      conteo: c.hitos.length,
      contenido: (
        <div className="space-y-5">
          {c.serie && c.serie.anios.length > 1 && (
            <section className="space-y-2">
              <h3 className="text-cuerpo font-semibold text-ink">{c.serie.titulo}</h3>
              {/* La leyenda a la vista (la del gráfico sólo sale al pasar por un año); también separa el título del eje. */}
              <p className="flex flex-wrap gap-x-4 gap-y-1 pb-3 text-rotulo text-inkSoft">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: "rgb(var(--serie-1))" }} aria-hidden />
                  {c.serie.etiquetaA}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: "rgb(var(--serie-2))" }} aria-hidden />
                  {c.serie.etiquetaB}
                </span>
              </p>
              {/* El aire de arriba del eje ya lo trae el gráfico (ColumnasAnio, 2026-11-23). */}
              <div>
                <ColumnasAnio anios={c.serie.anios} etiquetaA={c.serie.etiquetaA} etiquetaB={c.serie.etiquetaB} etiqueta={c.serie.titulo} />
              </div>
            </section>
          )}
          <CronologiaCaso hitos={c.hitos} nodos={c.nodos} />
        </div>
      ),
    },
    {
      id: "quienes",
      titulo: "Quiénes son",
      tituloLargo: "Quiénes son y qué los une",
      bajada: "Cada involucrado y cada vínculo, con su fuente. Toca uno para ver su papel, sus cifras y su ficha.",
      conteo: c.nodos.length,
      contenido: <RedCaso caso={c} />,
    },
    {
      id: "por-que",
      titulo: "Por qué llama la atención",
      bajada: "Cada razón con su cifra, de la más grave a la más leve. Un patrón es un motivo para mirar, no una acusación.",
      conteo: razones.filter((r) => r.severidad).length,
      tono: peor,
      contenido: <Razones c={c} razones={razones} />,
    },
    {
      id: "evidencia",
      titulo: "La evidencia",
      tituloLargo: c.evidencia.titulo,
      bajada: "Una por una, con su enlace. Se buscan, se filtran por quién y por lo que las marca, y se descargan.",
      conteo: c.evidencia.total,
      contenido: (
        <div className="space-y-3">
          {c.evidencia.nota && (
            <p className="text-meta text-inkSoft">
              {c.evidencia.nota}{" "}
              {c.evidencia.masHref && (
                <a href={c.evidencia.masHref} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                  Ir a las compras
                </a>
              )}
            </p>
          )}
          <EvidenciaCaso filas={c.evidencia.filas} nodos={c.nodos} nombre={`caso-${c.tipo}-${c.clave}`} unidad={c.evidencia.unidad} />
        </div>
      ),
    },
    {
      id: "revisar",
      titulo: "Qué revisar",
      tituloLargo: "Qué revisar y de dónde sale cada dato",
      bajada: "Los pasos para confirmarlo o descartarlo, las fuentes oficiales y a dónde seguir en Vigía.",
      contenido: <Revisar c={c} />,
    },
  ];
  return (
    <Pagina className="space-y-6">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Patrones", href: "/app/patrones" },
          { etiqueta: c.patron, href: `/app/patrones?seccion=${c.tipo}` },
        ]}
      />
      <EncabezadoPagina
        titulo={c.titulo}
        bajada={
          <span className="flex flex-wrap items-center gap-2">
            <Severidad bandera={c.severidad} />
            <Badge variant="neutral">{c.patron}</Badge>
            {c.observacion ? <Badge variant="amber">En observación: todavía no cuenta para el puntaje</Badge> : null}
          </span>
        }
        ayuda={<Ayuda titulo="¿Qué es este caso?">{c.como_leerlo}</Ayuda>}
        acciones={
          c.entidad ? (
            <EnlaceAccion href={`/entidad/${c.entidad.ruc}?seccion=patrones`} prefetch={false} variante="secundario" flecha>
              Sus otros patrones
            </EnlaceAccion>
          ) : undefined
        }
      />
      <EnUnaFrase tono={c.severidad}>{c.frase}</EnUnaFrase>
      {/* Las cifras del caso en una franja (2026-11-23): eran cuatro cajitas sueltas con la etiqueta encima del número. */}
      <Indicadores
        franja
        items={c.cifras.map((x) => ({ valor: x.valor, etiqueta: x.etiqueta, contexto: x.contexto ?? undefined }))}
      />
      {/* Cada capítulo abierto en su tarjeta, con su título adentro (el usuario: «secciones que son solo texto sin fondo o
          forma»): antes el título del capítulo, su gráfico y su cronología iban sueltos sobre el fondo de la página. Se hace
          desde aquí, sin tocar CapitulosRelato: el panel es la `section` hija de su raíz. `.tarjeta` quita el marco de las
          tablas de adentro. */}
      <div className="tarjeta [&>div>section]:mt-3 [&>div>section]:rounded-2xl [&>div>section]:border [&>div>section]:border-line [&>div>section]:bg-paper [&>div>section]:p-4 sm:[&>div>section]:p-5">
        <CapitulosRelato capitulos={capitulos} etiqueta="Capítulos del caso" />
      </div>
    </Pagina>
  );
}

function Razones({ c, razones }: { c: CasoPatron; razones: CasoPatron["razones"] }) {
  if (!razones.length) {
    return <p className="text-dato text-inkSoft">{c.como_leerlo}</p>;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {razones.map((r) => {
        const s = r.severidad ?? "baja";
        const Icono = ICONO_NIVEL[s];
        return (
          <li key={r.titulo} className={cn("space-y-1.5 rounded-xl border px-4 py-3", TONO[s])}>
            <p className="flex items-center justify-between gap-3">
              <span className={cn("inline-flex items-center gap-1.5 text-meta font-semibold", COLOR[s])}>
                <Icono size={15} aria-hidden />
                {r.severidad ? (r.severidad === "alta" ? "Señal alta" : r.severidad === "media" ? "Señal media" : "Señal baja") : "Contexto"}
              </span>
              <span className="font-display text-bloque font-bold tabular-nums text-ink">{r.cifra}</span>
            </p>
            <p className="text-dato font-semibold leading-snug text-ink">{r.titulo}</p>
            <p className="text-meta leading-relaxed text-inkSoft text-pretty">{r.texto}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Revisar({ c }: { c: CasoPatron }) {
  return (
    <div className="space-y-5">
      <ol className="space-y-2">
        {c.revisar.map((p, i) => (
          <li key={i} className="flex gap-2.5 text-dato leading-snug text-inkSoft">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ol>
      <FuenteDato fuente="Los registros oficiales de cada dato" enlaces={c.fuentes} />
      {c.relacionados.length > 0 && (
        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="text-cuerpo font-semibold text-ink">Seguir en Vigía</h3>
          <ul className="flex flex-wrap gap-2">
            {c.relacionados.map((r, i) => (
              <li key={r.href}>
                <EnlaceAccion href={r.href} prefetch={false} variante={i === 0 ? "primario" : "secundario"} flecha>
                  {r.texto}
                </EnlaceAccion>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-rotulo text-mute">
        Enlace de este caso: <span className="font-mono">{rutaCaso(c.tipo, c.clave)}</span>. Hay {numero(c.nodos.length)} involucrados y {numero(c.hitos.length)} hechos fechados.
      </p>
    </div>
  );
}
