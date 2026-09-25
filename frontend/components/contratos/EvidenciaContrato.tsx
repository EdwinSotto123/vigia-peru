/**
 * La evidencia oficial de la ficha de un contrato (DESIGN_SYSTEM.md §14.2, "Secciones"):
 * ítems, postores y ofertas, precio contratado frente a la referencia, dónde dice cada
 * señal y documentos. Cada sección es una pestaña (§14.3) con su conteo, su tabla del kit
 * (`Tabla`, §14.1: misma cabecera, misma fila, columnas que entran por breakpoint) y la
 * fuente al pie. Antes se apilaban una tras otra y lo largo iba plegado detrás de "Ver
 * los 73 ítems": ahora cada tabla ocupa su pestaña entera y se ve de un clic.
 *
 * Vive aparte de `ContratoDetalle` (identidad, cifras y estado de la lectura) para que
 * ninguno de los dos pase de 800 líneas. Server component: `pestanasEvidencia` es una
 * función de servidor que arma ReactNode; `Redact`, `CitaPagina`, `DocumentosContrato`,
 * `Revelar` y `TextoRedactado` son islas de cliente.
 */

import type { ReactNode } from "react";
import { PersonName, Ruc } from "@/components/Redact";
import { Ayuda, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, FuenteDato, type DatoClave, type Pestana } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, type Columna, type Fila } from "@/components/listado";
import { DocumentosContrato } from "./DocumentosContrato";
import { CitaPagina } from "./CitaPagina";
import { TextoRedactado } from "./TextoRedactado";
import { etiquetaRegla, type CatalogoReglas } from "@/lib/revision";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import {
  esPersonaNatural, formatoDoc, humanizarCodigo, ordenNombrePostor, personasNaturalesDe, tipoDocLabel,
  type ContratoDetalle as Detalle, type ContratoDocumento, type PostorContrato,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";
import { Partes, Separador } from "@/components/ui/Partes";

export const OCDS = "registro OCDS del OECE (SEACE)";

// ─── Formato ─────────────────────────────────────────────────────────────────

/** Monto en tabla: soles completos (lib/formato). Si el registro trae otra moneda, se dice cuál. */
export function monto(n: number | null | undefined, moneda: string | null): string {
  if (n == null) return "Sin dato";
  return moneda && moneda !== "PEN" ? `${moneda} ${numero(n)}` : soles(n);
}

/** "+12.3 %" · "−4 %": diferencia con signo, en tinta neutra (un número no es una señal). */
function diferencia(pct: number): string {
  const signo = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${signo}${porcentaje(Math.abs(pct), { decimales: 1 })}`;
}

/** Sólo el día de un DATE/TIMESTAMP (AAAA-MM-DD): una medianoche UTC no se corre al día anterior en Lima. */
export const dia = (s: string | null | undefined): string | null => (s ? s.slice(0, 10) : null);

/**
 * Referencia contra la que se compara la oferta de UN postor. La oferta es por ítem
 * (`p.item`): compararla con el valor referencial del proceso entero daba "−71 %"
 * a un postor que ofertó exactamente el valor de su ítem en un proceso de tres
 * ítems. Se usa la referencia del ítem que ofertó; con un solo ítem, el total del
 * proceso es la misma cifra. Sin ítem identificable, no se compara.
 */
function referenciaDe(p: PostorContrato, c: Detalle): number | null {
  const n = p.item != null ? Number(String(p.item).trim()) : NaN;
  if (Number.isFinite(n)) {
    const it = c.items.find((x) => x.posicion === n);
    if (it?.montoPen) return it.montoPen;
  }
  if (c.items.length <= 1 && c.montoPen) return c.montoPen;
  return null;
}

/**
 * Las pestañas de evidencia, en el orden de la ficha, cada una con su conteo. Una sección
 * sin filas que antes no se mostraba (postores, precios, citas) tampoco es pestaña: una
 * pestaña vacía es un clic que no lleva a nada. Ítems y documentos siempre están (su vacío
 * dice qué falta). En revisión humana no van precios ni citas (§10.4): serían publicar las
 * señales por la puerta de atrás.
 */
export function pestanasEvidencia({ c, enRevision, catalogo }: { c: Detalle; enRevision: boolean; catalogo: CatalogoReglas }): Pestana[] {
  const postores = c.postoresDetalle ?? [];
  const precios = itemsConPrecio(c);
  const senales = senalesConCita(c);
  const pestanas: (Pestana | false)[] = [
    { clave: "items", etiqueta: "Ítems", conteo: c.items.length, contenido: <SeccionItems c={c} /> },
    postores.length > 0 && {
      clave: "postores",
      etiqueta: "Postores y ofertas",
      conteo: postores.length,
      contenido: <SeccionPostores c={c} enRevision={enRevision} />,
    },
    !enRevision && precios.length > 0 && {
      clave: "precios",
      etiqueta: "Precio contratado",
      conteo: precios.length,
      contenido: <SeccionPrecios c={c} items={precios} />,
    },
    !enRevision && senales.length > 0 && {
      clave: "citas",
      etiqueta: "Dónde dice cada señal",
      conteo: senales.length,
      contenido: <SeccionCitas c={c} senales={senales} catalogo={catalogo} />,
    },
    { clave: "documentos", etiqueta: "Documentos oficiales", conteo: c.documentos.length, contenido: <SeccionDocumentos c={c} /> },
  ];
  return pestanas.filter((p): p is Pestana => !!p);
}

/** Ítems con precio unitario leído del expediente (contratado u ofertado). */
const itemsConPrecio = (c: Detalle) =>
  (c.itemsAnalizados ?? []).filter((it) => it.precioUnitarioContratado != null || it.precioUnitarioOfertado != null);

/** Señales del dictamen con al menos una cita a una página del expediente. */
const senalesConCita = (c: Detalle) => (c.alerta?.banderas ?? []).filter((b) => (b.citas?.length ?? 0) > 0);

// ─── Secciones de evidencia ──────────────────────────────────────────────────

function SeccionItems({ c }: { c: Detalle }) {
  const conEstado = c.items.some((it) => it.estado);
  const columnas: Columna[] = [
    ...(conEstado ? [{ clave: "estado", titulo: "Estado", ancho: "120px", desde: "md" } satisfies Columna] : []),
    { clave: "item", titulo: "Ítem", ancho: "minmax(0,1fr)" },
    { clave: "cantidad", titulo: "Cantidad", ancho: "120px", alinear: "der", desde: "lg" },
    { clave: "monto", titulo: "Valor referencial", ancho: "140px", alinear: "der" },
  ];
  const filas: Fila[] = c.items.map((it) => {
    const cantidad = it.cantidad != null ? `${numero(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ""}` : null;
    return {
      id: it.id,
      celdas: {
        estado: it.estado ? <Chip>{humanizarCodigo(it.estado)}</Chip> : undefined,
        item: (
          <CeldaPrincipal
            titulo={it.descripcion ?? "Sin descripción"}
            meta={
              <>
                <Partes partes={[`Ítem ${it.posicion}`, it.cubso && `CUBSO ${it.cubso}`]} />
                {/* Debajo de lg la columna Cantidad no entra: la cantidad va en la meta. */}
                {cantidad && (
                  <span className="lg:hidden">
                    <Separador />
                    {cantidad}
                  </span>
                )}
              </>
            }
          />
        ),
        cantidad: it.cantidad != null ? <CeldaNumero sub={it.unidad ?? undefined}>{numero(it.cantidad)}</CeldaNumero> : undefined,
        monto: it.montoPen ? <CeldaNumero>{monto(it.montoPen, c.moneda)}</CeldaNumero> : undefined,
      },
    };
  });
  return (
    <>
      {c.items.length ? (
        <Tabla columnas={columnas} filas={filas} etiqueta="Ítems del proceso según el registro OCDS" />
      ) : (
        <Vacio>El registro OCDS no trae ítems para este proceso.</Vacio>
      )}
      <FuenteDato fuente={OCDS} className="mt-2" />
    </>
  );
}

/** Postores y ofertas, leídos de las actas del expediente. El ganador va primero y resaltado. */
function SeccionPostores({ c, enRevision }: { c: Detalle; enRevision: boolean }) {
  const postores = c.postoresDetalle ?? [];
  const conItem = c.items.length > 1;
  // La comparación con la referencia solo existe si al menos un postor tiene contra qué compararse.
  const hayReferencia = !enRevision && postores.some((p) => p.montoOferta != null && referenciaDe(p, c) != null);
  const columnas: Columna[] = [
    { clave: "estado", titulo: "Estado", ancho: "116px" },
    { clave: "postor", titulo: "Postor", ancho: "minmax(0,1fr)" },
    ...(conItem ? [{ clave: "item", titulo: "Ítem", ancho: "56px", desde: "md" } satisfies Columna] : []),
    {
      clave: "oferta",
      titulo: "Oferta",
      ancho: "150px",
      alinear: "der",
      desde: "md",
      ayuda: hayReferencia ? (
        <Ayuda titulo="¿Contra qué se compara la oferta?">
          {conItem
            ? "“vs. referencia” compara cada oferta con el valor referencial del ítem al que se presentó."
            : "“vs. referencia” compara la oferta con el valor referencial del proceso."}{" "}
          Es una diferencia, no una señal.
        </Ayuda>
      ) : undefined,
    },
    {
      clave: "fuente",
      titulo: "Fuente",
      ancho: "88px",
      desde: "lg",
      ayuda: <Ayuda titulo="¿Qué abre la fuente?">La página del acta o del cuadro comparativo donde se leyó la oferta.</Ayuda>,
    },
  ];
  const ordenados = [...postores].sort((a, b) => Number(b.esGanador) - Number(a.esGanador) || (a.ordenPrelacion ?? 99) - (b.ordenPrelacion ?? 99));
  const filas: Fila[] = ordenados.map((p, i) => {
    const ref = referenciaDe(p, c);
    const dif = hayReferencia && p.montoOferta != null && ref ? ((p.montoOferta - ref) / ref) * 100 : null;
    const oferta = p.montoOferta != null ? monto(p.montoOferta, c.moneda) : null;
    const estado = p.esGanador ? "Ganador" : humanizarCodigo(p.estado);
    const nombre = p.razonSocial
      ? esPersonaNatural(p.ruc)
        ? <PersonName name={p.razonSocial} orden={ordenNombrePostor(p.razonSocial, p.ruc, c.proveedor, c.proveedorRuc)} />
        : p.razonSocial
      : "Sin razón social";
    return {
      id: `${p.ruc ?? p.razonSocial ?? "postor"}-${i}`,
      resaltada: p.esGanador,
      celdas: {
        estado: estado ? <Chip ganador={p.esGanador}>{estado}</Chip> : undefined,
        // CeldaTexto y no CeldaPrincipal: el nombre de una persona natural va en vidrio (ReactNode, §10.6).
        postor: (
          <CeldaTexto
            sub={
              <>
                <Partes
                  partes={[
                    p.ordenPrelacion != null && `Puesto ${p.ordenPrelacion}`,
                    p.ruc && <>RUC <Ruc value={p.ruc} /></>,
                    humanizarCodigo(p.motivoEstado),
                  ]}
                />
                {oferta && (
                  <span className="md:hidden">
                    <Separador />
                    {oferta}
                  </span>
                )}
              </>
            }
          >
            <span className="font-semibold text-ink">{nombre}</span>
          </CeldaTexto>
        ),
        item: p.item ? <CeldaTexto>{p.item}</CeldaTexto> : undefined,
        oferta: oferta ? <CeldaNumero sub={dif != null ? `${diferencia(dif)} vs. referencia` : undefined}>{oferta}</CeldaNumero> : undefined,
        fuente: p.citas[0] ? <CitaPagina ocid={c.ocid} cita={p.citas[0]} corto /> : <span className="text-[12px] text-mute">Sin cita</span>,
      },
    };
  });
  return (
    <>
      <Tabla columnas={columnas} filas={filas} etiqueta="Postores con su oferta económica, leídos de las actas del expediente" />
      <FuenteDato fuente="actas y cuadros comparativos del expediente" className="mt-2" />
    </>
  );
}

/** Precio unitario contratado (u ofertado) de cada ítem frente a su referencia. */
function SeccionPrecios({ c, items }: { c: Detalle; items: ReturnType<typeof itemsConPrecio> }) {
  const columnas: Columna[] = [
    { clave: "item", titulo: "Ítem", ancho: "minmax(0,1fr)" },
    {
      clave: "referencia",
      titulo: "Referencia unitaria",
      ancho: "140px",
      alinear: "der",
      desde: "md",
      ayuda: <Ayuda titulo="¿Cómo se calcula la referencia?">Valor referencial del ítem ÷ cantidad, según el registro OCDS del OECE.</Ayuda>,
    },
    {
      clave: "contratado",
      titulo: "Contratado unitario",
      ancho: "140px",
      alinear: "der",
      ayuda: (
        <Ayuda titulo="¿De dónde sale el precio contratado?">
          Del contrato u orden de compra leída en el expediente. Si no la hay, se usa lo ofertado y se marca así.
        </Ayuda>
      ),
    },
    { clave: "diferencia", titulo: "Diferencia", ancho: "92px", alinear: "der", desde: "md" },
    { clave: "fuente", titulo: "Fuente", ancho: "88px", desde: "lg" },
  ];
  const filas: Fila[] = items.map((it, i) => {
    const unit = it.precioUnitarioContratado ?? it.precioUnitarioOfertado;
    const d = unit != null && it.referenciaUnitaria ? ((unit - it.referenciaUnitaria) / it.referenciaUnitaria) * 100 : null;
    const soloOfertado = it.precioUnitarioContratado == null && it.precioUnitarioOfertado != null;
    // En el celular la columna Diferencia no entra: va debajo del precio.
    const sub =
      soloOfertado || d != null ? (
        <>
          {soloOfertado && "ofertado"}
          {d != null && (
            <span className="md:hidden">
              {soloOfertado && <Separador />}
              {diferencia(d)}
            </span>
          )}
        </>
      ) : undefined;
    return {
      id: `${it.numero}-${i}`,
      celdas: {
        item: (
          <CeldaPrincipal
            titulo={it.descripcion ?? "Sin descripción"}
            meta={
              <Partes
                partes={[
                  `Ítem ${it.numero}`,
                  it.cantidad != null && `${numero(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ""}`,
                  it.marca && `marca ofertada: ${it.marca}`,
                ]}
              />
            }
          />
        ),
        referencia: it.referenciaUnitaria != null ? <CeldaNumero>{monto(it.referenciaUnitaria, c.moneda)}</CeldaNumero> : undefined,
        contratado: unit != null ? <CeldaNumero sub={sub}>{monto(unit, c.moneda)}</CeldaNumero> : undefined,
        diferencia: d != null ? <CeldaNumero>{diferencia(d)}</CeldaNumero> : undefined,
        fuente: it.citas[0] ? <CitaPagina ocid={c.ocid} cita={it.citas[0]} corto /> : <span className="text-[12px] text-mute">Sin cita</span>,
      },
    };
  });
  return (
    <>
      <Tabla columnas={columnas} filas={filas} etiqueta="Ítems con su precio unitario ofertado o contratado frente al valor referencial" />
      <FuenteDato fuente="registro OCDS (referencia) y contrato leído del expediente" className="mt-2" />
    </>
  );
}

/** Dónde dice cada señal en el expediente: evidencia de profundización, no la primera lectura. */
function SeccionCitas({ c, senales, catalogo }: { c: Detalle; senales: ReturnType<typeof senalesConCita>; catalogo: CatalogoReglas }) {
  const personas = personasNaturalesDe(c);
  return (
    <>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-paper" aria-label="Señales con la página del expediente que las respalda">
        {senales.map((b, i) => (
          <li key={`${b.regla}-${i}`} className="px-4 py-3 text-sm">
            <div className="text-[14px] font-semibold text-ink">{etiquetaRegla(b.regla, catalogo)}</div>
            {b.evidencia && (
              <p className="mt-0.5 line-clamp-2 text-[13px] text-inkSoft">
                <TextoRedactado texto={b.evidencia} personas={personas} />
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(b.citas ?? []).slice(0, 4).map((ct, j) => <CitaPagina key={j} ocid={c.ocid} cita={ct} />)}
            </div>
          </li>
        ))}
      </ul>
      <FuenteDato fuente="documentos del expediente, página por página" className="mt-2" />
    </>
  );
}

/** De qué parte del expediente sale un documento (la convocatoria es lo habitual: no se dice). */
const PARTE: Partial<Record<NonNullable<ContratoDocumento["seccion"]>, string>> = { award: "adjudicación", contract: "contrato" };

/**
 * Documentos oficiales, con la anatomía de fila del kit: tipo (chip) · documento · fecha · ›.
 * Una fila = una acción: abre el panel con "Ver" (la copia de Vigía, si la hay) y el original
 * en el SEACE. Así la fila no lleva dos botones propios.
 */
function SeccionDocumentos({ c }: { c: Detalle }) {
  const docs = c.documentos;
  const guardados = c.documentosEnVigia;
  const nota =
    guardados && docs.length > 0
      ? guardados.n > 0 && guardados.expiraAt
        ? `${numero(guardados.n)} guardados en Vigía hasta el ${fecha(dia(guardados.expiraAt))}.`
        : "Sin copia en Vigía: se descargan al financiar la lectura."
      : undefined;
  const columnas: Columna[] = [
    { clave: "tipo", titulo: "Tipo", ancho: "132px" },
    { clave: "documento", titulo: "Documento", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Publicado", ancho: "96px", desde: "md" },
  ];
  const filas: Fila[] = docs.map((d, i) => {
    const titulo = d.titulo ?? tipoDocLabel(d.tipo);
    const seccion = d.seccion ? PARTE[d.seccion] : undefined;
    return {
      id: `${d.url}-${i}`,
      celdas: {
        tipo: <Chip>{tipoDocLabel(d.tipo)}</Chip>,
        documento: (
          <CeldaPrincipal titulo={titulo} meta={[seccion, formatoDoc(d.formato)?.toUpperCase(), d.enVigia && "copia en Vigía"]} />
        ),
        fecha: <CeldaFecha fecha={dia(d.fecha)} />,
      },
      detalle: {
        titulo,
        etiqueta: `Abrir ${titulo}`,
        descripcion: tipoDocLabel(d.tipo),
        contenido: <DetalleDocumento c={c} d={d} parte={seccion} />,
      },
    };
  });
  return (
    <>
      {nota && <p className="mb-3 text-sm text-inkSoft">{nota}</p>}
      {docs.length ? (
        <Tabla columnas={columnas} filas={filas} etiqueta="Documentos oficiales del proceso" />
      ) : (
        <Vacio>El registro no publica documentos para este proceso.</Vacio>
      )}
      <FuenteDato fuente="SEACE (OECE)" className="mt-2" />
    </>
  );
}

/**
 * El panel de un documento (§14.4): chips (tipo, si hay copia) → sus datos en filas → cómo
 * abrirlo. Antes era un párrafo suelto encima del botón.
 */
function DetalleDocumento({ c, d, parte }: { c: Detalle; d: ContratoDocumento; parte: string | undefined }) {
  const formato = formatoDoc(d.formato)?.toUpperCase();
  const datos: DatoClave[] = [
    { etiqueta: "Publicado", valor: d.fecha ? fecha(dia(d.fecha)) : null },
    ...(parte ? [{ etiqueta: "Parte del expediente", valor: parte }] : []),
    { etiqueta: "Formato", valor: formato ?? null, mono: true },
    {
      etiqueta: "Dónde se abre",
      valor: d.enVigia ? "Aquí mismo, con la copia de Vigía; el original está en el SEACE" : "En el SEACE: Vigía no tiene una copia vigente",
    },
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <Chip>{tipoDocLabel(d.tipo)}</Chip>
        {d.enVigia && <Chip>Copia en Vigía</Chip>}
      </ChipsDetalle>
      <DatosClave items={datos} />
      <BloqueDetalle titulo="Abrir el documento">
        <DocumentosContrato ocid={c.ocid} documentos={[d]} />
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

/** Chip de estado o categoría de una fila (§14.1: la columna de estado siempre es un chip). */
function Chip({ children, ganador = false }: { children: ReactNode; ganador?: boolean }) {
  return (
    <span className={cn("pill max-w-full", ganador ? "border-granate/30 bg-granate-50 font-semibold text-granate" : "border-line bg-paperSoft text-inkSoft")}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Una sección sin filas: qué falta, en una línea. Sin llamita: puede haber varias en la misma ficha. */
function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line bg-paperSoft px-4 py-5 text-sm text-mute">{children}</p>;
}
