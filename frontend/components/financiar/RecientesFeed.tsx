import Link from "next/link";
import { EstadoVacio } from "@/components/patrones";
import { numero, relativo } from "@/lib/formato";
import { mensajePublicoVisible, type ContribucionReciente } from "@/lib/financiamiento";
import { Avatar } from "./RankingTable";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";

/**
 * Los últimos aportes confirmados. Cada uno se cuenta en contratos, nunca en soles
 * (PRODUCT.md: el reconocimiento se mide en contratos leídos), y enlaza a su
 * comprobante público, que es donde se ve en qué terminó.
 */
export function RecientesFeed({ items }: { items: ContribucionReciente[] }) {
  if (!items.length) {
    return (
      <EstadoVacio
        compacto
        titulo="Todavía no hay aportes confirmados"
        accion={
          <EnlaceAccion variante="secundario" href="#zonas">
            Elegir una zona
          </EnlaceAccion>
        }
      >
        Cuando se confirme el primero, aparece acá con su zona y su comprobante público.
      </EstadoVacio>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
      {items.map((c) => {
        const mensaje = mensajePublicoVisible(c.mensajePublico, c.pasarela);
        return (
          <li key={c.codigo} className="flex items-start gap-3 px-4 py-3">
            <Avatar tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-ink">
                <span className="font-semibold">{c.financiador}</span> financió la lectura de{" "}
                <span className="font-mono tabular-nums">{numero(c.contratos)}</span> {c.contratos === 1 ? "contrato" : "contratos"} en{" "}
                <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold text-granate underline-offset-2 hover:underline">{c.zona}</Link>
              </p>
              {mensaje && <p className="mt-0.5 line-clamp-2 text-[13px] italic text-inkSoft" title={mensaje}>“{mensaje}”</p>}
              <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[12px] text-mute">
                <span>{relativo(c.pagadaAt)}</span>
                <Link href={`/impacto/${c.codigo}`} className="font-mono underline-offset-2 hover:text-ink hover:underline">
                  {c.codigo}
                </Link>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
