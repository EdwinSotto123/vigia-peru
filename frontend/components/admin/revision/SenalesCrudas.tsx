"use client";

/**
 * Las señales tal como quedaron en la base: id de la regla, agente que la emitió, evidencia completa,
 * norma, fuente y la verificación determinista (cada identificador, monto, fecha o URL cotejado).
 * Va dentro del detalle técnico. La evidencia y los valores cotejados pasan por Redact.
 */

import { useState } from "react";
import { ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/admin/ui";
import { nombreDeAgente } from "@/components/agentes/catalogo";
import { redactDnis } from "@/components/Redact";
import { adminFetch, type BanderaRevision, type DecisionBandera } from "@/lib/admin";
import { SEVERIDAD_UI } from "./PorQueBloqueo";

const TIPO_COTEJO: Record<string, string> = { ruc: "RUC", dni: "DNI", fecha: "Fecha", url: "Enlace", monto: "Monto", cantidad: "Cantidad", pagina: "Página" };

const ESTADO_COTEJO: Record<string, string> = {
  fuente_determinista: "coincide con una fuente oficial",
  oficial_o_determinista: "enlace oficial",
  respaldada: "aparece en el expediente",
  respaldado: "aparece en el expediente",
  parser: "sale de la lectura de los documentos",
  no_verificable: "no se pudo comprobar",
  no_respaldada: "no aparece en ninguna fuente",
  no_respaldado: "no aparece en ninguna fuente",
};

const legible = (s: string) => s.replace(/_/g, " ");

/** La URL de la fuente la escribe el pipeline: sólo se enlaza si es http(s) (nunca javascript:, data:, etc.). */
function urlSegura(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : null;
  } catch {
    return null;
  }
}

/** "monto:250,000.00,:parser" → Monto 250,000.00, sale de la lectura de los documentos. */
function Cotejo({ raw }: { raw: string }) {
  const i = raw.indexOf(":");
  const j = raw.lastIndexOf(":");
  if (i < 0 || i === j) {
    const t = raw === "sin_identificadores_verificables" ? "Sin identificadores que cotejar" : legible(raw);
    return <li>{t.charAt(0).toUpperCase() + t.slice(1)}</li>;
  }
  const tipo = raw.slice(0, i);
  const valor = raw.slice(i + 1, j).replace(/,$/, "");
  const estado = raw.slice(j + 1);
  return (
    <li className="break-words">
      <span className="text-ink">{TIPO_COTEJO[tipo] ?? legible(tipo)}</span>{" "}
      <span className="font-mono text-[11px] text-ink">{redactDnis(valor)}</span>
      <span>, {ESTADO_COTEJO[estado] ?? legible(estado)}</span>
    </li>
  );
}

export function SenalesCrudas({ banderas, alertaId }: { banderas: BanderaRevision[]; alertaId?: string }) {
  if (!banderas.length) return <p className="text-[12px] text-mute">Sin señales guardadas.</p>;
  return (
    <ul className="space-y-2">
      {banderas.map((b) => <Senal key={b.id} b={b} alertaId={alertaId} />)}
    </ul>
  );
}

const DECISIONES: { clave: DecisionBandera; texto: string }[] = [
  { clave: "confirmada", texto: "Confirmada" },
  { clave: "falso_positivo", texto: "Falso positivo" },
  { clave: "no_concluyente", texto: "No concluyente" },
];

/** Tres botones por señal: lo que decide el revisor se guarda y alimenta la medición de cada regla. */
function Decision({ b, alertaId }: { b: BanderaRevision; alertaId: string }) {
  const [actual, setActual] = useState<DecisionBandera | null>(b.decision ?? null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decidir(d: DecisionBandera) {
    setEnviando(true);
    setError(null);
    try {
      await adminFetch(`/revision/${alertaId}/banderas/${b.id}/decision`, { method: "POST", body: JSON.stringify({ decision: d }) });
      setActual(d);
    } catch {
      setError("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-mute">¿Esta señal es correcta?</span>
      {DECISIONES.map(({ clave, texto }) => (
        <button
          key={clave}
          type="button"
          disabled={enviando}
          aria-pressed={actual === clave}
          onClick={() => decidir(clave)}
          className={`rounded-full border px-2.5 py-1 font-medium transition ${
            actual === clave ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperSoft"
          }`}
        >
          {texto}
        </button>
      ))}
      {error && <span role="alert" className="text-crimsonTexto">{error}</span>}
    </div>
  );
}

function Senal({ b, alertaId }: { b: BanderaRevision; alertaId?: string }) {
  const url = urlSegura(b.fuenteUrl);
  return (
    <li className="rounded-xl border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="font-mono text-ink">{b.regla}</span>
        <Badge tono={SEVERIDAD_UI[b.severidad]?.tono ?? SEVERIDAD_UI.baja.tono}>{b.severidad}</Badge>
        {b.puntua === false && <Badge tono="neutral">contexto, sin puntaje</Badge>}
        <span className="text-mute">
          {b.agente ? <>{nombreDeAgente(b.agente)} <span className="font-mono text-[11px]">({b.agente})</span></> : "Sin agente registrado"}
        </span>
      </div>
      {b.evidencia && <p className="mt-2 break-words text-[12px] leading-relaxed text-ink">{redactDnis(b.evidencia)}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute">
        {b.norma && <span>Norma: <span className="text-ink">{b.norma}</span></span>}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all hover:text-ink hover:underline">
            <ExternalLink size={10} className="shrink-0" aria-hidden /> {b.fuenteUrl}
          </a>
        ) : (
          b.fuenteUrl && <span className="break-all">Fuente (sin enlace): {b.fuenteUrl}</span>
        )}
      </div>
      {b.verificacion ? (
        <div className="mt-2 rounded-lg bg-paperSoft px-2.5 py-2 text-[11px] text-mute">
          <div className={`inline-flex items-center gap-1 font-medium ${b.verificacion.ok ? "text-mossTexto" : "text-crimsonTexto"}`}>
            {b.verificacion.ok ? <ShieldCheck size={12} aria-hidden /> : <ShieldAlert size={12} aria-hidden />}
            Verificación automática {b.verificacion.ok ? "superada" : "fallida"}
            {` (${b.verificacion.n_checks ?? 0} ${b.verificacion.n_checks === 1 ? "cotejo" : "cotejos"})`}
          </div>
          {(b.verificacion.motivos?.length ?? 0) > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {b.verificacion.motivos!.map((m, i) => <Cotejo key={i} raw={m} />)}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-mute">Sin verificación automática registrada.</p>
      )}
      {alertaId && <Decision b={b} alertaId={alertaId} />}
    </li>
  );
}
