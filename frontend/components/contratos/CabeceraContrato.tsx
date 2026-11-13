/**
 * La cabecera ÚNICA de la página de un contrato, igual en sus tres vistas (ficha, dictamen y cómo se leyó). Pedido del
 * 2026-11-13 (auditoría visual completa): la ficha y el dictamen tenían cada uno su cabecera, con un selector
 * «Ficha / Dictamen» encima de todo, y las mismas cifras dichas de otra forma en cada una (señales 5 y 4, puntaje 100 y
 * 105). Ahora, en este orden:
 *   ruta (y «Ver en el OECE», «Compartir») → título corto (el objeto, recortado; entero en el cuerpo) con quién compra,
 *   dónde y quién ganó → estado (tipo, etapa, lectura y riesgo) → banderas (las señales de la lectura o, sin lectura,
 *   los antecedentes de quien ganó) → cifras en una caja (cuánto, cuándo, cuántos compitieron y el puntaje).
 * Debajo, la página pone las vistas en pestañas (VistasContrato).
 *
 * Las señales y el puntaje salen de `lecturaDelContrato` (una sola cuenta para toda la página). Server component.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, ExternalLink, Hash, Info, MapPin, ShieldAlert, Trophy } from "lucide-react";
import { BanderasFicha, EncabezadoPagina, FuenteDato, Ayuda, AyudaTermino, Migas, type BanderaFicha, type Miga } from "@/components/patrones";
import { AyudaPuntaje } from "@/components/patrones/AyudaPuntaje";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { BanderaDato } from "@/components/ui/BanderaDato";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { PersonName } from "@/components/Redact";
import { Compartir } from "@/components/convocatoria/sections/IdentidadDossier";
import { reglaLabel } from "@/lib/auditoria";
import { busquedaOece, enlacesProceso, procesoOece } from "@/lib/fuentes";
import { motivoDudoso } from "@/lib/datoDudoso";
import { enlaceProveedor } from "@/lib/empresas";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { fechaConAnio, listaY, numero, oracion, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import {
  adjudicacionesVigentes, cambioDeGanador, esCodigoConsorcio, esPersonaNatural, etapaLabel, tipoLabel,
  type ContratoDetalle as Detalle,
} from "@/lib/contratos";
import { EstadoContratoPill } from "./ContratosLista";
import { AvisoContrato } from "./DatoDudosoContrato";
import { banderasAntecedentes } from "./CrucesProveedor";
import { monto } from "./EvidenciaContrato";
import { fechaGano } from "./LineaTiempoProceso";
import { PartidoQueGobierna } from "./PartidoQueGobierna";
import { limpiarObjeto, recortar } from "./recortar";
import type { LecturaContrato } from "./lecturaContrato";

/** Hasta cuántos caracteres va el objeto en el título: más largo, se recorta y va entero en el cuerpo (`objetoLargo`). */
export const TOPE_TITULO = 110;

/** El objeto del contrato tal como lo publica el SEACE, limpio y en oración. */
export const objetoDe = (c: Pick<Detalle, "titulo">) => (c.titulo ? oracion(limpiarObjeto(c.titulo)) : null);

/** El objeto entero, si el título lo recortó: el cuerpo lo muestra (Datos del proceso, la columna del dictamen). */
export const objetoLargo = (c: Pick<Detalle, "titulo">) => {
  const o = objetoDe(c);
  return o && o.length > TOPE_TITULO ? o : null;
};

