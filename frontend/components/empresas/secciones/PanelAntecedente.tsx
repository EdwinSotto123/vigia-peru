import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BloqueDetalle, DatosClave } from "@/components/patrones/Detalle";
import { TIPO_CRUCE } from "@/lib/cruces";
import type { AntecedenteEmpresa } from "@/lib/empresas";
import { fechaCorta, numero } from "@/lib/formato";
import { txtONumero } from "@/lib/utils";
import { datosDe, type DatoCaso } from "./casoAntecedente";
import { EvidenciaDelAntecedente } from "./EvidenciaAntecedente";

/**
 * Las piezas del panel de un antecedente, comunes a la pestaña Antecedentes de la empresa y a la Historia del contrato
 * (DetalleHecho): cada dato con su referencia, las visitas de un patrón, los registros de la fuente (a pedido) y por qué
 * se marca. El usuario (2026-10-29), de la Historia del proceso: «se ve muy poca info». Server-safe.
 */

const txt = txtONumero;

export const ENLACE = "font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink";

/** El valor de un dato en el panel, con su referencia: la ficha en Vigía o, con `fuera`, el registro oficial. */
export function ValorCaso({ x }: { x: DatoCaso }) {
  if (x.lista?.length) {
    return (
      <>
        {x.lista.map((o, i) => (
          <span key={`${o.texto}-${i}`}>
            {i > 0 && ", "}
            {o.href ? <Link href={o.href} className={ENLACE}>{o.texto}</Link> : o.texto}
          </span>
        ))}
      </>
    );
  }
  if (!x.href) return <>{x.valor}</>;
  if (x.fuera) {
    return (
      <a href={x.href} target="_blank" rel="noopener noreferrer" className={ENLACE}>
        {x.valor} <ArrowUpRight size={12} aria-hidden className="inline align-baseline" />
      </a>
    );
  }
  return <Link href={x.href} className={ENLACE}>{x.valor}</Link>;
}

/** Los tipos con registros que la API puede traer (lib/evidencia.ts) o, el fraccionamiento, sus días con órdenes. */
export const CON_EVIDENCIA = /^(proveedor_campana|aporte|aporte_empresa|candidato|autoridad|vendio_gobernante|partido_gobernante|penalidad|sancion.*|recurrente.*|sobreprecio.*|domicilio_compartido|socio_comun|socio_en_entidad|proveedor_cautivo|recien_fundada.*|obra_.*|inversion_.*|fraccionamiento)$/;

const DIA_SEMANA = new Intl.DateTimeFormat("es-PE", { weekday: "long", timeZone: "UTC" });
const POR_VISITA: Record<string, string> = { fin_de_semana: "en fin de semana", temprano: "antes de las 7", noche: "desde las 19" };

/** «Sábado 4 ago. 2024, a las 20:15 (3 h 10 min), en fin de semana»: una visita de un patrón. */
export function unaVisita(v: Record<string, unknown>): string {
  const f = txt(v.fecha);
  const dia = f ? `${DIA_SEMANA.format(new Date(`${f.slice(0, 10)}T12:00:00Z`))} ${fechaCorta(f)}` : "Un día sin fecha";
  const h = txt(v.hora) ? `, a las ${txt(v.hora)!.slice(0, 5)}` : "";
  const m = typeof v.minutos === "number" && v.minutos > 0 ? ` (${v.minutos >= 60 ? `${Math.floor(v.minutos / 60)} h${v.minutos % 60 ? ` ${v.minutos % 60} min` : ""}` : `${v.minutos} min`})` : "";
  const por = typeof v.por === "string" && POR_VISITA[v.por] ? `, ${POR_VISITA[v.por]}` : "";
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}${h}${m}${por}`;
}

/** Las visitas de un patrón (repetidas, fuera de horario, antes de la convocatoria), una por renglón. */
export function VisitasDelCaso({ visitas }: { visitas: Record<string, unknown>[] }) {
  return (
    <BloqueDetalle titulo={visitas.length === 1 ? "La visita" : `Las ${numero(visitas.length)} visitas`}>
      <ol className="space-y-1 text-dato text-inkSoft">
        {visitas.map((v, i) => (
          <li key={i} className="tabular-nums">{unaVisita(v)}</li>
        ))}
      </ol>
    </BloqueDetalle>
  );
}

/**
 * El detalle de un antecedente fuera de su pestaña (la Historia del contrato): sus datos por tipo con referencias, sus
 * visitas, los registros de la fuente y por qué se marca. La evidencia sólo de una empresa (RUC 20): la API la busca por
 * su ficha.
 */
export function DetalleDelAntecedente({ a, sinQuien = false }: { a: AntecedenteEmpresa; sinQuien?: boolean }) {
  const ruc = a.rucProveedor ?? "";
  // `sinQuien`: el panel ya dice quién en su recuadro (DetalleHecho); la persona y su papel no van dos veces.
  const datos = datosDe(a, ruc).filter((x) => !sinQuien || !["Quién", "Quién fue", "Quién lo declaró", "Su papel en la empresa"].includes(x.etiqueta));
  const patron = a.tipo !== "visita_previa" && a.tipo.startsWith("visita_") && a.visitas.length > 0;
  const explica = TIPO_CRUCE[a.tipo]?.explica;
  return (
    <>
      {datos.length > 0 && <DatosClave items={datos.map((x) => ({ etiqueta: x.etiqueta, valor: <ValorCaso x={x} />, mono: x.mono }))} />}
      {patron && <VisitasDelCaso visitas={a.visitas} />}
      {a.referencias?.clave && /^20\d{9}$/.test(ruc) && CON_EVIDENCIA.test(a.tipo) && (
        <BloqueDetalle titulo={a.tipo === "fraccionamiento" ? "Cada día, con sus órdenes" : "Los registros de la fuente"}>
          <EvidenciaDelAntecedente ruc={ruc} tipo={a.tipo} clave={a.referencias.clave} />
        </BloqueDetalle>
      )}
      {explica && (
        <BloqueDetalle titulo="Por qué se marca">
          <p className="text-dato text-inkSoft">{explica}</p>
        </BloqueDetalle>
      )}
    </>
  );
}
