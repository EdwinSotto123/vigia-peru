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
import Link from "next/link";
import { PersonName, Ruc } from "@/components/Redact";
import { Ayuda, BloqueDetalle, CabeceraPestana, ChipsDetalle, CuerpoDetalle, DatosClave, FuenteDato, type DatoClave, type Pestana } from "@/components/patrones";
import { enlacesProceso } from "@/lib/fuentes";
import { enlaceProveedor } from "@/lib/empresas";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, ListaPaginada, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { ChevronDown, CircleDot, Clock, Coins, FolderOpen, HardDrive, Info, ListOrdered, Package, Tag } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { DocumentosContrato } from "./DocumentosContrato";
import { CitaPagina } from "./CitaPagina";
import { TextoRedactado } from "./TextoRedactado";
import { etiquetaRegla, type CatalogoReglas } from "@/lib/revision";
import { decimal, fecha, numero, porcentaje, soles, oracion } from "@/lib/formato";
import {
  cambioDeGanador, esPersonaNatural, formatoDoc, humanizarCodigo, ordenNombrePostor, personasNaturalesDe, tipoDocLabel,
  type CitaDocumento, type ContratoDetalle as Detalle, type ContratoDocumento, type PostorContrato,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";
import { Partes } from "@/components/ui/Partes";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { DesgloseItems } from "./ItemsDocumento";
import { SeccionPerfil, cuentaPerfil } from "./PerfilContratista";

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
    { clave: "items", etiqueta: "Ítems", conteo: Math.max(c.items.length, c.itemsDocumento?.filas.length ?? 0), contenido: <SeccionItems c={c} /> },
    // Lo que las bases le pedían a quien quisiera ganar (ficha de las bases leída por pieza): entre lo que se compró y quién
    // ofertó.
    !!c.perfilContratista && {
      clave: "perfil",
      etiqueta: "Perfil del contratista",
      conteo: cuentaPerfil(c.perfilContratista),
      contenido: <SeccionPerfil c={c} />,
    },
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

/** Ítems con precio unitario: contratado según CONOSCE, o leído del expediente (contratado u ofertado). */
const itemsConPrecio = (c: Detalle) =>
  (c.itemsAnalizados ?? []).filter((it) => it.precioUnitarioConosce != null || it.precioUnitarioContratado != null || it.precioUnitarioOfertado != null);

/** Señales del dictamen con al menos una cita a una página del expediente. */
const senalesConCita = (c: Detalle) => (c.alerta?.banderas ?? []).filter((b) => (b.citas?.length ?? 0) > 0);

// ─── Secciones de evidencia ──────────────────────────────────────────────────

function SeccionItems({ c }: { c: Detalle }) {
  // El SEACE registra a veces un paquete (diez lubricantes) como UN ítem de «1 unidad»: su precio «por unidad» es el del
  // paquete entero y compararlo con lo que otras entidades pagan por un producto daba «311 veces la mediana». Con el
  // desglose de los documentos a la vista, esa comparación no se muestra.
  const paquete = (c.itemsDocumento?.filas.length ?? 0) > c.items.length;
  const conEstado = c.items.some((it) => it.estado);
  const conPrecio = c.items.some((it) => it.precio && (it.precio.unitarioAdjudicado != null || it.precio.unitarioReferencial != null));
  // Con precios, la columna central de la ficha (~600 px) no entra con todo: el estado, la cantidad y el valor referencial
  // pasan a la línea de abajo del ítem y quedan el precio por unidad y la comparación.
  const columnas: Columna[] = [
    ...(conEstado && !conPrecio ? [{ clave: "estado", titulo: "Estado", ancho: "120px", desde: "md" } satisfies Columna] : []),
    { clave: "item", titulo: "Ítem", ancho: "minmax(0,1fr)" },
    ...(conPrecio ? [] : [
      { clave: "cantidad", titulo: "Cantidad", ancho: "120px", alinear: "der", desde: "lg" } satisfies Columna,
      { clave: "monto", titulo: "Valor referencial", ancho: "140px", alinear: "der" } satisfies Columna,
    ]),
    ...(conPrecio ? [
      { clave: "unitario", titulo: "Por unidad", ancho: "112px", alinear: "der" } satisfies Columna,
      {
        clave: "frente", titulo: "Frente a otras entidades", ancho: "172px", desde: "md",
        ayuda: (
          <Ayuda titulo="¿Contra qué se compara?">
            Contra lo que pagaron otras entidades del Estado por el mismo código CUBSO y la misma unidad, ese año y el anterior
            (desde 5 entidades). La franja es el rango habitual (del 25 % al 75 % de esas compras) y la raya, la mediana.
            Si el ítem ya se adjudicó, se compara lo pagado; si no, lo presupuestado contra lo que presupuestan las demás.
          </Ayuda>
        ),
      } satisfies Columna,
    ] : []),
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
              <Partes
                partes={[
                  <Dato key="n" icono={ListOrdered} nombre="Número de ítem">Ítem {it.posicion}</Dato>,
                  it.cubso && <Dato key="cubso" icono={Tag} nombre="Código CUBSO">CUBSO <span className="font-mono tabular-nums">{it.cubso}</span></Dato>,
                  // Debajo de lg la columna Cantidad no entra (con precios, nunca): la cantidad va en la meta.
                  cantidad && <Dato key="cant" icono={Package} nombre="Cantidad" className={conPrecio ? undefined : "lg:hidden"}>{cantidad}</Dato>,
                  conPrecio && it.montoPen != null && <Dato key="ref" icono={Coins} nombre="Valor referencial">{monto(it.montoPen, c.moneda)} referencial</Dato>,
                  conPrecio && it.estado && <Dato key="estado" icono={CircleDot} nombre="Estado">{humanizarCodigo(it.estado)}</Dato>,
                ]}
              />
            }
          />
        ),
        cantidad: it.cantidad != null ? <CeldaNumero sub={it.unidad ?? undefined}>{numero(it.cantidad)}</CeldaNumero> : undefined,
        monto: it.montoPen ? <CeldaNumero>{monto(it.montoPen, c.moneda)}</CeldaNumero> : undefined,
        unitario: it.precio ? <PrecioUnidad p={it.precio} unidad={it.unidad} /> : undefined,
        frente: paquete && it.precio
          ? <span className="text-rotulo text-mute">Un paquete de {numero(c.itemsDocumento!.filas.length)} renglones: no se compara por unidad</span>
          : it.precio?.comparacion ? <FrenteOtras p={it.precio} /> : it.precio ? <span className="text-rotulo text-mute">Sin con qué comparar</span> : undefined,
      },
      buscable: [it.descripcion, `item ${it.posicion}`, it.cubso && `cubso ${it.cubso}`, it.estado && humanizarCodigo(it.estado)].filter(Boolean).join(" "),
    };
  });
  const desglose = (c.itemsDocumento?.filas.length ?? 0) > 0;
  return (
    <>
      <CabeceraPestana>
        {desglose
          ? "Lo que se compró, renglón por renglón según las bases y el contrato, y debajo cómo lo registra el SEACE."
          : "Lo que se compra, ítem por ítem, con su cantidad y su valor referencial."}
      </CabeceraPestana>
      {desglose && <DesgloseItems c={c} />}
      {desglose && <h3 className="mt-5 font-display text-bloque font-bold text-ink">Como lo registra el SEACE</h3>}
      {c.items.length ? (
        <TablaPaginada
          columnas={columnas}
          filas={filas}
          etiqueta="Ítems del proceso según el registro OCDS"
          nombre="ítems"
          tam={20}
          buscar={{ placeholder: "Buscar en los ítems por descripción o CUBSO…", etiqueta: "Buscar en los ítems del proceso" }}
        />
      ) : (
        <Vacio>El registro OCDS no trae ítems para este proceso.</Vacio>
      )}
      <FuenteDato fuente={OCDS} enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })} className="mt-2" />
    </>
  );
}

