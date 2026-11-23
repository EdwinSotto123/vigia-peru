"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Loader2 } from "lucide-react";
import { FUENTE, PORTADA } from "@/components/empresas/secciones/antecedentes";
import { datosDe } from "@/components/empresas/secciones/casoAntecedente";
import { baseApiNavegador } from "@/lib/api-client";
import type { AntecedenteEmpresa } from "@/lib/empresas";
import { fecha } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

/**
 * Los casos de UN antecedente de un participante, con sus datos (2026-11-23, el usuario en 1217692: «no dice qué socio ni
 * cita evidencias… se pierde información»). El panel del participante decía «Socio del proveedor trabaja en la entidad,
 * 13 registros» y la explicación genérica del tipo: ni quién, ni dónde, ni cuándo. Ahora, bajo cada uno, sus casos con
 * lo que dice el registro (quién, su papel, la entidad, la fecha, el monto), los de ESTE contrato primero, y la fuente.
 *
 * Una sola consulta por empresa (GET /empresas/:ruc/antecedentes, la misma de su pestaña Antecedentes), compartida por
 * todos los antecedentes del panel y pedida al abrirlo. Los nombres de personas llegan tapados de la API.
 */
const cache = new Map<string, Promise<AntecedenteEmpresa[]>>();
function casosDe(ruc: string): Promise<AntecedenteEmpresa[]> {
  let p = cache.get(ruc);
  if (!p) {
    p = fetch(`${baseApiNavegador()}/empresas/${ruc}/antecedentes`)
      .then((r) => (r.ok ? (r.json() as Promise<{ data?: AntecedenteEmpresa[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => d.data ?? []);
    p.catch(() => cache.delete(ruc));
    cache.set(ruc, p);
  }
  return p;
}

/** ¿Es del contrato que se está viendo? El caso trae el OCID entero o el código del SEACE. */
const delContrato = (a: AntecedenteEmpresa, ocid: string | null) => !!ocid && !!a.ocid && (a.ocid === ocid || a.ocid.endsWith(`-${ocid}`));

export function EvidenciaParticipante({ ruc, tipo, ocid, href }: { ruc: string; tipo: string; ocid: string | null; href: string | null }) {
  const [casos, setCasos] = useState<AntecedenteEmpresa[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    casosDe(ruc)
      .then((xs) => vivo && setCasos(xs.filter((a) => a.tipo === tipo)))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [ruc, tipo]);

  if (error) return null;
  if (!casos) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-meta text-mute">
        <Loader2 size={13} className="animate-spin" aria-hidden /> Buscando sus casos…
      </p>
    );
  }
  if (casos.length === 0) return null;
  const orden = [...casos].sort((a, b) => Number(delContrato(b, ocid)) - Number(delContrato(a, ocid)));
  // Los casos que dicen lo mismo (la misma persona, las mismas órdenes) en fechas distintas van juntos: antes se repetía
  // tres veces la misma tarjeta con otra fecha.
  const grupos: { firma: string; a: AntecedenteEmpresa; fechas: string[]; aqui: boolean }[] = [];
  for (const a of orden) {
    // La firma es lo que se MUESTRA (los cinco primeros datos y la entidad): lo demás (el proceso, la orden) varía.
    const firma =
      datosDe(a, ruc)
        .filter((x) => x.valor || x.lista?.length)
        .slice(0, 5)
        .map((x) => `${x.etiqueta}=${x.valor ?? x.lista?.map((l) => l.texto).join(",") ?? ""}`)
        .join("|") + `|${a.entidad ?? ""}`;
    const g = grupos.find((x) => x.firma === firma);
    if (g) {
      if (a.fecha) g.fechas.push(a.fecha);
      g.aqui = g.aqui || delContrato(a, ocid);
    } else grupos.push({ firma, a, fechas: a.fecha ? [a.fecha] : [], aqui: delContrato(a, ocid) });
  }
  const vista = grupos.slice(0, 3);
  return (
    <ul className="mt-2 space-y-2" aria-label="Sus casos">
      {/* recorte: los tres primeros (los de este contrato antes); todos, con su evidencia, en la ficha de la empresa */}
      {vista.map(({ a, fechas, aqui }, k) => {
        const datos = datosDe(a, ruc).filter((x) => x.valor || x.lista?.length);
        const ordenadas = [...fechas].sort();
        return (
          <li key={`${a.ocid ?? "x"}-${k}`} className="rounded-xl border border-line bg-paperSoft px-3 py-2.5">
            <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta">
              {/* recorte: los cinco datos que lo distinguen; el panel de su ficha tiene todos */}
              {datos.slice(0, 5).map((x, j) => (
                <Fragment key={`${x.etiqueta}-${j}`}>
                  <dt className="text-mute">{x.etiqueta}</dt>
                  <dd className="min-w-0 break-words font-medium text-ink">
                    {x.lista?.length ? (
                      x.lista.map((l, i) => (
                        <span key={i}>
                          {i > 0 ? ", " : ""}
                          {l.href ? (
                            <Link href={l.href} prefetch={false} className="text-granate underline-offset-2 hover:underline">
                              {l.texto}
                            </Link>
                          ) : (
                            l.texto
                          )}
                        </span>
                      ))
                    ) : x.href ? (
                      x.fuera ? (
                        <a href={x.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-granate underline-offset-2 hover:underline">
                          {x.valor} <ArrowUpRight size={12} aria-hidden />
                        </a>
                      ) : (
                        <Link href={x.href} prefetch={false} className="text-granate underline-offset-2 hover:underline">
                          {x.valor}
                        </Link>
                      )
                    ) : (
                      x.valor
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute">
              {aqui && <span className="rounded-full bg-granate-50 px-2 py-0.5 font-semibold text-granate">En este contrato</span>}
              {a.entidad && <span>{tituloNatural(a.entidad)}</span>}
              {ordenadas.length > 1 ? (
                <span className="tabular-nums">
                  {ordenadas.length} registros, del {fecha(ordenadas[0])} al {fecha(ordenadas[ordenadas.length - 1])}
                </span>
              ) : (
                a.fecha && <span className="tabular-nums">{fecha(a.fecha)}</span>
              )}
              {/* La fuente con su nombre (la API manda la clave: «persona_entidad», «precio_item»). */}
              {(a.fuenteUrl ?? PORTADA[a.fuente]) ? (
                <a href={(a.fuenteUrl ?? PORTADA[a.fuente])!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-granate underline-offset-2 hover:underline">
                  {FUENTE[a.fuente] ?? "Fuente oficial"} <ArrowUpRight size={11} aria-hidden />
                </a>
              ) : FUENTE[a.fuente] ? (
                <span>Fuente: {FUENTE[a.fuente]}</span>
              ) : null}
            </p>
          </li>
        );
      })}
      {href && (
        <li>
          <Link href={href} prefetch={false} className="inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline">
            {grupos.length > vista.length ? `Ver los ${casos.length} registros con su evidencia` : "Ver su evidencia completa"} <ChevronRight size={14} aria-hidden />
          </Link>
        </li>
      )}
    </ul>
  );
}
