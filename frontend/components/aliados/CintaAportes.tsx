import Link from "next/link";
import { numero, relativo } from "@/lib/formato";
import type { ContribucionReciente } from "@/lib/financiamiento";
import { NombreEntidad } from "@/components/financiar/NombreEntidad";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AvatarAliado } from "./TarjetaAliado";
import { PistaCinta } from "./PistaCinta";

/**
 * "Últimos aportes" como una cinta que se desplaza despacio (DESIGN_SYSTEM.md §14.6): cada aporte es una
 * píldora con quién se sumó y lleva a su recibo público. Un apoyo (migración 206) dice si es de cada mes y lo que lo
 * motiva; una lectura del modelo anterior, cuántos contratos y dónde. Con cinco aportes o más se mueve; con menos se
 * queda quieta y se muestran todos, porque una cinta con dos píldoras que da vueltas parece un error. Nunca soles: el
 * monto está en el recibo.
 *
 * El movimiento es CSS puro (globals.css: .cinta-pista): se detiene al pasar el cursor o al enfocar un
 * aporte, con su botón de detener (WCAG 2.2.2, `PistaCinta`), y con "reducir movimiento" no corre y la fila se
 * desliza a mano. La segunda mitad del bucle es una copia decorativa: `inert` y `aria-hidden`, así que ni el
 * teclado ni un lector de pantalla la ven repetida.
 *
 * Server-safe: el único estado (detenida o no) vive en `PistaCinta`.
 */

/** Dónde fue el aporte, en una frase corta (partido, entidad o zona). */
function dondeFue(c: ContribucionReciente) {
  if (c.partido) return <>los gobiernos de {c.partido.nombre}</>;
  if (c.entidad) return <NombreEntidad ruc={c.entidad.ruc} nombre={c.entidad.nombre} />;
  return <>{c.zona}</>;
}

/** Lo que motiva un apoyo (sólo informativo: el aporte va al fondo común). */
function motivo(c: ContribucionReciente) {
  if (c.paraRuc && c.paraEntidad) return <NombreEntidad ruc={c.paraRuc} nombre={c.paraEntidad} />;
  if (c.paraZona) return <>{c.paraZona}</>;
  return null;
}

function Pildora({ c }: { c: ContribucionReciente }) {
  if (c.tipoAporte === "apoyo") return <PildoraApoyo c={c} />;
  const deAlguien = !!c.entidad || !!c.partido;
  return (
    <li className="shrink-0">
      <Link
        href={`/impacto/${c.codigo}`}
        className="group/ap flex items-center gap-3 rounded-full border border-maiz/25 bg-paper/[0.06] py-2 pl-2 pr-5 transition-colors hover:border-maiz hover:bg-paper/[0.12] focus-visible:border-maiz"
      >
        <AvatarAliado tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} size="sm" />
        <span className="flex flex-col leading-tight">
          <span className="whitespace-nowrap text-dato text-paper">
            <span className="font-semibold">{c.financiador}</span> financió la lectura de{" "}
            <span className="font-display font-bold tabular-nums text-maiz">{numero(c.contratos)}</span>{" "}
            {c.contratos === 1 ? "contrato" : "contratos"} {deAlguien ? "de " : "en "}
            <span className="font-semibold">{dondeFue(c)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-rotulo text-paper/70">
            <span>{relativo(c.pagadaAt)}</span>
            <span className="font-mono group-hover/ap:text-maiz">{c.codigo}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Un apoyo al fondo común: quién se sumó, si es de cada mes y lo que lo motiva. */
function PildoraApoyo({ c }: { c: ContribucionReciente }) {
  const lo = motivo(c);
  return (
    <li className="shrink-0">
      <Link
        href={`/impacto/${c.codigo}`}
        className="group/ap flex items-center gap-3 rounded-full border border-maiz/25 bg-paper/[0.06] py-2 pl-2 pr-5 transition-colors hover:border-maiz hover:bg-paper/[0.12] focus-visible:border-maiz"
      >
        <AvatarAliado tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} size="sm" />
        <span className="flex flex-col leading-tight">
          <span className="whitespace-nowrap text-dato text-paper">
            <span className="font-semibold">{c.financiador}</span> se sumó a la vigilancia
            {c.periodicidad === "mensual" && <span className="font-semibold text-maiz"> cada mes</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-rotulo text-paper/70">
            <span>{relativo(c.pagadaAt)}</span>
            {lo && <span>Lo motiva {lo}</span>}
            <span className="font-mono group-hover/ap:text-maiz">{c.codigo}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

export function CintaAportes({ items, total }: { items: ContribucionReciente[]; total?: number }) {
  if (!items.length) return null;
  const mueve = items.length >= 5;
  // Unos 7 segundos por aporte: se alcanza a leer lo que pasa.
  const duracion = Math.max(40, items.length * 7);
  return (
    <section aria-labelledby="aportes-titulo" className="sobre-oscuro overflow-hidden rounded-2xl bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-1 pt-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 id="aportes-titulo" className="font-display text-bloque font-bold leading-tight">
            Últimos aportes
          </h2>
          <p className="text-meta text-paper/70">Quienes se suman a la vigilancia. Toca uno para ver su recibo.</p>
        </div>
        <EnlaceAccion href="/app/aliados/aportes" variante="oscuro" flecha>
          Ver todos los aportes{typeof total === "number" && total > items.length ? ` (${numero(total)})` : ""}
        </EnlaceAccion>
      </div>
      {mueve ? (
        // Se mueve sola, con su botón para detenerla (WCAG 2.2.2): PistaCinta guarda ese estado en el cliente.
        <PistaCinta duracion={duracion}>
          <ul className="flex gap-3 px-1.5" aria-label="Últimos aportes" data-lista="avance">
            {items.map((c) => (
              <Pildora key={c.codigo} c={c} />
            ))}
          </ul>
          <ul className="cinta-copia flex gap-3 px-1.5" aria-hidden {...({ inert: "" } as object)}>
            {items.map((c) => (
              <Pildora key={c.codigo} c={c} />
            ))}
          </ul>
        </PistaCinta>
      ) : (
        <div className="cinta-marco relative overflow-x-auto py-3">
          <div className="flex w-max gap-3 px-4 sm:px-5">
            <ul className="flex gap-3" aria-label="Últimos aportes" data-lista="avance">
              {items.map((c) => (
                <Pildora key={c.codigo} c={c} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
