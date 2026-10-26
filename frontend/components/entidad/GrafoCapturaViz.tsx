"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { tituloNatural } from "@/lib/landing";
import { plural, solesCompacto } from "@/lib/formato";
import { corto, esLazoFuerte, radioPorRaiz } from "@/lib/grafo";
import { Arista, ChipLeyenda, Nodo, type Tono } from "@/components/grafo/primitivos";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import type { GrafoCaptura } from "@/lib/poder";

/**
 * "Ver como red": las empresas ligadas a la gestión de una entidad (mapa de poder, migración 125), dibujadas. A la
 * izquierda las empresas, una por renglón y con su nombre derecho; a la derecha la entidad y el partido que la gobierna.
 * Cada línea es un lazo: roja si financió al partido o un socio trabaja en la entidad, ámbar si le vendió a la campaña;
 * el tamaño del punto, sus contratos con el lazo.
 *
 * Antes era un anillo con los nombres girados y cortados, a 560 px de ancho mínimo (scroll lateral en el celular), con
 * su propio panel y su propio aviso. Ahora es una vista más de la tabla `EmpresasLigadas` (que es la que se lee en el
 * celular): la abre "Ver como red" desde lg, con 4 empresas o más. Letra de 14 en un lienzo de 640: a 12 px o más en
 * pantalla en la columna del Inicio.
 */

const tonoLazo = (lazos: string[]): Tono => (esLazoFuerte(lazos) ? "crimson" : "amber");

const W = 640;
const FILA = 30;
const MARGEN = 24;
/** La columna de las empresas: el nombre va a su izquierda. */
const X_EMP = 300;
/** La entidad, y su radio. */
const X_ENT = 540;
const R_ENT = 30;

export function GrafoCapturaViz({ data }: { data: GrafoCaptura }) {
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const empresas = data.empresas;
  const n = empresas.length;
  // Lugar arriba para "La gobierna" y el partido, sobre la entidad.
  const H = Math.max(240, MARGEN * 2 + n * FILA);
  const yEnt = Math.max(H / 2, R_ENT + 64);
  // La columna de empresas, centrada en el alto (con pocas no quedan todas arriba).
  const y0 = (H - n * FILA) / 2;
  const maxC = Math.max(1, ...empresas.map((e) => e.contratos));
  const nodos = empresas.map((e, i) => ({
    e,
    y: y0 + FILA / 2 + i * FILA,
    r: radioPorRaiz(e.contratos, maxC, 5, 7),
    tono: tonoLazo(e.lazos),
  }));
  // La empresa que se lee abajo: la del cursor o el foco y, si no, la última tocada.
  const activa = empresas.find((e) => e.ruc === (hover ?? sel)) ?? null;
  const partido = tituloNatural(data.partido);

  return (
    <figure className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-manipulation select-none"
        role="group"
        aria-label={`Red de ${plural(n, "empresa ligada", "empresas ligadas")} a la gestión de ${partido}`}
      >
        {nodos.map((nd) => (
          <Arista
            key={`a${nd.e.ruc}`}
            x1={X_EMP}
            y1={nd.y}
            x2={X_ENT - R_ENT}
            y2={yEnt}
            tono={nd.tono}
            opacity={hover && hover !== nd.e.ruc ? 0.12 : 0.55}
          />
        ))}
        {nodos.map((nd) => {
          const nombre = tituloNatural(nd.e.nombre ?? `RUC ${nd.e.ruc}`);
          return (
            <Nodo
              key={`n${nd.e.ruc}`}
              x={X_EMP}
              y={nd.y}
              r={nd.r}
              tono={nd.tono}
              label={corto(nombre, 34)}
              anchor="end"
              fontSize={14}
              hovered={hover === nd.e.ruc}
              selected={sel === nd.e.ruc}
              atenuado={hover != null && hover !== nd.e.ruc}
              onEnter={() => setHover(nd.e.ruc)}
              onLeave={() => setHover(null)}
              onClick={() => setSel((s) => (s === nd.e.ruc ? null : nd.e.ruc))}
              aria={`${nombre}: ${plural(nd.e.contratos, "contrato", "contratos")} con el lazo, ${solesCompacto(nd.e.monto)}`}
            />
          );
        })}
        <text x={X_ENT} y={yEnt - R_ENT - 30} textAnchor="middle" className="fill-mute" style={{ fontSize: "12px" }}>
          La gobierna
        </text>
        <text x={X_ENT} y={yEnt - R_ENT - 12} textAnchor="middle" className="fill-granate font-semibold" style={{ fontSize: "14px" }}>
          {corto(data.partido, 22)}
        </text>
        <circle cx={X_ENT} cy={yEnt} r={R_ENT} className="fill-paperSoft stroke-ink" strokeWidth={2} />
        <text x={X_ENT} y={yEnt + 5} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "13px" }}>
          La entidad
        </text>
      </svg>

      {/* Lo de la empresa activa, o la leyenda: una línea debajo del dibujo, no otra caja al costado. */}
      <figcaption aria-live="polite" className="min-h-9">
        {activa ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-dato font-semibold text-ink">{tituloNatural(activa.nombre ?? `RUC ${activa.ruc}`)}</span>
            <CrucesCelda cruces={activa.lazos.map((tipo) => ({ tipo, severidad: esLazoFuerte([tipo]) ? "alta" : "media" }))} />
            <span className="font-mono text-meta tabular-nums text-inkSoft">{plural(activa.contratos, "contrato", "contratos")}</span>
            <span className="font-mono text-meta tabular-nums text-inkSoft">{solesCompacto(activa.monto)}</span>
            <Link href={`/empresa/${activa.ruc}`} prefetch={false} className="inline-flex min-h-8 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-4 hover:underline">
              Ver la empresa <ChevronRight size={14} aria-hidden />
            </Link>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <ChipLeyenda tono="crimson">Financió al partido o un socio trabaja en la entidad</ChipLeyenda>
            <ChipLeyenda tono="amber">Le vendió a la campaña</ChipLeyenda>
            <span className="text-rotulo text-mute">Más grande, más contratos. Toca una empresa para ver sus datos.</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