/** Precio por unidad del ítem: el adjudicado si lo hay (con el presupuestado debajo) o el presupuestado. */
function PrecioUnidad({ p, unidad }: { p: NonNullable<Detalle["items"][number]["precio"]>; unidad: string | null }) {
  const u = unidad ? `por ${unidad.toLowerCase()}` : undefined;
  if (p.unitarioAdjudicado != null) {
    return <CeldaNumero sub={p.unitarioReferencial != null ? `presupuesto ${soles(p.unitarioReferencial)}` : u}>{soles(p.unitarioAdjudicado)}</CeldaNumero>;
  }
  return p.unitarioReferencial != null ? <CeldaNumero sub={`presupuestado${u ? ` ${u}` : ""}`}>{soles(p.unitarioReferencial)}</CeldaNumero> : null;
}

/**
 * Dónde cae el precio del ítem frente a las demás entidades: la franja va del p25 al p75, la raya es la mediana y el
 * punto, este ítem. Escala logarítmica: un precio 10 veces mayor no aplasta la franja. El color del punto sigue la
 * razón con la mediana (hasta 1.5, tinta; desde 1.5, ámbar; desde 3, carmesí) y siempre va con el texto.
 */
function FrenteOtras({ p }: { p: NonNullable<Detalle["items"][number]["precio"]> }) {
  const k = p.comparacion!;
  const precio = k.base === "adjudicado" ? p.unitarioAdjudicado : p.unitarioReferencial;
  if (precio == null || !k.mediana) return null;
  const p25 = k.p25 ?? k.mediana, p75 = k.p75 ?? k.mediana;
  const min = Math.min(p25, precio) / 1.6, max = Math.max(p75, precio) * 1.6;
  const W = 150, x = (v: number) => (Math.log(v / min) / Math.log(max / min)) * W;
  const r = k.razon ?? precio / k.mediana;
  const tono = r >= 3 ? "fill-crimson" : r >= 1.5 ? "fill-amber" : "fill-ink";
  const texto = r >= 1.15 ? `${r.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces la mediana`
    : r <= 0.87 ? `${Math.round((1 - r) * 100)} % bajo la mediana` : "en la mediana";
  return (
    <span className="block">
      <svg viewBox={`-4 0 ${W + 8} 14`} width={W + 8} height={14} role="img" aria-label={`${texto}; mediana ${soles(k.mediana)}`} className="block">
        <line x1={0} x2={W} y1={7} y2={7} className="stroke-line" strokeWidth={1} />
        <rect x={x(p25)} y={3} width={Math.max(2, x(p75) - x(p25))} height={8} rx={2} className="fill-paperEdge" />
        <line x1={x(k.mediana)} x2={x(k.mediana)} y1={1} y2={13} className="stroke-mute" strokeWidth={1.5} />
        <circle cx={x(precio)} cy={7} r={4.5} className={`${tono} stroke-paper`} strokeWidth={1.5} />
      </svg>
      <span className="mt-0.5 block text-rotulo text-mute">
        {texto} de lo {k.base === "adjudicado" ? "pagado" : "presupuestado"} en {numero(k.entidades)} entidades
      </span>
    </span>
  );
}

