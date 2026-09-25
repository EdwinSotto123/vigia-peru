/**
 * La evidencia oficial de la ficha de un contrato (DESIGN_SYSTEM.md §14.2, "Secciones"):
 * ítems, postores y ofertas, precio contratado frente a la referencia, dónde dice cada
 * señal y documentos. Cada sección es un `Seccion` con su conteo, su tabla del kit
 * (`Tabla`, §14.1: misma cabecera, misma fila, columnas que entran por breakpoint), lo
 * largo plegado y la fuente al pie.
 *
 * Vive aparte de `ContratoDetalle` (identidad, cifras y estado de la lectura) para que
 * ninguno de los dos pase de 800 líneas. Server component; `Redact`, `CitaPagina`,
 * `DocumentosContrato`, `Revelar` y `TextoRedactado` son islas de cliente.
 */

import { Fragment, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { PersonName, Ruc } from "@/components/Redact";
import { Ayuda, FuenteDato, Seccion } from "@/components/patrones";
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

/** Con más filas que esto, la tabla de una sección queda plegada (§14.2: "lo largo, plegado"). */
const LIMITE = { items: 10, postores: 8, precios: 10, citas: 6, documentos: 10 } as const;

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

/** Partes de una línea de contexto separadas por " · ", sin huecos. */
function Puntos({ partes }: { partes: ReactNode[] }) {
  const xs = partes.filter((x) => x != null && x !== false && x !== "");
  return (
    <>
      {xs.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {x}
        </Fragment>
      ))}
    </>
  );
}

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

/** Las secciones, en el orden de la ficha. En revisión humana no van precios ni citas (§10.4). */
export function EvidenciaContrato({ c, enRevision, catalogo }: { c: Detalle; enRevision: boolean; catalogo: CatalogoReglas }) {
  return (
    <>
      <SeccionItems c={c} />
      <SeccionPostores c={c} enRevision={enRevision} />
      {!enRevision && <SeccionPrecios c={c} />}
      {/* En revisión humana no se muestra: sería publicar las señales por la puerta de atrás. */}
      {!enRevision && <SeccionCitas c={c} catalogo={catalogo} />}
      <SeccionDocumentos c={c} />
    </>
  );
}

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
                <Puntos partes={[`Ítem ${it.posicion}`, it.cubso && `CUBSO ${it.cubso}`]} />
                {/* Debajo de lg la columna Cantidad no entra: la cantidad va en la meta. */}
                {cantidad && <span className="lg:hidden"> · {cantidad}</span>}
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
    <Seccion id="items" titulo={<TituloConteo texto="Ítems" n={c.items.length} />}>
      {c.items.length ? (
        <Plegado n={c.items.length} limite={LIMITE.items} nombre="ítems">
          <Tabla columnas={columnas} filas={filas} etiqueta="Ítems del proceso según el registro OCDS" />
        </Plegado>
      ) : (
        <Vacio>El registro OCDS no trae ítems para este proceso.</Vacio>
      )}
      <FuenteDato fuente={OCDS} className="mt-2" />
    </Seccion>
  );
}

/** Postores y ofertas, leídos de las actas del expediente. El ganador va primero y resaltado. */
function SeccionPostores({ c, enRevision }: { c: Detalle; enRevision: boolean }) {
  const postores = c.postoresDetalle ?? [];
  if (!postores.length) return null;
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
                <Puntos
                  partes={[
                    p.ordenPrelacion != null && `Puesto ${p.ordenPrelacion}`,
                    p.ruc && <>RUC <Ruc value={p.ruc} /></>,
                    humanizarCodigo(p.motivoEstado),
                  ]}
                />
                {oferta && <span className="md:hidden"> · {oferta}</span>}
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
    <Seccion id="postores" titulo={<TituloConteo texto="Postores y ofertas" n={postores.length} />}>
      <Plegado n={postores.length} limite={LIMITE.postores} nombre="postores">
        <Tabla columnas={columnas} filas={filas} etiqueta="Postores con su oferta económica, leídos de las actas del expediente" />
      </Plegado>
      <FuenteDato fuente="actas y cuadros comparativos del expediente" className="mt-2" />
    </Seccion>
  );
}

