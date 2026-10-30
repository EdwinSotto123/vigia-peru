/**
 * Las pestañas de la ficha de un contrato que salen del registro del proceso y no de la lectura de Vigía (API:
 * backend/api/src/lib/proceso.ts): «Participantes» (ParticipantesContrato.tsx), «Adjudicación y contrato» (lo
 * adjudicado por ítem, el contrato firmado y el presupuesto del proyecto) y «Cronograma» (cada hito con su fecha y su
 * fuente). Antes, sin dictamen, la ficha mostraba sólo el resumen, los ítems y los documentos (pedido del usuario,
 * 2026-10-26).
 *
 * Una pestaña sin nada que mostrar no va (§14.3: un clic que no lleva a nada). Cada panel abre con su `CabeceraPestana`.
 * Server component: arma ReactNode; las tablas del kit son islas de cliente.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Clock, FileText, Hash, ListOrdered, Package, UserRound } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, CabeceraPestana, ChipsDetalle, CuerpoDetalle, DatosClave, EnlaceFuente, FuenteDato, type DatoClave, type Pestana } from "@/components/patrones";
import { CONSULTA_AMIGABLE, DATASET_MEF, enlacesProceso, inversionSsi } from "@/lib/fuentes";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { PersonName } from "@/components/Redact";
import { SeccionParticipantes } from "./ParticipantesContrato";
import { monto, OCDS } from "./EvidenciaContrato";
import { fecha, fechaConAnio, listaY, numero, oracion, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { adjudicacionesVigentes, esPersonaNatural, humanizarCodigo, type ContratoDetalle as Detalle } from "@/lib/contratos";
import { enlaceProveedor } from "@/lib/empresas";
import { FUENTE_HITO, numeroContrato, tituloContrato, type ContratoFirmado, type HitoProceso, type ItemAdjudicado, type PersonaProceso } from "@/lib/procesoContrato";
import { ObrasDelContrato } from "@/components/obras/ObraContrato";

/**
 * Las tres pestañas, o null la que no tiene nada. «Participantes» sólo sin las actas del dictamen (con ellas va
 * «Postores y ofertas», que trae las ofertas leídas); «Adjudicación y contrato» si hay algo adjudicado, un contrato o el
 * presupuesto del proyecto; «Cronograma» con dos hitos o más.
 */
export function pestanasProceso({ c }: { c: Detalle }): { participantes: Pestana | null; adjudicacion: Pestana | null; cronograma: Pestana | null } {
  const ps = c.participantes ?? [];
  const k = c.contrato;
  const hitos = c.cronograma ?? [];
  const conActas = (c.postoresDetalle ?? []).length > 0;
  const hayAdjudicado = !!k && (k.items.some((i) => i.adjudicado != null || i.proveedores.length > 0) || k.firmados.length > 0);
  return {
    participantes: !conActas && ps.length > 0 ? { clave: "participantes", etiqueta: "Participantes", conteo: ps.length, contenido: <SeccionParticipantes c={c} /> } : null,
    // También con sólo la obra de INFOBRAS o la inversión de Invierte.pe de su CUI (migración 160).
    adjudicacion: hayAdjudicado || c.presupuesto || (c.obras?.length ?? 0) > 0 || (c.inversiones?.length ?? 0) > 0
      ? { clave: "adjudicacion", etiqueta: "Adjudicación y contrato", contenido: <SeccionAdjudicacion c={c} /> }
      : null,
    cronograma: hitos.length >= 2 ? { clave: "cronograma", etiqueta: "Cronograma", conteo: hitos.length, contenido: <SeccionCronograma c={c} /> } : null,
  };
}

/**
 * Un nombre en pantalla: el de una persona natural ya viene con su apellido tapado (la API lo tapa). Con `enlace`, una
 * empresa (RUC 20) lleva a su ficha: qué más ganó y con quién. Sin él en la fila de una tabla que abre un panel (sería un
 * enlace dentro de un botón): ahí el enlace va en el panel. Una persona natural nunca lleva enlace (su RUC lleva el DNI).
 */
