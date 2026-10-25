import Link from "next/link";
import { getPoderEntidad, clavePartido } from "@/lib/poder";
import { tituloNatural } from "@/lib/landing";
import { numero, plural, solesCompacto } from "@/lib/formato";

/**
 * La «captura» política de una entidad (migración 125, mapa de poder): qué partido la gobierna y cuántos de sus contratos
 * ganaron empresas ligadas a ese partido — que le financiaron la campaña, que le vendieron a ella, o con un socio
 * contratado por la misma entidad. Son INDICIOS agregados para revisión humana, nunca una acusación. Si la entidad no
 * tiene gobierno electo mapeado, no muestra nada.
 */
export async function CapturaEntidad({ ruc }: { ruc: string }) {
  const p = await getPoderEntidad(ruc).catch(() => null);
  if (!p?.partido) return null;
  const periodo = p.periodoInicio ? `${p.periodoInicio.slice(0, 4)}–${p.periodoFin?.slice(0, 4) ?? ""}` : null;
  const captura = p.n_captura ?? 0;
  const stats = [
    { n: numero(captura), t: "contratos con indicio" },
    { n: solesCompacto(p.monto_captura ?? 0), t: "en esos contratos" },
    { n: numero(p.n_empresas ?? 0), t: plural(p.n_empresas ?? 0, "empresa ligada", "empresas ligadas") },
  ];
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-cuerpo font-semibold tracking-tight text-ink">Quién la gobierna, y a quién le compra</div>
        {periodo && <span className="text-rotulo text-mute">Gobierno {periodo}</span>}
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        La gobierna{" "}
        <Link href={`/app/poder/${clavePartido(p.partido)}`} className="font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
          {tituloNatural(p.partido)}
        </Link>
        {p.autoridad ? (
          <>
            , con {p.cargo_gob ? p.cargo_gob.toLowerCase() : "su autoridad"} <b className="text-ink">{tituloNatural(p.autoridad)}</b>
          </>
        ) : ""}
        .
      </p>
      {captura > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <div key={s.t} className="rounded-xl border border-line bg-paperSoft px-3 py-2">
                <div className="font-mono text-cuerpo font-semibold tabular-nums text-ink">{s.n}</div>
                <div className="text-rotulo text-mute">{s.t}</div>
              </div>
            ))}
          </div>
          <p className="text-meta leading-relaxed text-inkSoft">
            De esas empresas, <b className="text-ink">{numero(p.n_financiaron ?? 0)}</b> le financiaron la campaña,{" "}
            <b className="text-ink">{numero(p.n_vendieron ?? 0)}</b> le vendieron a ella y{" "}
            <b className="text-ink">{numero(p.n_socio ?? 0)}</b> tienen un socio contratado por esta entidad.
          </p>
          <p className="text-rotulo leading-relaxed text-mute">
            Son indicios para revisar —una empresa puede ganar de forma limpia—, no una acusación.
          </p>
        </>
      ) : (
        <p className="text-meta text-inkSoft">Sin indicios de captura con los registros actuales.</p>
      )}
    </section>
  );
}
