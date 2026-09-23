"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sparkles, Copy, Download, Loader2, Newspaper, Wand2, ArrowLeft, Check, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { formatSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Generador de borradores de nota (herramienta editorial interna, detrás de
 * NEXT_PUBLIC_EDITORIAL).
 *
 * Antes, si el caso no tenía dictamen, armaba una "noticia" sobre ALERTAS_MOCK
 * (contratos inventados sobre municipalidades reales), y la versión larga
 * agregaba una cifra que nadie verificó: "según el reporte 2024 de la
 * Contraloría, el 38 %…". Ahora sólo trabaja sobre dictámenes reales, y donde
 * haría falta contexto deja un hueco marcado para que lo llene quien edita, con
 * su fuente.
 */

const TONOS = [
  { id: "investigativo", label: "Investigativo", hint: "Sobrio y factual" },
  { id: "explicativo", label: "Explicativo", hint: "Para audiencia general, didáctico" },
  { id: "denuncia", label: "Denuncia ciudadana", hint: "Directo, en primera persona" },
];

const LARGOS = [
  { id: "breve", label: "Breve (300 palabras)" },
  { id: "estandar", label: "Estándar (700 palabras)" },
  { id: "largo", label: "Reportaje (1.500 palabras)" },
];

interface Analizada {
  codigo: string;
  codigo_convocatoria?: string;
  score?: number | string;
  region?: string | null;
  entidad?: string | null;
  monto?: number | string | null;
}

