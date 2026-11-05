import type { ReactNode } from "react";
import { CalendarClock, FileSignature, FileText, ScanSearch } from "lucide-react";
import { BloqueDetalle, DatosClave, FuenteDato, Nota, TarjetaDatos, type BanderaFicha, type DatoClave } from "@/components/patrones";
import { Tabla, type Columna, type Fila } from "@/components/listado";
import { BanderasAntecedentes, conFicha, fichasCompra } from "@/components/ordenes/ListaOrdenes";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Severidad } from "@/components/ui/Severidad";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, numero, oracion, soles } from "@/lib/formato";
import { SEACE_CONTRATOS, SEACE_MENORES } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { rutaMenor, urlContratoMenor, urlRequerimiento, type FichaMenor, type ItemMenor, type SenalMenor } from "@/lib/menores";
import { textoSenal } from "@/lib/senalesMenor";
import { antecedentesSunat, duracion, fechaHoraLima } from "./ListaMenores";

/**
 * La ficha de un contrato menor (≤8 UIT): antes sólo había un panel con dos botones a los PDF. Ahora, de arriba abajo:
 * las cifras del contrato, sus señales con la evidencia (los contratos de la compra partida, el ítem caro), lo que se
 * pidió (lo que la IA leyó en el requerimiento), qué se compró y a qué precio frente a otras entidades, lo que dice el
 * contrato u orden, la cronología (publicación, consultas, cotización, firma) y los demás contratos menores de la entidad
 * con ese proveedor, donde una compra partida se ve sola. Server-safe.
 */

const objetoTxt = (o: string | null) => (o && /bien/i.test(o) ? "Bien" : o && /servicio/i.test(o) ? "Servicio" : o ? tituloNatural(o) : null);

/** Las banderas de la cabecera: inhabilitado al firmar, las señales del contrato y lo de la SUNAT. */
export function banderasMenor(f: FichaMenor): BanderaFicha[] {
  const m = f.menor;
  const out: BanderaFicha[] = [];
  if (m.inhabilitacion) out.push({ tipo: "inhabilitado", severidad: "alta", nombre: "Inhabilitado por el Tribunal al firmar", href: "#antecedentes" });
  for (const s of f.senales) {
    const t = textoSenal(s);
    out.push({ tipo: s.tipo, severidad: s.severidad, nombre: t.nombre, explica: t.explica, href: `#senal-${s.tipo}`, n: s.grupo?.length ?? null });
  }
  for (const a of antecedentesSunat(m)) out.push({ tipo: a.tipo, severidad: a.severidad, nombre: a.titulo, explica: a.explica, href: "#antecedentes" });
  return out;
}

export function CifrasMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const anual = f.historial.filter((h) => h.anio === m.anio && h.moneda === "PEN");
  const sumaAnual = anual.reduce((a, h) => a + (h.monto || 0), 0);
  const items: Cifra[] = [
    {
      valor: m.monto != null ? soles(m.monto) : null,
      etiqueta: "monto del contrato",
      contexto: m.tope ? `${numero(Math.round((100 * (m.monto ?? 0)) / m.tope))} % del tope de 8 UIT (${soles(m.tope)})` : "hasta 8 UIT",
      tono: m.sobreTope ? "alta" : undefined,
    },
    {
      valor: m.cotizaHoras != null ? duracion(m.cotizaHoras) : null,
      etiqueta: "para cotizar",
      contexto: m.cotizaInicio && m.cotizaCierre ? `del ${fechaHoraLima(m.cotizaInicio)} al ${fechaHoraLima(m.cotizaCierre)}` : "ventana de cotización",
      tono: f.senales.some((s) => s.tipo === "menor_ventana_corta") ? "media" : undefined,
    },
    {
      valor: numero(anual.length),
      etiqueta: `con este proveedor en ${m.anio ?? "el año"}`,
      contexto: `contratos menores de la entidad, por ${soles(sumaAnual)}`,
      tono: m.tope && sumaAnual > m.tope && anual.length > 1 ? "alta" : undefined,
    },
    {
      valor: numero(f.items.length),
      etiqueta: f.items.length === 1 ? "ítem" : "ítems",
      contexto: f.items.some((i) => i.refMediana != null) ? "con precio de otras entidades para comparar" : "del catálogo del Estado",
    },
  ];
  return <CifrasEnFila items={items} />;
}

