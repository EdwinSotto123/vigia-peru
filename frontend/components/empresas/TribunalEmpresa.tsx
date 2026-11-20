/**
 * La empresa ante el Tribunal de Contrataciones (API GET /empresas/:ruc/tribunal; migraciones 423-424): las apelaciones
 * en que tenía la buena pro (y si el Tribunal se la quitó) y los procedimientos sancionadores que el Tribunal ordenó
 * abrirle por lo que presentó en su oferta, cada uno con su resolución y su proceso. Sólo RUC 20, unido por el nombre
 * comprobado en la parte resolutiva. Server component; sin datos, nada.
 */
import Link from "next/link";
import { BloqueDetalle, DatosClave, EnlaceFuente, FuenteDato, type DatoClave } from "@/components/patrones";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { API_BASE } from "@/lib/api-client";
import { fechaConAnio, numero } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";

interface Resolucion {
  titulo: string;
  fecha: string | null;
  rol: "adjudicatario" | "sancionador";
  resultado: string | null;
  leQuitaron: boolean | null;
  infraccion: string[];
  enlace: string;
  ocid: string | null;
  codigo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
}
interface TribunalDeEmpresa {
  adjudicataria: number;
  leQuitaron: number;
  entidadesDondeLeQuitaron: number;
  sancionadores: number;
  data: Resolucion[];
}

async function leer(ruc: string): Promise<TribunalDeEmpresa | null> {
  try {
    const r = await fetch(`${API_BASE}/empresas/${ruc}/tribunal`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()) as TribunalDeEmpresa) : null;
  } catch {
    return null;
  }
}

function infraccionEnPalabras(inf: string[]): string | null {
  if (inf.includes("documentacion_falsa") && inf.includes("informacion_inexacta")) return "Documentación falsa o información inexacta";
  if (inf.includes("documentacion_falsa")) return "Documentación falsa";
  if (inf.includes("informacion_inexacta")) return "Información inexacta";
  return null;
}

function papel(x: Resolucion): string {
  if (x.rol === "sancionador") return "El Tribunal ordenó abrirle un procedimiento sancionador";
  return x.leQuitaron ? "Tenía la buena pro y el Tribunal se la quitó" : "Tenía la buena pro";
}

export async function TribunalEmpresa({ ruc }: { ruc: string }) {
  const d = await leer(ruc);
  if (!d || (!d.adjudicataria && !d.sancionadores)) return null;
  const cifras: Cifra[] = [
    { valor: numero(d.adjudicataria), etiqueta: "apelaciones contra su buena pro", contexto: "otro postor apeló lo que ganó" },
    {
      valor: numero(d.leQuitaron),
      etiqueta: "se la quitó el Tribunal",
      contexto: d.entidadesDondeLeQuitaron > 1 ? `en ${numero(d.entidadesDondeLeQuitaron)} entidades distintas` : "revocó o descalificó su oferta",
    },
    { valor: numero(d.sancionadores), etiqueta: "sancionadores ordenados", contexto: "por lo que presentó en su oferta" },
  ];
  return (
    <section aria-labelledby="tribunal-empresa" className="tarjeta overflow-clip rounded-2xl border border-line bg-paper">
      <div className="space-y-4 p-4 sm:p-5">
        <h3 id="tribunal-empresa" className="font-display text-bloque font-bold text-ink">
          Ante el Tribunal de Contrataciones
        </h3>
        <CifrasEnFila items={cifras} chico />
        <p className="text-meta leading-relaxed text-inkSoft">
          Un sancionador ordenado es la orden de investigar, no la sanción: el Tribunal decide después si la impone (mira su
          historial de sanciones). Que le quiten la buena pro una vez puede ser un error del comité; varias, en entidades distintas,
          es un patrón. Todavía se están leyendo resoluciones: las cifras pueden crecer.
        </p>
        {d.data.slice(0, 12).map((x) => {
          const datos: DatoClave[] = [
            { etiqueta: "Qué pasó", valor: papel(x) },
            { etiqueta: "Fecha", valor: x.fecha ? fechaConAnio(x.fecha) : null },
            { etiqueta: "Por presunta", valor: x.rol === "sancionador" ? infraccionEnPalabras(x.infraccion ?? []) : null },
            {
              etiqueta: "Entidad",
              valor: x.entidad && x.entidadRuc ? (
                <Link href={`/entidad/${x.entidadRuc}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                  {x.entidad}
                </Link>
              ) : x.entidad,
            },
            {
              etiqueta: "El proceso",
              valor: x.ocid ? (
                <Link href={rutaContrato(x.ocid)} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                  {x.codigo ?? x.ocid}
                </Link>
              ) : null,
            },
          ].filter((y) => y.valor != null && y.valor !== "");
          return (
            <BloqueDetalle key={`${x.enlace}-${x.rol}`} titulo={x.titulo}>
              <DatosClave items={datos} />
              <EnlaceFuente href={x.enlace} className="mt-2">
                Leer la resolución
              </EnlaceFuente>
            </BloqueDetalle>
          );
        })}
      </div>
      <FuenteDato fuente="Resoluciones del Tribunal de Contrataciones en gob.pe, leídas por Vigía" className="border-t border-line px-4 py-2 sm:px-5" />
    </section>
  );
}
