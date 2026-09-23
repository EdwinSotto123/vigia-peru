"use client";

// Pantalla de confirmación tras enviar el reporte (extraído de page.tsx).
//
// Antes prometía un viaje que no existe: "los agentes lo cruzan con el SEACE y
// SUNAT", "si calza con una alerta se vuelve caso convergente", "te avisamos".
// Ningún código hace eso hoy. Ahora dice sólo lo que pasa de verdad.

import Link from "next/link";
import { Camera, Check, ListChecks, MapPin } from "lucide-react";
import { REGIONES } from "@/lib/peru-data";
import type { Modo } from "./types";

const boton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors sm:w-auto";

export function Confirmacion({
  id,
  modo,
  regionNombre,
  onOtra,
}: {
  id: string;
  modo: Modo;
  regionNombre?: string | null;
  /** Vuelve a un formulario en blanco. Un enlace a /reporte/nuevo no alcanza: es la misma URL y el estado se queda. */
  onOtra?: () => void;
}) {
  const regionId = REGIONES.find((r) => r.nombre === regionNombre)?.id ?? null;
  const mapaHref = `/app/mapa?${regionId ? `region=${regionId}&` : ""}tab=denuncias`;
  const pasos =
    modo === "obra"
      ? [
          { t: "Ya está publicada", d: "Aparece en la lista de denuncias ciudadanas y en el mapa, con tu foto y el lugar que indicaste." },
          { t: "Nadie la edita", d: "Se muestra tal como la escribiste. Es tu testimonio, no un hallazgo de Vigía." },
          { t: "Cómo se confirma", d: "Figura como confirmada cuando la respaldan dos o más reportes independientes del mismo lugar." },
        ]
      : [
          { t: "Ya está publicada", d: "Aparece en la lista de denuncias ciudadanas, a nombre de la entidad que elegiste." },
          { t: "Nadie la edita", d: "Se muestra tal como la escribiste. Es tu testimonio, no un hallazgo de Vigía." },
        ];

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl border border-line bg-ink px-6 py-10 text-center text-paper">
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-moss/25 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-heroGreen/20 ring-4 ring-heroGreen/30">
            <Check size={40} strokeWidth={2.5} className="text-heroGreen" aria-hidden />
          </div>
          <h2 className="mt-5 font-serif text-3xl font-bold leading-tight sm:text-4xl">Gracias por dar la cara.</h2>
          <p className="mx-auto mt-2 max-w-md text-paper/80">
            Tu denuncia ya está publicada. Acabas de hacer algo que el control del Estado no alcanza a hacer solo: mirar
            donde no llega.
          </p>
          {/* El código es lo único que hay que anotar: alto contraste, tamaño de lectura y seleccionable de un toque. */}
          <div className="mx-auto mt-5 max-w-xs rounded-2xl bg-paper px-4 py-3 text-ink">
            <div className="text-[12px] font-medium text-inkSoft">Anota el código de tu denuncia</div>
            <div className="mt-0.5 select-all font-mono text-2xl font-bold tracking-wide">{id}</div>
          </div>
        </div>
      </div>

      <div className="surface p-6">
        <h3 className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-ink">
          <ListChecks size={14} className="text-heroViolet" aria-hidden /> Qué pasa ahora
        </h3>
        <ol className="space-y-3">
          {pasos.map((p, i) => (
            <li key={p.t} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper" aria-hidden>
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

      {/* Enlaces con aspecto de botón, sin anidar un <button> dentro de un <a>. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        <Link href={`/app/denuncias/${encodeURIComponent(id)}`} className={`${boton} border border-line bg-white text-ink hover:bg-line`}>
          Ver mi denuncia
        </Link>
        {modo === "obra" && (
          <Link href={mapaHref} className={`${boton} border border-line bg-white text-ink hover:bg-line`}>
            <MapPin size={16} aria-hidden /> Verla en el mapa
          </Link>
        )}
        {onOtra ? (
          <button type="button" onClick={onOtra} className={`${boton} bg-ink text-paper hover:bg-ink/90`}>
            <Camera size={16} aria-hidden /> Denunciar algo más
          </button>
        ) : (
          <Link href="/reporte/nuevo" className={`${boton} bg-ink text-paper hover:bg-ink/90`}>
            <Camera size={16} aria-hidden /> Denunciar algo más
          </Link>
        )}
      </div>
    </div>
  );
}