function Nombre({ p, enlace = false }: { p: PersonaProceso | null; enlace?: boolean }) {
  if (!p?.nombre) return <>{p ? "Sin razón social" : "Sin dato"}</>;
  if (esPersonaNatural(p.ruc)) return <PersonName name={p.nombre} orden="sunat" />;
  const ficha = enlace ? enlaceProveedor(p.ruc) : null;
  return ficha ? (
    <Link href={ficha} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
      {p.nombre}
    </Link>
  ) : (
    <>{p.nombre}</>
  );
}

/** El chip de estado de un ítem (§14.1). */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="pill max-w-full border-line bg-paperSoft text-inkSoft">
      <span className="truncate">{children}</span>
    </span>
  );
}

const pct = (n: number | null) => (n == null ? null : porcentaje(n, { decimales: 1 }));
const sumar = (xs: (number | null)[]) => xs.reduce<number | null>((s, x) => (x == null ? s : (s ?? 0) + x), null);

// ─── Adjudicación y contrato ─────────────────────────────────────────────────

function SeccionAdjudicacion({ c }: { c: Detalle }) {
  const k: NonNullable<Detalle["contrato"]> = c.contrato ?? { items: [], firmados: [] };
  const items = k.items.filter((i) => i.adjudicado != null || i.proveedores.length > 0 || i.estado);
  // De todos los contratos, aunque en un proceso enorme sólo lleguen los de mayor monto.
  const nFirmados = k.firmadosTotal ?? k.firmados.length;
  // Lo adjudicado es lo mismo que la cifra de cabecera: las adjudicaciones vigentes (o, sin ellas, lo de CONOSCE).
  const vigentes = adjudicacionesVigentes(c).reduce((s, a) => s + (a.montoPen ?? 0), 0) || null;
  const adjudicado = vigentes ?? sumar(k.items.map((i) => i.adjudicado));
  const contratado = k.montoFirmados !== undefined ? k.montoFirmados : sumar(k.firmados.map((f) => f.monto));
  // Los adicionales sólo los registra CONOSCE: con el contrato del OCDS no se sabe (sin dato, no «ninguno»).
  const deConosce = k.firmados.filter((f) => f.fuente === "conosce");
  const adicional =
    k.adicionalFirmados !== undefined ? k.adicionalFirmados : deConosce.length ? sumar(deConosce.map((f) => f.adicional)) ?? 0 : null;
  const cifras: Cifra[] = [
    { valor: c.montoPen ? solesCompacto(c.montoPen) : null, etiqueta: "valor referencial", ayuda: <AyudaTermino clave="valor-referencial" />, contexto: c.montoPen ? monto(c.montoPen, c.moneda) : "el registro no lo publica" },
    {
      valor: adjudicado ? solesCompacto(adjudicado) : null,
      etiqueta: "adjudicado",
      ayuda: <AyudaTermino clave="adjudicacion" />,
      contexto: adjudicado && c.montoPen ? `${pct((adjudicado / c.montoPen) * 100)} del valor referencial` : adjudicado ? monto(adjudicado, c.moneda) : "todavía sin buena pro",
    },
    {
      valor: contratado ? solesCompacto(contratado) : null,
      etiqueta: "contratado",
      contexto: contratado
        ? plural(nFirmados, "contrato firmado", "contratos firmados")
        : adjudicado ? "CONOSCE todavía no publica el contrato" : "sin buena pro, sin contrato",
    },
    ...(contratado
      ? [{
          valor: adicional == null ? null : adicional ? solesCompacto(adicional) : "Ninguno",
          etiqueta: "adicionales",
          contexto: adicional == null ? "el registro OCDS no los informa" : adicional ? `${pct((adicional / contratado) * 100)} de lo contratado` : "según CONOSCE",
        } satisfies Cifra]
      : []),
  ];
  return (
    <>
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿De dónde sale?">
            <span className="block">
              Lo adjudicado y el contrato, de CONOSCE (OECE): qué se le adjudicó a quién en cada ítem, cuándo quedó firme
              la buena pro y el contrato que se firmó, con sus adicionales y prórrogas. Si CONOSCE todavía no lo publica, lo
              que trae el registro OCDS.
            </span>
            <span className="mt-2 block">El presupuesto del proyecto, del MEF: lo que la entidad tiene para gastar en él y lo que ya devengó.</span>
          </Ayuda>
        }
      >
        Cuánto se adjudicó en cada ítem frente a su valor referencial, el contrato firmado y, si es un proyecto de inversión, su presupuesto.
      </CabeceraPestana>
      <div className="space-y-5">
        <section aria-labelledby="adjudicado-titulo" className="tarjeta overflow-clip rounded-2xl border border-line bg-paper">
          <div className="space-y-4 p-4 sm:p-5">
            <h3 id="adjudicado-titulo" className="font-display text-bloque font-bold text-ink">Lo adjudicado</h3>
            <CifrasEnFila items={cifras} chico />
            {items.length === 1 && <DatosClave items={datosItem(items[0], c, { sinMontos: true })} />}
            {items.length === 0 && <EstadoVacio variante="compacta">Todavía no hay una buena pro registrada para este proceso.</EstadoVacio>}
          </div>
          {items.length > 1 && <TablaItems items={items} c={c} />}
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <h3 className="font-display text-bloque font-bold text-ink">{nFirmados > 1 ? "Los contratos firmados" : "El contrato firmado"}</h3>
            {nFirmados > k.firmados.length && (
              <p className="mt-1 text-meta text-inkSoft">
                Es una compra con {numero(nFirmados)} contratos: aquí van los {numero(k.firmados.length)} de mayor monto, y las cifras de
                arriba cuentan todos. La lista entera está en CONOSCE (al pie).
              </p>
            )}
            {k.firmados.length === 1 ? (
              <DatosClave items={datosContrato(k.firmados[0], c)} className="mt-2" />
            ) : k.firmados.length === 0 ? (
              <EstadoVacio variante="compacta" className="mt-2">
                {items.some((i) => i.adjudicado != null) ? "CONOSCE todavía no publica el contrato firmado de este proceso." : "Sin buena pro no hay contrato que mostrar."}
              </EstadoVacio>
            ) : null}
          </div>
          {k.firmados.length > 1 && <TablaContratos firmados={k.firmados} c={c} />}
          <FuenteDato fuente="CONOSCE (OECE) y el registro OCDS" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo, conosce: true })} className="border-t border-line px-4 py-2 sm:px-5" />
        </section>
        {c.presupuesto && <BloquePresupuesto c={c} />}
        {/* La obra que ejecuta o supervisa este contrato (INFOBRAS) y la inversión de su CUI (Invierte.pe). */}
        <ObrasDelContrato obras={c.obras} inversiones={c.inversiones} />
      </div>
    </>
  );
}

