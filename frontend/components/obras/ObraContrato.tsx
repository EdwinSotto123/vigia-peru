import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Ayuda, AyudaTermino, ChipsDetalle, DatosClave, FuenteDato, type DatoClave } from "@/components/patrones";
import { ChipsCruces } from "@/components/contratos/CrucesCelda";
import { EstadoCompra } from "@/components/ordenes/ListaOrdenes";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha as fechaLarga } from "@/lib/formato";
import { ESTADO_TEXTO, FUENTE_INVERSION, FUENTE_OBRA, type InversionDelContrato, type ObraDelContrato } from "@/lib/obras";
import { BloqueBanderasObra, cifrasObra, datosObra } from "./ListaObras";
import { cifrasInversion, datosInversion, notaInversion, obrasDeLaInversion } from "./ListaInversiones";

/**
 * En la ficha de un contrato (pestaña «Adjudicación y contrato», junto al presupuesto del proyecto): la obra de INFOBRAS
 * que ejecuta o supervisa este contrato y la inversión de su CUI en Invierte.pe, con lo que dice cada fuente (estado,
 * avance físico frente a lo pagado, paralización, adicionales, ampliaciones; monto viable frente al costo de hoy) y sus
 * banderas en palabras. Las banderas también van en la pestaña «Antecedentes», grupo «En la obra». Server-safe.
 */

const VIA: Record<string, string> = {
  cui_ruc: "el CUI del proceso y el RUC de quien INFOBRAS registra como ejecutor o supervisor, que ganó la buena pro",
  cui_consorcio: "el CUI del proceso y el nombre del consorcio que ganó la buena pro (INFOBRAS no registra su RUC)",
  ruc_monto: "el RUC de quien ganó, la entidad y el mismo monto del contrato (el proceso no trae el CUI)",
};
const ORIGEN_CUI: Record<string, string> = {
  ocds: "según el registro OCDS del proceso",
  texto: "leído de la descripción del proceso",
  snip: "por el código SNIP que cita el proceso",
};

export function ObraDelContratoBloque({ obra: o }: { obra: ObraDelContrato }) {
  const supervisa = o.rol === "supervision";
  const titulo = supervisa ? "La obra que supervisa este contrato" : "La obra que ejecuta este contrato";
  const dudoso = o.dudoso.map(motivoDudoso).find((m) => !!m) ?? null;
  const datos: DatoClave[] = [
    { etiqueta: "Código INFOBRAS", valor: String(o.codigo), mono: true, ayuda: <AyudaTermino clave="infobras" /> },
    ...datosObra(o, false),
  ];
  return (
    <section aria-label={titulo} className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex items-center gap-1">
        <h3 className="font-display text-bloque font-bold text-ink">{titulo}</h3>
        <Ayuda titulo="¿Cómo se reconoce la obra?">
          <span className="block">
            Es la obra que la entidad registra en INFOBRAS (Contraloría). Se reconoce por {VIA[o.via] ?? "el CUI del proceso"}.
          </span>
          <span className="mt-2 block">La registra y la actualiza la propia entidad: una obra que no se actualiza queda como la dejó.</span>
        </Ayuda>
      </div>
      <ChipsDetalle>
        <EstadoCompra estado={o.estado ? ESTADO_TEXTO[o.estado] ?? o.estado : null} />
        {o.banderas.length > 0 && <ChipsCruces cruces={o.banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))} etiquetaLista="Banderas de la obra" />}
      </ChipsDetalle>
      {dudoso && <AvisoDato motivo={dudoso} fuente="infobras" suma={false} />}
      <CifrasEnFila items={cifrasObra(o)} chico />
      <DatosClave items={datos} />
      <BloqueBanderasObra banderas={o.banderas} sujeto={supervisa ? "La obra que supervisa este contrato" : "La obra"} enlace={o.url} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FuenteDato fuente={`${FUENTE_OBRA}, obra ${o.codigo}${o.alDia ? `, archivo del ${fechaLarga(o.alDia)}` : ""}`} href={o.url} />
        <a href={o.url} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
          La obra en INFOBRAS <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </div>
    </section>
  );
}

export function InversionDelContratoBloque({ inversion: v }: { inversion: InversionDelContrato }) {
  const dudoso = v.dudoso.map(motivoDudoso).find((m) => !!m) ?? null;
  const datos: DatoClave[] = datosInversion(v).map((d) =>
    d.etiqueta === "CUI" ? { ...d, valor: `${v.cui}, ${ORIGEN_CUI[v.origenCui] ?? "del proceso"}` } : d,
  );
  return (
    <section aria-label="La inversión de este contrato" className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex items-center gap-1">
        <h3 className="font-display text-bloque font-bold text-ink">La inversión de este contrato</h3>
        <Ayuda titulo="¿Qué inversión es?">
          El proyecto de inversión pública del CUI de este proceso en Invierte.pe (MEF): el monto con que se declaró viable, lo
          que cuesta hoy y lo gastado. Es el proyecto entero, que puede tener otros contratos (la obra, la supervisión, el
          expediente técnico, los equipos).
        </Ayuda>
      </div>
      <ChipsDetalle>
        <EstadoCompra estado={v.estado === "cerrada" ? "Cerrada" : "Activa"} explica={v.situacion ?? undefined} />
        {v.banderas.length > 0 && <ChipsCruces cruces={v.banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))} etiquetaLista="Banderas de la inversión" />}
      </ChipsDetalle>
      {dudoso && <AvisoDato motivo={dudoso} fuente="invierte_pe" suma={false} />}
      <CifrasEnFila items={cifrasInversion(v)} chico />
      <DatosClave items={datos} />
      <BloqueBanderasObra banderas={v.banderas} sujeto="La inversión" nota={notaInversion(v.cui)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FuenteDato fuente={`${FUENTE_INVERSION}, CUI ${v.cui}${v.alDia ? `, archivo del ${fechaLarga(v.alDia)}` : ""}`} href={v.url} />
        <div className="flex flex-wrap gap-2">
          {v.obras > 0 && v.entidad.ruc && v.entidad.ficha && (
            <Link href={obrasDeLaInversion(v)} prefetch={false} className={claseAccion("secundario")}>
              {v.obras === 1 ? "Su obra en INFOBRAS" : `Sus ${v.obras} obras en INFOBRAS`}
            </Link>
          )}
          <a href={v.url} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
            Seguimiento en el MEF <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/** Las obras y las inversiones del contrato, en su orden: primero la obra (lo que se construye), después el proyecto. */
export function ObrasDelContrato({ obras = [], inversiones = [] }: { obras?: ObraDelContrato[]; inversiones?: InversionDelContrato[] }) {
  if (!obras.length && !inversiones.length) return null;
  return (
    <>
      {obras.map((o) => <ObraDelContratoBloque key={`${o.codigo}-${o.rol}`} obra={o} />)}
      {inversiones.map((v) => <InversionDelContratoBloque key={v.cui} inversion={v} />)}
    </>
  );
}