/** Postores y ofertas, leídos de las actas del expediente. El ganador va primero y resaltado. */
function SeccionPostores({ c, enRevision }: { c: Detalle; enRevision: boolean }) {
  const postores = c.postoresDetalle ?? [];
  const conItem = c.items.length > 1;
  // Con el acta o cuadro leído por pieza (lector «evaluacion»): el puntaje con su desglose.
  const conPuntaje = postores.some((p) => p.puntajeFinal != null || p.puntajeTotal != null);
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
    ...(conPuntaje ? [{
      clave: "puntaje",
      titulo: "Puntaje",
      ancho: "128px",
      alinear: "der",
      desde: "md",
      ayuda: (
        <Ayuda titulo="¿Cómo se lee el puntaje?">
          El puntaje final del acta. Debajo, de dónde sale: lo que dio el precio, lo que dieron los demás factores y la bonificación
          (por ejemplo, 5 % a la micro y pequeña empresa). Gana el puntaje final más alto.
        </Ayuda>
      ),
    } satisfies Columna] : []),
    {
      clave: "fuente",
      titulo: "Fuente",
      ancho: "88px",
      desde: "lg",
      ayuda: <Ayuda titulo="¿Qué abre la fuente?">La página del acta o del cuadro comparativo donde se leyó la oferta.</Ayuda>,
    },
  ];
  const ordenados = [...postores].sort((a, b) => Number(b.esGanador) - Number(a.esGanador) || (a.ordenPrelacion ?? 99) - (b.ordenPrelacion ?? 99));
  // Si la buena pro pasó a otro postor (OCDS + CONOSCE), el "ganador" del acta no es con quien se contrató.
  const cambio = cambioDeGanador(c);
  const rucsQuedan = new Set((cambio?.queda ?? []).map((a) => a.proveedorRuc));
  // Por qué quedó fuera cada postor: el registro del proceso casi nunca lo trae (salía «Sin dato»), pero la lectura del
  // acta sí (banderas «acta_*», `detalle.fuera`: nombre, RUC y motivo). El acta casi nunca trae el RUC y escribe el nombre
  // a su modo («E.I.R.L.» / «EIRL»): se une por RUC o, si no, por las palabras propias del nombre (sin la forma
  // societaria), y SÓLO cuando el calce es de uno a uno. Antes bastaban los primeros 18 caracteres («INVERSIONES Y
  // SERVICIOS GENERALES ALFA» recibía el motivo de «… BETA») o que quedara fuera uno solo (un segundo puesto válido
  // recibía el motivo de otro): atribuir un motivo a la empresa equivocada es peor que no mostrarlo (auditoría 11-13).
  const RELLENO = new Set(["SAC", "SAA", "SRL", "EIRL", "SOCIEDAD", "ANONIMA", "CERRADA", "ABIERTA", "EMPRESA", "INDIVIDUAL", "RESPONSABILIDAD", "LIMITADA", "COMERCIAL", "DEL", "LOS", "LAS", "POR"]);
  const palabras = (s: string): string[] =>
    [...new Set(s.toUpperCase().normalize("NFD").replace(/[^A-Z0-9 ]/g, (ch) => (/[.'’]/.test(ch) ? "" : " ")).split(/\s+/).filter((w) => w.length >= 3 && !RELLENO.has(w)))].sort();
  const mismoNombre = (a: string[], b: string[]): boolean => {
    if (!a.length || !b.length) return false;
    const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
    // Iguales, o el más corto (desde 2 palabras propias) entero dentro del otro: «CONSORCIO VIAL NORTE» y «VIAL NORTE».
    return (corto.length === largo.length || corto.length >= 2) && corto.every((w) => largo.includes(w));
  };
  const fueraActa: { ruc: string | null; nombre: string[]; motivo: string }[] = [];
  for (const x of c.cruces ?? []) {
    if (!x.tipo.startsWith("acta_")) continue;
    const fuera = (x.detalle as { fuera?: unknown })?.fuera;
    if (!Array.isArray(fuera)) continue;
    for (const f of fuera as { ruc?: string | null; nombre?: string | null; motivo?: string | null }[]) {
      const m = typeof f?.motivo === "string" ? f.motivo.trim() : "";
      const nombre = palabras(f?.nombre ?? "");
      // Dos postores pueden quedar fuera por el mismo motivo: son dos renglones, no uno.
      if (m && !fueraActa.some((y) => y.motivo === m && y.nombre.join(" ") === nombre.join(" "))) fueraActa.push({ ruc: f.ruc ?? null, nombre, motivo: m });
    }
  }
  const nombresExcluidos = [...new Set(postores.filter((p) => !p.esGanador).map((p) => palabras(p.razonSocial ?? "").join(" ")))].map((s) => s.split(" ").filter(Boolean));
  const motivoDe = (p: { ruc?: string | null; razonSocial?: string | null; motivoEstado?: string | null; esGanador?: boolean }): string | null => {
    const propio = humanizarCodigo(p.motivoEstado);
    if (propio) return propio;
    if (p.esGanador || !fueraActa.length) return null;
    const porRuc = p.ruc ? fueraActa.find((y) => y.ruc === p.ruc) : undefined;
    if (porRuc) return porRuc.motivo;
    const n = palabras(p.razonSocial ?? "");
    const candidatos = fueraActa.filter((y) => !y.ruc && mismoNombre(y.nombre, n));
    // De uno a uno: un solo renglón del acta calza con este postor y ese renglón no calza con ningún otro postor.
    if (candidatos.length !== 1) return null;
    return nombresExcluidos.filter((o) => mismoNombre(candidatos[0].nombre, o)).length === 1 ? candidatos[0].motivo : null;
  };
  const personasPostores = personasNaturalesDe(c);
  const filas: Fila[] = ordenados.map((p, i) => {
    const ref = referenciaDe(p, c);
    const dif = hayReferencia && p.montoOferta != null && ref ? ((p.montoOferta - ref) / ref) * 100 : null;
    const oferta = p.montoOferta != null ? monto(p.montoOferta, c.moneda) : null;
    const estado = cambio && p.ruc === cambio.original.proveedorRuc
      ? "No contrató"
      : cambio && p.ruc && rucsQuedan.has(p.ruc)
        ? "Contratado"
        : p.esGanador ? "Ganador" : humanizarCodigo(p.estado);
    // Una empresa (RUC 20) lleva a su ficha: qué más ganó, con quién postula. Una persona natural, nunca (su RUC lleva
    // el DNI y no va en una URL); un consorcio sin RUC propio, tampoco.
    const ficha = enlaceProveedor(p.ruc);
    const nombre = p.razonSocial
      ? esPersonaNatural(p.ruc)
        ? <PersonName name={p.razonSocial} orden={ordenNombrePostor(p.razonSocial, p.ruc, c.proveedor, c.proveedorRuc)} />
        : ficha
          ? <Link href={ficha} prefetch={false} className="text-granate underline-offset-2 hover:underline">{p.razonSocial}</Link>
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
              <Partes
                partes={[
                  p.ordenPrelacion != null && <Dato key="puesto" icono={ListOrdered} nombre="Orden de prelación">Puesto {p.ordenPrelacion}</Dato>,
                  p.ruc && <Dato key="ruc" tipo="ruc">RUC <Ruc value={p.ruc} /></Dato>,
                  p.horaOferta && (
                    <Dato key="hora" icono={Clock} nombre="Hora de su oferta">Ofertó {p.fechaOferta ? `el ${fecha(p.fechaOferta)} ` : ""}a las {p.horaOferta}</Dato>
                  ),
                  p.admitida === false && <Dato key="adm" icono={Info} nombre="Admisión">No admitida</Dato>,
                  p.admitida !== false && p.calificada === false && <Dato key="cal" icono={Info} nombre="Calificación">No calificó</Dato>,
                  conPuntaje && (p.puntajeFinal ?? p.puntajeTotal) != null && (
                    <Dato key="pts" icono={ListOrdered} nombre="Puntaje" className="md:hidden">{pts((p.puntajeFinal ?? p.puntajeTotal)!)} puntos</Dato>
                  ),
                  !p.esGanador && motivoDe(p) && (
                    <Dato key="motivo" icono={Info} nombre="Por qué quedó fuera" className="whitespace-normal">
                      Por qué quedó fuera: <TextoRedactado texto={recortarMotivo(oracion(motivoDe(p)!))} personas={personasPostores} />
                    </Dato>
                  ),
                  oferta && <Dato key="oferta" icono={Coins} nombre="Oferta" className="md:hidden">{oferta}</Dato>,
                ]}
              />
            }
          >
            <span className="font-semibold text-ink">{nombre}</span>
          </CeldaTexto>
        ),
        item: p.item ? <CeldaTexto>{p.item}</CeldaTexto> : undefined,
        oferta: oferta ? <CeldaNumero sub={dif != null ? `${diferencia(dif)} vs. referencia` : undefined}>{oferta}</CeldaNumero> : undefined,
        puntaje: (p.puntajeFinal ?? p.puntajeTotal) != null ? (
          <CeldaNumero
            sub={[
              p.puntajePrecio != null && `precio ${pts(p.puntajePrecio)}`,
              p.puntajeOtros != null && `otros ${pts(p.puntajeOtros)}`,
              p.puntajeOtros == null && p.puntajePrecio != null && p.puntajeTotal != null && p.puntajeTotal !== p.puntajePrecio && `otros ${pts(Math.round((p.puntajeTotal - p.puntajePrecio) * 100) / 100)}`,
              p.bonificacion != null && `bonificación ${pts(p.bonificacion)}`,
            ].filter(Boolean).join(", ") || undefined}
          >
            {pts((p.puntajeFinal ?? p.puntajeTotal)!)}
          </CeldaNumero>
        ) : undefined,
        fuente: p.citas[0] ? <CitaPagina ocid={c.ocid} cita={p.citas[0]} corto /> : <span className="text-rotulo text-mute">Sin cita</span>,
      },
      // Una persona natural no se busca por su nombre ni por su RUC (docs/PRIVACIDAD.md): sólo por su estado.
      buscable: [esPersonaNatural(p.ruc) ? null : p.razonSocial, esPersonaNatural(p.ruc) ? null : p.ruc, estado, motivoDe(p)].filter(Boolean).join(" "),
    };
  });
  return (
    <>
      <CabeceraPestana>Quién presentó oferta, por cuánto y en qué quedó, según las actas del expediente.</CabeceraPestana>
      <ResumenEvaluacion c={c} />
      <TablaPaginada
        columnas={columnas}
        filas={filas}
        etiqueta="Postores con su oferta económica, leídos de las actas del expediente"
        nombre="postores"
        tam={20}
        buscar={{ placeholder: "Buscar un postor por razón social, RUC o estado…", etiqueta: "Buscar en los postores" }}
      />
      <FuenteDato fuente="actas y cuadros comparativos del expediente" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })} className="mt-2" />
    </>
  );
}

