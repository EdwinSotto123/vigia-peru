"use client";

import Link from "next/link";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { Cadena } from "@/lib/cadena";
import { AyudaTermino } from "@/components/patrones";

/**
 * Capa C — la cadena de captura (combina Capa A + Capa B): [empresas ligadas] → [partido + su autoridad] → [la entidad]
 * → [quién aprueba/decide sus contratos], cerrando el círculo. Son INDICIOS de registros públicos para revisión humana,
 * NUNCA una acusación. Oculto si no hay partido ni empresas ligadas.
 */
const fuerte = (ls: string[]) => ls.includes("partido_gobernante") || ls.includes("socio_en_entidad");
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function Paso({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-5 text-rotulo text-mute" aria-hidden>
      <span className="text-granate">↓</span> {texto}
    </div>
  );
}

export function CadenaCaptura({ cadena }: { cadena: Cadena }) {
  if (!cadena?.disponible || !cadena.partido || !(cadena.empresas && cadena.empresas.length)) return null;
  const empresas = cadena.empresas;
  const cap = cadena.captura;
  const dec = cadena.decision;

  const comoLigan: string[] = [];
  if (cap && cap.n_financiaron > 0) comoLigan.push(`${numero(cap.n_financiaron)} le financiaron la campaña`);
  if (cap && cap.n_socio > 0) comoLigan.push(`${numero(cap.n_socio)} tienen un socio contratado por la entidad`);
  if (cap && cap.n_vendieron > 0) comoLigan.push(`${numero(cap.n_vendieron)} le vendieron a la campaña`);
  const ligazon = comoLigan.length ? comoLigan.join(", ") : "ligadas al partido";

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="text-cuerpo font-semibold tracking-tight text-ink">La cadena de captura</div>
      <p className="text-meta leading-relaxed text-inkSoft">
        Cómo se cierra el círculo: empresas ligadas al partido que gobierna la entidad ganan los contratos que esa misma
        gestión aprueba. Es un indicio de registros públicos para revisar, no una acusación.
      </p>

      <div className="space-y-0.5">
        {/* 1. empresas */}
        <div className="rounded-xl border border-line bg-paperSoft/50 p-3">
          <div className="mb-2 text-rotulo uppercase tracking-wide text-mute">Empresas ligadas que ganan sus contratos</div>
          <div className="flex flex-wrap gap-1.5">
            {empresas.map((e) => (
              <Link
                key={e.ruc}
                href={`/empresa/${e.ruc}`}
                className={`rounded-full border px-2.5 py-1 text-rotulo transition-colors duration-rapido ${fuerte(e.lazos) ? "border-crimson/40 bg-crimson/10 text-crimson hover:bg-crimson/20" : "border-amber/40 bg-amber/10 text-amber hover:bg-amber/20"}`}
              >
                {corto(e.nombre ?? e.ruc, 28)} <span className="font-mono tabular-nums opacity-80">{numero(e.contratos)}</span>
              </Link>
            ))}
          </div>
        </div>

        <Paso texto={ligazon} />

        {/* 2. partido + autoridad */}
        <div className="rounded-xl border border-line bg-paperSoft/50 p-3">
          <div className="text-rotulo uppercase tracking-wide text-mute">El partido que gobierna</div>
          <Link href={`/app/poder/${encodeURIComponent(cadena.partido)}`} className="text-cuerpo font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
            {tituloNatural(cadena.partido)}
          </Link>
          {cadena.autoridad ? (
            <div className="text-meta text-inkSoft">
              con {cadena.cargo ? cadena.cargo.toLowerCase() : "su autoridad"} <b className="text-ink">{tituloNatural(cadena.autoridad)}</b>
            </div>
          ) : null}
        </div>

        <Paso texto="gobierna" />

        {/* 3. entidad */}
        <div className="rounded-xl border border-line bg-paperSoft/50 p-3">
          <div className="text-rotulo uppercase tracking-wide text-mute">La entidad</div>
          <div className="text-cuerpo font-semibold text-ink">{tituloNatural(cadena.entidad?.nombre ?? "")}</div>
          {cap ? <div className="font-mono text-rotulo text-crimson">{numero(cap.n_captura)} contratos con indicio</div> : null}
        </div>

        <Paso texto="aprueba y decide sus contratos" />

        {/* 4. quién decide */}
        <div className="rounded-xl border border-line bg-paperSoft/50 p-3">
          <div className="flex items-center gap-1 text-rotulo uppercase tracking-wide text-mute">Quién aprueba y decide <AyudaTermino clave="aga" /></div>
          <div className="text-cuerpo font-semibold text-ink">{dec?.apruebaContratos ?? "Autoridad de la gestión administrativa"}</div>
          {dec && dec.funcionarios.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-meta text-inkSoft">
              {dec.funcionarios.slice(0, 6).map((f) => (
                <li key={`${f.persona}-${f.cargo}`}><b className="text-ink">{tituloNatural(f.persona)}</b> — {tituloNatural(f.cargo)}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-0.5 text-rotulo text-mute">La estructura legal que aprueba la contratación (el grafo del Estado no trae nombres para este nivel).</div>
          )}
        </div>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        Y esas mismas empresas ganan los contratos que esa gestión aprueba: así se cierra el círculo. Cada paso es un cruce
        de registros públicos (JNE, ONPE, RNP/SEACE, grafo del Estado) para revisión humana, no una acusación ni condena.
      </p>
    </section>
  );
}
