import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import {
  type OcdsCompiledRelease,
  type OcdsAmount,
  formatAmount,
  formatDate,
} from "@/lib/oece";
import { cn } from "@/lib/utils";

type Estado = "pass" | "fail" | "pending" | "na";
type Severidad = "alta" | "media" | "baja";

interface Check {
  id: string;
  estado: Estado;
  titulo: string;
  evidencia: string;
  norma?: string;
  severidad?: Severidad;
  opinionOece?: string;
  source?: { label: string; url: string };
}

// Plazos mínimos legales (días calendarios aprox) por tipo de procedimiento
const PLAZO_MINIMO_DIAS: Record<string, number> = {
  "Licitación Pública": 22,
  "Concurso Público": 22,
  "Adjudicación Simplificada": 8,
  "Subasta Inversa Electrónica": 8,
  "Selección de Consultores Individuales": 5,
  "Comparación de Precios": 5,
  "Contratación Directa": 0,
};

function daysBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  try {
    const d1 = new Date(a).getTime();
    const d2 = new Date(b).getTime();
    if (!isFinite(d1) || !isFinite(d2)) return null;
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function computeChecks(release: OcdsCompiledRelease): Check[] {
  const checks: Check[] = [];
  const tender = release.tender ?? {};
  const awards = release.awards ?? [];
  const contracts = release.contracts ?? [];
  const method = tender.procurementMethodDetails ?? "—";

  // 1. Tipo de procedimiento publicado
  checks.push({
    id: "tipo_procedimiento",
    estado: tender.procurementMethodDetails ? "pass" : "na",
    titulo: "Tipo de procedimiento publicado",
    evidencia: tender.procurementMethodDetails
      ? `Procedimiento clasificado como "${method}". Marco aplicable: ${
          tender.procurementMethodDetails.includes("Directa")
            ? "Art. 27 TUO Ley 30225 (causal obligatoria)"
            : "Reglamento Ley 32069"
        }.`
      : "Sin método de selección publicado.",
    norma: "Art. 24 Reglamento Ley 32069",
  });

  // 2. Plazo legal entre convocatoria y presentación de propuestas
  const plazoStart = tender.tenderPeriod?.startDate ?? tender.datePublished;
  const plazoEnd = tender.tenderPeriod?.endDate;
  const plazoDias = daysBetween(plazoStart, plazoEnd);
  const minDias = PLAZO_MINIMO_DIAS[method] ?? null;

  if (plazoDias == null) {
    checks.push({
      id: "plazo_minimo",
      estado: "pending",
      titulo: "Plazo entre convocatoria y presentación",
      evidencia:
        "OECE no expuso fechas de inicio/fin del periodo de tender. El document_parser_agent las extraerá del PDF de la convocatoria.",
      norma: "Art. 64 Reglamento Ley 32069",
    });
  } else if (minDias == null) {
    checks.push({
      id: "plazo_minimo",
      estado: "na",
      titulo: "Plazo entre convocatoria y presentación",
      evidencia: `Convocatoria abierta ${plazoDias} días. Procedimiento "${method}" — el plazo mínimo no está hardcodeado para este tipo.`,
      norma: "Art. 64 Reglamento Ley 32069",
    });
  } else if (plazoDias >= minDias) {
    checks.push({
      id: "plazo_minimo",
      estado: "pass",
      titulo: "Plazo legal de presentación cumplido",
      evidencia: `Convocatoria abierta ${plazoDias} días (${formatDate(plazoStart)} → ${formatDate(plazoEnd)}). Mínimo legal para ${method}: ${minDias} días.`,
      norma: "Art. 64 Reglamento Ley 32069",
    });
  } else {
    checks.push({
      id: "plazo_minimo",
      estado: "fail",
      titulo: "Plazo de presentación por debajo del mínimo legal",
      evidencia: `Convocatoria abierta sólo ${plazoDias} días (${formatDate(plazoStart)} → ${formatDate(plazoEnd)}). El mínimo legal para ${method} es ${minDias} días.`,
      norma: "Art. 64 Reglamento Ley 32069",
      severidad: "alta",
      opinionOece: "D037-2025",
    });
  }

  // 3. Único postor
  const tenderers = tender.tenderers ?? [];
  const totalAward = awards.reduce(
    (s, a) => s + (a.value?.amount ?? 0),
    0,
  );
  const referencial = tender.value?.amount ?? 0;
  const ratio = referencial > 0 ? totalAward / referencial : 0;

  if (tenderers.length === 0 && awards.length === 0) {
    checks.push({
      id: "unico_postor",
      estado: "pending",
      titulo: "Cantidad de postores",
      evidencia: "OECE no publicó aún la lista de postores ni adjudicaciones.",
      norma: "Heurística C2 — modelo Funes",
    });
  } else if (tenderers.length === 1 && ratio >= 0.95) {
    checks.push({
      id: "unico_postor",
      estado: "fail",
      titulo: "Único postor adjudicado cerca del valor referencial",
      evidencia: `Sólo 1 postor presentó oferta. Adjudicación al ${(ratio * 100).toFixed(1)}% del valor referencial (${formatAmount(tender.value)}). Patrón clásico de direccionamiento (cruce C2 del modelo Funes).`,
      norma: "Heurística OjoPúblico · Art. 27 Reglamento",
      severidad: "alta",
      opinionOece: "D008-2025",
    });
  } else if (tenderers.length === 1) {
    checks.push({
      id: "unico_postor",
      estado: "fail",
      titulo: "Único postor presentado",
      evidencia: `Sólo 1 postor en la convocatoria. Sin competencia. Adjudicación al ${(ratio * 100).toFixed(1)}% del valor referencial.`,
      norma: "Heurística C2",
      severidad: "media",
    });
  } else {
    checks.push({
      id: "unico_postor",
      estado: "pass",
      titulo: `Competencia múltiple (${tenderers.length} postores)`,
      evidencia: `${tenderers.length} ofertas presentadas. ${
        awards.length > 0
          ? `Adjudicación final al ${(ratio * 100).toFixed(1)}% del valor referencial.`
          : "Sin adjudicación publicada aún."
      }`,
    });
  }

  // 4. Monto adjudicado vs valor referencial
  if (referencial > 0 && totalAward > 0) {
    const overrun = totalAward > referencial;
    if (overrun) {
      checks.push({
        id: "monto_vs_referencial",
        estado: "fail",
        titulo: "Adjudicación supera el valor referencial",
        evidencia: `Adjudicado ${formatAmount({ amount: totalAward, currency: "PEN" } as OcdsAmount)} sobre referencial ${formatAmount(tender.value)} (${(ratio * 100).toFixed(1)}%).`,
        norma: "Art. 28 Reglamento Ley 32069",
        severidad: "alta",
      });
    } else {
      checks.push({
        id: "monto_vs_referencial",
        estado: "pass",
        titulo: "Adjudicación dentro del valor referencial",
        evidencia: `Adjudicación al ${(ratio * 100).toFixed(1)}% del valor referencial.`,
      });
    }
  }

  // 5. Causal de contratación directa
  if (method.toLowerCase().includes("directa")) {
    // OECE OCDS no expone "causal" directamente — el document_parser_agent debe extraerla
    checks.push({
      id: "causal_directa",
      estado: "pending",
      titulo: "Causal de contratación directa fundamentada",
      evidencia:
        "Toda contratación directa requiere causal válida del Art. 27 TUO Ley 30225 (emergencia, exclusividad, etc). El document_parser_agent extraerá la causal del PDF y validará que sea una de las 12 causales legales.",
      norma: "Art. 27 TUO Ley 30225",
    });
  }

  // 6. Comité de selección (no expuesto en OCDS)
  checks.push({
    id: "comite_seleccion",
    estado: "pending",
    titulo: "Comité de Selección con SICAN vigente",
    evidencia:
      "OECE OCDS no expone la lista del Comité de Selección. El document_parser_agent extrae los DNI del acta del comité y compliance_agent los cruza contra el padrón SICAN vigente.",
    norma: "Art. 8 Reglamento Ley 32069",
  });

  // 7. Inhabilitación del ganador
  if (awards.length > 0) {
    checks.push({
      id: "ganador_no_inhabilitado",
      estado: "pending",
      titulo: "Ganador sin inhabilitación vigente",
      evidencia:
        "compliance_agent cruzará el RUC del adjudicado contra el registro OSCE de inhabilitados. Si está sancionado a la fecha de buena pro → nulidad automática del proceso.",
      norma: "Art. 50 TUO Ley 30225",
    });
  }

  // 8. Adendas dentro del 25%
  if (contracts.length > 0) {
    checks.push({
      id: "adendas_25",
      estado: "pending",
      titulo: "Adendas dentro del 25% del monto contratado",
      evidencia:
        "Las adendas y modificaciones contractuales no pueden exceder el 25% del monto original. El compliance_agent monitoreará el campo monto_adicional / monto_original sobre cada modificación publicada.",
      norma: "Art. 34 TUO Ley 30225",
      opinionOece: "D037-2024",
    });
  } else {
    checks.push({
      id: "adendas_25",
      estado: "na",
      titulo: "Adendas dentro del 25%",
      evidencia: "Aún no se ha firmado contrato — no aplican adendas.",
      norma: "Art. 34 TUO Ley 30225",
    });
  }

  // 9. Coherencia cronológica
  const fechaPub = tender.datePublished;
  const fechaInicio = tender.tenderPeriod?.startDate;
  const fechaFin = tender.tenderPeriod?.endDate;
  const fechaBuenaPro = awards[0]?.date;

  const allDates = [fechaPub, fechaInicio, fechaFin, fechaBuenaPro].filter(Boolean) as string[];
  if (allDates.length >= 2) {
    const ts = allDates.map((d) => new Date(d).getTime());
    const ordered = ts.every((t, i) => i === 0 || t >= ts[i - 1]);
    checks.push({
      id: "cronologia",
      estado: ordered ? "pass" : "fail",
      titulo: ordered
        ? "Cronología de fechas coherente"
        : "Cronología de fechas con saltos inconsistentes",
      evidencia: ordered
        ? `Publicación → Inicio → Cierre → Buena pro en orden cronológico.`
        : `Una o más fechas están fuera de orden. Revisar manualmente.`,
      norma: "Coherencia procedimental",
      severidad: ordered ? undefined : "media",
    });
  }

  return checks;
}

export function DeteccionInconsistencias({
  release,
}: {
  release: OcdsCompiledRelease;
}) {
  const checks = computeChecks(release);
  const passed = checks.filter((c) => c.estado === "pass").length;
  const failed = checks.filter((c) => c.estado === "fail").length;
  const pending = checks.filter((c) => c.estado === "pending").length;
  const na = checks.filter((c) => c.estado === "na").length;

  return (
    <section className="surface overflow-hidden p-0">
      <header className="border-b border-line bg-paperDeep px-5 py-4">
        <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-clay">
          <ShieldAlert size={11} /> Detección de irregularidades
        </div>
        <h2 className="font-serif text-2xl font-bold text-ink">
          {failed > 0
            ? `${failed} incumplimiento${failed > 1 ? "s" : ""} detectado${failed > 1 ? "s" : ""}`
            : "Sin incumplimientos detectados"}
        </h2>
        <p className="mt-1 text-xs text-mute">
          {checks.length} reglas evaluadas · {passed} cumple · {failed} falla ·{" "}
          {pending} pendiente del agente · {na} N/A
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-mute">
          <span>Motor: <code className="font-mono">compliance_agent</code></span>
          <span>+ <code className="font-mono">document_parser_agent</code></span>
          <span>· Cada regla cita su artículo legal vinculante</span>
        </div>
      </header>

      <ul className="divide-y divide-line">
        {checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>

      <div className="border-t border-line bg-paperDeep px-5 py-3 text-[11px] text-mute">
        <strong className="text-ink">Cómo leerlo:</strong> los checks en{" "}
        <span className="text-rust">rust</span> son incumplimientos verificables
        contra la norma. Los <span className="text-mute">pendientes</span>{" "}
        requieren parsear el PDF de buena pro o cruzar con OSCE / SICAN — eso lo
        hace el motor de agentes una vez se invoca el caso.
      </div>
    </section>
  );
}

function CheckRow({ check }: { check: Check }) {
  const estadoMeta = {
    pass: { icon: <ShieldCheck size={16} />, color: "text-moss", bg: "bg-paperSoft" },
    fail: { icon: <ShieldAlert size={16} />, color: "text-rust", bg: "bg-crimson-soft" },
    pending: { icon: <Clock size={16} />, color: "text-mute", bg: "bg-paperDeep" },
    na: { icon: <ChevronRight size={16} />, color: "text-mute", bg: "" },
  }[check.estado];

  return (
    <li className={cn("px-5 py-3.5", estadoMeta.bg)}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", estadoMeta.color)}>
          {estadoMeta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "rounded-full px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider",
                check.estado === "pass" && "bg-moss text-paper",
                check.estado === "fail" && "bg-rust text-paper",
                check.estado === "pending" && "bg-paper text-mute border border-line",
                check.estado === "na" && "bg-line text-mute",
              )}
            >
              {check.estado === "pass"
                ? "cumple"
                : check.estado === "fail"
                  ? "falla"
                  : check.estado === "pending"
                    ? "pendiente"
                    : "N/A"}
            </span>
            {check.severidad && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0 text-[9px] font-bold uppercase",
                  check.severidad === "alta"
                    ? "bg-rust text-paper"
                    : check.severidad === "media"
                      ? "bg-amber text-paper"
                      : "bg-line text-ink",
                )}
              >
                {check.severidad}
              </span>
            )}
          </div>
          <div className="mt-1 font-serif text-sm font-bold leading-snug text-ink">
            {check.titulo}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-inkSoft">
            {check.evidencia}
          </p>
          {(check.norma || check.opinionOece) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
              {check.norma && (
                <span className="text-mute">
                  <strong className="text-ink">Norma:</strong> {check.norma}
                </span>
              )}
              {check.opinionOece && (
                <a
                  href={`https://www.gob.pe/institucion/oece/buscador?contenido=opinion&search=${check.opinionOece}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-clay hover:underline"
                >
                  <ExternalLink size={9} />
                  Opinión OECE {check.opinionOece}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
