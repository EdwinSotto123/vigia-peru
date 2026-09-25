"use client";

/**
 * Lo que ya se sabe de un contrato, en el panel lateral que abre su fila en
 * /app/contratos (el `detalle` de la `Tabla` del kit). Sólo con los datos de la
 * fila: abrirlo no pide nada al API. El dossier completo queda en el pie del panel.
 *
 * Una fila en revisión dice "En revisión" y nada más: ni puntaje ni señales
 * (DESIGN_SYSTEM.md §10.4).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { PersonName, Ruc } from "@/components/Redact";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { plural } from "@/lib/formato";
import { esPersonaNatural, etapaLabel, formatFecha, formatMonto, tipoLabel, type ContratoResumen } from "@/lib/contratos";
import { PuntoLectura, estadoLecturaDe } from "./estadoLectura";
import { PesoRiesgo } from "./PesoRiesgo";
import { cn } from "@/lib/utils";

export function DetalleContrato({ c }: { c: ContratoResumen }) {
  const lectura = estadoLecturaDe(c);
  const natural = esPersonaNatural(c.proveedorRuc);
  const leido = c.score != null;
  const nSenales = c.banderas ?? 0;

  return (
    <div className="space-y-5">
      <section>
        <Rotulo>Estado de lectura</Rotulo>
        <div className="mt-1.5 flex items-center gap-2 text-[13px] font-medium text-ink">
          <PuntoLectura estado={lectura.estado} />
          {lectura.label}
          <Ayuda titulo={`¿Qué quiere decir «${lectura.label}»?`}>{lectura.detalle}</Ayuda>
        </div>
      </section>

      <section>
        <Rotulo>Peso del riesgo y señales</Rotulo>
        {c.enRevision ? (
          // §10.4: una alerta en revisión dice "En revisión" y nada más — sin puntaje ni señales.
          <div className="mt-1.5 flex items-center gap-1.5">
            <PesoRiesgo score={null} enRevision formato="pastilla" />
            <Ayuda titulo="¿Por qué en revisión?">
              Los agentes ya lo leyeron. Antes de publicar el dictamen, una persona lo está revisando: hasta entonces no
              se muestran puntaje ni señales.
            </Ayuda>
          </div>
        ) : leido ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <PesoRiesgo score={c.score} banderas={c.banderas} formato="pastilla" />
            {nSenales > 0 && (
              <span className="text-[12px] tabular-nums text-inkSoft">
                puntaje {c.score} de 100, por {plural(nSenales, "señal publicada", "señales publicadas")}
              </span>
            )}
            {nSenales > 0 ? (
              <Ayuda titulo="¿Dónde está cada señal?">
                Cada señal lleva su norma citada y la página del documento donde se apoya: eso está en el dossier.
              </Ayuda>
            ) : (
              <Ayuda titulo="¿Sin señales quiere decir limpio?">
                No. El análisis terminó sin señales, pero eso no certifica que el contrato esté limpio: el dossier dice
                qué se revisó.
              </Ayuda>
            )}
          </div>
        ) : lectura.estado === "procesado" ? (
          // Leído y no publicado (lo descartó una persona): no es "nadie lo leyó".
          <p className="mt-1.5 text-[12.5px] text-mute">El análisis terminó, pero su resultado no se publicó.</p>
        ) : (
          // Estado vacío que enseña el mecanismo, no un guion. Ninguna cifra
          // inventada: de un contrato sin leer no se sabe nada todavía.
          <div className="mt-1.5 rounded-xl border border-dashed border-line bg-paperSoft px-3 py-2.5">
            <p className="flex items-center gap-1 text-[12.5px] text-mute">
              Todavía sin dictamen: nadie ha leído este expediente.
              {/* El número de agentes sale del catálogo (el DAG real del backend), no se escribe a mano. */}
              <Ayuda titulo="¿Cómo se lee un contrato?">
                Cuando su lectura se financia, {TOTAL_AGENTES} agentes leen el expediente, lo cruzan con registros
                públicos del Estado y publican las señales que encuentren con su norma citada. El resultado es público,
                lo señale a quien lo señale.
              </Ayuda>
            </p>
            <Link
              href={c.ubigeo ? `/app/financiar/${c.ubigeo}` : "/app/financiar"}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-granate underline-offset-2 hover:underline"
            >
              Financiar la lectura de {c.zona ?? "esta zona"} <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        )}
      </section>

      <section>
        <Rotulo>Lo que dice el expediente público</Rotulo>
        <dl className="mt-1.5 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px] sm:grid-cols-[128px_minmax(0,1fr)]">
          <Dato k="Objeto">{c.titulo ?? <Vacio>Sin objeto registrado en el OCDS</Vacio>}</Dato>
          <Dato k="Entidad">
            {c.entidadRuc ? (
              <Link href={`/entidad/${c.entidadRuc}`} className="text-granate underline-offset-2 hover:underline">
                {c.entidad ?? c.entidadRuc}
              </Link>
            ) : (
              c.entidad ?? <Vacio>No identificada</Vacio>
            )}
          </Dato>
          <Dato k="Zona">{c.zona ?? <Vacio>Sin ubigeo asignado</Vacio>}</Dato>
          <Dato k="Tipo">{tipoLabel(c.tipo) ?? <Vacio>Sin clasificar</Vacio>}</Dato>
          <Dato k="Etapa">{etapaLabel(c.etapa) ?? <Vacio>Sin clasificar</Vacio>}</Dato>
          {c.modalidad && <Dato k="Modalidad">{c.modalidad}</Dato>}
          <Dato k="Convocada">{c.fecha ? formatFecha(c.fecha) : <Vacio>Sin fecha publicada</Vacio>}</Dato>
          <Dato k="Valor referencial" mono>
            {c.montoPen != null && c.montoPen > 0 ? formatMonto(c.montoPen, c.moneda) : <Vacio>Sin valor referencial publicado</Vacio>}
          </Dato>
          <Dato k="Proveedor">
            {c.proveedor ? (
              <>
                {/* Orden SUNAT (apellidos primero): se tapa el apellido materno, no el nombre de pila. */}
                {natural ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor}
                {c.proveedorRuc && (
                  <span className="ml-2 font-mono text-[11px] text-mute">
                    RUC <Ruc value={c.proveedorRuc} />
                  </span>
                )}
              </>
            ) : (
              <Vacio>Sin adjudicar todavía</Vacio>
            )}
          </Dato>
          <Dato k="Código SEACE" mono>
            {c.codigo}
          </Dato>
          <Dato k="OCID" mono>
            <span className="break-all">{c.ocid}</span>
          </Dato>
        </dl>
      </section>
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[12px] font-semibold text-mute">{children}</h3>;
}

function Dato({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-mute">{k}</dt>
      <dd className={cn("min-w-0 text-ink", mono && "font-mono text-[12px] tabular-nums")}>{children}</dd>
    </>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <span className="font-sans text-mute">{children}</span>;
}