/**
 * Lo que el acta o cuadro de evaluación leído por pieza deja ver arriba de la tabla: si la oferta más baja perdió (y por
 * cuánto, con la bonificación que lo decidió) y con qué factores se puntuó. Neutro: la bonificación a la micro y pequeña
 * empresa es legal; es un dato para leer, no una señal.
 */
function ResumenEvaluacion({ c }: { c: Detalle }) {
  const ev = c.evaluacion;
  if (!ev || (!ev.masBajaPerdio && !ev.factores.length)) return null;
  const m = ev.masBajaPerdio;
  const pn = (n: { ruc: string | null; nombre: string | null }) =>
    n.nombre ? (esPersonaNatural(n.ruc) ? <PersonName name={n.nombre} /> : <b>{n.nombre}</b>) : "un postor";
  const total = ev.factores.reduce((s, f) => s + (f.puntajeMaximo ?? 0), 0);
  return (
    <div className="mb-3 space-y-2 rounded-2xl border border-line bg-paper px-4 py-3 text-dato leading-relaxed text-ink">
      {m && (
        <p>
          La oferta más baja, de {pn(m.masBaja)} por <b>{soles(m.masBaja.monto ?? 0)}</b>
          {m.masBaja.puntajeFinal != null ? ` (${pts(m.masBaja.puntajeFinal)} puntos)` : ""}, no ganó. La buena pro fue a {pn(m.ganador)}, que ofertó{" "}
          <b>{soles(m.ganador.monto ?? 0)}</b>, {porcentaje(m.diferenciaPct, { decimales: 1 })} más ({soles(m.diferenciaSoles)})
          {m.ganador.puntajeFinal != null ? `, y sumó ${pts(m.ganador.puntajeFinal)} puntos` : ""}
          {m.ganador.bonificacion != null ? ` con ${pts(m.ganador.bonificacion)} de bonificación` : ""}.
        </p>
      )}
      {ev.factores.length > 0 && (
        <p className="text-inkSoft">
          Se puntuó con {ev.factores.map((f) => `${f.factor ?? "un factor"}${f.puntajeMaximo != null ? ` (${pts(f.puntajeMaximo)})` : ""}`).join(", ")}
          {total > 0 ? `, ${pts(total)} puntos en total` : ""}.
        </p>
      )}
    </div>
  );
}

