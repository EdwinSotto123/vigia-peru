import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Migas, Pagina, EncabezadoPagina } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getPoderPartido } from "@/lib/poder";
import { GrafoPartido } from "@/components/entidad/GrafoPartido";

export async function generateMetadata({ params }: { params: { partido: string } }): Promise<Metadata> {
  return { title: `${decodeURIComponent(params.partido)} — Mapa de poder` };
}

/** Un partido en el mapa de poder: las entidades que gobierna y, en cada una, su captura (contratos a empresas ligadas). */
export default async function PoderPartidoPage({ params }: { params: { partido: string } }) {
  const nombre = decodeURIComponent(params.partido);
  const r = await getPoderPartido(nombre);
  if (!r?.partido) notFound();
  const { partido: p, entidades } = r;
  const conIndicio = entidades.filter((e) => e.n_captura > 0).sort((a, b) => b.n_captura - a.n_captura);
  const sinIndicio = entidades.length - conIndicio.length;

  const cifras: Indicador[] = [
    { valor: numero(p.n_entidades), etiqueta: "entidades que gobierna", contexto: `en ${numero(p.n_departamentos)} ${p.n_departamentos === 1 ? "departamento" : "departamentos"}` },
    { valor: numero(p.n_captura), etiqueta: "contratos con indicio", contexto: `en ${numero(p.n_entidades_con_captura)} de sus entidades` },
    { valor: solesCompacto(p.monto_captura), etiqueta: "monto con indicio", contexto: "de esos contratos" },
    { valor: numero(p.n_empresas), etiqueta: "empresas involucradas", contexto: "para revisión; no prueban nada por sí solas" },
  ];

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Mapa de poder", href: "/app/poder" }, { etiqueta: tituloNatural(p.partido) }]} />
      <EncabezadoPagina
        titulo={p.partido}
        bajada={`Las entidades que gobierna hoy y, en cada una, cuántos contratos ganaron empresas ligadas al partido. ${sinIndicio > 0 ? `${numero(sinIndicio)} entidades sin indicios no se listan.` : ""}`}
      />
      <Indicadores items={cifras} />

      {/* El grafo de captura del partido: entidades que gobierna ↔ empresas que se repiten en 2+ de ellas. Oculto si
          ninguna empresa se repite. Se trae aparte (su propia consulta) para no frenar la tabla. */}
      <Suspense fallback={null}>
        <GrafoPartido partido={p.partido} />
      </Suspense>

      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[720px] text-meta">
          <thead>
            <tr className="border-b border-line text-rotulo uppercase tracking-wide text-mute">
              <th className="px-4 py-2.5 text-left font-semibold">Entidad</th>
              <th className="px-3 py-2.5 text-left font-semibold">Autoridad</th>
              <th className="px-3 py-2.5 text-right font-semibold">Contratos con indicio</th>
              <th className="px-3 py-2.5 text-right font-semibold">Monto</th>
              <th className="px-4 py-2.5 text-left font-semibold">Desglose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {conIndicio.map((e) => (
              <tr key={e.entidad_ruc} className="transition-colors duration-rapido hover:bg-paperSoft">
                <td className="px-4 py-2.5">
                  <Link href={`/entidad/${e.entidad_ruc}`} className="font-semibold text-ink hover:text-granate hover:underline underline-offset-2">
                    {tituloNatural(e.entidad)}
                  </Link>
                  <span className="block text-rotulo text-mute">
                    {e.nivel === "regional" ? "Gobierno regional" : e.nivel === "provincial" ? "Municipalidad provincial" : "Municipalidad distrital"}
                    {e.departamento ? ` · ${tituloNatural(e.departamento)}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-inkSoft">{e.autoridad ? tituloNatural(e.autoridad) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{numero(e.n_captura)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{solesCompacto(e.monto_captura)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {e.n_financiaron > 0 && <Badge variant="crimson">{numero(e.n_financiaron)} le financiaron</Badge>}
                    {e.n_vendieron > 0 && <Badge variant="amber">{numero(e.n_vendieron)} vendieron a su campaña</Badge>}
                    {e.n_socio > 0 && <Badge variant="amber">{numero(e.n_socio)} socio dentro</Badge>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        «Gobierna» = ganó la alcaldía o la gobernación de esa jurisdicción (JNE), periodo vigente. Los indicios cruzan ONPE
        (aportes y campaña), RNP/SEACE (socios y contratos). Son señales para revisar, no una acusación.
      </p>
    </Pagina>
  );
}