export function CabeceraContrato({
  c,
  lectura,
  migas,
  ruta,
  dudoso = true,
}: {
  c: Detalle;
  lectura: LecturaContrato | null;
  migas: Miga[];
  /** La pestaña abierta de la vista, para el último paso de la ruta (Migas). */
  ruta?: { param: string; primera: string; activa?: string; etiquetas: Record<string, string> };
  /** El aviso del dato dudoso y el del cambio de ganador (lo que explica cifras que no cuadran). */
  dudoso?: boolean;
}) {
  const objeto = objetoDe(c);
  const titulo = objeto ? recortar(objeto, TOPE_TITULO) : "Contrato sin objeto registrado";
  const cambio = cambioDeGanador(c);
  const enRevision = c.alerta?.estado === "revision";
  const cifras = cifrasDe(c, lectura);
  const banderas = banderasDe(c, lectura);
  const estado = (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tipo, etapa y estado de la lectura">
      <li><span className="pill border-transparent bg-paperDeep text-ink">{tipoLabel(c.tipo) ?? "Tipo sin clasificar"}</span></li>
      <li><span className="pill border-line text-inkSoft">{etapaLabel(c.etapa) ?? "Etapa sin clasificar"}</span></li>
      {c.modalidad && <li><span className="pill border-line text-inkSoft">{c.modalidad}</span></li>}
      <li>{enRevision ? <EstadoPill estado="revision" /> : <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />}</li>
      {lectura && <li><ChipRiesgo lectura={lectura} /></li>}
      {motivoDudoso(c.datoDudoso?.motivo) && <li><BanderaDato motivo={motivoDudoso(c.datoDudoso?.motivo)!} fuente="oece_ocds" /></li>}
    </ul>
  );
  const accion =
    "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-rotulo font-semibold text-ink transition-colors duration-rapido hover:bg-paperDeep";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* Con la clave de la vista: Migas guarda la pestaña abierta en su estado y cada vista tiene las suyas. */}
        <Migas key={ruta?.param ?? "sin-pestanas"} items={migas} pestanas={ruta} />
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <a href={c.ocid ? procesoOece(c.ocid) : busquedaOece(c.codigo)} target="_blank" rel="noreferrer" className={accion}>
            <ExternalLink size={13} aria-hidden /> Ver en el OECE
          </a>
          <Compartir codigo={c.ocid} objeto={objeto} ficha={!lectura} />
        </div>
      </div>

      {/* Con banderas, el estado va bajo el título (EncabezadoPagina lo pone en la columna izquierda, junto al panel de
          banderas); sin ellas, debajo del encabezado (si no, quedaba a la derecha, lejos del título). */}
      <EncabezadoPagina
        titulo={titulo}
        bajada={<Identidad c={c} />}
        acciones={banderas.lista.length ? estado : undefined}
        banderas={banderas.lista.length ? <BanderasFicha etiqueta={banderas.etiqueta} banderas={banderas.lista} /> : undefined}
      />
      {!banderas.lista.length && estado}

      {/* Las cifras en una caja con una celda por cifra (la franja de CifrasEnFila); lo que el registro no trae, nombrado
          en una línea debajo (antes, tarjetas que decían «Sin dato»). */}
      <div className="space-y-2">
        {cifras.items.length > 0 && <CifrasEnFila items={cifras.items} />}
        <LineaSinDato faltan={cifras.faltan} />
      </div>

      {dudoso && <AvisoContrato dato={c.datoDudoso} />}
      {dudoso && cambio && <CambioGanador c={c} cambio={cambio} />}
    </div>
  );
}

// ─── Identidad: código, quién compra, dónde y quién ganó ─────────────────────

/** La bajada del título, en una línea que se parte si no entra: código, entidad, zona, partido que gobierna y ganador. */
function Identidad({ c }: { c: Detalle }) {
  const regionId = c.ubigeo ? UBIGEO_REGION[c.ubigeo.slice(0, 2)] : undefined;
  const mapaHref = regionId ? `/app/mapa?region=${regionId}&tab=cola${c.ubigeo && c.ubigeo.length === 6 ? `&ubigeo=${c.ubigeo}` : ""}` : "/app/mapa";
  // La entidad y el ganador son identificadores que llevan a su ficha: en verde y subrayados (pedido del 2026-11-05).
  const enlaceVerde = "font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";
  const icono = "shrink-0 text-mute";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <Hash size={14} className={icono} aria-hidden /> Código SEACE{" "}
        <a href={c.ocid ? procesoOece(c.ocid) : busquedaOece(c.codigo)} target="_blank" rel="noreferrer" className="font-mono text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
          <span translate="no">{c.codigo}</span>
        </a>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Building2 size={14} className={icono} aria-hidden />
        {c.entidadRuc ? (
          <Link href={`/entidad/${c.entidadRuc}`} className={enlaceVerde}>
            {c.entidad ? tituloNatural(c.entidad) : c.entidadRuc}
          </Link>
        ) : (
          <span>{c.entidad ? tituloNatural(c.entidad) : "Entidad no identificada"}</span>
        )}
      </span>
      {c.zona && (
        <Link href={mapaHref} prefetch={false} className="inline-flex items-center gap-1.5 text-ink underline-offset-2 hover:text-granate hover:underline">
          <MapPin size={14} className={icono} aria-hidden /> {c.zona}
        </Link>
      )}
      <PartidoQueGobierna g={c.gobierno} completo />
      <Ganador c={c} enlace={enlaceVerde} />
    </span>
  );
}

