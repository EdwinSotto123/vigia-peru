"use client";

/**
 * El panel de un participante (§14.4) y las piezas que comparte con su fila (ParticipantesContrato.tsx): qué hizo en el
 * proceso, con quién lo une, su ficha SUNAT y su historial en Vigía.
 *
 * Es una isla de cliente que recibe el participante como dato y arma el panel en el navegador, cuando se abre: armado en
 * el servidor, el panel de cada fila viajaba entero en la página aunque nadie lo abriera (un proceso con 126 participantes
 * pesaba 2.5 MB más; ~20 KB por participante, la mayoría íconos y clases repetidas). Así viaja su JSON (~1 KB).
 */

import Link from "next/link";
import { AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, FuenteDato, type DatoClave } from "@/components/patrones";
import { PersonName } from "@/components/Redact";
import { conDesde } from "@/lib/desde";
import { esRucEmpresa, rutaEmpresa } from "@/lib/empresas";
import { CONSULTA_RUC_SUNAT, fichaRnp } from "@/lib/fuentes";
import { Severidad } from "@/components/ui/Severidad";
import { CrucesCelda } from "./CrucesCelda";
import { CORTO_EMPRESA } from "@/lib/empresas";
import { fecha, listaY, numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { esRucPersonaNatural } from "@/lib/privacidad";
import {
  ETIQUETAS_PARTICIPANTE, EXPLICA_VINCULO, antiguedad, estadoParticipante, explicaBandera, nombreBandera, rucVisibleDe, tipoVinculo,
  vinculosComoBanderas, type Participante, type PersonaProceso,
} from "@/lib/procesoContrato";
import { cn } from "@/lib/utils";
import { P_ANTECEDENTES } from "@/lib/parametrosEmpresa";

/** El nombre en pantalla: el de una persona natural con su apellido tapado (ya viene así de la API). */
export function NombreParticipante({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  if (!nombre) return <>Sin razón social</>;
  return esRucPersonaNatural(ruc) ? <PersonName name={nombre} orden="sunat" /> : <>{nombre}</>;
}

/** El chip de la columna de estado (§14.1): ganó en granate, ofertó en tinta, sólo se registró en gris. */
export function ChipEstado({ estado }: { estado: ReturnType<typeof estadoParticipante> }) {
  return (
    <span
      className={cn(
        "pill max-w-full",
        estado === "Ganó"
          ? "border-granate/30 bg-granate-50 font-semibold text-granate"
          : estado.startsWith("Ofertó")
            ? "border-line bg-paperDeep text-ink"
            : "border-line bg-paperSoft text-mute",
      )}
    >
      <span className="truncate">{estado}</span>
    </span>
  );
}

const items = (xs: number[]) => (xs.length === 1 ? `el ítem ${xs[0]}` : `los ítems ${listaY(xs.map(String))}`);

/** La ficha de una empresa (RUC 20), con la vuelta a esta pestaña; null para una persona natural o un consorcio sin RUC. */
const fichaDe = (x: PersonaProceso, aqui?: string): string | null => {
  const ruc = rucVisibleDe(x);
  return ruc && esRucEmpresa(ruc) ? conDesde(rutaEmpresa(ruc), aqui) : null;
};

export function DetalleParticipante({
  p,
  conOfertas,
  hayGanador,
  aqui,
}: {
  p: Participante;
  conOfertas: boolean;
  hayGanador: boolean;
  /** La ruta de esta pestaña: la vuelta desde la ficha de un integrante. */
  aqui?: string;
}) {
  const estado = estadoParticipante(p, conOfertas);
  const s = p.sunat;
  const h = p.historial;
  const vinculos = vinculosComoBanderas(p);
  const enElProceso: DatoClave[] = [
    { etiqueta: "Se registró", valor: p.registrado ? "Sí, figura entre los participantes del registro OCDS" : "No figura entre los registrados del OCDS" },
    {
      etiqueta: "Presentó oferta",
      valor: p.oferta
        ? `Sí${p.oferta.desde ? `, el ${fecha(p.oferta.desde)}` : ""}${p.oferta.items.length ? `, por ${items(p.oferta.items)}` : ""}`
        : p.gano ? "CONOSCE no registra su oferta" : conOfertas ? "No" : "CONOSCE todavía no publica quién presentó oferta",
    },
    {
      etiqueta: "Buena pro",
      valor: p.gano
        ? `Ganó${p.itemsGanados.length ? ` ${items(p.itemsGanados)}` : ""}${p.montoAdjudicado != null ? ` por ${soles(p.montoAdjudicado)}` : ""}`
        : hayGanador ? "No la ganó" : "El proceso todavía no tiene ganador",
    },
  ];
  const sunat: DatoClave[] = s
    ? [
        { etiqueta: "Estado", valor: s.estado ? oracion(s.estado) : null },
        { etiqueta: "Condición", valor: s.condicion ? oracion(s.condicion) : null },
        {
          etiqueta: "Fundada",
          valor: s.fechaAlta
            ? `${fecha(s.fechaAlta)}${s.mesesAlConvocar == null ? "" : s.mesesAlConvocar < 0 ? ", después de la convocatoria" : `, ${antiguedad(s.mesesAlConvocar)} antes de la convocatoria`}`
            : null,
        },
        { etiqueta: "Actividad", valor: s.actividad ? oracion(s.actividad) : null },
        // La dirección sólo llega de una empresa (la API no manda la de una persona natural).
        ...(s.domicilio ? [{ etiqueta: "Domicilio fiscal", valor: tituloNatural(s.domicilio) }] : []),
        ...(s.distrito ? [{ etiqueta: "Distrito", valor: tituloNatural(s.distrito) }] : []),
        { etiqueta: "RNP vigente", valor: p.rnpVigente == null ? null : p.rnpVigente ? "Sí" : "No", ayuda: <AyudaTermino clave="rnp" /> },
      ]
    : [{ etiqueta: "Ficha RUC", valor: "Vigía no tiene su ficha de la SUNAT" }];
  const antecedentes = [...(h?.antecedentes ?? [])].sort((a, b) => "amb".indexOf(a.severidad[0]) - "amb".indexOf(b.severidad[0]));
  // Cada antecedente abre sus casos en la ficha de la empresa (pestaña Antecedentes, filtrada por ese tipo): ahí está la
  // evidencia de cada uno. Sólo una empresa (RUC 20): una persona natural no tiene ficha pública.
  const rucEmpresa = rucVisibleDe(p);
  const alAntecedente = (tipo: string) =>
    rucEmpresa && esRucEmpresa(rucEmpresa) ? conDesde(rutaEmpresa(rucEmpresa, "antecedentes", { [P_ANTECEDENTES.tipo]: tipo }), aqui) : null;
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <ChipEstado estado={estado} />
        {vinculos.length > 0 && (
          <CrucesCelda cruces={vinculos} etiquetas={ETIQUETAS_PARTICIPANTE} explicaciones={EXPLICA_VINCULO} etiquetaLista="Lo que lo une con otros participantes" />
        )}
      </ChipsDetalle>
      <DatosClave items={enElProceso} />
      {p.vinculos.length > 0 && (
        <BloqueDetalle titulo="Con otros participantes">
          <ul className="space-y-3">
            {p.vinculos.map((v) => (
              <li key={`${v.tipo}-${v.con.map((x) => x.ruc).join("-")}`} className="flex gap-2">
                <Severidad bandera={v.severidad} formato="punto" className="mt-0.5 shrink-0" />
                {/* div y no span: la fuente (FuenteDato) es un bloque. */}
                <div className="min-w-0">
                  <span className="block text-dato font-semibold leading-snug text-ink">{nombreBandera(tipoVinculo(v, p.gano))}</span>
                  <span className="mt-0.5 block text-meta leading-snug text-inkSoft">
                    Con{" "}
                    {v.con.map((x, i) => {
                      // La otra empresa lleva a su ficha (ver con quién más comparte socios o domicilio); una persona
                      // natural va tapada y sin enlace.
                      const href = fichaDe(x, aqui);
                      return (
                        <span key={x.ruc}>
                          {i > 0 && (i === v.con.length - 1 ? " y " : ", ")}
                          {href ? (
                            <Link href={href} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                              <NombreParticipante ruc={x.ruc} nombre={x.nombre} />
                            </Link>
                          ) : (
                            <NombreParticipante ruc={x.ruc} nombre={x.nombre} />
                          )}
                        </span>
                      );
                    })}
                    {v.tipo === "domicilio_compartido" && v.domicilio ? `: ${tituloNatural(v.domicilio)}` : ""}.
                  </span>
                  {/* La fuente, con dónde comprobarlo: la consulta RUC de la SUNAT (no tiene enlace por registro) o la ficha
                      de cada empresa en el RNP, con sus socios y representantes. `fichaRnp` sólo arma la de un RUC 20. */}
                  {v.tipo === "domicilio_compartido" ? (
                    <FuenteDato fuente="SUNAT (ficha RUC)" href={CONSULTA_RUC_SUNAT} className="mt-0.5" />
                  ) : (
                    <FuenteDato
                      fuente="RNP (socios y representantes)"
                      href={fichaRnp(rucVisibleDe(p))}
                      enlaces={v.con.map((x) => {
                        const ruc = rucVisibleDe(x);
                        return ruc && esRucEmpresa(ruc) ? { texto: `${x.nombre ?? `RUC ${ruc}`} en el RNP`, href: fichaRnp(ruc) } : null;
                      })}
                      className="mt-0.5"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
      <BloqueDetalle titulo="En la SUNAT">
        <DatosClave items={sunat} />
      </BloqueDetalle>
      <BloqueDetalle titulo="Su historial en Vigía">
        {h ? (
          <div className="space-y-4">
            <DatosClave
              items={[
                { etiqueta: "Postulaciones", valor: h.postulaciones ? `${numero(h.postulaciones)}, ganó ${numero(h.ganadas)}` : "Ninguna desde 2018" },
                { etiqueta: "Adjudicado en total", valor: h.adjudicado != null ? soles(h.adjudicado) : null, mono: true },
              ]}
            />
            {antecedentes.length > 0 ? (
              <ul className="space-y-3" aria-label="Antecedentes en otros registros">
                {antecedentes.map((a) => {
                  const titulo = CORTO_EMPRESA[a.tipo] ?? nombreBandera(a.tipo);
                  const href = alAntecedente(a.tipo);
                  return (
                    <li key={a.tipo} className="flex gap-2">
                      <Severidad bandera={a.severidad} formato="punto" className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-dato font-semibold leading-snug text-ink">
                          {href ? (
                            <Link href={href} prefetch={false} className="text-granate underline-offset-2 hover:underline">
                              {titulo}
                            </Link>
                          ) : (
                            titulo
                          )}
                          {a.n > 1 && <span className="ml-1.5 font-normal tabular-nums text-mute">{plural(a.n, "registro", "registros")}</span>}
                        </span>
                        {explicaBandera(a.tipo) && <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{explicaBandera(a.tipo)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-dato text-inkSoft">Ningún otro registro público la nombra.</p>
            )}
          </div>
        ) : (
          <p className="text-dato text-inkSoft">
            {esRucPersonaNatural(p.ruc) ? "Vigía no arma el historial de una persona natural." : "Vigía no tiene un historial de este participante."}
          </p>
        )}
      </BloqueDetalle>
      {p.integrantes.length > 0 && (
        <BloqueDetalle titulo="Integrantes del consorcio">
          <ul className="space-y-1.5">
            {p.integrantes.map((x) => {
              // Una empresa (RUC 20) abre su ficha; una persona natural va tapada y sin enlace (no tiene ficha pública).
              const ruc = rucVisibleDe(x);
              const href = ruc && /^20\d{9}$/.test(ruc) ? conDesde(rutaEmpresa(ruc), aqui) : null;
              return (
                <li key={x.ruc} className="text-dato text-ink">
                  {href ? (
                    <Link href={href} className="font-semibold text-granate underline-offset-2 hover:underline">
                      <NombreParticipante ruc={x.ruc} nombre={x.nombre} />
                    </Link>
                  ) : (
                    <NombreParticipante ruc={x.ruc} nombre={x.nombre} />
                  )}
                  {ruc ? (
                    <span className="ml-2 font-mono text-meta tabular-nums text-mute">{ruc}</span>
                  ) : (
                    esRucPersonaNatural(x.ruc) && <span className="ml-2 text-meta text-mute">Persona natural</span>
                  )}
                </li>
              );
            })}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}