// ─── Señales con su evidencia ─────────────────────────────────────────────────

const COLS_GRUPO: Columna[] = [
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.6fr)" },
  { clave: "fecha", titulo: "Firmado", ancho: "120px", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "120px", alinear: "der" },
];

function TablaGrupo({ grupo, actual, etiqueta }: { grupo: NonNullable<SenalMenor["grupo"]>; actual: number; etiqueta: string }) {
  const filas: Fila[] = grupo.map((g) => ({
    id: String(g.id),
    href: g.id === actual ? undefined : rutaMenor(g.id),
    resaltada: g.id === actual,
    celdas: {
      contrato: (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{g.descripcion ? oracion(g.descripcion) : "Sin descripción"}</span>
          <span className="block truncate font-mono text-rotulo text-mute">{g.codigo}{g.id === actual ? " (este contrato)" : ""}</span>
        </span>
      ),
      fecha: <span className="font-mono text-meta">{g.fecha ? fechaConAnio(g.fecha) : "Sin fecha"}</span>,
      monto: <span className="font-mono text-meta tabular-nums">{soles(g.monto)}</span>,
    },
  }));
  return <Tabla columnas={COLS_GRUPO} filas={filas} etiqueta={etiqueta} densidad="compacta" />;
}

function EvidenciaSenal({ s, f }: { s: SenalMenor; f: FichaMenor }) {
  const d = s.detalle as Record<string, any>;
  if (s.grupo?.length) {
    return <TablaGrupo grupo={s.grupo} actual={f.menor.id} etiqueta={`Los contratos de la señal «${textoSenal(s).nombre}»`} />;
  }
  if (s.tipo === "menor_precio_alto" && d.peor) {
    const p = d.peor;
    return (
      <DatosClave
        items={[
          { etiqueta: "Ítem", valor: oracion(String(p.descripcion ?? "")) },
          { etiqueta: "Cantidad", valor: `${numero(p.cantidad)} ${String(p.unidad ?? "").toLowerCase()}`, mono: true },
          { etiqueta: "Pagado por unidad", valor: soles(p.unitario), mono: true },
          { etiqueta: "Mediana de otras entidades", valor: `${soles(p.mediana)} (${numero(p.entidades)} entidades, ${p.anio})`, mono: true },
          { etiqueta: "Por encima de lo habitual", valor: soles(d.exceso), mono: true },
        ]}
      />
    );
  }
  if (s.tipo === "menor_ventana_corta" && d.desde) {
    return <p className="text-dato text-inkSoft">Del {fechaHoraLima(String(d.desde).replace(" ", "T"))} al {fechaHoraLima(String(d.hasta).replace(" ", "T"))}.</p>;
  }
  const cita: string | null = typeof d.cita === "string" && d.cita ? d.cita : null;
  const marcas: { marca: string; cita: string }[] = Array.isArray(d.marcas) ? d.marcas : [];
  if (cita || marcas.length) {
    return (
      <div className="space-y-2">
        {cita && <blockquote className="border-l-2 border-line pl-3 text-dato italic text-inkSoft">«{cita}»</blockquote>}
        {marcas.map((m, i) => (
          <blockquote key={i} className="border-l-2 border-line pl-3 text-dato text-inkSoft">
            <span className="font-semibold not-italic text-ink">{m.marca}:</span> <span className="italic">«{m.cita}»</span>
          </blockquote>
        ))}
        <p className="text-rotulo text-mute">Citado de {d.documento === "requerimiento" ? "el requerimiento" : "el contrato u orden"}, leído por {d.lector ?? "la IA"}.</p>
      </div>
    );
  }
  return null;
}

