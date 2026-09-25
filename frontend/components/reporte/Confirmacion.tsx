"use client";

// Pantalla de confirmación tras enviar el reporte (extraído de page.tsx).
//
// Antes prometía un viaje que no existe: "los agentes lo cruzan con el SEACE y
// SUNAT", "si calza con una alerta se vuelve caso convergente", "te avisamos".
// Ningún código hace eso hoy. Ahora dice sólo lo que pasa de verdad — y eso
// depende de qué se denunció: una denuncia de OBRA se publica al instante; una
// denuncia a una ENTIDAD nunca se publica (backend/api/src/lib/publicacion.ts,
// regla 3). Antes esta pantalla le decía a quien denunciaba una entidad que "ya
// está publicada" y le ofrecía "Ver mi denuncia", un enlace que daba 404.
//
// Es un momento de confirmación: lo acompaña la llamita (DESIGN_SYSTEM.md §2.3)
// y la franja textil de 8 px de las tarjetas de marca (§6).

import Link from "next/link";
import { Camera, ListChecks, MapPin } from "lucide-react";
import { REGIONES } from "@/lib/peru-data";
import { FranjaTextil, Llamita } from "@/components/marca";
import type { Modo } from "./types";

const boton =
  "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-rapido sm:w-auto";
const botonSecundario = `${boton} border border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50`;
const botonPrimario = `${boton} bg-granate text-paper hover:bg-granate-deep`;

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
  const publica = modo === "obra";
  const pasos = publica
    ? [
        { t: "Ya está publicada", d: "Aparece en la lista de denuncias ciudadanas y en el mapa, con tu foto y el lugar que indicaste." },
        { t: "Nadie la edita", d: "Se muestra tal como la escribiste. Es tu testimonio, no un hallazgo de Vigía." },
        { t: "Cómo se confirma", d: "Figura como confirmada cuando la respaldan dos o más reportes independientes del mismo lugar." },
      ]
    : [
        { t: "Quedó guardada", d: "Tu denuncia está registrada con el código de arriba, a nombre de la entidad que elegiste." },
        { t: "No se publica", d: "Las denuncias sobre una entidad quedan en reserva: no aparecen en la lista pública ni en el mapa." },
        { t: "Nadie la edita", d: "Se guarda tal como la escribiste. Es tu testimonio, no un hallazgo de Vigía." },
      ];

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-line bg-paper text-center">
        <FranjaTextil alto={8} />
        <div className="px-6 py-8 sm:py-10">
          <Llamita className="mx-auto w-12 text-granate" />
          <h2 className="mt-4 font-display text-2xl font-bold leading-tight text-ink text-balance sm:text-3xl">
            {publica ? "Tu denuncia ya está publicada" : "Recibimos tu denuncia"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-inkSoft text-pretty">
            Gracias por mirar donde el control del Estado no alcanza a llegar solo.
          </p>
          {/* El código es lo único que hay que anotar: alto contraste, tamaño de lectura y seleccionable de un toque. */}
          <div className="mx-auto mt-5 max-w-xs rounded-2xl border border-line bg-paperSoft px-4 py-3 text-ink">
            <div className="text-[13px] font-medium text-inkSoft">Anota el código de tu denuncia</div>
            <div className="mt-0.5 select-all font-mono text-2xl font-bold tracking-wide" translate="no">
              {id}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <h3 className="mb-4 inline-flex items-center gap-2 font-display text-[15px] font-bold text-ink">
          <ListChecks size={16} className="text-granate" aria-hidden /> Qué pasa ahora
        </h3>
        <ol className="space-y-3">
          {pasos.map((p, i) => (
            <li key={p.t} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate-soft text-xs font-bold tabular-nums text-granate" aria-hidden>
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="text-sm font-semibold text-ink">{p.t}</div>
                <div className="text-[13px] text-inkSoft">{p.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Enlaces con aspecto de botón, sin anidar un <button> dentro de un <a>. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {publica && (
          <Link href={`/app/denuncias/${encodeURIComponent(id)}`} className={botonSecundario}>
            Ver mi denuncia
          </Link>
        )}
        {publica && (
          <Link href={mapaHref} className={botonSecundario}>
            <MapPin size={16} aria-hidden /> Verla en el mapa
          </Link>
        )}
        {onOtra ? (
          <button type="button" onClick={onOtra} className={botonPrimario}>
            <Camera size={16} aria-hidden /> Denunciar algo más
          </button>
        ) : (
          <Link href="/reporte/nuevo" className={botonPrimario}>
            <Camera size={16} aria-hidden /> Denunciar algo más
          </Link>
        )}
      </div>
    </div>
  );
}
