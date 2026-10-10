"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Globe, Mail } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { TIPO_FINANCIADOR_LABEL } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AvatarAliado, esFundador } from "./TarjetaAliado";
import { hrefPerfil, type FilaRanking } from "./ranking";

/**
 * Lo que pasa al tocar un puesto del podio: se abre un panel con QUIÉN ES el aliado
 * (su logo, qué publicó de sí, sus enlaces) y QUÉ HIZO LEER (cifras y zonas), sin sacar
 * a nadie de la página. "Ver perfil completo" lleva a /aliado/<slug>.
 *
 * Lo que el panel muestra viene de `GET /financiamiento/aliados/:slug`, el mismo del
 * perfil, y se pide al abrir (no al pintar el podio). Las cifras de arriba ya vienen en la
 * fila del ranking, así que el panel nunca está vacío: si el perfil tarda o falla, se ve
 * lo que se sabe y el enlace al perfil.
 *
 * Mismas reglas que todo el ranking: se cuenta en CONTRATOS, nunca en soles, y sólo se
 * dice lo que el aliado publicó; lo que no publicó se dice tal cual, no se rellena.
 */

interface Contribucion {
  contratos: number;
  zona: string;
  entidad: string | null;
  procesados: number;
  senales: number;
}
interface PerfilApi {
  aliado: {
    descripcion?: string | null;
    web?: string | null;
    email?: string | null;
    redes?: Record<string, string> | null;
  };
  contribuciones: Contribucion[];
}

const NOMBRE_RED: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
};

const mesAnio = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "America/Lima" }).format(new Date(iso)) : null;