/** Un puntaje como lo escribe el acta, con hasta dos decimales: 100,02 frente a 100 decide una buena pro. */
const pts = (n: number) => decimal(n, 2);

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
          Lo que registra CONOSCE para el ítem (monto adjudicado ÷ cantidad); si no, el contrato u orden de compra leída en el
          expediente; si tampoco, lo ofertado por el ganador del acta, marcado así. Si la buena pro pasó a otro postor, debajo
          va lo que había ofertado el primero.
        </Ayuda>
      ),
    },
    { clave: "diferencia", titulo: "Diferencia", ancho: "92px", alinear: "der", desde: "md" },
    { clave: "fuente", titulo: "Fuente", ancho: "88px", desde: "lg" },
  ];
  const filas: Fila[] = items.map((it, i) => {
    const unit = it.precioUnitarioConosce ?? it.precioUnitarioContratado ?? it.precioUnitarioOfertado;
    const d = unit != null && it.referenciaUnitaria ? ((unit - it.referenciaUnitaria) / it.referenciaUnitaria) * 100 : null;
    const deConosce = it.precioUnitarioConosce != null;
    const soloOfertado = !deConosce && it.precioUnitarioContratado == null && it.precioUnitarioOfertado != null;
    // CONOSCE registra otro precio que el que ofertó el ganador del acta: la buena pro pasó a otro postor.
    const otroPostor = deConosce && it.precioUnitarioOfertado != null && Math.abs(it.precioUnitarioOfertado - (unit ?? 0)) > 0.005;
    const origen = soloOfertado
      ? "ofertado"
      : deConosce
        ? otroPostor ? `CONOSCE; el 1.º ofertó ${monto(it.precioUnitarioOfertado!, c.moneda)}` : "CONOSCE"
        : null;
    // En el celular la columna Diferencia no entra: va debajo del precio.
    const sub =
      origen || d != null ? (
        <Partes partes={[origen, d != null && <span key="dif" className="md:hidden">{diferencia(d)}</span>]} />
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
                  <Dato key="n" icono={ListOrdered} nombre="Número de ítem">Ítem {it.numero}</Dato>,
                  it.cantidad != null && <Dato key="cant" icono={Package} nombre="Cantidad">{`${numero(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ""}`}</Dato>,
                  it.marca && <Dato key="marca" icono={Tag} nombre="Marca ofertada">Marca {it.marca}</Dato>,
                ]}
              />
            }
          />
        ),
        referencia: it.referenciaUnitaria != null ? <CeldaNumero>{monto(it.referenciaUnitaria, c.moneda)}</CeldaNumero> : undefined,
        contratado: unit != null ? <CeldaNumero sub={sub}>{monto(unit, c.moneda)}</CeldaNumero> : undefined,
        diferencia: d != null ? <CeldaNumero>{diferencia(d)}</CeldaNumero> : undefined,
        fuente: it.citas[0] ? <CitaPagina ocid={c.ocid} cita={it.citas[0]} corto /> : <span className="text-rotulo text-mute">Sin cita</span>,
      },
      buscable: [it.descripcion, `item ${it.numero}`, it.marca].filter(Boolean).join(" "),
    };
  });
  return (
    <>
      <CabeceraPestana>El precio por unidad de cada ítem frente a su referencia unitaria.</CabeceraPestana>
      <TablaPaginada
        columnas={columnas}
        filas={filas}
        etiqueta="Ítems con su precio unitario ofertado o contratado frente al valor referencial"
        nombre="ítems"
        tam={20}
        buscar={{ placeholder: "Buscar en los ítems por descripción o marca…", etiqueta: "Buscar en los precios por ítem" }}
      />
      <FuenteDato fuente="registro OCDS (referencia), CONOSCE (contratado) y el expediente leído" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo, conosce: true })} className="mt-2" />
    </>
  );
}

