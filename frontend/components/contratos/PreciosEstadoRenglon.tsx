"use client";

import { useState } from "react";
import { Landmark, LoaderCircle } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { Ayuda } from "@/components/patrones";
import { decimal, soles } from "@/lib/formato";

/**
 * En el panel de un renglón de la ficha: lo que pagó el Estado por lo mismo, buscado por las palabras del producto
 * (GET /patrones/precios-estado; migraciones 338-339). Se pide al tocar el botón, no al abrir la ficha: son varias
 * consultas por renglón y una ficha puede traer cien.
 */

interface Referencia {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  p25: number | null;
  mediana: number;
  p75: number | null;
}

/** La unidad comparable, como `unidad_norm` de la base (migración 338): «GALONES» y «gal» → «galon». */
function unidadNorm(t: string | null): string | null {
  const u = (t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  if (!u) return null;
  if (/^(gal|gln|gl)(on|ones)?$/.test(u)) return "galon";
  if (/^(kg|kgs|kilo|kilos|kilogramos?)$/.test(u)) return "kilogramo";
  if (/^(l|lt|lts|litros?)$/.test(u)) return "litro";
  if (/^(und|unid|unidad|unidades|u|un|pza|pieza|piezas)$/.test(u)) return "unidad";
  return u;
}

const FUENTE: Record<string, string> = {
  procesos: "Procesos del Estado",
  compras_menores: "Compras menores",
  perucompras: "Catálogo de Perú Compras",
  contratos_leidos: "Otros contratos leídos",
};

export function PreciosEstadoRenglon({
  producto,
  unidad,
  fecha,
  pagado,
}: {
  producto: string;
  unidad: string | null;
  /** La fecha del proceso: los precios del Estado se toman de antes de ella. */
  fecha: string | null;
  pagado: number | null;
}) {
  const [estado, setEstado] = useState<"inicio" | "cargando" | "listo" | "error">("inicio");
  const [refs, setRefs] = useState<Referencia[]>([]);
  const pedir = async () => {
    setEstado("cargando");
    const u = new URLSearchParams({ q: producto.slice(0, 300) });
    if (unidad) u.set("unidad", unidad);
    if (fecha && /^\d{4}-\d{2}-\d{2}/.test(fecha)) u.set("hasta", fecha.slice(0, 10));
    try {
      const r = await fetch(`${PUBLIC_API_BASE}/patrones/precios-estado?${u}`);
      if (!r.ok) throw new Error(String(r.status));
      setRefs(((await r.json()) as { referencias?: Referencia[] }).referencias ?? []);
      setEstado("listo");
    } catch {
      setEstado("error");
    }
  };
  if (producto.trim().length < 5) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 font-display text-bloque font-bold text-ink">
        Lo que pagó el Estado por lo mismo
        <Ayuda titulo="¿Cómo se busca?">
          Por las palabras que nombran el producto, en procesos adjudicados de los últimos 3 años, compras menores de los
          últimos 2, el catálogo de Perú Compras (con IGV) y otros contratos que Vigía leyó. Cada fuente da el cuartil 1,
          la mediana y el cuartil 3 en una sola unidad: si no es la del contrato, no se comparan.
        </Ayuda>
      </h3>
      {estado === "inicio" && (
        <button
          type="button"
          onClick={pedir}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-1.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:bg-paperSoft"
        >
          <Landmark size={14} aria-hidden />
          Buscar precios del Estado
        </button>
      )}
      {estado === "cargando" && (
        <p className="inline-flex items-center gap-1.5 text-meta text-mute" role="status">
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Buscando en procesos, compras menores y Perú Compras…
        </p>
      )}
      {estado === "error" && <p className="text-meta text-mute">No se pudo consultar ahora. Prueba otra vez en un momento.</p>}
      {estado === "listo" &&
        (refs.length ? (
          <ul className="divide-y divide-line/60 rounded-xl border border-line">
            {refs.map((x, i) => {
              // Sólo en la misma unidad: un «balde de 5 galones» no se compara con el precio por galón.
              const misma = !!x.unidad && unidadNorm(x.unidad) === unidadNorm(unidad);
              const veces = misma && pagado != null && x.mediana > 0 ? pagado / x.mediana : null;
              return (
                <li key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-meta font-semibold text-ink">{FUENTE[x.fuente] ?? x.fuente}</p>
                    <p className="text-rotulo text-mute">{x.detalle}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-meta font-semibold tabular-nums text-ink">{soles(x.mediana)}</p>
                    {x.p25 != null && x.p75 != null && (
                      <p className="font-mono text-rotulo tabular-nums text-mute">
                        {soles(x.p25)} a {soles(x.p75)}
                      </p>
                    )}
                    {veces != null && veces >= 1.15 && (
                      <p className="text-rotulo font-semibold text-amberTexto">se pagó {decimal(veces, 2)} veces la mediana</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-meta text-mute">Ninguna compra del Estado nombra este producto con las mismas palabras.</p>
        ))}
    </section>
  );
}
