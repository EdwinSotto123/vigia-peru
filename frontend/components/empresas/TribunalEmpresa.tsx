/**
 * La empresa ante el Tribunal de Contrataciones (API GET /empresas/:ruc/tribunal; migraciones 423-424): las apelaciones
 * en que tenía la buena pro (y si el Tribunal se la quitó) y los procedimientos sancionadores que el Tribunal ordenó
 * abrirle por lo que presentó en su oferta, cada uno con su resolución y su proceso. Sólo RUC 20, unido por el nombre
 * comprobado en la parte resolutiva. Server component; sin datos, nada.
 */
import Link from "next/link";
import { Award, Ban, Gavel } from "lucide-react";
import { EnlaceFuente, FuenteDato, Nota } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { cn } from "@/lib/utils";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { API_BASE } from "@/lib/api-client";
import { fechaConAnio, numero, solesCompacto } from "@/lib/formato";
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
  /** Procesos que ganó después de una orden de sancionador y antes de cualquier sanción, su monto y la primera orden. */
  ganadasConSancionador?: number;
  montoConSancionador?: number | null;
  sancionadorDesde?: string | null;
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

/** Qué pasó, en pocas palabras: va al lado de su marca (la buena pro que le quitaron, la que conservó, el sancionador). */
function papel(x: Resolucion): string {
  if (x.rol === "sancionador") return "Le ordenaron un sancionador";
  return x.leQuitaron ? "El Tribunal le quitó la buena pro" : "Apelaron su buena pro";
}

/**
 * Una resolución en un renglón (antes una tabla de cinco filas «Qué pasó / Fecha / Entidad / El proceso» por cada una):
 * la marca de lo que pasó (rojo si le quitaron la buena pro, ámbar un sancionador), la fecha, la entidad y el proceso, y
 * la resolución misma como enlace a su fuente.
 */
function ResolucionDeEmpresa({ x }: { x: Resolucion }) {
  const inf = x.rol === "sancionador" ? infraccionEnPalabras(x.infraccion ?? []) : null;
  const tono =
    x.rol === "sancionador" ? "border-amber/40 bg-amber-soft text-amberTexto" : x.leQuitaron ? "border-crimson/30 bg-crimson-soft text-crimsonTexto" : "border-line bg-paperSoft text-inkSoft";
  const Icono = x.rol === "sancionador" ? Gavel : x.leQuitaron ? Ban : Award;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border", tono)} aria-hidden>
        <Icono size={15} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-dato font-semibold text-ink">{papel(x)}</span>
          {inf ? <span className={cn("pill", tono)}>Por presunta {inf.toLowerCase()}</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-inkSoft">
          {x.fecha ? <Dato tipo="fecha">{fechaConAnio(x.fecha)}</Dato> : null}
          {x.entidad ? (
            <Dato tipo="entidad">
              {x.entidadRuc ? (
                <Link href={`/entidad/${x.entidadRuc}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                  {x.entidad}
                </Link>
              ) : (
                x.entidad
              )}
            </Dato>
          ) : null}
          {x.ocid ? (
            <Dato tipo="codigo" nombre="El proceso" mono>
              <Link href={rutaContrato(x.ocid)} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                {x.codigo ?? x.ocid}
              </Link>
            </Dato>
          ) : null}
        </p>
        <EnlaceFuente href={x.enlace} className="text-meta">
          {x.titulo}
        </EnlaceFuente>
      </div>
    </li>
  );
}

export async function TribunalEmpresa({ ruc }: { ruc: string }) {
  const d = await leer(ruc);
  if (!d || (!d.adjudicataria && !d.sancionadores)) return null;
  const total = d.adjudicataria + d.sancionadores;
  const cifras: Cifra[] = [
    { valor: numero(d.adjudicataria), etiqueta: "apelaciones contra su buena pro", contexto: "otro postor apeló lo que ganó" },
    {
      valor: numero(d.leQuitaron),
      etiqueta: "se la quitó el Tribunal",
      contexto: d.entidadesDondeLeQuitaron > 1 ? `en ${numero(d.entidadesDondeLeQuitaron)} entidades distintas` : "revocó o descalificó su oferta",
    },
    { valor: numero(d.sancionadores), etiqueta: "sancionadores ordenados", contexto: "por lo que presentó en su oferta" },
    ...(d.ganadasConSancionador
      ? [{
          valor: numero(d.ganadasConSancionador),
          etiqueta: "procesos ganados con un sancionador abierto",
          contexto: `${d.montoConSancionador ? `${solesCompacto(d.montoConSancionador)}, ` : ""}${d.sancionadorDesde ? `desde la orden del ${fechaConAnio(d.sancionadorDesde)}` : "después de la orden"}`,
        }]
      : []),
  ];
  return (
    <section aria-labelledby="tribunal-empresa" className="tarjeta overflow-clip rounded-2xl border border-line bg-paper">
      <div className="space-y-4 p-4 sm:p-5">
        <h3 id="tribunal-empresa" className="font-display text-bloque font-bold text-ink">
          Ante el Tribunal de Contrataciones
        </h3>
        <CifrasEnFila items={cifras} chico />
        <ul className="divide-y divide-line/70">
          {/* recorte: las 5 más recientes a la vista; las demás, plegadas debajo */}
          {d.data.slice(0, 5).map((x) => <ResolucionDeEmpresa key={`${x.enlace}-${x.rol}`} x={x} />)}
        </ul>
        {d.data.length > 5 ? (
          <details className="group">
            <summary className="cursor-pointer text-meta font-medium text-granate underline-offset-2 hover:underline">
              Ver {numero(d.data.length - 5)} resoluciones más
            </summary>
            <ul className="mt-3 divide-y divide-line/70">
              {d.data.slice(5).map((x) => <ResolucionDeEmpresa key={`${x.enlace}-${x.rol}`} x={x} />)}
            </ul>
          </details>
        ) : null}
        {/* Cómo leer las cifras, en su nota (antes un párrafo suelto entre las cifras y las resoluciones). */}
        <Nota>
          Un sancionador ordenado es la orden de investigar, no la sanción: el Tribunal decide después si la impone. Que le quiten la
          buena pro una vez puede ser un error del comité; varias, en entidades distintas, es un patrón. Todavía se están leyendo
          resoluciones: las cifras pueden crecer.
        </Nota>
        {total > d.data.length ? (
          <p className="text-meta text-mute">Se muestran las {numero(d.data.length)} más recientes de {numero(total)}.</p>
        ) : null}
      </div>
      <FuenteDato fuente="Resoluciones del Tribunal de Contrataciones en gob.pe, leídas por Vigía" className="border-t border-line px-4 py-2 sm:px-5" />
    </section>
  );
}