/**
 * Quién ganó, en la bajada (antes, en la ficha, dentro de «Datos del proceso» en la columna lateral; en el dictamen, en
 * una segunda línea de su propia cabecera). Si la buena pro pasó a otro postor, con quien quedó (CONOSCE). Una empresa
 * (RUC 20) con su ficha; una persona natural, tapada y sin enlace ni RUC; un consorcio sin RUC propio, por su nombre (sus
 * integrantes van en «Datos del proceso»).
 */
function Ganador({ c, enlace }: { c: Detalle; enlace: string }) {
  const queda = cambioDeGanador(c)?.queda[0];
  const proveedor = queda?.proveedor ?? c.proveedor;
  const ruc = queda?.proveedorRuc ?? c.proveedorRuc;
  if (!proveedor) {
    return (
      <span className="inline-flex items-center gap-1.5 text-mute">
        <Trophy size={14} className="shrink-0" aria-hidden /> Sin adjudicar todavía
      </span>
    );
  }
  const natural = esPersonaNatural(ruc);
  const ficha = !natural && !esCodigoConsorcio(ruc) ? enlaceProveedor(ruc) : null;
  // Otros ganadores en otros ítems (adjudicaciones vigentes a otro proveedor).
  const otros = new Set(adjudicacionesVigentes(c).map((a) => a.proveedorRuc ?? a.proveedor).filter((x) => x && x !== ruc && x !== proveedor)).size;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <Trophy size={14} className="shrink-0 text-mute" aria-hidden />
      Ganó{" "}
      {natural ? (
        <span className="font-semibold text-ink"><PersonName name={proveedor} orden="sunat" /></span>
      ) : ficha ? (
        <Link href={ficha} prefetch={false} className={enlace}>{proveedor}</Link>
      ) : (
        <span className="font-semibold text-ink">{proveedor}</span>
      )}
      {otros > 0 && <span className="text-mute">y {plural(otros, "ganador más", "ganadores más")} en otros ítems</span>}
    </span>
  );
}

/** El peso del riesgo como chip de estado (color, ícono y palabra), con las palabras de las listas. */
function ChipRiesgo({ lectura }: { lectura: LecturaContrato }) {
  const { nivel } = lectura;
  const Icono = ICONO_SEVERIDAD[nivel.ui.icono];
  return (
    <span className={cn("pill font-semibold", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)}>
      <Icono size={11} aria-hidden />
      {nivel.etiqueta}
    </span>
  );
}

// ─── Banderas ────────────────────────────────────────────────────────────────

/**
 * Las banderas de la cabecera. Con lectura y señales: las señales que cuentan, una fila cada una (dos de la misma regla
 * se numeran, «1 de 2»), y cada una lleva a su evidencia en el dictamen. Son las mismas que cuentan la cifra del puntaje,
 * la pestaña «Señales» y la frase del dictamen. Sin lectura (o sin señales): los antecedentes de quien ganó, que van a
 * su grupo en la pestaña «Antecedentes». Antes la ficha listaba las señales en su Resumen y el dictamen en su pestaña,
 * y ninguna iba a la vista en las otras pestañas.
 */