export function GeneradorNoticia() {
  const search = useSearchParams();
  const casoFromUrl = search.get("caso");
  const autoRun = search.get("auto") === "1";

  const [casoId, setCasoId] = useState<string>(casoFromUrl ?? "");
  const [tono, setTono] = useState("investigativo");
  const [largo, setLargo] = useState("estandar");
  const [generando, setGenerando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analizadas, setAnalizadas] = useState<Analizada[] | null>(null);
  const [copiado, setCopiado] = useState(false);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    fetch("/api/agent/history?limit=30", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const items: Analizada[] = d?.items || [];
        setAnalizadas(items);
        setCasoId((c) => c || items[0]?.codigo || "");
      })
      .catch(() => setAnalizadas([]));
  }, []);

  const elegida = analizadas?.find((a) => a.codigo === casoId) ?? null;

  const generar = async () => {
    if (!casoId) return;
    setGenerando(true);
    setResultado(null);
    setError(null);
    try {
      const probe = casoId.replace(/^OECE-/, "");
      const r = await fetch(`/api/agent/history/${encodeURIComponent(probe)}`, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        const md = data?.dictamen?.dictamen_markdown || "";
        if (md && md.length > 200) {
          setResultado(buildNoticiaFromDictamen(md, data, tono, largo));
          return;
        }
      }
      setError("Este caso todavía no tiene un dictamen del análisis, así que no hay nada verificado sobre qué escribir.");
    } catch {
      setError("No pudimos cargar el dictamen. Revisa la conexión e inténtalo otra vez.");
    } finally {
      setGenerando(false);
    }
  };

  // Auto-disparo con ?auto=1 (desde "Generar borrador" en el dossier).
  useEffect(() => {
    if (!autoRun || autoFiredRef.current || !casoFromUrl) return;
    autoFiredRef.current = true;
    void generar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, casoFromUrl]);

  const copiar = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError("No pudimos copiar el texto. Selecciónalo y cópialo a mano.");
    }
  };

  const descargar = () => {
    if (!resultado) return;
    const blob = new Blob([resultado], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `borrador-${(casoId || "caso").replace(/[^\w-]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="container-page max-w-5xl space-y-8 py-10">
      <Link href="/app/mapa" className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Volver al mapa
      </Link>

      <header className="space-y-3">
        <Badge variant="amber">
          <Sparkles size={12} aria-hidden /> Borrador automático
        </Badge>
        <h1 className="font-serif text-4xl font-bold leading-tight">Genera un borrador de nota</h1>
        <p className="text-lg text-mute">
          Parte del dictamen del análisis del caso. Tú verificas, editas y publicas. La herramienta <strong>no decide</strong>:
          decides tú.
        </p>
      </header>

      <DisclaimerBanner />

      <section className="grid gap-6 lg:grid-cols-[400px,1fr]">
        <div className="surface space-y-5 p-6">
          <div>
            <label htmlFor="noticia-caso" className="mb-1 block text-xs font-medium uppercase tracking-wider text-mute">
              Caso
            </label>
            {analizadas === null ? (
              <p className="inline-flex items-center gap-2 text-sm text-mute">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Cargando los casos analizados…
              </p>
            ) : analizadas.length === 0 && !casoFromUrl ? (
              <p className="text-sm text-mute">No hay casos analizados todavía, o no pudimos leerlos.</p>
            ) : (
              <select
                id="noticia-caso"
                value={casoId}
                onChange={(e) => {
                  setCasoId(e.target.value);
                  setResultado(null);
                  setError(null);
                }}
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
              >
                {casoFromUrl && !analizadas.some((a) => a.codigo === casoFromUrl) && <option value={casoFromUrl}>{casoFromUrl}</option>}
                {analizadas.map((a) => (
                  <option key={a.codigo} value={a.codigo}>
                    {a.codigo_convocatoria ?? a.codigo}, {a.region || "sin región"}: {a.entidad?.slice(0, 40) ?? "entidad sin nombre"} (puntaje {a.score ?? "?"})
                  </option>
                ))}
              </select>
            )}
            {elegida && (
              <p className="mt-2 text-xs text-mute">
                {elegida.entidad}
                {elegida.monto != null && Number.isFinite(Number(elegida.monto)) ? `, ${formatSoles(Number(elegida.monto))}` : ""}
              </p>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 block text-xs font-medium uppercase tracking-wider text-mute">Tono</legend>
            <div className="space-y-1.5">
              {TONOS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tono === t.id}
                  onClick={() => setTono(t.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition",
                    tono === t.id ? "border-ink bg-paperSoft" : "border-line bg-paper hover:bg-paperSoft",
                  )}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-mute">{t.hint}</div>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 block text-xs font-medium uppercase tracking-wider text-mute">Largo</legend>
            <div className="space-y-1.5">
              {LARGOS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={largo === l.id}
                  onClick={() => setLargo(l.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition",
                    largo === l.id ? "border-ink bg-paperSoft" : "border-line bg-paper hover:bg-paperSoft",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </fieldset>

          <Button onClick={generar} disabled={generando || !casoId} full variant="ink">
            {generando ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden /> Generando…
              </>
            ) : (
              <>
                <Wand2 size={16} aria-hidden /> Generar borrador
              </>
            )}
          </Button>
        </div>

        <div className="surface flex min-h-[500px] flex-col p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <div className="flex items-center gap-2">
              <Newspaper size={16} className="text-mute" aria-hidden />
              <span className="text-sm font-semibold">Borrador</span>
            </div>
            {resultado && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={copiar}>
                  {copiado ? (
                    <>
                      <Check size={14} aria-hidden /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy size={14} aria-hidden /> Copiar
                    </>
                  )}
                </Button>
                <Button variant="secondary" onClick={descargar}>
                  <Download size={14} aria-hidden /> Descargar .md
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 p-6" aria-live="polite">
            {!resultado && !generando && !error && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-mute">
                <Sparkles size={36} className="text-amberTexto" aria-hidden />
                <p>
                  Elige un caso, un tono y un largo.
                  <br />
                  El borrador sale del dictamen del análisis, con sus fuentes.
                </p>
              </div>
            )}
            {error && !generando && (
              <p className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2.5 text-sm text-crimsonTexto" role="alert">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
              </p>
            )}
            {generando && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Loader2 size={36} className="animate-spin text-crimsonTexto" aria-hidden />
                <p className="text-sm text-mute">Cargando el dictamen del caso…</p>
              </div>
            )}
            {resultado && (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-paperDeep px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-clayTexto">
                  <Sparkles size={11} aria-hidden />
                  Hecho a partir del dictamen del análisis
                </div>
                <article className="prose prose-sm max-w-none font-serif text-ink prose-headings:font-serif prose-headings:text-ink prose-strong:text-ink prose-a:text-clayTexto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{resultado}</ReactMarkdown>
                </article>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Toma el dictamen del análisis y lo adapta al tono y al largo elegidos. */
function buildNoticiaFromDictamen(dictamenMd: string, data: any, tono: string, largo: string): string {
  const conv = data?.convocatoria || {};
  const cmpl = data?.compliance || {};
  const n = cmpl.banderas?.length || 0;
  const monto = Number(conv.cuantia_total || 0).toLocaleString("es-PE");
  const senales = `${n} señal${n === 1 ? "" : "es"} de riesgo`;

  const intro =
    tono === "denuncia"
      ? `**${conv.region || "Perú"}.** Un contrato de S/ ${monto} de ${conv.entidad || "una entidad pública"} activó ${senales}. Esto es lo que dicen los documentos públicos.\n\n`
      : tono === "explicativo"
        ? `Una contratación pública en **${conv.region || "Perú"}** activó ${senales} en el análisis de Vigía Perú. Aquí te lo explicamos paso a paso, con los datos oficiales.\n\n`
        : `**${conv.entidad || "Una entidad pública"}** adjudicó un contrato por S/ ${monto}. El análisis de Vigía Perú encontró **${senales}** en el proceso.\n\n`;

  let body = dictamenMd;
  if (largo === "breve") {
    // sólo título, resumen ejecutivo y señales
    const sections = dictamenMd.split(/^##\s+/m);
    body = "## " + sections.slice(0, 3).join("\n\n## ").trim();
  } else if (largo === "largo") {
    // Un hueco marcado, no una cifra: el contexto lo pone quien edita, con su fuente.
    body += `\n\n## Contexto\n\n_[Agrega aquí contexto verificado sobre la entidad o la región, con su fuente. Vigía no lo genera.]_`;
  }

  return `${intro}${body}\n\n---\n*Borrador generado a partir del análisis automático de Vigía Perú (convocatoria ${data?.ocid ?? ""}). Puntaje de riesgo: ${cmpl.score ?? "sin dato"} de 100. Las señales no constituyen acusación.*`;
}
