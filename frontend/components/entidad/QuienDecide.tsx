import { getEstructuraEntidad } from "@/lib/api-client";
import { tituloNatural } from "@/lib/landing";

/**
 * «Quién decide y firma los contratos» de una entidad, del grafo del Estado (migración 126): la autoridad que por ley
 * aprueba sus contrataciones (la AGA) y los altos funcionarios que hoy la ocupan. Acerca la responsabilidad: no solo
 * «la entidad contrató», sino quién decide. Si no hay data del grafo para esta entidad, no muestra nada.
 */
export async function QuienDecide({ ruc }: { ruc: string }) {
  const e = await getEstructuraEntidad(ruc).catch(() => null);
  if (!e?.disponible) return null;
  const funcionarios = e.funcionarios ?? [];
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-ink">Quién decide y firma los contratos</h2>
        <span className="text-rotulo text-mute">Estructura institucional, fuentes oficiales, corte {e.corte ?? "2026"}</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        Por ley, quien aprueba las contrataciones de esta entidad es la <b className="text-ink">{e.apruebaContratos}</b>.
      </p>
      {funcionarios.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {funcionarios.map((f, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-meta">
              <span className="font-medium text-ink">{tituloNatural(f.persona)}</span>
              <span className="text-inkSoft">{f.cargo}{f.organo ? ` (${f.organo})` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-rotulo leading-relaxed text-mute">
        Es la estructura de decisión según normas oficiales; la confianza varía y es un corte en el tiempo, no el
        organigrama en vivo.
      </p>
    </section>
  );
}
