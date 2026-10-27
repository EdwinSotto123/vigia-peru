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

import { PartidoQueGobierna } from "./PartidoQueGobierna";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { AyudaTermino } from "@/components/patrones/AyudaTermino";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { PersonName, Ruc } from "@/components/Redact";
import { enlaceProveedor } from "@/lib/empresas";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { esCodigoConsorcio, esPersonaNatural, etapaLabel, formatFecha, formatMonto, tipoLabel, type ContratoResumen, type GanadorContrato } from "@/lib/contratos";
import { ChipsCruces } from "./CrucesCelda";
import { limpiarObjeto } from "./recortar";
import { PuntoLectura, estadoLecturaDe } from "./estadoLectura";
import { PesoRiesgo } from "./PesoRiesgo";

/** El nombre de quien ganó (o de un integrante): una persona natural con su apellido tapado (ya viene así de la API). */
function NombreGanador({ ruc, nombre }: { ruc: string | null; nombre: string | null }) {
  if (!nombre) return <>Sin razón social</>;
  return esPersonaNatural(ruc) ? <PersonName name={nombre} orden="sunat" /> : <>{nombre}</>;
}

/**
 * Los integrantes del consorcio que ganó: cada empresa con su RUC y el enlace a su ficha; una persona natural, tapada y
 * sin enlace (no tiene ficha pública).
 */