/**
 * Los datos de un ítem adjudicado (en la tarjeta si es uno solo; en el panel de su fila si son varios). `sinMontos`: el
 * referencial y lo adjudicado ya van en las cifras de arriba (un proceso de un ítem).
 */
function datosItem(it: ItemAdjudicado, c: Detalle, { sinMontos = false } = {}): DatoClave[] {
  return [
    { etiqueta: "Estado del ítem", valor: it.estado ? `${humanizarCodigo(it.estado)}${it.fuente === "conosce" ? " (CONOSCE)" : it.fuente === "ocds" ? " (registro OCDS)" : ""}` : null },
    ...(sinMontos
      ? []
      : [
          { etiqueta: "Valor referencial", valor: it.referencial != null ? monto(it.referencial, c.moneda) : null, mono: it.referencial != null },
          {
            etiqueta: "Adjudicado",
            valor: it.adjudicado != null ? `${monto(it.adjudicado, c.moneda)}${it.porcentaje != null ? `, el ${pct(it.porcentaje)} del referencial` : ""}` : null,
          },
        ]),
    {
      etiqueta: it.proveedores.length > 1 ? "A quiénes" : "A quién",
      valor: it.proveedores.length ? (
        <span className="block space-y-0.5">
          {it.proveedores.map((p) => (
            <span key={p.ruc} className="block">
              <Nombre p={p} enlace />
              {it.proveedores.length > 1 && p.monto != null && <span className="ml-1.5 font-mono text-meta tabular-nums text-mute">{monto(p.monto, c.moneda)}</span>}
            </span>
          ))}
        </span>
      ) : null,
    },
    { etiqueta: "Buena pro", valor: it.fechaBuenaPro ? fecha(it.fechaBuenaPro) : null },
    {
      etiqueta: "Consentimiento",
      ayuda: <AyudaTermino clave="consentimiento" />,
      valor: it.fechaConsentimiento ? fecha(it.fechaConsentimiento) : it.fechaBuenaPro ? "CONOSCE no registra la fecha" : null,
    },
  ];
}

