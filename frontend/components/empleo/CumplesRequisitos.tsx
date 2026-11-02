"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Circle, CircleCheckBig, PartyPopper } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";

export interface Requisito {
  clave: string;
  titulo: string;
  /** Lo que pide en dos palabras, junto al título («1 año»). */
  resumen?: string;
  texto: string;
}

/**
 * SERVIR escribe varios requisitos en un solo texto, separados con asteriscos («Título de médico * colegiatura * rne»):
 * se parten para leerlos uno por uno, cada uno con su inicial en mayúscula.
 */
function partes(texto: string): string[] {
  return texto
    .split(/\s*\*+\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.charAt(0).toLocaleUpperCase("es") + x.slice(1));
}

/**
 * «¿Cumples?»: cada requisito de la plaza con su casilla. Lo marcado se guarda en este navegador (por aviso), así quien
 * vuelve a la ficha ve su avance; nunca sale del navegador. Arriba, la barra de cuántos cumple. Al marcarlos todos, ahí
 * mismo el botón para postular (o SERVIR, si la entidad no publicó su enlace): es el momento de hacerlo.
 */
export function CumplesRequisitos({
  aviso,
  requisitos,
  postular,
  servir,
  cerrada = false,
}: {
  aviso: number;
  requisitos: Requisito[];
  postular?: string | null;
  servir?: string;
  cerrada?: boolean;
}) {
  const clave = `gobserva-empleo:cumplo:${aviso}`;
  const [marcados, setMarcados] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(clave) ?? "[]");
      if (Array.isArray(v)) setMarcados(v.filter((x) => typeof x === "string"));
    } catch {
      /* sin almacenamiento, la lista funciona igual sin recordar */
    }
  }, [clave]);
  const alternar = (k: string) =>
    setMarcados((m) => {
      const nuevo = m.includes(k) ? m.filter((x) => x !== k) : [...m, k];
      try {
        window.localStorage.setItem(clave, JSON.stringify(nuevo));
      } catch {
        /* igual */
      }
      return nuevo;
    });
  if (!requisitos.length) return null;
  const n = requisitos.filter((r) => marcados.includes(r.clave)).length;
  const todos = n === requisitos.length;
  const destino = postular ?? servir;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-dato">
          <span className="font-semibold text-ink" aria-live="polite">
            Cumples {n} de {requisitos.length} {requisitos.length === 1 ? "requisito" : "requisitos"}
          </span>
          <span className="text-rotulo text-mute">Se guarda sólo en este navegador</span>
        </p>
        <span aria-hidden className="mt-2 block h-2 overflow-hidden rounded-full bg-paperDeep">
          <span className={cn("block h-full rounded-full transition-[width] duration-normal", todos ? "bg-moss" : "bg-granate")} style={{ width: `${(n / requisitos.length) * 100}%` }} />
        </span>
      </div>
      <ul className="divide-y divide-line">
        {requisitos.map((r) => {
          const ok = marcados.includes(r.clave);
          return (
            <li key={r.clave}>
              <button
                type="button"
                role="checkbox"
                aria-checked={ok}
                onClick={() => alternar(r.clave)}
                className="flex min-h-12 w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5"
              >
                {ok ? <CircleCheckBig size={20} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" /> : <Circle size={20} aria-hidden className="mt-0.5 shrink-0 text-mute" />}
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-dato font-semibold text-ink">{r.titulo}</span>
                    {r.resumen && <span className="rounded-full bg-paperDeep px-2 py-0.5 text-rotulo font-semibold text-inkSoft">{r.resumen}</span>}
                  </span>
                  {partes(r.texto).length > 1 ? (
                    // Dentro del botón sólo puede ir texto: cada parte en su línea, con un punto dibujado de viñeta.
                    <span className={cn("mt-1.5 block space-y-1 text-meta leading-relaxed", ok ? "text-mute" : "text-inkSoft")}>
                      {partes(r.texto).map((x, i) => (
                        <span key={i} className="flex gap-2">
                          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current" />
                          <span className="min-w-0">{x}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className={cn("mt-1 block whitespace-pre-line text-meta leading-relaxed", ok ? "text-mute" : "text-inkSoft")}>{r.texto}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {todos && (
        <div role="status" className="flex flex-col gap-3 border-t border-line bg-granate-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="flex items-start gap-2 text-dato text-ink">
            <PartyPopper size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            <span>
              {cerrada
                ? "Cumples todo lo que pedía, pero esta plaza ya cerró."
                : postular
                  ? "Cumples todo lo que pide. Revisa las bases en la web de la entidad y postula antes del cierre."
                  : "Cumples todo lo que pide. Revisa las bases de la entidad y postula antes del cierre."}
            </span>
          </p>
          {!cerrada && destino && (
            <a href={destino} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "min-h-11 shrink-0")}>
              {postular ? "Postular en la entidad" : "Ver en SERVIR"}
              <ArrowUpRight size={16} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
