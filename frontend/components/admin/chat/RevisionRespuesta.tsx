"use client";

import { useId, useState } from "react";
import { AlertTriangle, ChevronDown, Link2, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { Badge, plural } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { entero, type PorRevisar, type Revision } from "./conversacion";

/**
 * La revisión automática de una respuesta (evento `revision`, lib/revisionChat.ts del API): cuántos enlaces y montos en
 * soles salen de los datos consultados y, plegado, lo que no se encontró, con su motivo. Lo mismo se marca en el texto
 * (Respuesta.tsx). No dice que algo esté mal: dice que no sale tal cual de los datos.
 */
export function RevisionRespuesta({ r }: { r: Revision }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const porRevisar = r.enlaces.dudosos.length + r.montos.dudosos.length;
  const enlacesBien = r.enlaces.ok + r.enlaces.anteriores;
  const montosBien = r.montos.ok + r.montos.sumas + r.montos.anteriores;
  if (r.enlaces.total + r.montos.total === 0) return null;

  const parte = (bien: number, total: number, uno: string, varios: string) =>
    total === 0 ? null : bien === total ? (total === 1 ? `el ${uno}` : `los ${entero(total)} ${varios}`) : `${entero(bien)} de ${entero(total)} ${varios}`;
  const partes = [parte(enlacesBien, r.enlaces.total, "enlace", "enlaces"), parte(montosBien, r.montos.total, "monto", "montos")].filter(Boolean);
  const frase = `${partes.join(" y ")} ${enlacesBien + montosBien === 1 ? "sale" : "salen"} de los datos consultados.`;
  const detalle = [
    r.montos.sumas ? plural(r.montos.sumas, "es un total de tabla", "son totales de tabla") : null,
    r.enlaces.anteriores + r.montos.anteriores ? `${plural(r.enlaces.anteriores + r.montos.anteriores, "viene", "vienen")} de mensajes anteriores` : null,
  ].filter(Boolean);
  const Icono = porRevisar ? ShieldAlert : ShieldCheck;

  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={porRevisar ? abierto : undefined}
        aria-controls={porRevisar ? id : undefined}
        disabled={!porRevisar}
        onClick={() => setAbierto((a) => !a)}
        className="flex min-h-10 w-full items-start gap-2 px-4 py-2 text-left text-meta transition-colors duration-rapido enabled:hover:bg-paperDeep/50 sm:px-5"
      >
        <Icono size={15} className={cn("mt-0.5 shrink-0", porRevisar ? "text-amberTexto" : "text-mossTexto")} aria-hidden />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="font-medium text-ink">Revisión automática: </span>
          <span className="text-inkSoft">{frase.charAt(0).toUpperCase() + frase.slice(1)}</span>
          {detalle.length > 0 && <span className="text-mute"> ({detalle.join(", ")})</span>}
        </span>
        {porRevisar > 0 && (
          <>
            <Badge tono="warn" className="shrink-0">
              {plural(porRevisar, "por revisar", "por revisar")}
            </Badge>
            <ChevronDown size={15} className={cn("mt-0.5 shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />
          </>
        )}
      </button>
      {porRevisar > 0 && (
        <div id={id} hidden={!abierto} className="space-y-3 px-4 pb-3.5 pt-1 sm:px-5">
          {r.enlaces.dudosos.length > 0 && (
            <Grupo icono={Link2} titulo={`Enlaces por revisar (${entero(r.enlaces.dudosos.length)})`}>
              {r.enlaces.dudosos.map((d) => (
                <Fila key={`${d.url}-${d.texto}`} d={d} enlace />
              ))}
            </Grupo>
          )}
          {r.montos.dudosos.length > 0 && (
            <Grupo
              icono={Wallet}
              titulo={`Montos por revisar (${entero(r.montos.dudosos.length)})`}
              nota="No están tal cual en los datos consultados: pueden ser una suma o una cuenta del modelo."
            >
              {r.montos.dudosos.map((d) => (
                <Fila key={`${d.texto}-${d.contexto}`} d={d} />
              ))}
            </Grupo>
          )}
          <p className="text-rotulo leading-snug text-mute">
            Cada enlace y cada monto en soles se busca en lo que devolvieron las consultas de esta respuesta. Que algo esté por
            revisar no quiere decir que esté mal: hay que confirmarlo antes de publicarlo.
          </p>
        </div>
      )}
    </div>
  );
}

function Grupo({ icono: I, titulo, nota, children }: { icono: typeof Link2; titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="flex items-center gap-1.5 text-dato font-medium text-ink">
        <I size={13} className="shrink-0 text-mute" aria-hidden /> {titulo}
      </h4>
      {nota && <p className="mt-0.5 text-rotulo text-mute">{nota}</p>}
      <ul className="mt-1.5 space-y-1.5">{children}</ul>
    </section>
  );
}

function Fila({ d, enlace = false }: { d: PorRevisar; enlace?: boolean }) {
  return (
    <li className="flex min-w-0 gap-2">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
      <div className="min-w-0 flex-1 text-meta leading-snug">
        {enlace && d.url ? (
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-amberTexto underline decoration-amber decoration-dotted underline-offset-2 [overflow-wrap:anywhere]">
            {d.texto}
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : (
          <span className="font-mono font-medium tabular-nums text-ink">{d.texto}</span>
        )}
        {enlace ? (
          <p className="text-mute [overflow-wrap:anywhere]">{d.motivo}</p>
        ) : (
          d.contexto && <p className="text-mute [overflow-wrap:anywhere]">{d.contexto}</p>
        )}
      </div>
    </li>
  );
}