/** Dónde dice cada señal en el expediente: evidencia de profundización, no la primera lectura. */
function SeccionCitas({ c, senales, catalogo }: { c: Detalle; senales: ReturnType<typeof senalesConCita>; catalogo: CatalogoReglas }) {
  const personas = personasNaturalesDe(c);
  return (
    <>
      <CabeceraPestana>Cada señal del dictamen con las páginas del expediente que la sostienen.</CabeceraPestana>
      {/* Se busca por la señal, no por la evidencia: trae nombres de personas que la página tapa. */}
      <ListaPaginada
        nombre="señales"
        tam={10}
        className="divide-y divide-line rounded-2xl border border-line bg-paper"
        buscar={{ placeholder: "Buscar una señal…", etiqueta: "Buscar en las señales con su página" }}
        items={senales.map((b, i) => ({
          id: `${b.regla}-${i}`,
          buscable: etiquetaRegla(b.regla, catalogo),
          contenido: (
            <div className="px-4 py-3 text-dato leading-5">
              <div className="text-dato font-semibold text-ink">{etiquetaRegla(b.regla, catalogo)}</div>
              {b.evidencia && (
                <p className="mt-0.5 line-clamp-2 text-meta text-inkSoft">
                  <TextoRedactado texto={b.evidencia} personas={personas} />
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {/* recorte: las 4 primeras en la línea; las demás, todas, plegadas debajo (CitasPlegadas) */}
                {(b.citas ?? []).slice(0, 4).map((ct, j) => <CitaPagina key={j} ocid={c.ocid} cita={ct} />)}
              </div>
              <CitasPlegadas c={c} citas={(b.citas ?? []).slice(4)} />
            </div>
          ),
        }))}
      />
      <FuenteDato fuente="documentos del expediente, página por página" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })} className="mt-2" />
    </>
  );
}

