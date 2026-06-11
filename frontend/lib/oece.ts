/**
 * Cliente para la API OCDS de OECE.
 *
 * Base: https://contratacionesabiertas.oece.gob.pe/api/v1
 *   /records?ocid=ocds-dgv273-seacev3-{id} → record compilado (todas las fases)
 *   /records?limit=N&page=N                → paginado por defecto (default 20)
 *   /releases                              → releases atómicos
 *   /buyers   /suppliers                    → listados con totales
 *
 * El record compilado tiene la forma OCDS 1.1:
 *   planning.budget         → presupuesto
 *   tender.{title,desc,...}  → convocatoria (fase 2)
 *   awards[]                 → adjudicación (fase 3)
 *   contracts[]              → contrato (fase 4)
 *   parties[]                → comprador, oferentes, ganador
 */

export const OECE_BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1";
export const OCID_PREFIX = "ocds-dgv273-seacev3-";
export const OECE_PORTAL_BASE = "https://contratacionesabiertas.oece.gob.pe";

export interface OcdsAmount {
  amount: number;
  currency: string;
  currencyName?: string;
  amount_PEN?: number;
}

export interface OcdsBudget {
  description?: string;
  amount?: OcdsAmount;
  source?: string;
}

export interface OcdsBuyer {
  id: string;
  name: string;
}

export interface OcdsAddress {
  streetAddress?: string;
  locality?: string;
  region?: string;
  department?: string;
  countryName?: string;
}

export interface OcdsParty {
  id: string;
  name: string;
  roles?: string[];
  identifier?: { scheme?: string; id?: string; legalName?: string };
  additionalIdentifiers?: Array<{ scheme?: string; id?: string; legalName?: string }>;
  address?: OcdsAddress;
  contactPoint?: { telephone?: string; email?: string };
}

export interface OcdsItem {
  id: string;
  position?: string;
  description?: string;
  status?: string;
  statusDetails?: string;
  classification?: { id?: string; description?: string; scheme?: string };
  quantity?: number;
  unit?: { name?: string; value?: OcdsAmount };
}

export interface OcdsDocument {
  id: string;
  documentType?: string;
  title?: string;
  url?: string;
  datePublished?: string;
}

export interface OcdsTender {
  id?: string;
  title?: string;
  description?: string;
  procuringEntity?: OcdsBuyer;
  datePublished?: string;
  procurementMethod?: string;
  procurementMethodDetails?: string;
  mainProcurementCategory?: string;
  additionalProcurementCategories?: string[];
  value?: OcdsAmount;
  items?: OcdsItem[];
  tenderers?: Array<{ id: string; name: string }>;
  tenderPeriod?: { startDate?: string; endDate?: string };
  enquiryPeriod?: { startDate?: string; endDate?: string };
  documents?: OcdsDocument[];
  status?: string;
}

export interface OcdsAward {
  id: string;
  title?: string;
  value?: OcdsAmount;
  date?: string;
  suppliers?: Array<{ id: string; name: string }>;
  status?: string;
  items?: OcdsItem[];
}

export interface OcdsContract {
  id: string;
  title?: string;
  awardID?: string;
  value?: OcdsAmount;
  period?: { startDate?: string; endDate?: string };
  status?: string;
  dateSigned?: string;
  documents?: OcdsDocument[];
}

export interface OcdsCompiledRelease {
  ocid: string;
  id: string;
  date?: string;
  publishedDate?: string;
  initiationType?: string;
  buyer?: OcdsBuyer;
  planning?: { budget?: OcdsBudget; documents?: OcdsDocument[] };
  tender?: OcdsTender;
  awards?: OcdsAward[];
  contracts?: OcdsContract[];
  parties?: OcdsParty[];
}

export interface OcdsRecordsResponse {
  version: string;
  publishedDate: string;
  publisher: { name: string };
  records: Array<{ compiledRelease: OcdsCompiledRelease }>;
  links?: { next?: string | null; prev?: string | null };
}

// ─── Helpers ─────────────────────────────────────

export function toOcid(idOrOcid: string): string {
  const clean = idOrOcid.trim();
  if (clean.startsWith("ocds-")) return clean;
  return OCID_PREFIX + clean;
}

export function shortIdFromOcid(ocid: string): string {
  return ocid.replace(OCID_PREFIX, "");
}

export function formatAmount(a?: OcdsAmount): string {
  if (!a || !a.amount) return "—";
  const v = a.amount;
  if (v >= 1_000_000) return `S/. ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `S/. ${(v / 1000).toFixed(0)}K`;
  return `S/. ${v.toLocaleString("es-PE")}`;
}

export function formatDate(s?: string): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

// ─── Fetchers (server-side) ──────────────────────

export async function fetchConvocatoria(
  idOrOcid: string,
): Promise<OcdsCompiledRelease | null> {
  const ocid = toOcid(idOrOcid);
  const url = `${OECE_BASE}/records?ocid=${encodeURIComponent(ocid)}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 3600 }, // 1h cache
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data: OcdsRecordsResponse = await res.json();
    return data.records?.[0]?.compiledRelease ?? null;
  } catch {
    return null;
  }
}

export async function fetchLatestRecords(
  limit = 20,
  page = 1,
): Promise<OcdsCompiledRelease[]> {
  const url = `${OECE_BASE}/records?limit=${limit}&page=${page}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 }, // 10 min cache
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data: OcdsRecordsResponse = await res.json();
    return data.records?.map((r) => r.compiledRelease) ?? [];
  } catch {
    return [];
  }
}

// Helper para enriquecer una bandera con info OECE en caso necesario
export function portalUrlFor(ocid: string): string {
  return `${OECE_PORTAL_BASE}/perfilProveedor/#!/transactions/contract/${ocid}`;
}
