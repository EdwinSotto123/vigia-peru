"use client";

// Pantalla de confirmación tras enviar el reporte (extraído de page.tsx).

import Link from "next/link";
import { Camera, Check, MapPin, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { REGIONES } from "@/lib/peru-data";
import type { Modo } from "./types";

export function Confirmacion({ id, modo, regionNombre }: { id: string; modo: Modo; regionNombre?: string | null }) {
  const regionId = REGIONES.find((r) => r.nombre === regionNombre)?.id ?? null;
  const pinHref = modo === "obra"
    ? `/app/mapa?${regionId ? `region=${regionId}&` : ""}tab=denuncias`
    : `/app/mapa${regionId ? `?region=${regionId}` : ""}`;
  const pasos =
    modo === "obra"
      ? [
          { t: "Entra al mapa", d: "Aparece como pin rojo en validación." },
          { t: "Los agentes lo cruzan", d: "Con alertas automáticas del SEACE y SUNAT." },
          { t: "Coincidencia → caso", d: "Si calza con una alerta, se vuelve caso convergente público." },
          { t: "Te avisamos", d: "Si dejaste email, cuando pase a verificado." },
        ]
      : [
          { t: "Llega a revisión", d: "Entra al panel privado de validación." },
          { t: "Los agentes contrastan", d: "Contra OECE, SUNAT, ONPE y JNE." },
          { t: "Evidencia → dictamen", d: "Si hay patrón, se publica en el perfil de la entidad." },
          { t: "Te avisamos", d: "Si dejaste correo." },
        ];

  return (
    <div className="space-y-5">
      {/* Cabecera celebratoria */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-ink px-6 py-10 text-center text-paper">
        <div className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-moss/25 blur-3xl" />
        <div className="relative">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-moss/20 ring-4 ring-moss/30">
            <Check size={40} strokeWidth={2.5} className="text-moss" />
          </div>
          <h2 className="mt-5 font-serif text-3xl font-bold leading-tight sm:text-4xl">
            Gracias por dar la cara.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-paper/75">
            Tu reporte ya entró al sistema. Acabás de hacer algo que el Estado no
            hace solo: poner un ojo donde no llega el control.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-paper/10 px-4 py-2 text-sm">
            <span className="text-paper/60">Código</span>
            <span className="font-mono font-bold text-amber">{id}</span>
          </div>
        </div>
      </div>

      {/* Qué pasa después — como un viaje */}
      <div className="surface p-6">
        <h3 className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-ink">
          <Zap size={14} className="text-clay" /> El viaje de tu reporte
        </h3>
        <ol className="space-y-3">
          {pasos.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="text-sm font-semibold text-ink">{p.t}</div>
                <div className="text-xs text-mute">{p.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href={pinHref}>
          <Button variant="secondary" full>
            <MapPin size={16} /> Ver mi pin en el mapa
          </Button>
        </Link>
        <Link href={`/app/denuncias/${encodeURIComponent(id)}`}>
          <Button variant="secondary" full>
            Ver la ficha del reporte
          </Button>
        </Link>
        <Link href="/reporte/nuevo">
          <Button variant="ink" full>
            <Camera size={16} /> Reportar algo más
          </Button>
        </Link>
      </div>
    </div>
  );
}
