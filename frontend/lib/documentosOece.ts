import { registroOcds } from "@/lib/fuentes";

/**
 * Los documentos de un proceso tal como los publica el OECE en su registro OCDS (Contrataciones Abiertas): bases, actas de
 * buena pro, contrato, adendas y prórrogas, cada uno con su enlace de descarga del SEACE. Para los procesos que Vigía todavía
 * no tiene entre sus contratos (2026-11-23: la contratación directa del alquiler de oficinas de la Municipalidad de Lima,
 * código 922222, tenía seis PDF en el OECE y el panel de su orden no mostraba ninguno). Se pide desde el servidor (el OECE no
 * deja leerlo desde el navegador) y se guarda un día.
 */
export interface DocumentoOece {
  titulo: string;
  url: string;
  etapa: "Convocatoria" | "Buena pro" | "Contrato" | "Plan";
  fecha: string | null;
}

export interface RegistroOece {
  nomenclatura: string | null;
  metodo: string | null;
  documentos: DocumentoOece[];
}

interface DocOcds {
  title?: string;
  url?: string;
  datePublished?: string;
}

const UA = "Gobserva-Vigia/1.0 (+https://vigia.gobserva.cloud)";

export async function documentosOece(codigo: string): Promise<RegistroOece | null> {
  if (!/^\d{3,9}$/.test(codigo)) return null;
  try {
    const r = await fetch(registroOcds(codigo), {
      headers: { accept: "application/json", "user-agent": UA },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(6_000),
    } as RequestInit);
    if (!r.ok) return null;
    const d = (await r.json()) as { records?: { compiledRelease?: Record<string, unknown> }[] };
    const cr = d.records?.[0]?.compiledRelease as
      | {
          planning?: { documents?: DocOcds[] };
          tender?: { title?: string; procurementMethodDetails?: string; documents?: DocOcds[] };
          awards?: { documents?: DocOcds[] }[];
          contracts?: { documents?: DocOcds[] }[];
        }
      | undefined;
    if (!cr) return null;
    const de = (xs: DocOcds[] | undefined, etapa: DocumentoOece["etapa"]): DocumentoOece[] =>
      (xs ?? [])
        .filter((x) => !!x.url && /^https?:\/\//.test(x.url))
        .map((x) => ({ titulo: (x.title ?? "Documento").trim(), url: x.url!, etapa, fecha: x.datePublished?.slice(0, 10) ?? null }));
    const documentos = [
      ...de(cr.planning?.documents, "Plan"),
      ...de(cr.tender?.documents, "Convocatoria"),
      ...(cr.awards ?? []).flatMap((a) => de(a.documents, "Buena pro")),
      ...(cr.contracts ?? []).flatMap((c) => de(c.documents, "Contrato")),
    ];
    // El mismo archivo puede venir en dos etapas: una vez.
    const vistos = new Set<string>();
    return {
      nomenclatura: cr.tender?.title ?? null,
      metodo: cr.tender?.procurementMethodDetails ?? null,
      documentos: documentos.filter((x) => (vistos.has(x.url) ? false : (vistos.add(x.url), true))),
    };
  } catch {
    return null;
  }
}