function banderasDe(c: Detalle, lectura: LecturaContrato | null): { etiqueta: string; lista: BanderaFicha[] } {
  if (lectura && lectura.senales.length > 0) {
    const total = new Map<string, number>();
    for (const s of lectura.senales) total.set(s.regla, (total.get(s.regla) ?? 0) + 1);
    const vistas = new Map<string, number>();
    const href = rutaContrato(c.ocid, "dictamen", { tab: "resumen" });
    const lista = lectura.senales.map((s) => {
      const k = (vistas.get(s.regla) ?? 0) + 1;
      vistas.set(s.regla, k);
      const n = total.get(s.regla) ?? 1;
      return {
        tipo: s.regla,
        severidad: s.severidad,
        nombre: n > 1 ? `${reglaLabel(s.regla)} (${k} de ${n})` : reglaLabel(s.regla),
        explica: s.norma ? `Lo que dice la norma: ${recortar(s.norma, 180)}` : undefined,
        href,
      } satisfies BanderaFicha;
    });
    return { etiqueta: "Señales de la lectura", lista };
  }
  const cambio = cambioDeGanador(c);
  // El cruce «otro postor» repite el aviso del cambio de ganador: va una sola vez, en el aviso.
  const cruces = (c.cruces ?? []).filter((x) => !(cambio && x.tipo === "otro_postor"));
  const varios = new Set(cruces.map((x) => x.rucProveedor)).size > 1;
  return {
    etiqueta: varios ? "Antecedentes de quienes ganaron" : "Antecedentes de quien ganó",
    lista: banderasAntecedentes(cruces, rutaContrato(c.ocid, "ficha", { seccion: "antecedentes" })),
  };
}

/** ¿La cabecera lleva los antecedentes como banderas? (entonces el Resumen de la ficha no los repite). */
export function antecedentesEnCabecera(lectura: LecturaContrato | null): boolean {
  return !(lectura && lectura.senales.length > 0);
}

// ─── Cifras ──────────────────────────────────────────────────────────────────

/**
 * Las cifras del contrato, hasta cuatro en una caja: cuánto (lo adjudicado frente al referencial, con su barra), cuándo
 * (la buena pro, con la convocatoria y los días entre una y otra), cuántos compitieron (los registrados y los que
 * ofertaron, con su barra) y, con lectura, el puntaje de riesgo con sus señales. Las que el registro no trae van
 * nombradas en `faltan`.
 */
