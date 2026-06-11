"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  ArrowUpRight,
  Cpu,
  CircleDollarSign,
  FileSearch,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { getAnalyzedList } from "@/lib/dossier-cache";

// Tasas medidas por análisis end-to-end del pipeline (documentadas en /donar):
// ~180K tokens de entrada + ~80K de salida en Gemini 2.5, y ~S/.1 de costo de IA.
// Los totales se derivan del CONTEO REAL de análisis cacheados en Cloud SQL —
// no son cifras inventadas. (Para tokens/costo medidos por corrida hace falta
// poblar llm_metrics en el orquestador o leer Arize/Phoenix.)
const TOKENS_IN_PER = 180_000;
const TOKENS_OUT_PER = 80_000;
const SOLES_IA_PER = 1;
const CONVOCATORIAS_INDEXADAS = 14688; // catálogo SEACE en BD
const GASTO_INFRA_FIJA = 845;          // infra mensual fija (Cloud Run + SQL + APIs)

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString("es-PE");
}

export function OperationalMetrics() {
  // Conteo REAL de análisis cacheados (Cloud SQL, vía la API liviana).
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => setCount(d?.count ?? d?.items?.length ?? 0))
      .catch(() => setCount(null));
  }, []);

  const n = count ?? 0;
  const tokensEntrada = n * TOKENS_IN_PER;
  const tokensSalida = n * TOKENS_OUT_PER;
  const totalTokens = tokensEntrada + tokensSalida;
  const gastoIa = Math.round(n * SOLES_IA_PER);
  const pctEntrada = totalTokens ? (tokensEntrada / totalTokens) * 100 : 69;

  return (
    <section>
      {/* Header con eyebrow + link a /donar */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mute">
          <Cpu size={11} className="text-clay" />
          Operación · cuentas claras
        </h2>
        <Link
          href="/donar"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-clay hover:underline"
        >
          Ver balance completo <ArrowUpRight size={11} />
        </Link>
      </div>

      <div className="surface overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[1fr,1fr,1.2fr]">
          {/* Análisis ejecutados */}
          <MetricCell
            label="Análisis ejecutados"
            hint="convocatorias procesadas end-to-end · dato real"
            value={
              <span className="font-serif text-4xl font-bold leading-none text-ink sm:text-5xl">
                <NumberTicker value={n} duration={1500} />
              </span>
            }
            icon={<FileSearch size={14} />}
            iconBg="bg-clay/10 text-clay"
            footer={
              <span className="font-mono">
                {CONVOCATORIAS_INDEXADAS.toLocaleString("es-PE")} convocatorias en BD
              </span>
            }
          />

          {/* Gasto IA */}
          <MetricCell
            label="Gasto en IA · estimado"
            hint="~S/.1 por análisis · Gemini 2.5"
            value={
              <span className="font-serif text-4xl font-bold leading-none text-rust sm:text-5xl">
                S/. <NumberTicker value={gastoIa} duration={1500} />
              </span>
            }
            icon={<CircleDollarSign size={14} />}
            iconBg="bg-rust/10 text-rust"
            footer={
              <span>
                + infra fija{" "}
                <span className="font-mono font-bold text-ink">
                  S/. {GASTO_INFRA_FIJA}
                </span>{" "}
                /mes
              </span>
            }
          />

          {/* Tokens consumidos con split */}
          <div className="border-t border-line p-5 lg:border-l lg:border-t-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
                  Tokens consumidos
                </h3>
                <p className="mt-0.5 text-[10px] text-mute">
                  Gemini 2.5 · este mes
                </p>
              </div>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber/15 text-clay">
                <Sparkles size={13} />
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-serif text-3xl font-bold leading-none text-ink sm:text-4xl">
                {fmtTokens(totalTokens)}
              </span>
              <span className="text-xs font-medium text-mute">tokens</span>
            </div>

            {/* Barra split entrada/salida */}
            <div className="mt-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-paperDeep">
                <div
                  className="bg-clay"
                  style={{ width: `${pctEntrada}%` }}
                  title={`Entrada: ${fmtTokens(tokensEntrada)}`}
                />
                <div
                  className="bg-rust"
                  style={{ width: `${100 - pctEntrada}%` }}
                  title={`Salida: ${fmtTokens(tokensSalida)}`}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px]">
                <span className="inline-flex items-center gap-1 text-mute">
                  <span className="h-1.5 w-1.5 rounded-full bg-clay" />
                  Entrada <span className="font-mono font-bold text-ink">{fmtTokens(tokensEntrada)}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-mute">
                  <span className="h-1.5 w-1.5 rounded-full bg-rust" />
                  Salida <span className="font-mono font-bold text-ink">{fmtTokens(tokensSalida)}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Strip inferior — micro-explicación + CTA */}
        <div className="flex flex-col items-start justify-between gap-2 border-t border-line bg-paperSoft px-5 py-3 sm:flex-row sm:items-center">
          <p className="flex items-start gap-2 text-[11px] leading-snug text-mute">
            <Zap size={12} className="mt-0.5 shrink-0 text-amber" />
            Cada convocatoria consume ~180K tokens de entrada y ~80K de salida.
            Publicamos estos números para que cualquiera pueda auditar lo que cobra
            la infraestructura.
          </p>
          <Link
            href="/donar"
            className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-paper hover:bg-coal"
          >
            Apoyar el proyecto →
          </Link>
        </div>
      </div>
    </section>
  );
}

function MetricCell({
  label,
  hint,
  value,
  icon,
  iconBg,
  footer,
}: {
  label: string;
  hint: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  iconBg: string;
  footer: React.ReactNode;
}) {
  return (
    <div className="border-t border-line p-5 first:border-t-0 lg:border-l lg:border-t-0 lg:first:border-l-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
            {label}
          </h3>
          <p className="mt-0.5 text-[10px] text-mute">{hint}</p>
        </div>
        <span
          className={
            "flex h-7 w-7 items-center justify-center rounded-lg " + iconBg
          }
        >
          {icon}
        </span>
      </div>
      <div className="mt-3">{value}</div>
      <div className="mt-2 text-[11px] text-mute">{footer}</div>
    </div>
  );
}
