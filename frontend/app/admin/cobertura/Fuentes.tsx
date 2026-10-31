"use client";

import { Badge, DataTable, Expandable, SinDato, fmtFechaHora, fmtNum, hace, type Columna, type Tone } from "@/components/admin/ui";

// ── Fuentes de datos: el catálogo de la API (backend/api/src/lib/catalogoFuentes.ts) con su estado ──────────────────

export type Donde = "cloudflare" | "zurich" | "lima" | "navegador" | "pc" | "ci";
export type EstadoClave = "al_dia" | "atrasada" | "fallo" | "en_curso" | "a_mano" | "sin_registro";

export interface CargasFuente {
  tabla: string | null;
  cargas: number;
  cargasConError: number;
  filas: number | string;
  ultimaClave: string | null;
  ultimaDescarga: string | null;
  /** La última carga buena: cuándo llegó un dato nuevo. */
  ultimaCarga: string | null;
  ultimoError: string | null;
}
export interface CorridaFuente {
  fuente: string;
  instancia: string;
  estado: "corriendo" | "ok" | "error";
  inicio: string;
  fin: string | null;
  segundos: number | null;
  error: string | null;
  ultimaOk: string | null;
  ok30: number;
  error30: number;
}
/** Una fuente del catálogo con lo que dicen sus dos bitácoras (corridas del Worker y cargas). */
export interface EstadoFuente {
  fuente: string;
  nombre: string;
  que: string;
  donde: Donde;
  agenda: string;
  cadaDias: number | null;
  lanza?: string[];
  enCatalogo: boolean;
  cargas: CargasFuente | null;
  ultima: CorridaFuente | null;
  lanzadas: CorridaFuente[];
  ultimaBuena: string | null;
  estado: EstadoClave;
}

export const DONDE: Record<Donde, { label: string; tono: Tone; ayuda: string }> = {
  cloudflare: { label: "Cloudflare", tono: "ok", ayuda: "Worker vigia-scrapers con su cron: corre solo" },
  zurich: { label: "Cloudflare vía Zúrich", tono: "ok", ayuda: "corre solo y sale por el relay de Zúrich: el OECE y el SEACE bloquean otras regiones" },
  lima: { label: "Cloudflare vía Lima", tono: "ok", ayuda: "corre solo y sale por el relay de Lima (AWS): la fuente sólo responde a IPs del Perú" },
  navegador: { label: "Cloudflare con navegador", tono: "ok", ayuda: "corre solo con Browser Rendering: la ONPE filtra por la huella del navegador" },
  pc: { label: "Tu PC", tono: "pending", ayuda: "se corre a mano desde una PC en el Perú: la fuente bloquea la nube o pide un captcha" },
  ci: { label: "GitLab CI y tu PC", tono: "pending", ayuda: "rondas en GitLab CI (10 IP) que tu PC orquesta y procesa" },
};

const recorte = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Qué dice el estado de una fuente (lo calcula la API) y en qué tono. */
export function estadoFuente(f: EstadoFuente): { label: string; tono: Tone; pista: string } {
  switch (f.estado) {
    case "fallo":
      return { label: "Falló la última", tono: "danger", pista: f.ultima?.error ? recorte(f.ultima.error) : "sin detalle del error" };
    case "en_curso":
      return { label: "Corriendo", tono: "pending", pista: `empezó ${hace(f.ultima?.inicio) ?? "hace poco"}` };
    case "atrasada":
      return { label: "Atrasada", tono: "warn", pista: `toca cada ${f.cadaDias} días; la última buena, ${hace(f.ultimaBuena) ?? "nunca"}` };
    case "sin_registro":
      return { label: "Sin registro", tono: "muted", pista: f.donde === "ci" ? "su bitácora es dji_descargas" : "todavía no anotó ninguna carga" };
    case "a_mano":
      return { label: "A mano", tono: "muted", pista: `la última, ${hace(f.ultimaBuena)}` };
    default:
      return {
        label: "Al día",
        tono: "ok",
        pista: f.cargas?.cargasConError ? `${fmtNum(f.cargas.cargasConError)} cargas con error pendientes` : `la última buena, ${hace(f.ultimaBuena)}`,
      };
  }
}

/** Primero lo que pide atención; al final lo que no tiene registro. */
const ORDEN: Record<EstadoClave, number> = { fallo: 0, atrasada: 1, en_curso: 2, al_dia: 3, a_mano: 4, sin_registro: 5 };

/**
 * La tabla de fuentes (pestaña Fuentes externas de Cobertura) y, plegado debajo, el detalle técnico de cada carga: tabla,
 * último archivo y último error. «Última corrida» es la del Worker (las de tu PC no tienen); «Último dato nuevo», la última
 * carga de un archivo distinto: una fuente puede correr bien cada semana sin que su portal publique nada nuevo.
 */