export function AliadoAbrir({ fila, className, children }: { fila: FilaRanking; className?: string; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const [perfil, setPerfil] = useState<PerfilApi | null>(null);
  const [estado, setEstado] = useState<"idle" | "cargando" | "error">("idle");
  const cerrar = useCallback(() => setAbierto(false), []);

  useEffect(() => {
    if (!abierto || perfil || estado === "cargando" || !fila.slug) return;
    setEstado("cargando");
    fetch(`${PUBLIC_API_BASE}/financiamiento/aliados/${encodeURIComponent(fila.slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PerfilApi>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setPerfil(d);
        setEstado("idle");
      })
      .catch(() => setEstado("error"));
  }, [abierto, perfil, estado, fila.slug]);

  const href = hrefPerfil(fila.slug);
  const fundador = esFundador(fila);
  const desde = mesAnio(fila.desde);
  const a = perfil?.aliado;
  const redes = Object.entries(a?.redes ?? {}).filter(([, url]) => !!url);

  // Las zonas que financió, juntando aportes de la misma zona.
  const zonas = new Map<string, number>();
  for (const c of perfil?.contribuciones ?? []) {
    const clave = c.entidad ? `${c.entidad}` : c.zona;
    zonas.set(clave, (zonas.get(clave) ?? 0) + c.contratos);
  }
  const listaZonas = [...zonas.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);

  const cifras: { valor: number; etiqueta: string }[] = [
    { valor: fila.contratosFinanciados, etiqueta: fila.contratosFinanciados === 1 ? "contrato financiado" : "contratos financiados" },
    { valor: fila.contratosProcesados, etiqueta: fila.contratosProcesados === 1 ? "ya leído" : "ya leídos" },
    { valor: fila.senalesHalladas, etiqueta: fila.senalesHalladas === 1 ? "señal hallada" : "señales halladas" },
    { valor: fila.zonas, etiqueta: fila.zonas === 1 ? "zona alcanzada" : "zonas alcanzadas" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-label={`Ver quién es ${fila.nombre}, puesto ${fila.puesto}`}
        className={cn("text-left", className)}
      >
        {children}
      </button>
      <Panel
        abierto={abierto}
        onCerrar={cerrar}
        titulo={fila.nombre}
        descripcion={`Puesto ${fila.puesto} del ranking de aliados`}
        ancho="md"
        pie={
          <div className="flex flex-wrap items-center gap-3">
            {href && (
              <Link
                href={href}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-granate px-5 text-[15px] font-semibold text-paper hover:bg-granate-deep"
              >
                Ver perfil completo <ArrowRight size={16} aria-hidden />
              </Link>
            )}
            <Link
              href="/app/financiar"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-paperEdge px-5 text-[15px] font-semibold text-ink hover:bg-paperSoft"
            >
              Financiar una auditoría
            </Link>
          </div>
        }
      >
        <div className="flex items-center gap-4">
          <AvatarAliado tipo={fila.tipo} logoUrl={fila.logoUrl} nombre={fila.nombre} size="xl" />
          <div className="min-w-0">
            <p className="etiqueta-mono">{fundador ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[fila.tipo]}</p>
            <p className="mt-1 text-[15px] leading-snug text-inkSoft">{desde ? `Aliado desde ${desde}` : "Aliado de Vigía"}</p>
          </div>
        </div>

        <ul className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {cifras.map((c) => (
            <li key={c.etiqueta} className="bg-paperSoft p-4">
              <span className="block font-display text-3xl font-bold leading-none tabular-nums text-granate">{numero(c.valor)}</span>
              <span className="mt-1.5 block text-[13px] leading-snug text-mute">{c.etiqueta}</span>
            </li>
          ))}
        </ul>

        <section className="mt-6">
          <h3 className="etiqueta-mono">Quién es</h3>
          {a?.descripcion ? (
            <p className="mt-2 text-[15px] leading-relaxed text-ink">{a.descripcion}</p>
          ) : estado === "cargando" ? (
            <div className="mt-3 space-y-2" aria-hidden>
              <div className="h-3 w-11/12 animate-pulseSoft rounded bg-paperDeep" />
              <div className="h-3 w-8/12 animate-pulseSoft rounded bg-paperDeep" />
            </div>
          ) : fundador ? (
            <p className="mt-2 text-[15px] leading-relaxed text-ink">
              Vigía Perú financia con capital semilla las primeras lecturas y aparece en su propio ranking, igual que cualquier
              otro aliado.
            </p>
          ) : (
            <p className="mt-2 text-[15px] leading-relaxed text-mute">Todavía no publicó una descripción de sí.</p>
          )}
          {(a?.web || a?.email || redes.length > 0) && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {a?.web && (
                <li>
                  <a
                    href={a.web}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-[14px] font-medium text-ink hover:bg-paperSoft"
                  >
                    <Globe size={14} aria-hidden /> Sitio web <ArrowUpRight size={13} aria-hidden />
                  </a>
                </li>
              )}
              {a?.email && (
                <li>
                  <a
                    href={`mailto:${a.email}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-[14px] font-medium text-ink hover:bg-paperSoft"
                  >
                    <Mail size={14} aria-hidden /> Contacto
                  </a>
                </li>
              )}
              {redes.map(([red, url]) => (
                <li key={red}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-[14px] font-medium text-ink hover:bg-paperSoft"
                  >
                    {NOMBRE_RED[red] ?? red} <ArrowUpRight size={13} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h3 className="etiqueta-mono">Qué hizo leer</h3>
          {listaZonas.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {listaZonas.map(([zona, n]) => (
                <li key={zona} className="inline-flex items-center gap-2 rounded-full bg-granate-soft px-3.5 py-1.5 text-[14px] text-ink">
                  <span className="font-medium">{zona}</span>
                  <span className="font-mono text-[13px] tabular-nums text-granate">{numero(n)}</span>
                </li>
              ))}
            </ul>
          ) : estado === "error" ? (
            <p className="mt-2 text-[15px] leading-relaxed text-mute">No pudimos traer el detalle ahora. Está completo en su perfil.</p>
          ) : estado === "cargando" ? (
            <div className="mt-3 h-8 w-40 animate-pulseSoft rounded-full bg-paperDeep" aria-hidden />
          ) : (
            <p className="mt-2 text-[15px] leading-relaxed text-mute">Todavía no tiene zonas registradas.</p>
          )}
          <p className="mt-4 text-[13px] leading-snug text-mute">
            Se cuenta en contratos, nunca en soles. El aliado no elige cuáles se leen: se asignan por antigüedad.
          </p>
        </section>
      </Panel>
    </>
  );
}
