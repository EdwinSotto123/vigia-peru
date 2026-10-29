"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Globe, Link2, Linkedin, Mail, MapPin, Phone } from "lucide-react";
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
    telefono?: string | null;
    ubicacion?: string | null;
    enlaces?: { titulo: string; url: string }[] | null;
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
  const linkedin = a?.redes?.linkedin ?? null;
  const redes = Object.entries(a?.redes ?? {}).filter(([red, url]) => !!url && red !== "linkedin");
  const enlaces = (a?.enlaces ?? []).filter((e) => e.url && e.titulo);
  const telefono = a?.telefono ?? null;
  const sinContacto = !!a && !a.web && !a.email && !telefono && !linkedin && redes.length === 0 && enlaces.length === 0;

  // Las zonas que financió (del modelo anterior), juntando aportes de la misma zona. Un apoyo no tiene zona.
  const zonas = new Map<string, number>();
  for (const c of perfil?.contribuciones ?? []) {
    const clave = c.entidad ? `${c.entidad}` : c.zona;
    if (!clave) continue;
    zonas.set(clave, (zonas.get(clave) ?? 0) + c.contratos);
  }
  const listaZonas = [...zonas.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);

  // Primero lo que cuenta el podio (meses y aportes); lo que hizo leer en el modelo anterior, sólo si lo hubo.
  const cifras: { valor: number; etiqueta: string }[] = [
    { valor: fila.meses ?? 0, etiqueta: fila.meses === 1 ? "mes sosteniendo" : "meses sosteniendo" },
    { valor: fila.aportes ?? 0, etiqueta: fila.aportes === 1 ? "aporte" : "aportes" },
    ...(fila.contratosFinanciados > 0
      ? [
          { valor: fila.contratosFinanciados, etiqueta: fila.contratosFinanciados === 1 ? "contrato que hizo leer" : "contratos que hizo leer" },
          { valor: fila.senalesHalladas, etiqueta: fila.senalesHalladas === 1 ? "señal hallada" : "señales halladas" },
        ]
      : []),
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
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-granate px-5 text-cuerpo font-semibold text-paper hover:bg-granate-deep"
              >
                Ver perfil completo <ArrowRight size={16} aria-hidden />
              </Link>
            )}
            <Link
              href="/app/financiar"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-paperEdge px-5 text-cuerpo font-semibold text-ink hover:bg-paperSoft"
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
            <p className="mt-1 text-cuerpo leading-snug text-inkSoft">{desde ? `Aliado desde ${desde}` : "Aliado de Vigía"}</p>
          </div>
        </div>

        <ul className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {cifras.map((c) => (
            <li key={c.etiqueta} className="bg-paperSoft p-4">
              <span className="block font-display text-3xl font-bold leading-none tabular-nums text-granate">{numero(c.valor)}</span>
              <span className="mt-1.5 block text-meta leading-snug text-mute">{c.etiqueta}</span>
            </li>
          ))}
        </ul>

        <section className="mt-6">
          <h3 className="font-display text-bloque font-bold text-ink">Quién es</h3>
          {a?.descripcion ? (
            <p className="mt-2 text-cuerpo leading-relaxed text-ink">{a.descripcion}</p>
          ) : estado === "cargando" ? (
            <div className="mt-3 space-y-2" aria-hidden>
              <div className="h-3 w-11/12 animate-pulseSoft rounded bg-paperDeep" />
              <div className="h-3 w-8/12 animate-pulseSoft rounded bg-paperDeep" />
            </div>
          ) : fundador ? (
            <p className="mt-2 text-cuerpo leading-relaxed text-ink">
              Vigía Perú financia con capital semilla las primeras lecturas y aparece en su propio ranking, igual que cualquier
              otro aliado.
            </p>
          ) : (
            <p className="mt-2 text-cuerpo leading-relaxed text-mute">Todavía no publicó una descripción de sí.</p>
          )}
          {a?.ubicacion && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-dato text-inkSoft">
              <MapPin size={14} aria-hidden /> {a.ubicacion}
            </p>
          )}
          {(a?.web || a?.email || telefono || linkedin || redes.length > 0) && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {linkedin && (
                <li>
                  <a
                    href={linkedin}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-dato font-medium text-ink hover:bg-paperSoft"
                  >
                    <Linkedin size={14} aria-hidden /> LinkedIn <ArrowUpRight size={13} aria-hidden />
                  </a>
                </li>
              )}
              {telefono && (
                <li>
                  <a
                    href={`tel:${telefono.replace(/[^+\d]/g, "")}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-dato font-medium text-ink hover:bg-paperSoft"
                  >
                    <Phone size={14} aria-hidden /> <span className="tabular-nums">{telefono}</span>
                  </a>
                </li>
              )}
              {a?.web && (
                <li>
                  <a
                    href={a.web}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-dato font-medium text-ink hover:bg-paperSoft"
                  >
                    <Globe size={14} aria-hidden /> Sitio web <ArrowUpRight size={13} aria-hidden />
                  </a>
                </li>
              )}
              {a?.email && (
                <li>
                  <a
                    href={`mailto:${a.email}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-dato font-medium text-ink hover:bg-paperSoft"
                  >
                    <Mail size={14} aria-hidden /> {a.email}
                  </a>
                </li>
              )}
              {redes.map(([red, url]) => (
                <li key={red}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-paperEdge px-3.5 text-dato font-medium text-ink hover:bg-paperSoft"
                  >
                    {NOMBRE_RED[red] ?? red} <ArrowUpRight size={13} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {enlaces.length > 0 && (
            <div className="mt-4">
              <h4 className="text-meta font-semibold text-inkSoft">Enlaces relevantes</h4>
              <ul className="mt-2 space-y-1.5">
                {enlaces.map((e) => (
                  <li key={e.url}>
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 text-dato font-medium text-granate underline-offset-4 hover:underline"
                    >
                      <Link2 size={14} aria-hidden /> {e.titulo} <ArrowUpRight size={13} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sinContacto && !fundador && (
            <p className="mt-3 text-meta leading-snug text-mute">
              Todavía no publicó datos de contacto.{" "}
              <Link href="/app/configuracion" className="text-granate underline-offset-4 hover:underline">
                ¿Es tu empresa? Completa su perfil
              </Link>
              .
            </p>
          )}
        </section>

        {/* Lo que hizo leer en el modelo anterior (S/ 3 por contrato): sólo si lo hubo. Un apoyo va al fondo común. */}
        {fila.contratosFinanciados > 0 && (
        <section className="mt-6">
          <h3 className="font-display text-bloque font-bold text-ink">Qué hizo leer</h3>
          {listaZonas.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {listaZonas.map(([zona, n]) => (
                <li key={zona} className="inline-flex items-center gap-2 rounded-full bg-granate-soft px-3.5 py-1.5 text-dato text-ink">
                  <span className="font-medium">{zona}</span>
                  <span className="font-mono text-meta tabular-nums text-granate">{numero(n)}</span>
                </li>
              ))}
            </ul>
          ) : estado === "error" ? (
            <p className="mt-2 text-cuerpo leading-relaxed text-mute">No pudimos traer el detalle ahora. Está completo en su perfil.</p>
          ) : estado === "cargando" ? (
            <div className="mt-3 h-8 w-40 animate-pulseSoft rounded-full bg-paperDeep" aria-hidden />
          ) : (
            <p className="mt-2 text-cuerpo leading-relaxed text-mute">Todavía no tiene zonas registradas.</p>
          )}
          <p className="mt-4 text-meta leading-snug text-mute">
            El aliado no eligió cuáles se leían: se asignaban por antigüedad.
          </p>
        </section>
        )}
        <p className="mt-6 text-meta leading-snug text-mute">
          El podio cuenta los meses que sostiene la vigilancia, nunca los soles. Ningún aliado elige qué se lee ni qué se publica.
        </p>
      </Panel>
    </>
  );
}
