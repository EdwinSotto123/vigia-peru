import {
  ejecucionPct,
  formatPEN,
  type MefBudgetSummary,
} from "@/lib/mef";
import { getEntityBudget } from "@/lib/mef-cache";
import {
  Coins,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Database,
  Clock,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Server component. Recibe un keyword (parte del nombre del pliego o ejecutora)
 * y muestra el presupuesto real consultado a MEF — Datos Abiertos.
 */
export async function EjecucionPresupuestal({
  query,
  ruc,
  title,
  subtitle,
}: {
  query: string;
  /** Si pasas el RUC, primero buscamos en public/mef-entities.json */
  ruc?: string;
  title?: string;
  subtitle?: string;
}) {
  const result = await getEntityBudget(query, ruc);

  // MEF API tardó demasiado → timeout (LIKE sin índice sobre 8M filas)
  if (result.kind === "timeout") {
    return (
      <section className="surface overflow-hidden p-0">
        <Header
          title={title ?? "Ejecución presupuestal MEF"}
          subtitle="MEF respondió lento — datos no cargaron"
        />
        <div className="space-y-3 px-5 py-6">
          <div className="flex items-start gap-3 rounded-xl border border-amber/40 bg-amber-soft px-4 py-3">
            <Clock size={18} className="mt-0.5 shrink-0 text-amber" />
            <div className="text-sm text-ink">
              <strong>MEF Datos Abiertos está respondiendo lento (&gt; 28s).</strong>{" "}
              Las queries con <code className="rounded bg-paperDeep px-1 font-mono text-xs">LIKE</code> sobre la tabla de 8M filas{" "}
              <strong>no tienen índice</strong>, así que el portal hace
              full-scan. Es una limitación conocida del endpoint público.
            </div>
          </div>
          <details className="rounded-xl border border-line bg-paperSoft px-4 py-3 text-xs text-mute">
            <summary className="cursor-pointer font-semibold text-ink">
              ¿Por qué pasa esto?
            </summary>
            <ul className="mt-2 space-y-1">
              <li>
                · El campo <code className="rounded bg-paperDeep px-1 font-mono">PLIEGO_NOMBRE</code>{" "}
                no está indexado en MEF; entidades grandes generan millones de filas para escanear.
              </li>
              <li>
                · Una vez que la query corre por primera vez, la cacheamos 1 h
                en memoria — refrescá la página en 30-60 s y debería cargar de inmediato.
              </li>
              <li>
                · Para entidades a nivel <strong>departamental</strong>{" "}
                (Gobiernos Regionales) el cache pre-fetcheado por{" "}
                <code className="rounded bg-paperDeep px-1 font-mono">scripts/fetch_mef_budget.py</code>{" "}
                sí está disponible — la pantalla regional <code className="font-mono">/region/&lt;id&gt;</code> carga al toque.
              </li>
            </ul>
          </details>
          <p className="text-center text-xs text-mute">
            Buscado: <code className="font-mono text-ink">"{query}"</code>
          </p>
        </div>
      </section>
    );
  }

  if (result.kind === "error") {
    return (
      <section className="surface overflow-hidden p-0">
        <Header
          title={title ?? "Ejecución presupuestal MEF"}
          subtitle="MEF no disponible ahora"
        />
        <div className="px-5 py-6 text-center text-sm">
          <WifiOff size={20} className="mx-auto mb-2 text-amber" />
          <p className="font-medium text-ink">
            La API de Datos Abiertos del MEF no respondió.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-mute">
            El portal del MEF se satura al consultar su dataset de 8 millones de
            filas y por momentos devuelve error. No es una falla de Vigía — vuelve
            a intentar en unos segundos o consulta el dato directo en el MEF.
          </p>
          <a
            href="https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-clay hover:underline"
          >
            Abrir Consulta Amigable MEF →
          </a>
        </div>
      </section>
    );
  }

  if (result.kind === "empty") {
    return (
      <section className="surface overflow-hidden p-0">
        <Header
          title={title ?? "Ejecución presupuestal MEF"}
          subtitle="Sin registros en el dataset MEF"
        />
        <div className="px-5 py-6 text-center text-sm text-mute">
          <Database size={20} className="mx-auto mb-2 text-mute" />
          <p>
            MEF Datos Abiertos respondió pero no hay coincidencias para{" "}
            <code className="font-mono text-ink">"{query}"</code>.
          </p>
          <p className="mt-1 text-xs">
            El nombre puede diferir del oficial en MEF (case, abreviaturas), o
            el pliego no tiene actividad presupuestal registrada en 2022-2026.
          </p>
        </div>
      </section>
    );
  }

  return <EjecucionView data={result.data} title={title} subtitle={subtitle} />;
}

function EjecucionView({
  data,
  title,
  subtitle,
}: {
  data: MefBudgetSummary;
  title?: string;
  subtitle?: string;
}) {
  const last5 = data.byYear;
  const current = last5[last5.length - 1];
  const prevYear = last5[last5.length - 2];

  const ejPct = ejecucionPct(current);
  const isUnderExecuted = current.pim > 0 && ejPct < 40 && current.year < 2026;
  const isOverExecuted = current.pim > 0 && current.devengado > current.pim;

  // Crecimiento PIM vs año anterior
  const growth =
    prevYear && prevYear.pim > 0
      ? ((current.pim - prevYear.pim) / prevYear.pim) * 100
      : 0;

  return (
    <section className="surface overflow-hidden p-0">
      <Header
        title={title ?? "Ejecución presupuestal MEF"}
        subtitle={
          subtitle ??
          `Pliego "${data.query}" · ${data.totalRows.toLocaleString("es-PE")} registros agregados`
        }
      />

      {/* Pliegos matched */}
      {data.matchedPliegos.length > 0 && (
        <div className="border-b border-line bg-paperDeep px-5 py-3 text-xs">
          <div className="mb-1 font-semibold uppercase tracking-wider text-mute">
            Pliegos detectados ({data.matchedPliegos.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.matchedPliegos.slice(0, 6).map((p, i) => (
              <span key={i} className="rounded-full bg-paper px-2 py-0.5 text-[10px] text-ink">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPIs año actual */}
      <div className="grid gap-3 px-5 py-5 sm:grid-cols-4">
        <KPI
          icon={<Coins size={15} />}
          label={`PIA ${current.year}`}
          value={formatPEN(current.pia)}
          hint="presupuesto aprobado"
        />
        <KPI
          icon={<Coins size={15} />}
          label={`PIM ${current.year}`}
          value={formatPEN(current.pim)}
          hint={growth !== 0 ? `${growth > 0 ? "▲" : "▼"} ${Math.abs(growth).toFixed(1)}% vs ${current.year - 1}` : "modificado"}
          tone="ink"
        />
        <KPI
          icon={<Activity size={15} />}
          label="Devengado"
          value={formatPEN(current.devengado)}
          hint={`${ejPct.toFixed(1)}% del PIM`}
          tone={isUnderExecuted ? "rust" : isOverExecuted ? "rust" : "moss"}
        />
        <KPI
          icon={<Activity size={15} />}
          label="Girado"
          value={formatPEN(current.girado)}
          hint={current.pim > 0 ? `${((current.girado / current.pim) * 100).toFixed(1)}% del PIM` : "—"}
          tone="ink"
        />
      </div>

      {/* Flags / anomalías */}
      {(isUnderExecuted || isOverExecuted) && (
        <div className="border-y border-rust/30 bg-crimson-soft px-5 py-3 text-sm">
          {isUnderExecuted && (
            <div className="flex items-start gap-2 text-rust">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <strong>Sub-ejecución detectada.</strong> Sólo se ha devengado{" "}
                {ejPct.toFixed(1)}% del PIM con el año ya avanzado. Patrón típico
                de obras paralizadas o presupuestos inflados.
              </div>
            </div>
          )}
          {isOverExecuted && (
            <div className="flex items-start gap-2 text-rust">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <strong>Sobre-ejecución.</strong> El Devengado supera el PIM.
                Indica modificaciones presupuestales fuera del marco aprobado.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabla 5 años */}
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-xs">
          <thead className="bg-paperDeep text-left text-[10px] uppercase tracking-wider text-mute">
            <tr>
              <th className="px-5 py-2.5">Año</th>
              <th className="px-3 py-2.5 text-right">PIA</th>
              <th className="px-3 py-2.5 text-right">PIM</th>
              <th className="px-3 py-2.5 text-right">Devengado</th>
              <th className="px-3 py-2.5 text-right">Girado</th>
              <th className="px-5 py-2.5 text-right">Ejec.</th>
            </tr>
          </thead>
          <tbody>
            {last5.map((row) => {
              const pct = ejecucionPct(row);
              const isUnder = row.pim > 0 && pct < 40 && row.year < 2026;
              return (
                <tr key={row.year} className="border-t border-line">
                  <td className="px-5 py-2 font-mono font-semibold text-ink">
                    {row.year}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-mute">
                    {formatPEN(row.pia)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {formatPEN(row.pim)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {formatPEN(row.devengado)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-mute">
                    {formatPEN(row.girado)}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <EjecBadge pct={pct} flag={isUnder} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer con fuente */}
      <div className="border-t border-line bg-paperSoft px-5 py-2.5 text-[11px] text-mute">
        <a
          href="https://datosabiertos.mef.gob.pe/dataset/comparativo-gastos-2022-2026"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-clay hover:underline"
        >
          <ExternalLink size={11} />
          MEF — Datos Abiertos · comparativo_gastos_2022_2026
        </a>
        <span className="mx-2">·</span>
        <span>Cache 1h · agregado por SUM(PIA/PIM/Devengado/Girado)</span>
      </div>
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-line bg-paperDeep px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay text-paper">
        <Database size={16} />
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
          MEF · Datos Abiertos
        </div>
        <h3 className="font-serif text-lg font-bold text-ink">{title}</h3>
        <p className="text-xs text-mute">{subtitle}</p>
      </div>
    </div>
  );
}

function KPI({
  icon,
  label,
  value,
  hint,
  tone = "ink",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "rust" | "moss";
}) {
  const valueColor =
    tone === "rust" ? "text-rust" : tone === "moss" ? "text-moss" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-mute">
        {icon} {label}
      </div>
      <div className={cn("mt-1 font-mono text-xl font-bold tabular-nums", valueColor)}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-mute">{hint}</div>}
    </div>
  );
}

function EjecBadge({ pct, flag }: { pct: number; flag?: boolean }) {
  const color = flag
    ? "bg-rust text-paper"
    : pct >= 90
      ? "bg-moss text-paper"
      : pct >= 60
        ? "bg-amber text-paper"
        : pct === 0
          ? "bg-paperDeep text-mute"
          : "bg-paperDeep text-ink";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold",
        color,
      )}
    >
      {flag && <AlertTriangle size={9} />}
      {pct === 0 ? "—" : `${pct.toFixed(0)}%`}
    </span>
  );
}
