"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, PlayCircle, Search, Loader2 } from "lucide-react";

/**
 * Bloque para iniciar análisis de una convocatoria nueva de una entidad
 * específica. Permite pegar OCID/código corto, dispara `/app/convocatoria?run=`,
 * y ofrece búsqueda oficial en SEACE para encontrar IDs.
 */
export function AnalizarOtraConvocatoria({
  rucEntidad,
  nombreEntidad,
}: {
  rucEntidad: string;
  nombreEntidad: string;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [yendo, setYendo] = useState(false);

  const procesar = () => {
    const clean = codigo.trim();
    if (!clean) return;
    setYendo(true);
    // Acepta tanto OCID largo (ocds-...) como código corto numérico
    router.push(`/app/convocatoria?run=${encodeURIComponent(clean)}`);
  };

  // SEACE V3 búsqueda por entidad contratante (RUC). El portal usa este patrón.
  const seaceSearchUrl = `https://prodapp2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml`;
  const oeceContratosUrl = `https://contratacionesabiertas.oece.gob.pe/proveedores/${rucEntidad}`;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-6 py-4">
        <h3 className="font-serif text-xl font-bold text-ink">
          Analizar otra convocatoria de esta entidad
        </h3>
        <p className="text-sm text-mute">
          Pega el código (corto o OCID) de cualquier convocatoria del SEACE
          y disparamos el pipeline agéntico — toma ~10-15 min.
        </p>
      </div>

      <div className="grid gap-4 p-6 lg:grid-cols-[1.4fr,1fr]">
        {/* Input + run */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Código de convocatoria
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") procesar(); }}
              placeholder="Ej: 1212841   o   ocds-dgv273-seacev3-1212841"
              className="flex-1 rounded-xl border border-line bg-paperSoft px-4 py-2.5 font-mono text-sm placeholder:text-mute focus:border-clay focus:outline-none"
            />
            <button
              type="button"
              onClick={procesar}
              disabled={!codigo.trim() || yendo}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-coal disabled:opacity-40"
            >
              {yendo ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <PlayCircle size={15} />
              )}
              Analizar
            </button>
          </div>
          <p className="mt-2 text-[11px] text-mute">
            ⚠ Para que el análisis se complete, OECE debe estar accesible.
            Si el proxy está bloqueado verás un modal para pegar el JSON manualmente.
          </p>
        </div>

        {/* Helpers para encontrar IDs */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-mute">
            ¿No tienes el código? Búscalo
          </label>
          <a
            href={oeceContratosUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-sm hover:border-clay hover:bg-paperDeep"
            title={`Ver perfil de la entidad en Contrataciones Abiertas OECE`}
          >
            <span className="flex items-center gap-2">
              <Search size={13} className="text-clay" />
              <span className="truncate">
                <span className="text-mute">Perfil OECE:</span>{" "}
                <span className="font-mono text-ink">{rucEntidad}</span>
              </span>
            </span>
            <ExternalLink size={12} className="text-mute" />
          </a>
          <a
            href={seaceSearchUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-sm hover:border-clay hover:bg-paperDeep"
            title="Buscador público SEACE V3"
          >
            <span className="flex items-center gap-2">
              <Search size={13} className="text-clay" />
              <span className="truncate">Buscador SEACE V3</span>
            </span>
            <ExternalLink size={12} className="text-mute" />
          </a>
          <p className="text-[10px] leading-snug text-mute">
            Abrí el buscador, filtrá por &quot;{nombreEntidad.slice(0, 40)}
            {nombreEntidad.length > 40 ? "…" : ""}&quot; y copiá el código.
          </p>
        </div>
      </div>
    </section>
  );
}
