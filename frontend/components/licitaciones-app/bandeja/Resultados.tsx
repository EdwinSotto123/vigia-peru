"use client";

import type { ReactNode } from "react";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { cn } from "@/lib/utils";

/** Los resultados mientras llega la página nueva: atenuados y con aria-busy, para que se note que algo cambia. */
export function ResultadosVivos({ children }: { children: ReactNode }) {
  const { pendiente } = useLista();
  return (
    <div aria-busy={pendiente} className={cn("min-w-0 transition-opacity duration-normal", pendiente && "pointer-events-none opacity-55")}>
      {children}
    </div>
  );
}