function cifrasDe(c: Detalle, lectura: LecturaContrato | null): { items: Cifra[]; faltan: string[] } {
  const items: Cifra[] = [];
  const faltan: string[] = [];
  const vigentes = adjudicacionesVigentes(c);
  const adjudicado = vigentes.reduce((s, a) => s + (a.montoPen ?? 0), 0) || null;
  const reemplazadas = (c.adjudicaciones ?? []).length - vigentes.length;
  const nItems = c.items.length;
  const ref = c.montoPen || null;

  // 1. Cuánto: lo adjudicado frente al referencial (una sola cifra si son iguales).
  if (adjudicado) {
    const igual = !!ref && Math.abs(adjudicado - ref) < 0.005 * ref;
    const pct = ref && !igual && c.moneda === "PEN" && adjudicado <= ref * 5 ? Math.round((100 * adjudicado) / ref) : null;
    const partes = [
      // Hasta el 100 % la barra ya dice el porcentaje: el texto dice de qué. Sobre el 100 %, sin barra, lo dice el texto.
      igual
        ? "igual al valor referencial"
        : pct != null
          ? `${pct > 100 ? `${pct} % ` : ""}de ${monto(ref!, c.moneda)} de valor referencial`
          : ref
            ? `valor referencial: ${monto(ref, c.moneda)}`
            : null,
      nItems > 1 ? `en ${numero(nItems)} ítems` : null,
      vigentes.length > 1 ? `${numero(vigentes.length)} adjudicaciones` : null,
      reemplazadas > 0 ? `sin ${plural(reemplazadas, "buena pro reemplazada", "buenas pro reemplazadas")}` : null,
    ].filter(Boolean);
    items.push({
      valor: monto(adjudicado, c.moneda),
      etiqueta: "Adjudicado",
      ayuda: <AyudaTermino clave="adjudicacion" />,
      contexto: partes.join(", "),
      // La barra, sólo si lo adjudicado no pasa el referencial (sobre el 100 % no hay parte que dibujar).
      parte: pct != null && pct <= 100 ? pct / 100 : null,
    });
    if (!ref) faltan.push("valor referencial");
  } else if (ref) {
    items.push({
      valor: monto(ref, c.moneda),
      etiqueta: "Valor referencial",
      ayuda: <AyudaTermino clave="valor-referencial" />,
      contexto: ["sin adjudicar todavía", nItems > 1 ? `en ${numero(nItems)} ítems` : null].filter(Boolean).join(", "),
      parte: null,
    });
  } else {
    faltan.push("valor referencial", "monto adjudicado");
  }

  // 2. Cuándo: la buena pro (o la adjudicación) y, en su contexto, la convocatoria y los días entre una y otra.
  const gano = fechaGano(c);
  const dias = gano && c.fecha ? Math.round((Date.parse(`${gano.fecha}T12:00:00Z`) - Date.parse(`${c.fecha.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null;
  if (gano) {
    items.push({
      valor: fechaConAnio(gano.fecha),
      etiqueta: gano.deAdjudicacion ? "Adjudicación" : "Buena pro",
      ayuda: gano.deAdjudicacion ? undefined : <AyudaTermino clave="buena-pro" />,
      contexto: c.fecha ? `convocada el ${fechaConAnio(c.fecha)}${dias != null && dias > 0 ? `, ${plural(dias, "día", "días")} antes` : ""}` : "convocatoria: sin fecha",
    });
  } else if (c.fecha) {
    items.push({ valor: fechaConAnio(c.fecha), etiqueta: "Convocatoria", ayuda: <AyudaTermino clave="convocatoria" />, contexto: "buena pro: sin fecha todavía" });
  } else {
    faltan.push("fecha de convocatoria");
  }

  // 3. Cuántos compitieron: la MISMA cuenta que la pestaña «Participantes» cuando existe (todos los del registro del
  // proceso); si no, los registrados del OCDS. Los que ofertaron, debajo y en la barra.
  const ps = c.participantes ?? [];
  const conPestana = (c.postoresDetalle ?? []).length === 0 && ps.length > 0;
  const registrados = conPestana ? ps.length : c.postores ?? (ps.filter((p) => p.registrado).length || null);
  const conOferta = (c.postoresDetalle ?? []).filter((p) => p.montoOferta != null).length;
  if (registrados != null) {
    const ofertas = c.ofertas ?? (conOferta > 0 ? conOferta : null);
    items.push({
      valor: numero(registrados),
      etiqueta: registrados === 1 ? "Participante" : "Participantes",
      ayuda: <AyudaTermino clave="participante" />,
      contexto: ofertas != null ? plural(ofertas, "presentó oferta", "presentaron oferta") : "ofertas: sin dato",
      parte: ofertas != null && registrados > 0 && ofertas <= registrados ? ofertas / registrados : null,
    });
  } else if (c.ofertas != null) {
    items.push({ valor: numero(c.ofertas), etiqueta: c.ofertas === 1 ? "Postor" : "Postores", ayuda: <AyudaTermino clave="postor" />, contexto: "presentaron oferta; los registrados, sin dato", parte: null });
  } else {
    faltan.push("participantes");
  }

  // 4. Con lectura: el puntaje (con tope de 100) y las señales que lo explican. Sin señales, que la lectura no encontró
  // ninguna (o que no terminó). En revisión humana no se cuenta nada (§10.4).
  if (lectura) {
    const { conteo, puntaje, nivel } = lectura;
    const partes = (["alta", "media", "baja"] as const)
      .filter((k) => conteo[k] > 0)
      .map((k) => `${numero(conteo[k])} ${conteo[k] === 1 ? k : `${k}s`}`);
    if (conteo.total > 0) {
      items.push({
        valor: puntaje != null ? `${puntaje} de 100` : null,
        etiqueta: "Puntaje de riesgo",
        ayuda: <AyudaPuntaje />,
        tono: nivel.nivel === "alta" ? "alta" : nivel.nivel === "media" ? "media" : "neutro",
        contexto: `${plural(conteo.total, "señal", "señales")}${partes.length > 1 ? `: ${listaY(partes)}` : partes.length === 1 ? ` ${partes[0].replace(/^\d+ /, "")}` : ""}`,
        parte: null,
      });
    } else {
      items.push({
        valor: nivel.nivel === "incompleto" ? "Incompleta" : "Ninguna",
        etiqueta: "Señales de la lectura",
        tono: nivel.nivel === "limpio" ? "positivo" : "neutro",
        contexto: nivel.detalle,
        parte: null,
      });
    }
  }
  return { items, faltan };
}

/** Lo que el registro todavía no trae, nombrado en una línea (un «Sin dato» no merece una celda del tamaño de una cifra). */
function LineaSinDato({ faltan }: { faltan: string[] }) {
  if (!faltan.length) return null;
  return (
    <p className="flex items-start gap-2 text-meta leading-snug text-mute">
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold text-inkSoft">Sin dato todavía:</span> {listaY(faltan)}.
      </span>
    </p>
  );
}

// ─── La buena pro pasó a otro postor ─────────────────────────────────────────

/**
 * La buena pro pasó a otro postor sobre los mismos ítems: el OCDS guarda las dos adjudicaciones y CONOSCE registra a
 * quién se le adjudicó al final. Pasa cuando el ganador no firma o pierde la buena pro y se adjudica al siguiente en el
 * orden de prelación, con su propia oferta. Es un dato, no una conclusión: explica la cifra de lo adjudicado.
 */
function CambioGanador({ c, cambio }: { c: Detalle; cambio: NonNullable<ReturnType<typeof cambioDeGanador>> }) {
  const { original, queda, diferencia, porcentaje } = cambio;
  const nombre = (a: { proveedor: string | null; proveedorRuc: string | null }): ReactNode => {
    if (!a.proveedor) return "otro postor";
    if (esPersonaNatural(a.proveedorRuc)) return <PersonName name={a.proveedor} orden="sunat" />;
    const ficha = enlaceProveedor(a.proveedorRuc);
    return ficha ? (
      <Link href={ficha} prefetch={false} className="text-granate underline-offset-2 hover:underline">
        {a.proveedor}
      </Link>
    ) : (
      a.proveedor
    );
  };
  const sube = diferencia != null && diferencia > 0;
  return (
    <section aria-labelledby="cambio-ganador" className={cn("rounded-xl border bg-paper px-4 py-3", sube ? "border-amber/40" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="cambio-ganador" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <ShieldAlert size={16} className={sube ? "text-amberTexto" : "text-mute"} aria-hidden />
          La buena pro pasó a otro postor
        </h2>
        <Ayuda titulo="¿Por qué hay dos adjudicaciones?">
          El registro OCDS guarda la buena pro original y la que la reemplazó sobre los mismos ítems; CONOSCE registra a quién se
          le adjudicó al final. Suele pasar cuando el ganador no firma el contrato o pierde la buena pro y se adjudica al siguiente
          postor, con su propia oferta. El motivo está en el expediente.
        </Ayuda>
      </div>
      <p className="mt-1.5 text-dato leading-5 text-ink">
        La buena pro fue primero para <span className="font-semibold">{nombre(original)}</span>
        {original.montoPen != null && <> por {monto(original.montoPen, c.moneda)}</>}; según CONOSCE quedó con{" "}
        {queda.map((q, i) => (
          <span key={q.id ?? i}>
            {i > 0 && ", "}
            <span className="font-semibold">{nombre(q)}</span>
            {q.montoPen != null && <> por {monto(q.montoPen, c.moneda)}</>}
          </span>
        ))}
        {diferencia != null && diferencia !== 0 && (
          <>
            : <span className={cn("font-semibold", sube && "text-amberTexto")}>{sube ? "+" : "−"}{monto(Math.abs(diferencia), c.moneda)}</span>
            {porcentaje != null && <> ({sube ? "+" : "−"}{numero(Math.abs(Math.round(porcentaje)))} %)</>}
          </>
        )}
        .
      </p>
      <FuenteDato fuente="registro OCDS del OECE y las adjudicaciones de CONOSCE" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo, conosce: true })} className="mt-1.5" />
    </section>
  );
}
