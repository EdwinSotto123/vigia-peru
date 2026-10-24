import { getEstructuraEntidad } from "@/lib/api-client";
import { tituloNatural } from "@/lib/landing";

/**
 * «Quién decide y firma los contratos» de una entidad, del grafo del Estado (migración 126): un grafo pequeño con la
 * entidad al centro, la autoridad que por ley aprueba sus contrataciones (la AGA, destacada) y los altos funcionarios
 * que hoy la ocupan, cada uno con su cargo. Acerca la responsabilidad: no solo «la entidad contrató», sino quién decide.
 * Es un corte en el tiempo (no el organigrama en vivo). Si no hay data del grafo para esta entidad, no muestra nada.
 */
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export async function QuienDecide({ ruc }: { ruc: string }) {
  const e = await getEstructuraEntidad(ruc).catch(() => null);
  if (!e?.disponible) return null;

  const aga = e.apruebaContratos ?? "Autoridad de la gestión administrativa";
  const funcionarios = (e.funcionarios ?? []).slice(0, 10);
  const resto = (e.funcionarios?.length ?? 0) - funcionarios.length;

  // Anillo alrededor de la entidad: primero la AGA (destacada) y luego los funcionarios actuales.
  const nodos = [
    { aga: true, titulo: aga, sub: "aprueba los contratos" },
    ...funcionarios.map((f) => ({ aga: false, titulo: f.cargo || "Cargo", sub: tituloNatural(f.persona) })),
  ];
  const N = nodos.length;
  const W = 720;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2;
  const R = 166;
  const pos = nodos.map((nd, i) => {
    const a = ((-90 + i * (360 / N)) * Math.PI) / 180;
    return { nd, a, cos: Math.cos(a), x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-ink">Quién decide y firma los contratos</h2>
        <span className="text-rotulo text-mute">Estructura institucional, fuentes oficiales, corte {e.corte ?? "2026"}</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        Por ley, quien aprueba las contrataciones de esta entidad es la <b className="text-ink">{aga}</b>
        {funcionarios.length > 0 ? ", y estos son los altos funcionarios que hoy la ocupan" : ""}.
      </p>

      <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img"
             aria-label={`Estructura de decisión: la entidad, su autoridad que aprueba contratos (${aga}) y ${funcionarios.length} funcionarios.`}>
          {pos.map((p, i) => (
            <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
              className={p.nd.aga ? "stroke-granate" : "stroke-line"} strokeWidth={p.nd.aga ? 2 : 1.2} strokeOpacity={p.nd.aga ? 0.7 : 0.45} strokeLinecap="round" />
          ))}
          {pos.map((p, i) => {
            const anchor = p.cos > 0.3 ? "start" : p.cos < -0.3 ? "end" : "middle";
            const r = p.nd.aga ? 15 : 9;
            const lx = p.x + (r + 8) * Math.cos(p.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
            const ly = p.y + (r + 8) * Math.sin(p.a) + (anchor === "middle" ? (Math.sin(p.a) > 0 ? 12 : -14) : 0);
            return (
              <g key={`n${i}`}>
                <circle cx={p.x} cy={p.y} r={r} className={p.nd.aga ? "fill-granate/25 stroke-granate stroke-[2]" : "fill-paperSoft stroke-ink stroke-[1.5]"} />
                <text x={lx} y={ly} textAnchor={anchor} className={`${p.nd.aga ? "fill-ink" : "fill-inkSoft"} text-[11px] font-semibold`}>{corto(p.nd.titulo, 24)}</text>
                {p.nd.sub ? <text x={lx} y={ly + 12} textAnchor={anchor} className="fill-mute text-[10px]">{corto(p.nd.sub, 26)}</text> : null}
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={34} className="fill-paperSoft stroke-ink stroke-[2.5]" />
          <text x={cx} y={cy - 1} textAnchor="middle" className="fill-ink text-[12px] font-semibold">La entidad</text>
          <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute text-[9px]">contrata</text>
        </svg>
      </div>

      {resto > 0 ? <p className="text-rotulo text-mute">y {resto} funcionarios más.</p> : null}
      <p className="text-rotulo leading-relaxed text-mute">
        Es la estructura de decisión según normas oficiales; la confianza varía y es un corte en el tiempo, no el
        organigrama en vivo.
      </p>
    </section>
  );
}
