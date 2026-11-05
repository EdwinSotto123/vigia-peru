"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { EnUnaFrase } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { oracion, plural } from "@/lib/formato";
import { PersonName, Ruc, redactDnis } from "../../../Redact";
import { fechaDossier, montoDossier } from "../../dossier";
import { antiguedadTexto, condicionLegible, estadoLegible, type HechosProveedor, type Vinculo } from "./proveedor";

/**
 * El veredicto del proveedor, arriba de la pestaña: quién es (su RUC en la SUNAT y cuánto llevaba al contratar), cuánto
 * le ganó al Estado y a ESTA entidad, si carga sanciones o penalidades, y lo más fuerte que encontró su red. Todo sale
 * de los registros (`HechosProveedor`); la red, de lo que dejó el agente. El tono es el de lo más grave.
 */
export function FraseProveedor({
  h,
  vinculo,
  redCorrio,
  ciiuNoCoincide,
  desdeRegistros,
}: {
  h: HechosProveedor;
  vinculo: Vinculo | null;
  /** La red de personas corrió: sin vínculo, se dice que no encontró ninguno (si no corrió, se calla). */
  redCorrio: boolean;
  /** La regla del giro (CIIU) frente al objeto saltó en este análisis. */
  ciiuNoCoincide: boolean;
  /** Los datos salen del expediente de la base (si no, del perfil que copió el agente web). */
  desdeRegistros: boolean;
}) {
  const s = h.sunat;
  const edad = antiguedadTexto(s?.edadDias);
  const joven = s?.edadDias != null && s.edadDias < 365;

  // Quién: el nombre de una persona natural va con un apellido tapado, como en toda la ficha.
  const nombre = h.natural ? <PersonName name={h.nombre} orden="sunat" /> : h.nombre;
  const sujeto = h.consorcio ? (
    <>
      El <strong className="font-bold">{h.nombre}</strong>
      {h.integrantes.length > 0 && <>, de {h.integrantes.length} {h.integrantes.length === 1 ? "integrante" : "integrantes"},</>}
    </>
  ) : (
    <>
      <strong className="font-bold">{nombre}</strong>
      {h.natural && <>, persona natural con negocio,</>}
    </>
  );

  // 1. Su RUC y lo que ganó.
  const ruc: ReactNode[] = [];
  // «activo y habido», «dado de baja de oficio y no habido» o sólo lo que se publicó.
  const estadoRuc = s ? [estadoLegible(s.estado), condicionLegible(s.condicion)].filter(Boolean).join(" y ") : "";
  if (s && (estadoRuc || edad)) {
    ruc.push(
      <Fragment key="ruc">
        {estadoRuc ? `tiene el RUC ${estadoRuc}` : "tiene el RUC"}
        {edad && `${estadoRuc ? "," : ""} con ${joven ? "solo " : ""}${edad} de antigüedad al contratar`}
      </Fragment>,
    );
  } else if (!h.consorcio && !h.natural && desdeRegistros) {
    ruc.push(<Fragment key="ruc">no figura en el padrón de la SUNAT que tiene Vigía</Fragment>);
  }
  const hist = h.historial;
  if (hist) {
    if (hist.procesos > 0) {
      const conEsta = hist.conEsta;
      ruc.push(
        <Fragment key="hist">
          ganó {plural(hist.procesos, "proceso", "procesos")} del Estado por {montoDossier(hist.monto)}
          {conEsta && (conEsta.procesos > 0 ? `, ${conEsta.procesos} con esta entidad (${montoDossier(conEsta.monto)})` : ", ninguno antes con esta entidad")}
        </Fragment>,
      );
    } else {
      ruc.push(<Fragment key="hist">no registra buenas pro en el CONOSCE</Fragment>);
    }
  } else if (h.consorcio) {
    ruc.push(<Fragment key="hist">ganó este contrato</Fragment>);
  }

  // 2. Lo que pesa sobre él: inhabilitación, sanciones, penalidades, el giro.
  const pesos: ReactNode[] = [];
  if (s?.inhabilitada) {
    pesos.push(
      <Fragment key="inh">
        Está inhabilitado para contratar con el Estado{s.inhabilitadaHasta ? ` hasta el ${fechaDossier(s.inhabilitadaHasta, true)}` : ""}.
      </Fragment>,
    );
  }
  const sanc = h.sanciones;
  const pen = h.penalidades;
  const textoPen = pen ? `${plural(pen.n, "penalidad", "penalidades")} en contratos anteriores${pen.monto ? ` (${montoDossier(pen.monto)})` : ""}` : null;
  if (sanc) {
    // Un consorcio no tiene sanciones propias: son las de sus integrantes, y así se dice.
    const base = h.consorcio
      ? sanc.vigentes > 0
        ? `Sus integrantes tienen ${plural(sanc.vigentes, "sanción vigente", "sanciones vigentes")} del OECE`
        : sanc.total > 0
          ? `Sus integrantes tuvieron ${plural(sanc.total, "sanción", "sanciones")} del OECE, ${sanc.total === 1 ? "ya no vigente" : "ya no vigentes"}`
          : "Ninguno de sus integrantes tiene sanciones del OECE"
      : sanc.vigentes > 0
        ? `Tiene ${plural(sanc.vigentes, "sanción vigente", "sanciones vigentes")} del OECE`
        : sanc.total > 0
          ? `Tuvo ${plural(sanc.total, "sanción", "sanciones")} del OECE, ${sanc.total === 1 ? "ya no vigente" : "ya no vigentes"}`
          : "No tiene sanciones del OECE";
    pesos.push(<Fragment key="sanc">{base}{textoPen ? `${sanc.total > 0 ? " y" : h.consorcio ? "; suman" : ", pero sí"} ${textoPen}` : ""}.</Fragment>);
  } else if (textoPen) {
    pesos.push(<Fragment key="pen">{h.consorcio ? "Sus integrantes suman" : "Tiene"} {textoPen}.</Fragment>);
  }
  if (ciiuNoCoincide) pesos.push(<Fragment key="ciiu">Su giro en la SUNAT no corresponde a lo que vendió.</Fragment>);

  // 3. Su red.
  const red = vinculo ? (
    <>Lo más fuerte de su red: {redactDnis(vinculo.texto)}.</>
  ) : redCorrio ? (
    <>La red de personas no encontró vínculos con la entidad.</>
  ) : null;

  const tono =
    (sanc?.vigentes ?? 0) > 0 || !!s?.inhabilitada || (s != null && !s.enRegla) || vinculo?.severidad === "alta"
      ? "alta"
      : vinculo?.severidad === "media" || (pen?.n ?? 0) >= 3 || joven || ciiuNoCoincide || h.banderasVigia.conAlta
        ? "media"
        : "neutro";

  const rucVisible = h.ruc && !h.consorcio ? h.ruc : null;
  const datos = [
    rucVisible && (
      <Dato key="ruc" tipo="ruc" mono>
        {/^20\d{9}$/.test(rucVisible) ? (
          <Link href={`/empresa/${rucVisible}`} prefetch={false} className="text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
            RUC {rucVisible}
          </Link>
        ) : (
          <>RUC <Ruc value={rucVisible} /></>
        )}
      </Dato>
    ),
    h.consorcio && h.integrantes.length > 0 && (
      <Dato key="int" tipo="personas" nombre="Integrantes">
        {plural(h.integrantes.length, "integrante", "integrantes")}
      </Dato>
    ),
    s?.actividad && (
      <Dato key="giro" tipo="servicio" nombre="Giro en la SUNAT">
        {oracion(s.actividad)}
      </Dato>
    ),
    s?.departamento && (
      <Dato key="lugar" tipo="lugar">
        {oracion(String(s.departamento))}
      </Dato>
    ),
  ].filter(Boolean);

  return (
    <EnUnaFrase
      tono={tono}
      datos={datos.length ? datos : undefined}
      pie={desdeRegistros ? "Según el padrón de la SUNAT, el RNP, el OECE y el CONOSCE, en la base de Vigía." : "Según el perfil que leyó el agente en este análisis."}
    >
      {sujeto} {ruc.length ? ruc.reduce<ReactNode[]>((acc, x, i) => (i === 0 ? [x] : [...acc, " y ", x]), []) : "ganó este contrato"}.
      {pesos.map((p, i) => (
        <Fragment key={i}> {p}</Fragment>
      ))}
      {red && <> {red}</>}
    </EnUnaFrase>
  );
}
