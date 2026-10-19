"use client";

import { useState, type ReactNode } from "react";
import { Paginacion } from "@/components/ui/Paginacion";
import { Tabla, type Columna, type Fila } from "./Tabla";

/**
 * Listas que ya llegaron enteras del servidor (las órdenes de una entidad, sus proyectos de inversión) paginadas en el
 * cliente con el mismo control de todos los listados: "1–10 de 136" y anterior/siguiente, arriba y abajo. Antes eran
 * "Ver más / Ver menos" (o cortaban en silencio en 15 o 50).
 */
function usePaginas(n: number, tam: number) {
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(n / tam));
  const actual = Math.min(pagina, paginas);
  return { actual, paginas, desde: (actual - 1) * tam, hasta: actual * tam, setPagina };
}

function Control({ actual, paginas, total, tam, nombre, onChange }: { actual: number; paginas: number; total: number; tam: number; nombre: string; onChange: (n: number) => void }) {
  if (total <= tam) return null;
  return (
    <div className="flex justify-end">
      <Paginacion actual={actual} paginas={paginas} total={total} tam={tam} navegacion="interna" onChange={onChange} cargando={false} nombre={nombre} />
    </div>
  );
}

export function TablaPaginada({ columnas, filas, etiqueta, tam = 10, nombre }: { columnas: Columna[]; filas: Fila[]; etiqueta: string; tam?: number; nombre: string }) {
  const p = usePaginas(filas.length, tam);
  const control = <Control actual={p.actual} paginas={p.paginas} total={filas.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  return (
    <div className="space-y-3">
      {control}
      <Tabla columnas={columnas} filas={filas.slice(p.desde, p.hasta)} etiqueta={etiqueta} />
      {control}
    </div>
  );
}

export function ListaPaginada({ items, tam = 10, nombre, className }: { items: { id: string; contenido: ReactNode }[]; tam?: number; nombre: string; className?: string }) {
  const p = usePaginas(items.length, tam);
  const control = <Control actual={p.actual} paginas={p.paginas} total={items.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  return (
    <div className="space-y-3">
      {control}
      <ul className={className}>
        {items.slice(p.desde, p.hasta).map((x) => (
          <li key={x.id}>{x.contenido}</li>
        ))}
      </ul>
      {control}
    </div>
  );
}
