import {
  FileText,
  ExternalLink,
  Sparkles,
  Scale,
  Users,
  CheckCircle2,
  AlertCircle,
  Calendar,
} from "lucide-react";
import { formatDate } from "@/lib/oece";
import type { OcdsDocument } from "@/lib/oece";

const TIPO_LABEL: Record<string, string> = {
  awardNotice: "Otorgamiento de buena pro",
  evaluationReports: "Evaluación de propuestas",
  biddingDocuments: "Bases del proceso",
  technicalSpecifications: "Especificaciones técnicas",
  contractGuarantees: "Garantías",
  contractSigned: "Contrato firmado",
  notice: "Aviso público",
  signedContract: "Contrato firmado",
  awardingDocument: "Acta de otorgamiento",
};

const TIPO_ICON: Record<string, string> = {
  awardNotice: "🏆",
  evaluationReports: "📋",
  biddingDocuments: "📄",
  technicalSpecifications: "🔧",
  contractGuarantees: "🔒",
  contractSigned: "✍️",
  signedContract: "✍️",
  notice: "📢",
  awardingDocument: "🏆",
};

export function DocumentosAnalisis({
  documents,
  convocatoriaId,
}: {
  documents: OcdsDocument[];
  convocatoriaId: string;
}) {
  if (!documents || documents.length === 0) {
    return (
      <section className="surface p-6">
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-line bg-paperDeep p-4">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-mute" />
          <div className="text-sm text-mute">
            <strong className="text-ink">Sin documentos publicados.</strong>{" "}
            OECE no expuso documentos públicos para esta convocatoria. El{" "}
            <code className="font-mono">document_parser_agent</code> no tiene
            archivos que analizar.
          </div>
        </div>
      </section>
    );
  }

  // Agrupa por tipo
  const byType = documents.reduce<Record<string, OcdsDocument[]>>((acc, d) => {
    const t = d.documentType ?? "otros";
    (acc[t] = acc[t] || []).push(d);
    return acc;
  }, {});

  return (
    <section className="surface overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">
            Documentos del proceso
          </div>
          <h3 className="font-serif text-xl font-bold text-ink">
            {documents.length} documento{documents.length === 1 ? "" : "s"} público{documents.length === 1 ? "" : "s"}
          </h3>
          <p className="text-xs text-mute">
            Bases, evaluaciones, otorgamiento de buena pro, contratos firmados.
            Descargables del portal OECE.
          </p>
        </div>
        <span className="rounded-full bg-amber-soft px-2.5 py-1 text-[10px] font-semibold text-clay">
          {Object.keys(byType).length} tipo{Object.keys(byType).length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Lista de documentos agrupada */}
      <div className="divide-y divide-line">
        {Object.entries(byType).map(([tipo, docs]) => (
          <div key={tipo} className="px-5 py-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-mute">
              <span className="text-base">{TIPO_ICON[tipo] ?? "📁"}</span>
              {TIPO_LABEL[tipo] ?? tipo}
              <span className="rounded-full bg-paperDeep px-1.5 py-0 text-mute">
                {docs.length}
              </span>
            </div>
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li key={d.id}>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-start gap-2 rounded-lg border border-line bg-paperSoft px-3 py-2 transition-colors hover:bg-paperDeep"
                  >
                    <FileText size={14} className="mt-0.5 shrink-0 text-clay" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">
                        {d.title ?? d.url}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-mute">
                        <Calendar size={9} />
                        {formatDate(d.datePublished)}
                      </div>
                    </div>
                    <ExternalLink size={12} className="mt-1 shrink-0 text-mute group-hover:text-clay" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Placeholder análisis IA */}
      <div className="border-t border-line bg-paperDeep p-5">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-clay">
          <Sparkles size={11} /> Análisis automático con IA · pendiente
        </div>
        <h4 className="font-serif text-lg font-bold text-ink">
          ¿Qué extrae el <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-sm">document_parser_agent</code>?
        </h4>
        <p className="mt-1 text-sm text-mute">
          Cuando este agente se ejecute sobre los PDFs/ZIPs publicados, extraerá
          una estructura comparable entre proveedores y citará el marco legal
          aplicado por el comité. El resultado se publica como parte del
          dictamen del caso.
        </p>

        <div className="mt-4 grid gap-2.5 md:grid-cols-2">
          <ExtractCard
            icon={<Users size={14} />}
            title="Ofertas comparadas"
            body="Por cada proveedor: monto, plazo de entrega, garantía, puntaje técnico y económico. Tabla normalizada."
          />
          <ExtractCard
            icon={<CheckCircle2 size={14} />}
            title="Razón explícita del ganador"
            body="Texto del comité explicando por qué se eligió a la empresa adjudicataria. Citas directas del PDF."
          />
          <ExtractCard
            icon={<Scale size={14} />}
            title="Marco legal citado"
            body="Artículos de Ley 32069 / TUO Ley 30225, opiniones normativas OECE, jurisprudencia. Cada uno con link a fuente."
          />
          <ExtractCard
            icon={<AlertCircle size={14} />}
            title="Indicios detectables"
            body="Discrepancias entre criterios de evaluación y resultados, miembros del comité sin SICAN, fechas inconsistentes."
          />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-paperSoft px-4 py-2.5 text-xs">
          <span className="text-mute">
            Tool ADK: <code className="font-mono text-ink">document_parser_agent.parse_award_zip(url)</code>
          </span>
          <span className="font-mono text-clay">convocatoria #{convocatoriaId}</span>
        </div>
      </div>
    </section>
  );
}

function ExtractCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-clay">
        {icon} {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink">{body}</p>
    </div>
  );
}