/**
 * Las citas de una señal que no entran en la primera línea (pasadas las 4), plegadas pero todas: antes decía «y 6 citas
 * más» y no había cómo verlas. `<details>` nativo: abre sin JavaScript y la ficha sigue siendo de servidor.
 */
function CitasPlegadas({ c, citas }: { c: Detalle; citas: CitaDocumento[] }) {
  if (citas.length === 0) return null;
  const n = citas.length;
  return (
    <details className="group/citas mt-1">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-lg text-rotulo font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
        <span className="group-open/citas:hidden">{n === 1 ? "Ver 1 cita más" : `Ver ${numero(n)} citas más`}</span>
        <span className="hidden group-open/citas:inline">{n === 1 ? "Ocultar la otra cita" : "Ocultar las otras citas"}</span>
        <ChevronDown size={14} aria-hidden className="shrink-0 transition-transform duration-rapido group-open/citas:rotate-180" />
      </summary>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {citas.map((ct, j) => (
          <CitaPagina key={j} ocid={c.ocid} cita={ct} />
        ))}
      </div>
    </details>
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
        : "Sin copia en Vigía: se descargan cuando se lee a fondo."
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
          <CeldaPrincipal
            titulo={titulo}
            meta={[
              seccion && <Dato key="parte" icono={FolderOpen} nombre="Parte del expediente">{seccion === "contrato" ? "Del contrato" : `De la ${seccion}`}</Dato>,
              formatoDoc(d.formato) && <Dato key="formato" tipo="documento" nombre="Formato">{formatoDoc(d.formato)!.toUpperCase()}</Dato>,
              d.enVigia && <Dato key="copia" icono={HardDrive} nombre="Copia">Copia en Vigía</Dato>,
            ]}
          />
        ),
        fecha: <CeldaFecha fecha={dia(d.fecha)} />,
      },
      detalle: {
        titulo,
        etiqueta: `Abrir ${titulo}`,
        descripcion: tipoDocLabel(d.tipo),
        contenido: <DetalleDocumento c={c} d={d} parte={seccion} />,
      },
      buscable: [titulo, tipoDocLabel(d.tipo), formatoDoc(d.formato), seccion].filter(Boolean).join(" "),
    };
  });
  return (
    <>
      <CabeceraPestana>Los documentos que el SEACE publica de este proceso.{nota ? ` ${nota}` : ""}</CabeceraPestana>
      {docs.length ? (
        <TablaPaginada
          columnas={columnas}
          filas={filas}
          etiqueta="Documentos oficiales del proceso"
          nombre="documentos"
          tam={20}
          buscar={{ placeholder: "Buscar un documento por nombre o tipo…", etiqueta: "Buscar en los documentos del proceso" }}
        />
      ) : (
        <Vacio>El registro no publica documentos para este proceso.</Vacio>
      )}
      <FuenteDato fuente="SEACE (OECE)" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })} className="mt-2" />
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
  return <VacioEnLinea variante="compacta">{children}</VacioEnLinea>;
}

/** El motivo del acta en una o dos oraciones: hasta 220 caracteres, cortado en una palabra. */
function recortarMotivo(m: string): string {
  const s = m.replace(/\s+/g, " ").trim();
  if (s.length <= 220) return s;
  return `${s.slice(0, 220).replace(/\s+\S*$/, "")}…`;
}