function TablaItems({ items, c }: { items: ItemAdjudicado[]; c: Detalle }) {
  const columnas: Columna[] = [
    { clave: "estado", titulo: "Estado", ancho: "120px", desde: "md", apilar: true },
    { clave: "item", titulo: "Ítem", ancho: "minmax(0,1fr)" },
    { clave: "referencial", titulo: "Referencial", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo" },
    { clave: "adjudicado", titulo: "Adjudicado", ancho: "132px", alinear: "der", apilar: "con-rotulo" },
  ];
  const filas: Fila[] = items.map((it) => ({
    id: `item-${it.posicion}`,
    celdas: {
      estado: it.estado ? <Chip>{humanizarCodigo(it.estado)}</Chip> : undefined,
      item: (
        <CeldaPrincipal
          titulo={it.descripcion ? oracion(it.descripcion) : `Ítem ${it.posicion}`}
          dosLineas
          meta={[
            <Dato key="n" icono={ListOrdered} nombre="Número de ítem">Ítem {it.posicion}</Dato>,
            it.proveedores[0] && (
              <Dato key="p" icono={UserRound} nombre="Adjudicado a">
                <Nombre p={it.proveedores[0]} />
                {it.proveedores.length > 1 ? ` y ${numero(it.proveedores.length - 1)} más` : ""}
              </Dato>
            ),
          ]}
        />
      ),
      referencial: it.referencial != null ? <CeldaNumero>{monto(it.referencial, c.moneda)}</CeldaNumero> : undefined,
      adjudicado: it.adjudicado != null
        ? <CeldaNumero sub={it.porcentaje != null ? `${pct(it.porcentaje)} del referencial` : undefined}>{monto(it.adjudicado, c.moneda)}</CeldaNumero>
        : <span className="text-meta text-mute">Sin adjudicar</span>,
    },
    detalle: {
      titulo: it.descripcion ? oracion(it.descripcion) : `Ítem ${it.posicion}`,
      descripcion: `Ítem ${it.posicion}`,
      contenido: (
        <CuerpoDetalle>
          {it.estado && <ChipsDetalle><Chip>{humanizarCodigo(it.estado)}</Chip></ChipsDetalle>}
          <DatosClave items={datosItem(it, c)} />
          {it.contratos.length > 0 && (
            <BloqueDetalle titulo={it.contratos.length > 1 ? "Sus contratos" : "Su contrato"}>
              <ul className="space-y-1.5">
                {(c.contrato?.firmados ?? []).filter((f) => f.codigo && it.contratos.includes(f.codigo)).map((f) => (
                  <li key={f.codigo} className="text-dato text-ink">
                    {tituloContrato(f.numero, f.codigo)}
                    {f.firmado && <span className="ml-1.5 text-meta text-mute">firmado el {fecha(f.firmado)}</span>}
                  </li>
                ))}
                {it.contratosTotal != null && it.contratosTotal > it.contratos.length && (
                  <li className="text-meta text-mute">
                    Y {plural(it.contratosTotal - it.contratos.length, "contrato más", "contratos más")} de este ítem, entre los que no van en esta ficha.
                  </li>
                )}
              </ul>
            </BloqueDetalle>
          )}
        </CuerpoDetalle>
      ),
    },
  }));
  return <Tabla columnas={columnas} filas={filas} etiqueta="Lo adjudicado en cada ítem" medida="contenedor" />;
}

/** Los datos de un contrato firmado (en la tarjeta si es uno solo; en el panel de su fila si son varios). */
function datosContrato(f: ContratoFirmado, c: Detalle): DatoClave[] {
  const enMoneda = (n: number | null) => (n == null ? null : monto(n, f.moneda && f.moneda !== "Soles" && f.moneda !== "PEN" ? f.moneda : c.moneda));
  const sobre = (n: number | null) => (n && f.monto ? `, el ${pct((n / f.monto) * 100)} de lo contratado` : "");
  return [
    { etiqueta: "Número", valor: numeroContrato(f.numero) ?? "Sin número" },
    ...(f.codigo ? [{ etiqueta: "Código del contrato", valor: f.codigo, mono: true }] : []),
    ...(f.contratista ? [{ etiqueta: "Contratista", valor: <Nombre p={f.contratista} enlace /> }] : []),
    ...(f.items.length
      ? [{
          etiqueta: (f.itemsTotal ?? f.items.length) > 1 ? "Ítems" : "Ítem",
          valor: f.itemsTotal && f.itemsTotal > f.items.length
            ? `${f.items.join(", ")} y ${plural(f.itemsTotal - f.items.length, "ítem más", "ítems más")}`
            : listaY(f.items.map(String)),
        }]
      : []),
    { etiqueta: "Monto contratado", valor: enMoneda(f.monto), mono: f.monto != null },
    ...(f.fuente === "conosce"
      ? [
          { etiqueta: "Adicionales", valor: f.adicional ? `${enMoneda(f.adicional)}${sobre(f.adicional)}` : "Ninguno" },
          ...(f.reduccion ? [{ etiqueta: "Reducciones", valor: enMoneda(f.reduccion), mono: true }] : []),
          ...(f.prorroga ? [{ etiqueta: "Prórrogas", valor: enMoneda(f.prorroga), mono: true }] : []),
          ...(f.complementario ? [{ etiqueta: "Complementarios", valor: enMoneda(f.complementario), mono: true }] : []),
        ]
      : []),
    { etiqueta: "Firmado", valor: f.firmado ? fecha(f.firmado) : null },
    {
      etiqueta: "Vigencia",
      valor: f.vigenciaDesde || f.vigenciaHasta
        ? `${f.vigenciaDesde ? `Del ${fecha(f.vigenciaDesde)}` : "Hasta"}${f.vigenciaHasta ? `${f.vigenciaDesde ? " al " : " el "}${fecha(f.vigenciaHasta)}` : ""}${f.vigenciaOriginal ? ` (se amplió: iba hasta el ${fecha(f.vigenciaOriginal)})` : ""}`
        : null,
    },
    ...(f.publicado ? [{ etiqueta: "Publicado en el SEACE", valor: fecha(f.publicado) }] : []),
    ...(f.url
      ? [{
          etiqueta: "Documento",
          valor: (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-medium text-granate underline-offset-2 hover:underline">
              Ver el contrato en el SEACE<span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          ),
        }]
      : []),
    { etiqueta: "Fuente", valor: f.fuente === "conosce" ? "CONOSCE (OECE)" : "Registro OCDS (SEACE)" },
  ];
}

function TablaContratos({ firmados, c }: { firmados: ContratoFirmado[]; c: Detalle }) {
  const columnas: Columna[] = [
    { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
    { clave: "firmado", titulo: "Firmado", ancho: "96px", desde: "md", apilar: "con-rotulo" },
    { clave: "monto", titulo: "Contratado", ancho: "132px", alinear: "der", apilar: "con-rotulo" },
  ];
  const filas: (Fila & { buscable: string })[] = firmados.map((f, i) => ({
    id: `contrato-${f.codigo ?? i}-${i}`,
    buscable: `${f.numero ?? ""} ${f.codigo ?? ""} ${f.contratista?.nombre ?? ""}`,
    celdas: {
      contrato: (
        <CeldaPrincipal
          titulo={tituloContrato(f.numero, f.codigo ?? String(i + 1))}
          meta={[
            // Un contrato con muchos ítems los cuenta (la lista va en su detalle): «Ítems 1, 2, … 79» no se leía.
            f.items.length > 0 && (
              <Dato key="i" icono={Package} nombre="Ítems">
                {(f.itemsTotal ?? f.items.length) > 8
                  ? plural(f.itemsTotal ?? f.items.length, "ítem", "ítems")
                  : f.items.length > 1 ? `Ítems ${listaY(f.items.map(String))}` : `Ítem ${f.items[0]}`}
              </Dato>
            ),
            f.contratista && <Dato key="k" icono={UserRound} nombre="Contratista"><Nombre p={f.contratista} /></Dato>,
            f.codigo && <Dato key="c" icono={Hash} nombre="Código del contrato" mono>{f.codigo}</Dato>,
          ]}
        />
      ),
      // Con el año: los contratos de un proceso se firman a veces en años distintos.
      firmado: f.firmado ? <CeldaTexto>{fechaConAnio(f.firmado)}</CeldaTexto> : undefined,
      monto: f.monto != null
        ? <CeldaNumero sub={f.adicional ? `+${soles(f.adicional)} adicionales` : undefined}>{monto(f.monto, c.moneda)}</CeldaNumero>
        : undefined,
    },
    detalle: {
      titulo: tituloContrato(f.numero, f.codigo ?? String(i + 1)),
      contenido: <CuerpoDetalle><DatosClave items={datosContrato(f, c)} /></CuerpoDetalle>,
    },
  }));
  // Muchos contratos (una compra corporativa): paginados y con buscador; pocos, la tabla entera.
  return filas.length > 25 ? (
    <TablaPaginada
      columnas={columnas}
      filas={filas}
      etiqueta="Contratos firmados del proceso"
      tam={25}
      nombre="contratos"
      buscar={{ placeholder: "Buscar por número, código o contratista…", etiqueta: "Buscar entre los contratos firmados" }}
      medida="contenedor"
    />
  ) : (
    <Tabla columnas={columnas} filas={filas} etiqueta="Contratos firmados del proceso" medida="contenedor" />
  );
}

/**
 * El presupuesto del proyecto de inversión (CUI) en la entidad, según el MEF: lo que tiene para gastar (PIM) y lo que ya
 * devengó. El gasto es el del MEF, no lo adjudicado. Con lo que declara el registro OCDS (fuente y monto presupuestado).
 */
function BloquePresupuesto({ c }: { c: Detalle }) {
  const p = c.presupuesto!;
  const datos: DatoClave[] = [
    ...(p.proyecto ? [{ etiqueta: "Proyecto", valor: oracion(p.proyecto) }] : []),
    ...(p.cui
      ? [{
          etiqueta: "CUI",
          ayuda: <AyudaTermino clave="cui" />,
          valor: (
            <span>
              {/* El CUI abre el seguimiento de la inversión en el MEF. */}
              <EnlaceFuente href={inversionSsi(p.cui)} className="font-mono tabular-nums">{p.cui}</EnlaceFuente>
              <span className="ml-1.5 text-meta text-mute">{p.cuiOrigen === "descripcion" ? "leído de la descripción del proceso y confirmado en el MEF" : "según el registro OCDS"}</span>
            </span>
          ),
        }]
      : []),
    ...(p.fuente ? [{ etiqueta: "Financiamiento", valor: `${oracion(p.fuente)} (registro OCDS)` }] : []),
    ...(p.monto != null ? [{ etiqueta: "Monto presupuestado", valor: `${monto(p.monto, c.moneda)} (registro OCDS)` }] : []),
  ];
  const ultimo = [...p.mef].sort((a, b) => b.anio - a.anio)[0];
  const mef: Cifra[] = ultimo
    ? [
        { valor: ultimo.pim != null ? solesCompacto(ultimo.pim) : null, etiqueta: `PIM ${ultimo.anio}`, ayuda: <AyudaTermino clave="pim" />, contexto: ultimo.pia != null ? `PIA ${soles(ultimo.pia)}` : "lo que tiene para gastar este año" },
        {
          valor: ultimo.devengado != null ? solesCompacto(ultimo.devengado) : null,
          etiqueta: `devengado ${ultimo.anio}`,
          ayuda: <AyudaTermino clave="devengado" />,
          contexto: ultimo.devengado != null && ultimo.pim ? `${pct((ultimo.devengado / ultimo.pim) * 100)} del PIM` : undefined,
        },
      ]
    : [];
  const anteriores = p.mef.filter((x) => x !== ultimo).sort((a, b) => b.anio - a.anio);
  return (
    <section aria-labelledby="presupuesto-titulo" className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex items-center gap-1">
        <h3 id="presupuesto-titulo" className="font-display text-bloque font-bold text-ink">Presupuesto del proyecto</h3>
        <Ayuda titulo="¿Qué presupuesto es?">
          El del proyecto de inversión en la entidad que contrata, según el MEF: lo que tiene para gastar en el año (PIM) y lo
          que ya devengó. Es el gasto del proyecto entero, no sólo de este contrato.
        </Ayuda>
      </div>
      {mef.length > 0 && <CifrasEnFila items={mef} chico />}
      {anteriores.length > 0 && (
        <DatosClave
          items={anteriores.map((x) => ({
            etiqueta: `En ${x.anio}`,
            valor: `PIM ${x.pim != null ? soles(x.pim) : "sin dato"}, devengado ${x.devengado != null ? soles(x.devengado) : "sin dato"}`,
          }))}
        />
      )}
      {datos.length > 0 && <DatosClave items={datos} />}
      {p.cui && !p.mef.length && (
        <EstadoVacio variante="compacta">El MEF no registra este CUI en el presupuesto de la entidad desde el año de la convocatoria.</EstadoVacio>
      )}
      <FuenteDato
        fuente={p.mef.length ? "MEF, Datos Abiertos (presupuesto y ejecución de gasto) y el registro OCDS" : OCDS}
        enlaces={[
          ...(p.cui ? [{ texto: `La inversión ${p.cui} en el seguimiento del MEF`, href: inversionSsi(p.cui) }] : []),
          ...(p.mef.length
            ? [{ texto: "Presupuesto y ejecución (Datos Abiertos del MEF)", href: DATASET_MEF }, { texto: "Consulta Amigable (MEF)", href: CONSULTA_AMIGABLE }]
            : []),
          ...enlacesProceso(c.ocid, { codigo: c.codigo }),
        ]}
      />
    </section>
  );
}

// ─── Cronograma ──────────────────────────────────────────────────────────────

/** Qué pasó en cada hito, en palabras. */
function textoHito(h: HitoProceso): string {
  switch (h.clave) {
    case "convocatoria": return "Se publicó la convocatoria";
    case "consultas": return "Plazo de consultas y observaciones";
    case "documentos": {
      const ds = h.documentos ?? [];
      return ds.length === 1 ? `Se publicó: ${ds[0].titulo ?? "un documento"}` : `Se publicaron ${numero(ds.length)} documentos`;
    }
    case "ofertas": return "Presentación de ofertas";
    case "buena_pro": return "Buena pro";
    case "consentimiento": return "La buena pro quedó consentida";
    case "contrato": return h.contratos && h.contratos.length > 1 ? "Se firmaron los contratos" : "Se firmó el contrato";
    case "vigencia": return "Vigencia del contrato";
  }
}

const DIA_MS = 86_400_000;
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS);

function SeccionCronograma({ c }: { c: Detalle }) {
  const hitos = c.cronograma ?? [];
  const conv = c.fecha?.slice(0, 10) ?? null;
  const columnas: Columna[] = [
    { clave: "fecha", titulo: "Fecha", ancho: "112px" },
    { clave: "hito", titulo: "Qué pasó", ancho: "minmax(0,1fr)" },
    { clave: "fuente", titulo: "Fuente", ancho: "168px", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: Fila[] = hitos.map((h, i) => {
    const despues = conv && h.fecha > conv ? dias(conv, h.fecha) : null;
    const docs = h.documentos ?? [];
    return {
      id: `${h.clave}-${h.fecha}-${i}`,
      celdas: {
        // Con el año: un cronograma cruza de un año a otro (la convocatoria en diciembre, el contrato en enero).
        fecha: <CeldaTexto sub={h.hasta ? `al ${fechaConAnio(h.hasta)}` : undefined}>{fechaConAnio(h.fecha)}</CeldaTexto>,
        hito: (
          <CeldaPrincipal
            titulo={textoHito(h)}
            dosLineas
            meta={[
              h.clave === "ofertas" && h.n != null && <Dato key="n" tipo="personas" nombre="Ofertas">{plural(h.n, "presentó oferta", "presentaron oferta")}</Dato>,
              (h.clave === "contrato" || h.clave === "vigencia") && h.contratos?.length && (
                <Dato key="k" icono={FileText} nombre="Contrato">{listaY(h.contratos.map((x) => tituloContrato(x)))}</Dato>
              ),
              h.clave === "documentos" && docs.length > 1 && <Dato key="d" tipo="documento" nombre="Documentos">{listaY(docs.map((d) => d.titulo ?? "sin título"))}</Dato>,
              despues != null && h.clave !== "vigencia" && <Dato key="t" icono={Clock} nombre="Desde la convocatoria">{`a ${plural(despues, "día", "días")} de la convocatoria`}</Dato>,
            ]}
          />
        ),
        fuente: (
          <span className="block min-w-0">
            {h.fuentes.map((f) => <span key={f} className="block truncate text-meta text-inkSoft">{FUENTE_HITO[f]}</span>)}
          </span>
        ),
      },
      buscable: [textoHito(h), ...docs.map((d) => d.titulo), ...(h.contratos ?? [])].filter(Boolean).join(" "),
    };
  });
  return (
    <>
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿De dónde sale cada fecha?">
            <span className="block">
              Del registro OCDS (la convocatoria, el plazo de consultas, la buena pro), de CONOSCE (las ofertas, la buena pro,
              su consentimiento y el contrato) y de la fecha en que cada documento se publicó en el SEACE.
            </span>
            <span className="mt-2 block">Nada se estima: una fecha que ningún registro publica no aparece.</span>
          </Ayuda>
        }
      >
        Lo que pasó en el proceso y cuándo, de la convocatoria al contrato, con la fuente de cada fecha.
      </CabeceraPestana>
      <TablaPaginada
        columnas={columnas}
        filas={filas}
        etiqueta="Hitos del proceso con su fecha y su fuente"
        nombre="hitos"
        tam={25}
        medida="contenedor"
        buscar={{ placeholder: "Buscar un hito o un documento…", etiqueta: "Buscar en el cronograma" }}
      />
      <FuenteDato fuente="registro OCDS del OECE, CONOSCE y los documentos del SEACE" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo, conosce: true })} className="mt-2" />
    </>
  );
}