function Integrantes({ lista }: { lista: GanadorContrato[] }) {
  return (
    <ul className="space-y-1.5">
      {lista.map((g) => {
        const href = enlaceProveedor(g.ruc);
        return (
          <li key={g.ruc} className="min-w-0">
            {href ? (
              <Link href={href} className="font-semibold text-granate underline-offset-2 hover:underline">
                <NombreGanador ruc={g.ruc} nombre={g.nombre} />
              </Link>
            ) : (
              <span className="font-semibold text-ink"><NombreGanador ruc={g.ruc} nombre={g.nombre} /></span>
            )}
            <span className="block font-mono text-meta tabular-nums text-mute">
              {esPersonaNatural(g.ruc) ? "Persona natural" : <>RUC <Ruc value={g.ruc} /></>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DetalleContrato({ c }: { c: ContratoResumen }) {
  const lectura = estadoLecturaDe(c);
  const natural = esPersonaNatural(c.proveedorRuc);
  const leido = c.score != null;
  const nSenales = c.banderas ?? 0;
  // Un "sin leer" que enseña el mecanismo, no un guion: de un contrato sin leer no se sabe nada todavía.
  const sinDictamen = !c.enRevision && !leido && lectura.estado !== "procesado";
  // Un consorcio sin RUC propio llega con el código que le da el SEACE (1830304): no es un RUC (antes decía «RUC del
  // proveedor 1830304», sin enlace y sin decir quiénes lo forman).
  const codigoConsorcio = esCodigoConsorcio(c.proveedorRuc) ? c.proveedorRuc : null;
  const ganadores = c.ganadores ?? [];
  const mismo = (a: string | null, b: string | null) => !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
  const integrantes = codigoConsorcio ? ganadores.filter((g) => mismo(g.consorcio, c.proveedor)) : [];
  // De quién es cada antecedente (los de la fila son de todos los ganadores juntos). Sin `ganadores` (API vieja), los de
  // la fila, sin decir de quién.
  const conAntecedentes = ganadores.filter((g) => g.cruces.length > 0);
  const varios = conAntecedentes.length > 1 || (conAntecedentes.length === 1 && !!codigoConsorcio);

  const datos: DatoClave[] = [
    // El objeto como lo escribió la entidad, sin los «¿» que el SEACE dejó en lugar de comillas.
    { etiqueta: "Objeto", valor: c.titulo ? limpiarObjeto(c.titulo) : <Vacio>Sin objeto registrado en el OCDS</Vacio> },
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
    {
      etiqueta: "Gobernaba",
      valor: c.gobierno ? <PartidoQueGobierna g={c.gobierno} completo /> : <Vacio>Entidad sin gobierno local electo</Vacio>,
    },
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
      etiqueta: codigoConsorcio ? "Ganó el consorcio" : "Proveedor",
      // Orden SUNAT (apellidos primero): se tapa el apellido materno, no el nombre de pila.
      valor: c.proveedor ? (natural ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor) : <Vacio>Sin adjudicar todavía</Vacio>,
    },
    ...(c.proveedor && codigoConsorcio
      ? [
          {
            etiqueta: "Código del consorcio",
            valor: codigoConsorcio,
            mono: true,
            ayuda: (
              <Ayuda titulo="¿Por qué no tiene RUC?">
                Un consorcio se forma para participar en un proceso y no tiene RUC propio: el SEACE le da este código. Sus
                integrantes sí tienen RUC, y cada empresa su ficha en Vigía.
              </Ayuda>
            ),
          },
          {
            etiqueta: "Integrantes",
            valor: integrantes.length ? <Integrantes lista={integrantes} /> : <Vacio>CONOSCE todavía no publica sus integrantes</Vacio>,
          },
        ]
      : c.proveedor && c.proveedorRuc
        ? [{
            etiqueta: "RUC del proveedor",
            valor: enlaceProveedor(c.proveedorRuc) ? (
              <Link href={enlaceProveedor(c.proveedorRuc)!} className="text-granate underline-offset-2 hover:underline">
                <Ruc value={c.proveedorRuc} />
              </Link>
            ) : (
              <Ruc value={c.proveedorRuc} />
            ),
            mono: true,
          }]
        : []),
    { etiqueta: "Código SEACE", valor: c.codigo, mono: true, ayuda: <AyudaTermino clave="seace" /> },
    { etiqueta: "OCID", valor: <span className="break-all">{c.ocid}</span>, mono: true, ayuda: <AyudaTermino clave="ocid" /> },
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

      {/* Las banderas de la fila, en el panel, diciendo de quién es cada una (antes la fila decía «Multa del Tribunal» y
          el panel no). Con la evidencia en la pestaña Antecedentes de su ficha. */}
      {(conAntecedentes.length > 0 || (!c.ganadores && (c.cruces?.length ?? 0) > 0)) && (
        <BloqueDetalle
          titulo={varios ? "Antecedentes de quienes ganaron" : "Antecedentes de quien ganó"}
          ayuda={
            <Ayuda titulo="¿Qué son estos antecedentes?">
              Datos oficiales donde aparece quien ganó (o sus socios y representantes): sanciones y penalidades, aportes al partido
              que gobierna la entidad, visitas antes de la buena pro, socios comunes con otros postores. No prueban por sí solos una
              irregularidad.
            </Ayuda>
          }
        >
          {conAntecedentes.length > 0 ? (
            <ul className="space-y-3">
              {conAntecedentes.map((g) => (
                <li key={g.ruc} className="space-y-1">
                  <span className="block text-dato font-semibold leading-snug text-ink">
                    <NombreGanador ruc={g.ruc} nombre={g.nombre} />
                    {g.consorcio && <span className="font-normal text-inkSoft">, integrante de {tituloNatural(g.consorcio)}</span>}
                  </span>
                  <ChipsCruces cruces={g.cruces} etiquetaLista="Sus antecedentes en este contrato" />
                </li>
              ))}
            </ul>
          ) : (
            <ChipsCruces cruces={c.cruces ?? []} etiquetaLista="Antecedentes del ganador" />
          )}
          <Link
            href={`/app/contratos/${encodeURIComponent(c.ocid)}?seccion=antecedentes`}
            className="mt-2 inline-flex min-h-6 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-2 hover:underline"
          >
            Ver la evidencia de cada uno <ChevronRight size={13} aria-hidden />
          </Link>
        </BloqueDetalle>
      )}

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
            className="mt-2 inline-flex items-center gap-1.5 text-meta font-semibold text-granate underline-offset-2 hover:underline"
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
