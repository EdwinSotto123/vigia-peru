"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Requisito {
  clave: string;
  titulo: string;
  texto: string;
}

/**
 * «¿Cumples?»: cada requisito de la plaza con su casilla. Lo marcado se guarda en este navegador (por aviso), así quien
 * vuelve a la ficha ve su avance; nunca sale del navegador. Arriba, la barra de cuántos cumple.
 */
export function CumplesRequisitos({ aviso, requisitos, postular }: { aviso: number; requisitos: Requisito[]; postular?: string | null }) {
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
  return (
    <div className="rounded-2xl border border-line bg-paper">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <p className="flex items-center justify-between gap-3 text-dato">
          <span className="font-semibold text-ink">
            Cumples {n} de {requisitos.length} {requisitos.length === 1 ? "requisito" : "requisitos"}
          </span>
          <span className="text-meta text-mute">Se guarda sólo en este navegador</span>
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
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5"
              >
                {ok ? <CheckCircle2 size={20} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" /> : <Circle size={20} aria-hidden className="mt-0.5 shrink-0 text-mute" />}
                <span className="min-w-0">
                  <span className="block text-dato font-semibold text-ink">{r.titulo}</span>
                  <span className={cn("mt-0.5 block whitespace-pre-line text-meta leading-relaxed", ok ? "text-mute" : "text-inkSoft")}>{r.texto}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {todos && (
        <p className="flex items-start gap-2 border-t border-line bg-granate-50 px-4 py-3 text-dato text-ink sm:px-5" role="status">
          <PartyPopper size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
          <span>
            Cumples todo lo que pide. {postular ? "Revisa las bases en la publicación oficial y postula antes del cierre." : "Revisa las bases de la entidad y postula antes del cierre."}
          </span>
        </p>
      )}
    </div>
  );
}
