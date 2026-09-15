import Link from "next/link";
import { ArrowRight, EyeOff, HeartHandshake } from "lucide-react";
import { getRanking, type RankingRow } from "@/lib/financiamiento";
import { TarjetaAliado } from "./TarjetaAliado";

const esAnonimo = (r: RankingRow) => r.tipo === "persona" && (r.nombre === "Anónimo" || !r.nombre);

/**
 * Muro de aliados de transparencia (server component).
 *  - normal:  "Aliados del mes" (top 3 destacado) + "Todos los aliados" + anónimos.
 *  - compact: solo el top 3 del mes (o histórico si el mes está vacío) + enlace a /aliados.
 * El ranking cuenta contratos, no soles.
 */
export async function MuroAliados({ compact = false }: { compact?: boolean }) {
  const [mesRaw, todoRaw] = await Promise.all([getRanking("mes"), getRanking("todo")]);
  const mes = mesRaw ?? [];
  const todo = todoRaw ?? [];

  const visiblesMes = mes.filter((r) => !esAnonimo(r));
  const visiblesTodo = todo.filter((r) => !esAnonimo(r));
  const anonimos = todo.filter(esAnonimo);
  const anonimosContratos = anonimos.reduce((n, r) => n + r.contratosFinanciados, 0);

  const leidosMes = mes.reduce((n, r) => n + r.contratosProcesados, 0);
  const financiadosMes = mes.reduce((n, r) => n + r.contratosFinanciados, 0);
  const leidosTotal = todo.reduce((n, r) => n + r.contratosProcesados, 0);
  const financiadosTotal = todo.reduce((n, r) => n + r.contratosFinanciados, 0);

  // Top 3 a destacar: el mes; si el mes está vacío, el histórico (para que el muro nunca quede en blanco).
  const destacados = (visiblesMes.length ? visiblesMes : visiblesTodo).slice(0, 3);
  const periodoDestacado = visiblesMes.length ? "del mes" : "históricos";

  if (!todo.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-8 text-center">
        <HeartHandshake size={22} className="mx-auto text-mute" aria-hidden />
        <p className="mt-2 text-sm text-mute">Todavía no hay aportes confirmados. El primer aliado abre este muro.</p>
        <Link href="/app/financiar" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-paper">
          Financiar una auditoría <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    );
  }

  const encabezado = leidosMes > 0
    ? <>Gracias a ellos, <span className="font-mono">{leidosMes.toLocaleString("es-PE")}</span> contratos públicos fueron leídos este mes.</>
    : financiadosMes > 0
      ? <>Gracias a ellos, <span className="font-mono">{financiadosMes.toLocaleString("es-PE")}</span> contratos públicos entraron a auditoría este mes.</>
      : <>Gracias a ellos, <span className="font-mono">{(leidosTotal || financiadosTotal).toLocaleString("es-PE")}</span> contratos públicos {leidosTotal ? "fueron leídos" : "entraron a auditoría"}.</>;

  if (compact) {
    return (
      <div>
        <p className="font-serif text-2xl font-bold text-ink">{encabezado}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {destacados.map((r, i) => <TarjetaAliado key={r.id} row={r} posicion={i + 1} destacado />)}
        </div>
        {anonimos.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-mute">
            <EyeOff size={12} aria-hidden /> {anonimos.length} {anonimos.length === 1 ? "persona aportó" : "personas aportaron"} de forma anónima · {anonimosContratos.toLocaleString("es-PE")} contratos
          </p>
        )}
        <div className="mt-4">
          <Link href="/app/aliados" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-2 hover:underline">
            Ver todos los aliados <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section>
        <p className="font-serif text-2xl font-bold text-ink sm:text-3xl">{encabezado}</p>
        <div className="mt-6 flex items-end justify-between gap-3">
          <h2 className="text-[11px] uppercase tracking-wide text-mute">Aliados {periodoDestacado}</h2>
          <span className="text-[11px] text-mute">se cuenta en contratos, no en soles</span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {destacados.map((r, i) => <TarjetaAliado key={r.id} row={r} posicion={i + 1} destacado />)}
        </div>
      </section>

      {visiblesTodo.length > 0 && (
        <section>
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-[11px] uppercase tracking-wide text-mute">Todos los aliados</h2>
            <span className="font-mono text-[11px] text-mute">{visiblesTodo.length}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visiblesTodo.map((r) => <TarjetaAliado key={r.id} row={r} posicion={r.posicion} />)}
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paperDeep px-5 py-4">
        <div className="inline-flex items-center gap-2 text-sm text-inkSoft">
          <EyeOff size={16} className="text-mute" aria-hidden />
          <span>
            Personas que aportaron de forma anónima: <span className="font-mono font-semibold text-ink">{anonimos.length}</span>
            {anonimosContratos > 0 && <span className="text-mute"> · {anonimosContratos.toLocaleString("es-PE")} contratos financiados</span>}
          </span>
        </div>
        <span className="text-[12px] text-mute">Valen exactamente lo mismo en el conteo. Sólo no aparecen con nombre.</span>
      </section>
    </div>
  );
}