export function Fuentes({ fuentes }: { fuentes: EstadoFuente[] }) {
  const filas = [...fuentes].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]);

  // En escritorio la segunda línea de cada celda (agenda, pista) va debajo; en la fila compacta del celular, al lado.
  const columnas: Columna<EstadoFuente>[] = [
    {
      clave: "fuente",
      titulo: "Fuente",
      principal: true,
      className: "max-w-[320px]",
      celda: (f) => (
        <>
          <span className="block font-medium text-ink">{f.nombre}</span>
          <span className="block text-rotulo text-mute">{f.que}</span>
        </>
      ),
    },
    {
      clave: "donde",
      titulo: "Dónde corre",
      celda: (f) => (
        <span title={DONDE[f.donde].ayuda} className="inline-flex flex-wrap items-center gap-x-1.5 lg:block">
          <Badge tono={DONDE[f.donde].tono} punto>
            {DONDE[f.donde].label}
          </Badge>
          <span className="text-micro text-mute lg:mt-0.5 lg:block">{f.agenda}</span>
        </span>
      ),
    },
    {
      clave: "corrida",
      titulo: "Última corrida",
      className: "whitespace-nowrap text-rotulo",
      celda: (f) =>
        f.ultima ? (
          <span className="text-ink" title={fmtFechaHora(f.ultima.inicio) ?? undefined}>
            {hace(f.ultima.inicio)}
            <span className="block text-micro text-mute">{f.ultima.estado === "ok" ? "terminó bien" : f.ultima.estado === "error" ? "falló" : "en curso"}</span>
          </span>
        ) : (
          <span className="hidden lg:inline">
            <SinDato texto={f.donde === "pc" || f.donde === "ci" ? "No corre sola" : "Sin corridas"} />
          </span>
        ),
    },
    {
      clave: "dato",
      titulo: "Último dato nuevo",
      className: "whitespace-nowrap text-rotulo",
      celda: (f) =>
        f.cargas?.ultimaCarga ? (
          <span className="text-ink" title={fmtFechaHora(f.cargas.ultimaCarga) ?? undefined}>
            {hace(f.cargas.ultimaCarga)}
            <span className="block text-micro text-mute">{fmtNum(f.cargas.filas)} filas en total</span>
          </span>
        ) : (
          <span className="hidden lg:inline">
            <SinDato texto="No anota cargas" />
          </span>
        ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (f) => {
        const e = estadoFuente(f);
        return (
          <span className="inline-flex flex-wrap items-center gap-x-1.5 lg:block">
            <Badge tono={e.tono}>{e.label}</Badge>
            <span className="text-micro text-mute lg:mt-0.5 lg:block" title={e.pista}>
              {e.pista}
            </span>
          </span>
        );
      },
    },
  ];

  const conCargas = filas.filter((f) => f.cargas);

  return (
    <div className="space-y-3">
      <DataTable etiqueta="Fuentes de datos" columnas={columnas} filas={filas} claveFila={(f) => f.fuente} apilarHasta="lg" compactoMovil />
      {conCargas.length > 0 && (
        <Expandable variante="linea" resumen={`Detalle técnico de las cargas (${conCargas.length} fuentes con registro)`}>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-paperSoft">
            {conCargas.map(({ fuente, nombre, cargas: c }) => (
              <li key={fuente} className="min-w-0 px-4 py-2.5">
                <p className="text-meta font-medium text-ink">{nombre}</p>
                <p className="truncate font-mono text-micro text-mute" title={`${fuente}${c!.tabla ? ` → ${c!.tabla}` : ""}`}>
                  {fuente}
                  {c!.tabla ? ` → ${c!.tabla}` : ""}
                </p>
                <p className="text-rotulo leading-snug text-inkSoft">
                  {/* Sin punto final: la fecha ya termina en «p. m.». */}
                  {fmtNum(c!.cargas)} cargas; último archivo <span className="break-all font-mono text-ink">{c!.ultimaClave ?? "sin dato"}</span>,
                  descargado {fmtFechaHora(c!.ultimaDescarga) ?? "sin fecha"}
                </p>
                <p className={`truncate text-rotulo ${c!.ultimoError ? "font-mono text-crimsonTexto" : "text-mute"}`} title={c!.ultimoError ?? undefined}>
                  {c!.ultimoError ? `Último error: ${c!.ultimoError}` : "Sin errores registrados"}
                </p>
              </li>
            ))}
          </ul>
        </Expandable>
      )}
    </div>
  );
}
