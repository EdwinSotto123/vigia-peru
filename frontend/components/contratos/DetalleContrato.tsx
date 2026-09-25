"use client";

/**
 * Lo que ya se sabe de un contrato, en el panel lateral que abre su fila en
 * /app/contratos (el `detalle` de la `Tabla` del kit). Sólo con los datos de la
 * fila: abrirlo no pide nada al API. El dossier completo queda en el pie del panel.
 *
 * Formato de panel (DESIGN_SYSTEM.md §14.4): chips de estado → lo que dice el
 * expediente, en filas → qué falta, si todavía no se leyó.
 *
 * Una fila en revisión dice "En revisión" y nada más: ni puntaje ni señales
 * (DESIGN_SYSTEM.md §10.4).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { PersonName, Ruc } from "@/components/Redact";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { plural } from "@/lib/formato";
import { esPersonaNatural, etapaLabel, formatFecha, formatMonto, tipoLabel, type ContratoResumen } from "@/lib/contratos";
import { PuntoLectura, estadoLecturaDe } from "./estadoLectura";
import { PesoRiesgo } from "./PesoRiesgo";

export function DetalleContrato({ c }: { c: ContratoResumen }) {
  const lectura = estadoLecturaDe(c);
  const natural = esPersonaNatural(c.proveedorRuc);
  const leido = c.score != null;
  const nSenales = c.banderas ?? 0;
  // Un "sin leer" que enseña el mecanismo, no un guion: de un contrato sin leer no se sabe nada todavía.
  const sinDictamen = !c.enRevision && !leido && lectura.estado !== "procesado";

  const datos: DatoClave[] = [
    { etiqueta: "Objeto", valor: c.titulo ?? <Vacio>Sin objeto registrado en el OCDS</Vacio> },
    {
      etiqueta: "Entidad",
      valor: c.entidadRuc ? (
        <Link href={`/entidad/${c.entidadRuc}`} className="text-granate underline-offset-2 hover:underline">
          {c.entidad ?? c.entidadRuc}
        </Link>
      ) : (
        c.entidad ?? <Vacio>No identificada</Vacio>
      ),
    },
    { etiqueta: "Zona", valor: c.zona ?? <Vacio>Sin ubigeo asignado</Vacio> },
    { etiqueta: "Tipo", valor: tipoLabel(c.tipo) ?? <Vacio>Sin clasificar</Vacio> },
    { etiqueta: "Etapa", valor: etapaLabel(c.etapa) ?? <Vacio>Sin clasificar</Vacio> },
    ...(c.modalidad ? [{ etiqueta: "Modalidad", valor: c.modalidad }] : []),
    { etiqueta: "Convocada", valor: c.fecha ? formatFecha(c.fecha) : <Vacio>Sin fecha publicada</Vacio> },
    {
      etiqueta: "Valor referencial",
      mono: true,
      valor: c.montoPen != null && c.montoPen > 0 ? formatMonto(c.montoPen, c.moneda) : <Vacio>Sin valor referencial publicado</Vacio>,
    },
    {
      etiqueta: "Proveedor",
      // Orden SUNAT (apellidos primero): se tapa el apellido materno, no el nombre de pila.
      valor: c.proveedor ? (natural ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor) : <Vacio>Sin adjudicar todavía</Vacio>,
    },
    ...(c.proveedor && c.proveedorRuc ? [{ etiqueta: "RUC del proveedor", valor: <Ruc value={c.proveedorRuc} />, mono: true }] : []),
    { etiqueta: "Código SEACE", valor: c.codigo, mono: true },
    { etiqueta: "OCID", valor: <span className="break-all">{c.ocid}</span>, mono: true },
  ];

  // El puntaje sólo junto a las señales que lo explican (§10.4), y nunca en revisión.
  if (!c.enRevision && leido && nSenales > 0) {
    datos.unshift({
      etiqueta: "Puntaje",
      valor: `${c.score} de 100, por ${plural(nSenales, "señal publicada", "señales publicadas")}`,
      ayuda: (
        <Ayuda titulo="¿Dónde está cada señal?">
          Cada señal lleva su norma citada y la página del documento donde se apoya: eso está en el dossier.
        </Ayuda>
      ),
    });
  }

  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <span className="pill border-line bg-paperSoft text-inkSoft">
          <PuntoLectura estado={lectura.estado} />
          {lectura.label}
        </span>
        <Ayuda titulo={`¿Qué quiere decir «${lectura.label}»?`}>{lectura.detalle}</Ayuda>
        {c.enRevision ? (
          <>
            <PesoRiesgo score={null} enRevision formato="pastilla" />
            <Ayuda titulo="¿Por qué en revisión?">
              Los agentes ya lo leyeron. Antes de publicar el dictamen, una persona lo está revisando: hasta entonces no se
              muestran puntaje ni señales.
            </Ayuda>
          </>
        ) : leido ? (
          <>
            <PesoRiesgo score={c.score} banderas={c.banderas} formato="pastilla" />
            {nSenales === 0 && (
              <Ayuda titulo="¿Sin señales quiere decir limpio?">
                No. El análisis terminó sin señales, pero eso no certifica que el contrato esté limpio: el dossier dice qué
                se revisó.
              </Ayuda>
            )}
          </>
        ) : null}
      </ChipsDetalle>

      <DatosClave items={datos} />

      {lectura.estado === "procesado" && !leido && !c.enRevision && (
        // Leído y no publicado (lo descartó una persona): no es "nadie lo leyó".
        <BloqueDetalle titulo="Resultado sin publicar">
          <p className="text-mute">El análisis terminó, pero su resultado no se publicó.</p>
        </BloqueDetalle>
      )}

      {sinDictamen && (
        <BloqueDetalle
          titulo="Todavía sin dictamen"
          ayuda={
            // El número de agentes sale del catálogo (el DAG real del backend), no se escribe a mano.
            <Ayuda titulo="¿Cómo se lee un contrato?">
              Cuando su lectura se financia, {TOTAL_AGENTES} agentes leen el expediente, lo cruzan con registros públicos
              del Estado y publican las señales que encuentren con su norma citada. El resultado es público, lo señale a
              quien lo señale.
            </Ayuda>
          }
        >
          <p className="text-mute">Nadie ha leído este expediente todavía.</p>
          <Link
            href={c.ubigeo ? `/app/financiar/${c.ubigeo}` : "/app/financiar"}
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-granate underline-offset-2 hover:underline"
          >
            Financiar la lectura de {c.zona ?? "esta zona"} <ArrowRight size={13} aria-hidden />
          </Link>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <span className="font-sans text-mute">{children}</span>;
}