export function SenalesMenor({ f }: { f: FichaMenor }) {
  if (!f.senales.length) {
    return (
      <Nota icono={<ScanSearch size={16} aria-hidden />}>
        No encontramos señales en este contrato menor: ni compra partida con este proveedor, ni monto sobre el tope o al borde,
        ni una ventana de cotización corta, ni un precio fuera de lo que pagan otras entidades
        {f.lecturas.tdr || f.lecturas.contrato ? ", ni nada raro en lo que la IA leyó en sus documentos" : ""}.
      </Nota>
    );
  }
  return (
    <div className="space-y-3">
      {f.senales.map((s) => {
        const t = textoSenal(s);
        return (
          <article key={s.tipo} id={`senal-${s.tipo}`} className="tarjeta scroll-mt-24 space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Severidad bandera={s.severidad} />
              <h3 className="font-display text-cuerpo font-bold text-ink">{t.nombre}</h3>
            </div>
            <p className="text-dato leading-relaxed text-inkSoft">{t.explica}</p>
            <EvidenciaSenal s={s} f={f} />
          </article>
        );
      })}
      <p className="text-rotulo text-mute">Son indicios para revisar, no prueban una irregularidad. Cada uno dice qué se midió.</p>
    </div>
  );
}

// ─── Lo que se pidió y lo que se compró ───────────────────────────────────────

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Lo que la IA leyó en el requerimiento (TDR o especificaciones técnicas). */
export function LoQueSePidio({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const l = f.lecturas.tdr;
  const r = (l?.salida ?? {}) as Record<string, any>;
  const pdf = m.tieneRequerimiento ? (
    <a href={urlRequerimiento(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
      <FileText className="size-4" aria-hidden /> Abrir el requerimiento (PDF)
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  ) : null;
  if (!l || !r.es_requerimiento) {
    return (
      <div className="space-y-3">
        <Nota icono={<FileText size={16} aria-hidden />}>
          {m.tieneRequerimiento
            ? "La IA todavía no leyó este requerimiento: lo que pide va a aparecer aquí cuando lo lea."
            : "El SEACE no publicó el requerimiento de este contrato menor."}
        </Nota>
        {pdf}
      </div>
    );
  }
  const perfil = (r.perfil_proveedor ?? {}) as Record<string, any>;
  const datos: (DatoClave | null)[] = [
    txt(r.objeto) ? { etiqueta: "Qué se pide", valor: txt(r.objeto) } : null,
    txt(r.finalidad) ? { etiqueta: "Para qué", valor: txt(r.finalidad) } : null,
    txt(r.area_usuaria) || m.areaUsuaria ? { etiqueta: "Quién lo pidió", valor: txt(r.area_usuaria) ?? oracion(m.areaUsuaria!) } : null,
    r.plazo_dias != null ? { etiqueta: "Plazo", valor: `${numero(r.plazo_dias)} días`, mono: true } : null,
    txt(r.lugar) ? { etiqueta: "Dónde", valor: txt(r.lugar) } : null,
    txt(perfil.formacion) ? { etiqueta: "Perfil del proveedor", valor: txt(perfil.formacion) } : null,
    perfil.experiencia_anios != null ? { etiqueta: "Experiencia exigida", valor: `${numero(perfil.experiencia_anios)} años`, mono: true } : null,
    perfil.experiencia_monto != null ? { etiqueta: "Facturación exigida", valor: soles(perfil.experiencia_monto), mono: true } : null,
    txt(r.forma_pago) ? { etiqueta: "Forma de pago", valor: txt(r.forma_pago) } : null,
    txt(r.penalidad) ? { etiqueta: "Penalidad", valor: txt(r.penalidad) } : null,
    r.monto_estimado != null ? { etiqueta: "Monto que estima", valor: soles(r.monto_estimado), mono: true } : null,
  ];
  const requisitos: { tipo: string; requisito: string }[] = Array.isArray(r.requisitos) ? r.requisitos : [];
  const marcas: { marca: string; con_equivalente: boolean }[] = Array.isArray(r.marcas) ? r.marcas : [];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TarjetaDatos titulo="Lo que dice el requerimiento" items={datos.filter(Boolean) as DatoClave[]} />
        <TarjetaDatos titulo={`Lo que se exige al proveedor${requisitos.length ? ` (${requisitos.length})` : ""}`}>
          {requisitos.length ? (
            <ul className="space-y-1.5 text-dato text-inkSoft">
              {requisitos.map((q, i) => <li key={i}>{q.requisito}</li>)}
            </ul>
          ) : (
            <p className="text-dato text-mute">El requerimiento no exige requisitos al proveedor.</p>
          )}
          {marcas.length > 0 && (
            <p className="mt-3 text-dato text-inkSoft">
              <span className="font-semibold text-ink">Marcas que nombra:</span>{" "}
              {marcas.map((x) => `${x.marca}${x.con_equivalente ? " (o equivalente)" : " (sin «o equivalente»)"}`).join(", ")}.
            </p>
          )}
        </TarjetaDatos>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pdf}
        <span className="text-rotulo text-mute">Leído por la IA ({l.modelo.replace(/-\d{8}$/, "")}) el {fechaConAnio(l.leido)}, {numero(l.paginas)} páginas.</span>
      </div>
      {m.tieneRequerimiento && (
        <details className="group hidden rounded-2xl border border-line bg-paper sm:block">
          <summary className="cursor-pointer list-none px-4 py-3 text-dato font-semibold text-granate [&::-webkit-details-marker]:hidden">
            Ver el requerimiento aquí
          </summary>
          <iframe src={urlRequerimiento(m.id)} title="Requerimiento del contrato menor (PDF)" className="h-[70vh] w-full rounded-b-2xl border-t border-line" loading="lazy" />
        </details>
      )}
    </div>
  );
}

const COLS_ITEMS: Columna[] = [
  { clave: "item", titulo: "Ítem", ancho: "minmax(0,1.6fr)" },
  { clave: "cantidad", titulo: "Cantidad", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "unitario", titulo: "Por unidad", ancho: "120px", alinear: "der", apilar: "con-rotulo" },
  { clave: "referencia", titulo: "Otras entidades", corto: "Mediana de otras", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
];

function celdaReferencia(i: ItemMenor): ReactNode {
  if (i.refMediana == null) return <span className="text-meta text-mute">Sin precio para comparar</span>;
  const razon = i.precioUnitario != null && i.refMediana > 0 ? i.precioUnitario / i.refMediana : null;
  return (
    <span className="block text-meta">
      <span className="font-mono tabular-nums text-ink">{soles(i.refMediana)}</span>{" "}
      <span className="text-mute">mediana de {numero(i.refEntidades)} entidades ({i.refAnio})</span>
      {razon != null && razon >= 1.5 && (
        <span className={`block font-semibold ${razon >= 2 ? "text-rust" : "text-amberTexto"}`}>{String(Math.round(razon * 10) / 10).replace(".", ",")} veces la mediana</span>
      )}
    </span>
  );
}

export function LoQueSeCompro({ f }: { f: FichaMenor }) {
  if (!f.items.length) {
    return <Nota icono={<ScanSearch size={16} aria-hidden />}>El SEACE todavía no publica los ítems de este contrato menor.</Nota>;
  }
  const sinPrecio = f.items.length > 1 && f.items.every((i) => i.precioUnitario == null);
  const filas: Fila[] = f.items.map((i) => ({
    id: String(i.n),
    celdas: {
      item: (
        <span className="block min-w-0">
          <span className="block font-medium text-ink">{oracion(i.cubsoNombre ?? i.descripcion ?? "Ítem")}</span>
          {i.descripcion && i.cubsoNombre && <span className="block line-clamp-2 text-meta text-mute">{oracion(i.descripcion)}</span>}
          {i.cubso && <span className="block font-mono text-rotulo text-mute">CUBSO {i.cubso}</span>}
        </span>
      ),
      cantidad: <span className="font-mono text-meta tabular-nums">{i.cantidad != null ? `${numero(i.cantidad)} ${(i.unidad ?? "").toLowerCase()}` : "Sin dato"}</span>,
      unitario: <span className="font-mono text-meta tabular-nums">{i.precioUnitario != null ? soles(i.precioUnitario) : "Sin dato"}</span>,
      referencia: celdaReferencia(i),
    },
  }));
  return (
    <div className="space-y-2">
      <Tabla columnas={COLS_ITEMS} filas={filas} etiqueta="Los ítems del contrato menor" densidad="compacta" />
      {sinPrecio && (
        <p className="text-rotulo text-mute">
          El SEACE publica sólo el total de la cotización ganadora, no el precio de cada ítem: por eso no se compara por unidad.
        </p>
      )}
      <p className="text-rotulo text-mute">
        «Otras entidades»: la mediana de lo que pagaron por el mismo ítem del catálogo (CUBSO) y unidad en los procesos con
        buena pro del SEACE de ese año o del anterior.
      </p>
    </div>
  );
}

/** Lo que la IA leyó en el contrato u orden registrado. */
export function LoQueDiceElContrato({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const l = f.lecturas.contrato;
  const c = (l?.salida ?? {}) as Record<string, any>;
  const pdf = m.tieneContrato ? (
    <a href={urlContratoMenor(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
      <FileSignature className="size-4" aria-hidden /> Abrir el contrato u orden (PDF)
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  ) : null;
  if (!l || !c.es_contrato) {
    return (
      <div className="space-y-3">
        <Nota icono={<FileSignature size={16} aria-hidden />}>
          {m.tieneContrato ? "La IA todavía no leyó este contrato u orden." : "El SEACE no publicó el contrato u orden."}
        </Nota>
        {pdf}
      </div>
    );
  }
  const tipo = { orden_de_compra: "Orden de compra", orden_de_servicio: "Orden de servicio", contrato: "Contrato" }[c.tipo_documento as string] ?? "Documento";
  const items: { descripcion: string; cantidad: number | null; unidad: string; precio_unitario: number | null; subtotal: number | null }[] =
    Array.isArray(c.items) ? c.items : [];
  const datos: (DatoClave | null)[] = [
    { etiqueta: "Documento", valor: `${tipo}${txt(c.numero) ? ` ${c.numero}` : ""}` },
    txt(c.fecha) ? { etiqueta: "Fecha del documento", valor: fechaConAnio(c.fecha), mono: true } : null,
    c.monto_total != null ? { etiqueta: "Monto en el documento", valor: soles(c.monto_total), mono: true } : null,
    c.plazo_dias != null ? { etiqueta: "Plazo", valor: `${numero(c.plazo_dias)} días`, mono: true } : null,
    txt(c.penalidad) ? { etiqueta: "Penalidad", valor: txt(c.penalidad) } : null,
    txt(c.garantia) ? { etiqueta: "Garantía", valor: txt(c.garantia) } : null,
    Array.isArray(c.firmantes) && c.firmantes.length ? { etiqueta: "Firman", valor: c.firmantes.map((x: string) => oracion(x)).join(", ") } : null,
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TarjetaDatos titulo="Lo que dice el documento" items={datos.filter(Boolean) as DatoClave[]} />
        {items.length > 0 && (
          <TarjetaDatos titulo={`Sus líneas (${items.length})`}>
            <ul className="space-y-1.5 text-dato text-inkSoft">
              {items.slice(0, 15).map((x, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3">
                  <span className="min-w-0">{oracion(x.descripcion || "Línea")}{x.cantidad != null ? `, ${numero(x.cantidad)} ${(x.unidad || "").toLowerCase()}` : ""}</span>
                  {x.precio_unitario != null && <span className="font-mono tabular-nums text-ink">{soles(x.precio_unitario)} c/u</span>}
                </li>
              ))}
            </ul>
            {items.length > 15 && <p className="mt-2 text-rotulo text-mute">Y {items.length - 15} líneas más en el PDF.</p>}
          </TarjetaDatos>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pdf}
        <span className="text-rotulo text-mute">Leído por la IA el {fechaConAnio(l.leido)}.</span>
      </div>
    </div>
  );
}

// ─── Cronología, historial y órdenes ─────────────────────────────────────────

export function Cronologia({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const pasos: { cuando: string | null; que: string }[] = [
    { cuando: m.publicado ? fechaHoraLima(m.publicado) : null, que: "Se publicó en el SEACE" },
    { cuando: m.consultasDesde ? `${fechaHoraLima(m.consultasDesde)}${m.consultasHasta ? ` a ${fechaHoraLima(m.consultasHasta)}` : ""}` : null, que: "Consultas" },
    { cuando: m.cotizaInicio ? `${fechaHoraLima(m.cotizaInicio)}${m.cotizaCierre ? ` a ${fechaHoraLima(m.cotizaCierre)}` : ""}` : null, que: `Cotización${m.cotizaHoras != null ? ` (${duracion(m.cotizaHoras)})` : ""}` },
    { cuando: m.fecha ? fechaConAnio(m.fecha) : null, que: "Se firmó el contrato" },
    { cuando: m.ejecucionDesde ? `${fechaConAnio(m.ejecucionDesde)}${m.ejecucionHasta ? ` a ${fechaConAnio(m.ejecucionHasta)}` : ""}` : null, que: "Ejecución" },
  ].filter((p) => p.cuando);
  if (!pasos.length) return <Nota icono={<CalendarClock size={16} aria-hidden />}>El SEACE no publicó las fechas de este contrato menor.</Nota>;
  return (
    <ol className="tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      {pasos.map((p, i) => (
        <li key={p.que} className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-granate-50 font-mono text-rotulo font-bold text-granate" aria-hidden>{i + 1}</span>
          <span className="min-w-0">
            <span className="block text-dato font-semibold text-ink">{p.que}</span>
            <span className="block font-mono text-meta text-inkSoft">{p.cuando}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const COLS_HIST: Columna[] = [
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.6fr)" },
  { clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "lg", apilar: true },
  { clave: "fecha", titulo: "Firmado", ancho: "112px", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "112px", alinear: "der" },
];

export function HistorialProveedor({ f }: { f: FichaMenor }) {
  const filas: Fila[] = f.historial.map((h) => ({
    id: String(h.id),
    href: h.id === f.menor.id ? undefined : rutaMenor(h.id),
    resaltada: h.id === f.menor.id,
    celdas: {
      contrato: (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{h.descripcion ? oracion(h.descripcion) : "Sin descripción"}</span>
          <span className="block truncate font-mono text-rotulo text-mute">{h.codigo}{h.id === f.menor.id ? " (este contrato)" : ""}{objetoTxt(h.objeto) ? `, ${objetoTxt(h.objeto)!.toLowerCase()}` : ""}</span>
        </span>
      ),
      senales: h.senales?.length ? (
        <BanderasAntecedentes
          etiqueta="Señales"
          antecedentes={h.senales.map((t) => {
            const x = textoSenal({ tipo: t, severidad: "media", monto: null });
            return { tipo: t, severidad: t === "menor_partido_mismo_dia" || t === "menor_sobre_tope" ? "alta" : t === "menor_borde_tope" || t === "menor_fin_de_semana" ? "baja" : "media", chip: x.chip, explica: x.explica };
          })}
        />
      ) : <span className="text-meta text-mute">Ninguna</span>,
      fecha: <span className="font-mono text-meta">{h.fecha ? fechaConAnio(h.fecha) : "Sin fecha"}</span>,
      monto: <span className="font-mono text-meta tabular-nums">{soles(h.monto)}</span>,
    },
  }));
  const porAnio = new Map<number, { n: number; monto: number }>();
  for (const h of f.historial) {
    if (h.anio == null) continue;
    const a = porAnio.get(h.anio) ?? { n: 0, monto: 0 };
    a.n += 1; a.monto += h.monto || 0;
    porAnio.set(h.anio, a);
  }
  return (
    <div className="space-y-2">
      <p className="text-dato text-inkSoft">
        {[...porAnio.entries()].sort((a, b) => b[0] - a[0]).map(([anio, a]) => `${anio}: ${a.n} ${a.n === 1 ? "contrato" : "contratos"} por ${soles(a.monto)}`).join("; ")}.
      </p>
      <Tabla columnas={COLS_HIST} filas={filas} etiqueta="Los contratos menores de la entidad con este proveedor" densidad="compacta" />
      {f.historial.length >= 80 && <p className="text-rotulo text-mute">Se muestran los 80 más recientes.</p>}
    </div>
  );
}

export function OrdenesMenor({ f }: { f: FichaMenor }) {
  if (!f.ordenes.length) {
    return (
      <Nota icono={<ScanSearch size={16} aria-hidden />}>
        Todavía no encontramos su orden en el registro de órdenes de CONOSCE: el enlace se arma por el número de la orden y no
        siempre coincide.
      </Nota>
    );
  }
  return (
    <ul className="tarjeta space-y-1.5 rounded-2xl border border-line bg-paper p-4 text-dato text-inkSoft">
      {f.ordenes.map((o) => (
        <li key={`${o.orden}|${o.fecha}`}>
          <span className="font-medium text-ink">{o.orden}</span>, emitida el {fechaConAnio(o.fecha)}
        </li>
      ))}
    </ul>
  );
}

/** Quién es quién: entidad, proveedor (y su ficha si es empresa) y lo que dice la SUNAT. */
export function PartesMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const fichas = fichasCompra("/app/contratos/menor", m.entidadRuc, m.proveedorRuc);
  const sunat = antecedentesSunat(m);
  const items: (DatoClave | null)[] = [
    { etiqueta: "Entidad", valor: conFicha(m.entidad ? tituloNatural(m.entidad) : null, fichas.entidad) },
    { etiqueta: "Proveedor", valor: conFicha(m.proveedor ? tituloNatural(m.proveedor) : null, fichas.proveedor) },
    m.provTipo ? { etiqueta: "Tipo de proveedor", valor: oracion(m.provTipo) } : null,
    m.provActividad ? { etiqueta: "Giro", valor: oracion(m.provActividad) } : null,
    m.provDesde ? { etiqueta: "Proveedor desde", valor: fechaConAnio(m.provDesde), mono: true } : null,
    objetoTxt(m.objeto) ? { etiqueta: "Bien o servicio", valor: objetoTxt(m.objeto) } : null,
    m.ccmnNombre ? { etiqueta: "En el catálogo", valor: oracion(m.ccmnNombre) } : null,
    m.tipoInvitacion ? { etiqueta: "Invitación", valor: oracion(m.tipoInvitacion.replace(/^INVITACI[OÓ]N\s+/i, "")) } : null,
    m.justifInvitacion ? { etiqueta: "Por qué no fue abierta", valor: m.justifInvitacion } : null,
    m.codigo ? { etiqueta: "Código", valor: m.codigo, mono: true } : null,
    m.estadoProceso ? { etiqueta: "Estado del proceso", valor: m.estadoProceso } : null,
  ];
  return (
    <div id="antecedentes" className="scroll-mt-24 space-y-3">
      <DatosClave items={items.filter(Boolean) as DatoClave[]} />
      {sunat.length > 0 && (
        <BloqueDetalle titulo="Lo que dice la SUNAT del proveedor">
          <ul className="space-y-1.5">
            {sunat.map((a) => (
              <li key={a.tipo}><span className="font-semibold text-ink">{a.titulo}.</span> <span className="text-inkSoft">{a.explica}</span></li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </div>
  );
}

export function FuenteMenor({ f }: { f: FichaMenor }) {
  return (
    <FuenteDato
      fuente={`SEACE, contrato menor ${f.menor.codigo ?? f.menor.id}`}
      enlaces={[
        { texto: "Buscador de Contratos del Estado (SEACE): el contrato", href: SEACE_CONTRATOS },
        { texto: "Buscador de contratos menores (SEACE): el requerimiento y los ítems", href: SEACE_MENORES },
      ]}
    />
  );
}