/** Precio unitario contratado (u ofertado) de cada ítem frente a su referencia. */
function SeccionPrecios({ c }: { c: Detalle }) {
  const items = (c.itemsAnalizados ?? []).filter((it) => it.precioUnitarioContratado != null || it.precioUnitarioOfertado != null);
  if (!items.length) return null;
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
          {d != null && <span className="md:hidden">{soloOfertado ? " · " : ""}{diferencia(d)}</span>}
        </>
      ) : undefined;
    return {
      id: `${it.numero}-${i}`,
      celdas: {
        item: (
          <CeldaPrincipal
            titulo={it.descripcion ?? "Sin descripción"}
            meta={
              <Puntos
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
    <Seccion id="precios" titulo={<TituloConteo texto="Precio contratado frente a la referencia" n={items.length} />}>
      <Plegado n={items.length} limite={LIMITE.precios} nombre="ítems">
        <Tabla columnas={columnas} filas={filas} etiqueta="Ítems con su precio unitario ofertado o contratado frente al valor referencial" />
      </Plegado>
      <FuenteDato fuente="registro OCDS (referencia) y contrato leído del expediente" className="mt-2" />
    </Seccion>
  );
}

/** Dónde dice cada señal en el expediente: evidencia de profundización, no la primera lectura. */
function SeccionCitas({ c, catalogo }: { c: Detalle; catalogo: CatalogoReglas }) {
  const senales = (c.alerta?.banderas ?? []).filter((b) => (b.citas?.length ?? 0) > 0);
  if (!senales.length) return null;
  const personas = personasNaturalesDe(c);
  return (
    <Seccion id="citas" titulo={<TituloConteo texto="Dónde dice cada señal en el expediente" n={senales.length} />}>
      <Plegado n={senales.length} limite={LIMITE.citas} nombre="señales">
        <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
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
      </Plegado>
    </Seccion>
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
          <CeldaPrincipal titulo={titulo} meta={<Puntos partes={[seccion, formatoDoc(d.formato)?.toUpperCase(), d.enVigia && "copia en Vigía"]} />} />
        ),
        fecha: <CeldaFecha fecha={dia(d.fecha)} />,
      },
      detalle: {
        titulo,
        etiqueta: `Abrir ${titulo}`,
        descripcion: <Puntos partes={[tipoDocLabel(d.tipo), d.fecha && `publicado el ${fecha(dia(d.fecha))}`]} />,
        contenido: (
          <>
            <p className="mb-3 text-[13px] leading-snug text-inkSoft">
              {d.enVigia
                ? "Vigía guarda una copia: se abre aquí mismo. El original está en el SEACE."
                : "El original está en el SEACE; Vigía no tiene una copia vigente de este documento."}
            </p>
            <DocumentosContrato ocid={c.ocid} documentos={[d]} />
          </>
        ),
      },
    };
  });
  return (
    <Seccion id="documentos" titulo={<TituloConteo texto="Documentos oficiales" n={docs.length} />} descripcion={nota}>
      {docs.length ? (
        <Plegado n={docs.length} limite={LIMITE.documentos} nombre="documentos">
          <Tabla columnas={columnas} filas={filas} etiqueta="Documentos oficiales del proceso" />
        </Plegado>
      ) : (
        <Vacio>El registro no publica documentos para este proceso.</Vacio>
      )}
      <FuenteDato fuente="SEACE (OECE)" className="mt-2" />
    </Seccion>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

/** Título de sección con su conteo, en segundo plano: "Ítems 12". */
function TituloConteo({ texto, n }: { texto: string; n: number }) {
  return (
    <>
      {texto} <span className="font-sans text-[15px] font-medium tabular-nums text-mute">{numero(n)}</span>
    </>
  );
}

/**
 * Lo largo, plegado (§14.2): con pocas filas la tabla va abierta; con muchas (hasta 73
 * ítems en casos reales), a un clic, para no empujar el resto de la ficha.
 */
function Plegado({ n, limite, nombre, children }: { n: number; limite: number; nombre: string; children: ReactNode }) {
  if (n <= limite) return <>{children}</>;
  return (
    // Grupo con nombre: un `group` sin nombre reaccionaría al [open] de cualquier ancestro.
    <details className="group/plegado">
      <summary className="inline-flex min-h-[40px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition-colors duration-rapido hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
        <span className="group-open/plegado:hidden">Ver los {numero(n)} {nombre}</span>
        <span className="hidden group-open/plegado:inline">Ocultar los {nombre}</span>
        <ChevronDown size={15} className="text-mute transition-transform duration-rapido group-open/plegado:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

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
