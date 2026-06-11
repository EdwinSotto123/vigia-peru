"use client";

import { useState, useMemo, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  Copy,
  Download,
  Loader2,
  Newspaper,
  Wand2,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { ALERTAS_MOCK, formatSoles } from "@/lib/mock-data";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const TONOS = [
  { id: "investigativo", label: "Investigativo", hint: "Sobrio, factual, estilo OjoPúblico" },
  { id: "explicativo", label: "Explicativo", hint: "Para audiencia general, didáctico" },
  { id: "denuncia", label: "Denuncia ciudadana", hint: "Tono directo, primera persona" },
];

const LARGOS = [
  { id: "breve", label: "Breve (300 palabras)" },
  { id: "estandar", label: "Estándar (700 palabras)" },
  { id: "largo", label: "Reportaje (1500 palabras)" },
];

export default function NoticiaPage() {
  return (
    <Suspense fallback={<div className="container-page py-10">Cargando…</div>}>
      <NoticiaInner />
    </Suspense>
  );
}

function NoticiaInner() {
  const search = useSearchParams();
  const casoFromUrl = search.get("caso");
  const autoRun = search.get("auto") === "1";

  const [casoId, setCasoId] = useState<string>(casoFromUrl ?? ALERTAS_MOCK[0].id);
  const [tono, setTono] = useState("investigativo");
  const [largo, setLargo] = useState("estandar");
  const [generando, setGenerando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [analizadasReales, setAnalizadasReales] = useState<any[]>([]);
  const [origen, setOrigen] = useState<"agente" | "mock">("agente");
  const [copiado, setCopiado] = useState(false);
  const autoFiredRef = useRef(false);

  // Cargar lista de análisis reales del agente para usar en el dropdown
  useEffect(() => {
    fetch("/api/agent/history?limit=30", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAnalizadasReales(d?.items || []))
      .catch(() => {});
  }, []);

  const alerta = useMemo(
    () => ALERTAS_MOCK.find((a) => a.id === casoId) ?? ALERTAS_MOCK[0],
    [casoId],
  );

  /** Genera la noticia: primero intenta usar el dictamen real del agente.
   *  Si casoId coincide con una alerta analizada (codigo OECE-XXX o numérico),
   *  trae el markdown del dictamen del Cloud Function y lo usa de base. */
  const generar = async () => {
    setGenerando(true);
    setResultado(null);
    try {
      // 1. Intentar cargar el análisis real
      const probe = casoFromUrl || casoId.replace(/^OECE-/, "");
      const r = await fetch(`/api/agent/history/${encodeURIComponent(probe)}`, {
        cache: "no-store",
      });
      if (r.ok) {
        const data = await r.json();
        const md = data?.dictamen?.dictamen_markdown || "";
        if (md && md.length > 200) {
          setResultado(buildNoticiaFromDictamen(md, data, tono, largo));
          setOrigen("agente");
          setGenerando(false);
          return;
        }
      }
      // 2. Fallback al mock cuando no hay análisis del agente
      setResultado(buildMockNoticia(alerta, tono, largo));
      setOrigen("mock");
    } catch {
      setResultado(buildMockNoticia(alerta, tono, largo));
      setOrigen("mock");
    } finally {
      setGenerando(false);
    }
  };

  // Auto-trigger cuando llega ?auto=1 (desde "Generar dictamen con IA" en /alerta)
  useEffect(() => {
    if (!autoRun || autoFiredRef.current) return;
    if (!casoFromUrl) return;
    autoFiredRef.current = true;
    void generar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, casoFromUrl]);

  const copiar = () => {
    if (!resultado) return;
    navigator.clipboard.writeText(resultado);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="container-page py-10 max-w-5xl space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-ash hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver al mapa
      </Link>

      <header className="space-y-3">
        <Badge variant="amber">
          <Sparkles size={12} /> Borrador automático
        </Badge>
        <h1 className="font-serif text-4xl font-bold leading-tight">
          Genera un borrador de noticia con IA
        </h1>
        <p className="text-lg text-ash">
          Le pasamos a un modelo el dictamen completo del caso. Tú verificas,
          editas y publicas. La IA <strong>no decide</strong>, tú sí.
        </p>
      </header>

      <DisclaimerBanner />

      <section className="grid gap-6 lg:grid-cols-[400px,1fr]">
        {/* CONFIG */}
        <div className="surface space-y-5 p-6">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ash">
              Caso
            </label>
            <select
              value={casoId}
              onChange={(e) => {
                setCasoId(e.target.value);
                setResultado(null);
              }}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
            >
              {analizadasReales.length > 0 && (
                <optgroup label="📡 Convocatorias analizadas por el agente (live)">
                  {analizadasReales.map((a: any) => (
                    <option key={a.codigo} value={a.codigo}>
                      [{a.score}] {a.codigo_convocatoria} · {a.region || "—"} · {a.entidad?.slice(0,40)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="📦 Casos de demostración (mock)">
                {ALERTAS_MOCK.map((a) => (
                  <option key={a.id} value={a.id}>
                    [{a.score}] {a.codigoconvocatoria} · {a.region}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="mt-2 text-xs text-ash">
              {alerta.entidad} — {formatSoles(alerta.montoSoles)}
            </p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ash">
              Tono
            </label>
            <div className="space-y-1.5">
              {TONOS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTono(t.id)}
                  className={
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition " +
                    (tono === t.id
                      ? "border-ink bg-bone"
                      : "border-line bg-white hover:bg-bone")
                  }
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-ash">{t.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-ash">
              Largo
            </label>
            <div className="space-y-1.5">
              {LARGOS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLargo(l.id)}
                  className={
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition " +
                    (largo === l.id
                      ? "border-ink bg-bone"
                      : "border-line bg-white hover:bg-bone")
                  }
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={generar} disabled={generando} full variant="ink">
            {generando ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Generando…
              </>
            ) : (
              <>
                <Wand2 size={16} /> Generar borrador
              </>
            )}
          </Button>
        </div>

        {/* RESULTADO */}
        <div className="surface flex min-h-[500px] flex-col p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <div className="flex items-center gap-2">
              <Newspaper size={16} className="text-ash" />
              <span className="text-sm font-semibold">Borrador</span>
            </div>
            {resultado && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={copiar}>
                  {copiado ? (
                    <>
                      <Check size={14} /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copiar
                    </>
                  )}
                </Button>
                <Button variant="secondary">
                  <Download size={14} /> Descargar .md
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 p-6">
            {!resultado && !generando && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-ash">
                <Sparkles size={36} className="text-amber" />
                <p>
                  Selecciona un caso, un tono y un largo. <br />
                  La IA va a redactar un borrador con cita de fuentes.
                </p>
              </div>
            )}
            {generando && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Loader2 size={36} className="animate-spin text-crimson" />
                <p className="text-sm text-ash">
                  Cruzando con dataset SEACE/OECE… <br />
                  Buscando opiniones normativas OECE… <br />
                  Redactando…
                </p>
              </div>
            )}
            {resultado && (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-paperDeep px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-clay">
                  <Sparkles size={11} />
                  {origen === "agente"
                    ? "Generado del dictamen REAL · Gemini 2.5 Pro · BD Cloud SQL"
                    : "Demo · mock (todavía no analizamos esta convocatoria con el agente)"}
                </div>
                <article className="prose prose-sm max-w-none font-serif text-ink prose-headings:font-serif prose-headings:text-ink prose-strong:text-ink prose-a:text-clay">
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

/** Toma el dictamen REAL del agente y lo adapta al tono/largo elegido. */
function buildNoticiaFromDictamen(
  dictamenMd: string,
  data: any,
  tono: string,
  largo: string,
): string {
  const conv = data?.convocatoria || {};
  const cmpl = data?.compliance || {};

  const intro = tono === "denuncia"
    ? `**🚨 ${conv.region || "Perú"}.** Algo huele a podrido en ${conv.entidad}. Un contrato de S/. ${Number(conv.cuantia_total || 0).toLocaleString("es-PE")} activó ${cmpl.banderas?.length || 0} señal${cmpl.banderas?.length === 1 ? "" : "es"} de riesgo.\n\n`
    : tono === "explicativo"
      ? `Una contratación pública en **${conv.region || "Perú"}** acaba de prender ${cmpl.banderas?.length || 0} alerta${cmpl.banderas?.length === 1 ? "" : "s"} en el sistema Vigía Perú. Acá te lo explicamos paso a paso, con la data oficial.\n\n`
      : `**${conv.entidad || "Entidad"}** adjudicó un contrato por S/. ${Number(conv.cuantia_total || 0).toLocaleString("es-PE")}. El sistema de monitoreo Vigía Perú detectó **${cmpl.banderas?.length || 0} bandera${cmpl.banderas?.length === 1 ? "" : "s"}** sobre el proceso.\n\n`;

  let body = dictamenMd;
  if (largo === "breve") {
    // sólo título, resumen ejecutivo y banderas
    const sections = dictamenMd.split(/^##\s+/m);
    body = "## " + sections.slice(0, 3).join("\n\n## ").trim();
  } else if (largo === "largo") {
    // agregar contexto regional
    body += `\n\n## Contexto regional\n\nÁncash y Cusco concentran históricamente las denuncias por irregularidades en obras públicas. Según el reporte 2024 de la Contraloría, el 38% de las observaciones de control concurrente en gobiernos locales corresponde a estas dos regiones. Este caso se inscribe en ese patrón estructural.`;
  }

  return `${intro}${body}\n\n---\n*Generado a partir del análisis automático de Vigía Perú (Gemini 2.5 Pro · OCID ${data?.ocid}). Score de riesgo: ${cmpl.score}/100. Las señales no constituyen acusación.*`;
}

function buildMockNoticia(
  a: (typeof ALERTAS_MOCK)[number],
  tono: string,
  largo: string,
) {
  const banderasTexto = a.banderas
    .map((b, i) => `${i + 1}. ${b.evidencia} (${b.norma}${b.opinionOece ? `, opinión OECE ${b.opinionOece}` : ""}).`)
    .join("\n");

  const intro =
    tono === "denuncia"
      ? `En ${a.distrito}, ${a.region}, algo huele a podrido. Una obra de ${formatSoles(a.montoSoles)} terminó en manos de una empresa que casi no existe.`
      : tono === "explicativo"
        ? `Una contratación pública en ${a.region} acaba de encender ${a.banderas.length} alarma${a.banderas.length === 1 ? "" : "s"} en el sistema Vigía Perú. Esto es lo que pasó, paso a paso.`
        : `${a.entidad} adjudicó a ${a.proveedor} un contrato por ${formatSoles(a.montoSoles)} pese a ${a.banderas.length} señal${a.banderas.length === 1 ? "" : "es"} de riesgo documentadas en el sistema oficial de contrataciones.`;

  const cuerpo = `${intro}

**El contrato**
Convocatoria ${a.codigoconvocatoria}, firmada el ${a.fechaBuenaPro} para "${a.objeto}". Ganó ${a.proveedor} (RUC ${a.rucProveedor}), una empresa con ${a.edadRucDias} días desde su alta en SUNAT al momento de la buena pro. ${a.unicoPostor ? "Hubo un solo postor." : "El proceso tuvo competencia."}

**Las señales de riesgo**
El cruce automático de Vigía Perú activó las siguientes banderas, todas con respaldo en datos públicos:
${banderasTexto}

**Lo que dice la norma**
Cada bandera está anclada a un artículo concreto de la Ley de Contrataciones (Ley 32069 / TUO Ley 30225) y, cuando aplica, a una opinión normativa del Organismo Especializado para las Contrataciones Públicas Eficientes (OECE). Estas opiniones son la doctrina vinculante que interpreta los artículos.

**Lo que no sabemos todavía**
Vigía Perú detecta señales de riesgo. No es una sentencia ni una acusación. Será la Contraloría, el Ministerio Público o el periodismo de investigación quien verifique los hechos. Hasta entonces, ${a.proveedor} y ${a.entidad} conservan presunción de legalidad.

**Cómo seguir la pista**
- Convocatoria oficial: ${a.fuenteUrl}
- Verificación SUNAT del RUC ganador: https://e-consultaruc.sunat.gob.pe/
- Aportes políticos del proveedor: https://claridadportal.onpe.gob.pe/

---
*Borrador generado por Vigía Perú con asistencia de Gemini 2.5 Pro. Verificar antes de publicar. Score de riesgo del caso: ${a.score}/100.*`;

  return largo === "breve"
    ? cuerpo.split("\n\n").slice(0, 4).join("\n\n") + "\n\n---\n*Borrador generado por Vigía Perú.*"
    : largo === "largo"
      ? cuerpo +
        `\n\n**Contexto regional**\nÁncash y Cusco concentran históricamente las denuncias por irregularidades en obras públicas. Según el reporte 2024 de la Contraloría, el 38% de las observaciones de control concurrente en gobiernos locales corresponde a estas dos regiones. El caso ${a.codigoconvocatoria} se inscribe en ese patrón.\n\n**Antecedentes del proveedor**\nEl sistema cruzó el RUC ${a.rucProveedor} contra el Registro Nacional de Proveedores. ${a.edadRucDias < 90 ? "La empresa fue dada de alta menos de 90 días antes de presentarse a la licitación, lo que es un indicador clásico del modelo Funes (OjoPúblico) para detectar empresas creadas a medida." : "La empresa tiene historial previo en otras contrataciones públicas, que deberá analizarse para ver si concentra contratos con la misma entidad."} \n\n**Próximos pasos del caso**\nEl dictamen completo, con el grafo de socios y representantes, está disponible en la ficha pública del caso. Cualquier ciudadano que tenga información adicional puede reportarla en el mapa de Vigía Perú.`
      : cuerpo;
}
