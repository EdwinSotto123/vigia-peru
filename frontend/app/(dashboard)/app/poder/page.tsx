import type { Metadata } from "next";
import Link from "next/link";
import { Migas, Pagina, EncabezadoPagina, Ayuda } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getPoderPartidos, getPoderEntidades, clavePartido } from "@/lib/poder";
import { PoderVista } from "@/components/entidad/PoderVista";
import { PoderResumenGrafo } from "@/components/entidad/PoderResumenGrafo";

export const metadata: Metadata = {
  title: "Mapa de poder",
  description: "Qué partido gobierna cada entidad y cuánta de su contratación fue a empresas ligadas a ese partido.",
};

// ISR como el resto de los listados: si no, la página queda estática del build (y el build, sin el binding
// VIGIA_API_URL, pegaba al Cloud Run muerto y la dejaba en cero). Con revalidate se rearma en runtime con datos.
export const revalidate = 600;

/**
 * Mapa de poder: ranking de partidos por «captura» — de las entidades que gobiernan (municipios y gobiernos regionales,
 * periodo vigente, JNE), cuántos contratos ganaron empresas que les financiaron, les vendieron a su campaña o tienen un
 * socio contratado por la misma entidad. Son INDICIOS agregados para revisar, nunca una acusación.
 */
export default async function PoderPage() {
  const [r, re] = await Promise.all([getPoderPartidos(), getPoderEntidades()]);
  const todos = r?.data ?? [];
  const partidos = todos.filter((p) => p.n_captura > 0).sort((a, b) => b.n_captura - a.n_captura);
  const entidadesTop = re?.data ?? [];
  const entidades = entidadesTop.slice(0, 50);

  const totEnt = partidos.reduce((s, p) => s + p.n_entidades, 0);
  const totCap = partidos.reduce((s, p) => s + p.n_captura, 0);
  const totEmp = partidos.reduce((s, p) => s + p.n_empresas, 0);
  const cifras: Indicador[] = [
    { valor: numero(partidos.length), etiqueta: "partidos con indicios", contexto: `de ${numero(todos.length)} que gobiernan alguna entidad hoy` },
    { valor: numero(totEnt), etiqueta: "entidades que gobiernan", contexto: "municipios y gobiernos regionales, periodo vigente" },
    { valor: numero(totCap), etiqueta: "contratos con indicio de captura", contexto: "ganados por empresas ligadas al partido que gobierna" },
    { valor: numero(totEmp), etiqueta: "empresas involucradas", contexto: "para revisión; no prueban nada por sí solas" },
  ];

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Mapa de poder" }]} />
      <EncabezadoPagina
        titulo="Mapa de poder"
        bajada="Qué partido gobierna cada entidad y cuánta de su contratación fue a empresas ligadas a ese partido. Indicios para revisar, nunca una acusación."
        ayuda={
          <Ayuda titulo="¿Qué mide la «captura»?">
            De las entidades que un partido gobierna hoy (alcaldías y gobiernos regionales, JNE), cuántos de sus contratos los
            ganaron empresas que <b>le financiaron</b> la campaña, que <b>le vendieron</b> a la campaña, o que tienen un
            <b> socio contratado por la misma entidad</b> (puerta giratoria). Son cruces de registros públicos: señalan dónde
            mirar, no prueban corrupción.
          </Ayuda>
        }
      />
      <Indicadores items={cifras} />

      <PoderVista
        grafo={<PoderResumenGrafo partidos={partidos} entidades={entidadesTop} />}
        lista={
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[720px] text-meta">
          <thead>
            <tr className="border-b border-line text-rotulo uppercase tracking-wide text-mute">
              <th className="px-4 py-2.5 text-left font-semibold">Partido</th>
              <th className="px-3 py-2.5 text-right font-semibold">Entidades que gobierna</th>
              <th className="px-3 py-2.5 text-right font-semibold">Contratos con indicio</th>
              <th className="px-3 py-2.5 text-right font-semibold">Monto</th>
              <th className="px-3 py-2.5 text-right font-semibold">Empresas</th>
              <th className="px-4 py-2.5 text-left font-semibold">Desglose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {partidos.map((p) => (
              <tr key={p.partido} className="transition-colors duration-rapido hover:bg-paperSoft">
                <td className="px-4 py-2.5">
                  <Link href={`/app/poder/${clavePartido(p.partido)}`} className="font-semibold text-ink hover:text-granate hover:underline underline-offset-2">
                    {p.partido}
                  </Link>
                  <span className="block text-rotulo text-mute">{numero(p.n_departamentos)} {p.n_departamentos === 1 ? "departamento" : "departamentos"}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span className="text-ink">{numero(p.n_entidades)}</span>
                  <span className="block text-rotulo text-mute">{numero(p.n_entidades_con_captura)} con indicio</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{numero(p.n_captura)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{solesCompacto(p.monto_captura)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{numero(p.n_empresas)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {p.n_financiaron > 0 && <Badge variant="crimson">{numero(p.n_financiaron)} le financiaron</Badge>}
                    {p.n_vendieron > 0 && <Badge variant="amber">{numero(p.n_vendieron)} vendieron a su campaña</Badge>}
                    {p.n_socio > 0 && <Badge variant="amber">{numero(p.n_socio)} socio en la entidad</Badge>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        }
      />

      {entidades.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-seccion font-semibold text-ink">Entidades más capturadas</h2>
          <p className="text-meta leading-relaxed text-inkSoft">
            Baja del partido al municipio o gobierno regional concreto: dónde más contratos ganaron empresas ligadas al
            partido que lo gobierna. Toca una entidad para ver su ficha.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[720px] text-meta">
              <thead>
                <tr className="border-b border-line text-rotulo uppercase tracking-wide text-mute">
                  <th className="px-4 py-2.5 text-left font-semibold">Entidad</th>
                  <th className="px-4 py-2.5 text-left font-semibold">La gobierna</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Contratos con indicio</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Monto</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Desglose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {entidades.map((e) => (
                  <tr key={e.entidad_ruc} className="transition-colors duration-rapido hover:bg-paperSoft">
                    <td className="px-4 py-2.5">
                      <Link href={`/entidad/${e.entidad_ruc}`} className="font-semibold text-ink hover:text-granate hover:underline underline-offset-2">
                        {tituloNatural(e.entidad)}
                      </Link>
                      <span className="block text-rotulo text-mute">{[e.distrito, e.provincia, e.departamento].filter(Boolean).map((x) => tituloNatural(String(x))).join(", ")}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/app/poder/${clavePartido(e.partido)}`} className="text-inkSoft hover:text-granate hover:underline underline-offset-2">{tituloNatural(e.partido)}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{numero(e.n_captura)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">{solesCompacto(e.monto_captura)}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {e.n_financiaron > 0 && <Badge variant="crimson">{numero(e.n_financiaron)} le financiaron</Badge>}
                        {e.n_vendieron > 0 && <Badge variant="amber">{numero(e.n_vendieron)} vendieron a su campaña</Badge>}
                        {e.n_socio > 0 && <Badge variant="amber">{numero(e.n_socio)} socio adentro</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-rotulo leading-relaxed text-mute">
        Fuente: JNE (quién gobierna cada entidad), ONPE (aportes y gastos de campaña), RNP/SEACE (socios y contratos). Cada
        indicio es un cruce de registros públicos para revisión humana; no es una acusación ni una condena.
      </p>
    </Pagina>
  );
}
