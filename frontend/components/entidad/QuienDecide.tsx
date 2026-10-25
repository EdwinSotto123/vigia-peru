import { getEstructuraEntidad } from "@/lib/api-client";
import { tituloNatural } from "@/lib/landing";
import { rad, corto, anguloEnAnillo, anchorDeCos } from "@/lib/grafo";
import { GrafoSeccion, GrafoMarco } from "@/components/grafo/primitivos";

/**
 * «Quién decide y firma los contratos» de una entidad, del grafo del Estado (migración 126): un grafo pequeño con la
 * entidad al centro, la autoridad que por ley aprueba sus contrataciones (la AGA, destacada, con halo que respira) y los
 * altos funcionarios que hoy la ocupan, cada uno con su cargo. Acerca la responsabilidad: no solo «la entidad contrató»,
 * sino quién decide. Es un corte en el tiempo (no el organigrama en vivo). Server component estático: el latido del halo
 * es CSS puro (animate-latidoNodo), sin JS. Si no hay data del grafo para esta entidad, no muestra nada.
 */
const W = 720;
const H = 560;
const cx = W / 2;
const cy = H / 2;
const R = 166;

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
  const pos = nodos.map((nd, i) => {
    const a = anguloEnAnillo(i, N);
    return { nd, a, x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) };
  });

  return (
    <GrafoSeccion>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-cuerpo font-semibold tracking-tight text-ink">Quién decide y firma los contratos</div>
        <span className="text-rotulo text-mute">Estructura institucional, fuentes oficiales, corte {e.corte ?? "2026"}</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        Por ley, quien aprueba las contrataciones de esta entidad es la <b className="text-ink">{aga}</b>
        {funcionarios.length > 0 ? ", y estos son los altos funcionarios que hoy la ocupan" : ""}.
      </p>

      <GrafoMarco>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img"
             aria-label={`Estructura de decisión: la entidad, su autoridad que aprueba contratos (${aga}) y ${funcionarios.length} funcionarios.`}>
          {pos.map((p, i) => (
            <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
              className={p.nd.aga ? "stroke-granate" : "stroke-line"} strokeWidth={p.nd.aga ? 2 : 1.2} strokeOpacity={p.nd.aga ? 0.7 : 0.45} strokeLinecap="round" />
          ))}
          {pos.map((p, i) => {
            const anchor = anchorDeCos(Math.cos(rad(p.a)));
            const r = p.nd.aga ? 15 : 9;
            const lx = p.x + (anchor === "start" ? r + 8 : -(r + 8));
            return (
              <g key={`n${i}`}>
                {p.nd.aga
                  ? <circle cx={p.x} cy={p.y} r={r + 6} className="grafo-halo animate-latidoNodo fill-granate/15" />
                  : <circle cx={p.x} cy={p.y} r={r + 3.5} className="fill-mute/10" />}
                <circle cx={p.x} cy={p.y} r={r} className={p.nd.aga ? "fill-granate/30 stroke-granate" : "fill-paperSoft stroke-ink"} strokeWidth={p.nd.aga ? 2 : 1.5} />
                <text x={lx} y={p.y} textAnchor={anchor} className={`${p.nd.aga ? "fill-ink" : "fill-inkSoft"} font-semibold`} style={{ fontSize: "11px" }}>{corto(p.nd.titulo, 24)}</text>
                {p.nd.sub ? <text x={lx} y={p.y + 12} textAnchor={anchor} className="fill-mute" style={{ fontSize: "10px" }}>{corto(p.nd.sub, 26)}</text> : null}
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={34} className="fill-paperSoft stroke-ink" strokeWidth={2.5} />
          <text x={cx} y={cy - 1} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "12px" }}>La entidad</text>
          <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute" style={{ fontSize: "9px" }}>contrata</text>
        </svg>
      </GrafoMarco>

      {resto > 0 ? <p className="text-rotulo text-mute">y {resto} funcionarios más.</p> : null}
      <p className="text-rotulo leading-relaxed text-mute">
        Es la estructura de decisión según normas oficiales; la confianza varía y es un corte en el tiempo, no el
        organigrama en vivo.
      </p>
    </GrafoSeccion>
  );
}
