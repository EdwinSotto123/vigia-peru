"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleDashed, CircleSlash, ExternalLink, Loader2, Search, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorBanner,
  Expandable,
  KeyValue,
  Panel,
  StatCard,
  StatGrid,
  claseBoton,
  hace,
  mensajeError,
  type Columna,
  type Tone,
} from "@/components/admin/ui";
import { adminFetch } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";

/** GET /admin/precios-lab y /admin/precios-lab/:id (backend/api/src/routes/admin_precios.ts → vigia-precios-lab). */
interface Fila {
  id: string;
  estado: Estado;
  paso: string | null;
  consulta: string;
  creado: string;
  terminado: string | null;
  costo: number;
  veredicto: string | null;
  mediana: number | null;
  validas: number | null;
  ocid: string | null;
  item: number | null;
}
type Estado = "en_cola" | "corriendo" | "listo" | "error";
interface Paso {
  nombre: string;
  estado: "corriendo" | "listo" | "error" | "saltado";
  detalle: unknown;
  inicio: string | null;
  fin: string | null;
}
interface Referencia {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  mediana: number;
}
interface Oferta {
  n: number;
  fuente: "tienda" | "buscador" | "web";
  tienda: string;
  titulo: string;
  marca: string | null;
  url: string;
  precio: number | null;
  moneda: string | null;
  extraccion: string;
  confirmado: boolean | null;
  vendedor: string | null;
  similitud: number | null;
  coincidencia: "exacta" | "equivalente" | "distinta" | "sin_juicio";
  unidades: number | null;
  razon: string | null;
  precioUnitario: number | null;
  valida: boolean;
  motivo: string | null;
  evidencia: string | null;
}
interface Detalle {
  id: string;
  estado: Estado;
  paso: string | null;
  consulta: string;
  error: string | null;
  creado: string;
  terminado: string | null;
  entrada: { consulta: string; unidad?: string; cantidad?: number; precioReferencia?: number; referencias?: Referencia[]; ocid?: string; item?: number };
  ficha: { nombre: string; unidad_base: string; atributos: { nombre: string; valor: string; obligatorio: boolean }[]; busquedas: string[]; busqueda_web: string; rubros?: string[] } | null;
  resumen: {
    n: number;
    validas: number;
    minimo: number | null;
    p25: number | null;
    mediana: number | null;
    p75: number | null;
    maximo: number | null;
    referencia: number | null;
    razon: number | null;
    veredicto: string;
    nota: string;
    sinComparar?: string | null;
  } | null;
  tokens_entrada: number;
  tokens_salida: number;
  costo_modelo: number;
  busquedas_web: number;
  costo_web: number;
  segundos_navegador: number;
  segundos_contenedor?: number;
  costo_contenedor?: number;
  pasos: Paso[];
  ofertas: Oferta[];
}

/** GET /admin/precios-lab/contrato/:ocid: los ítems del contrato con su última investigación y el total. */
interface ItemContrato {
  item: number;
  descripcion: string | null;
  unidad: string | null;
  cantidad: number | null;
  precioReferencial: number | null;
  precioAdjudicado: number | null;
  sinTiendas: boolean;
  cuentaEnTotal: boolean;
  investigacion: {
    id: string;
    estado: Estado;
    paso: string | null;
    veredicto: string | null;
    mediana: number | null;
    p25: number | null;
    p75: number | null;
    validas: number | null;
    razon: number | null;
    unidad: string | null;
    caja: number | null;
    sinComparar: string | null;
  } | null;
}
interface Contrato {
  contrato: { ocid: string; codigo?: string; titulo?: string; entidad?: string };
  items: ItemContrato[];
  laboratorio: boolean;
  total: { comparados: number; encima: number; pagado: number; mercado: number };
}

const soles = (n: number | null | undefined) =>
  n == null ? "" : `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd = (n: number) => `US$ ${n.toLocaleString("es-PE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
const NUM = new Intl.NumberFormat("es-PE");

const ESTADO: Record<Estado, { texto: string; tono: Tone }> = {
  en_cola: { texto: "En cola", tono: "pending" },
  corriendo: { texto: "Investigando", tono: "pending" },
  listo: { texto: "Lista", tono: "ok" },
  error: { texto: "Falló", tono: "danger" },
};
const PASOS: { clave: string; titulo: string; que: string }[] = [
  { clave: "entender", titulo: "Entender", que: "GLM 5.3 flash arma la ficha del producto y las búsquedas" },
  { clave: "tiendas", titulo: "Tiendas", que: "15 tiendas peruanas por su propia búsqueda" },
  { clave: "buscadores", titulo: "Buscadores", que: "El buscador propio de las tiendas del rubro (directorio abierto; Crawl4AI si se arman con JavaScript)" },
  { clave: "web", titulo: "Páginas pegadas", que: "Las páginas de venta que pegaste" },
  { clave: "leer", titulo: "Leer páginas", que: "schema.org, Crawl4AI o GLM sobre el texto" },
  { clave: "emparejar", titulo: "Emparejar", que: "¿Mismo producto? ¿Cuántas unidades trae?" },
  { clave: "resumir", titulo: "Resumir", que: "Validar y comparar con la referencia" },
];
const COINCIDE: Record<Oferta["coincidencia"], { texto: string; tono: Tone }> = {
  exacta: { texto: "Mismo producto", tono: "ok" },
  equivalente: { texto: "Equivalente", tono: "ok" },
  distinta: { texto: "Otro producto", tono: "muted" },
  sin_juicio: { texto: "Sin juicio", tono: "muted" },
};
const LECTURA: Record<string, string> = {
  api_tienda: "Búsqueda de la tienda",
  json_ld: "schema.org (JSON-LD)",
  microdatos: "schema.org (microdatos)",
  open_graph: "Open Graph",
  ia: "GLM sobre el texto",
  navegador_json_ld: "Navegador y schema.org",
  navegador_ia: "Navegador y GLM",
  contenedor_json_ld: "Crawl4AI y schema.org",
  contenedor_ia: "Crawl4AI y GLM",
  listado_json_ld: "Buscador de la tienda (schema.org)",
  listado_ia: "Buscador de la tienda, leído por GLM",
};
const tonoVeredicto = (v: string): Tone => (/muy por encima/i.test(v) ? "danger" : /por encima/i.test(v) ? "warn" : /en línea|por debajo|encontrado/i.test(v) ? "ok" : "muted");

/** Los rubros del directorio de tiendas (backend/precios-lab-worker/src/directorio.ts). */
const RUBRO: Record<string, string> = {
  farmacia: "farmacia", medico: "insumos médicos", oficina: "oficina", computo: "cómputo", ferreteria: "ferretería",
  limpieza: "limpieza", alimentos: "alimentos", hogar: "hogar", seguridad: "seguridad", automotriz: "automotriz",
};

/** El detalle de un paso, en palabras («12 ofertas», «3 sin precio»). */
function detallePaso(d: unknown): string {
  if (d == null) return "";
  if (typeof d === "string") return d;
  if (typeof d !== "object") return String(d);
  const o = d as Record<string, unknown>;
  const partes: string[] = [];
  const nombres: Record<string, string> = {
    ofertas: "ofertas", paginas: "páginas", ok: "con precio", sin_precio: "sin precio", robots: "no permitidas por robots.txt", rechazo: "rechazaron la lectura",
    error: "con error", navegador: "abiertas con navegador", armadas: "abiertas con Crawl4AI", ia: "leídas por GLM", exactas: "mismo producto", equivalentes: "equivalentes", distintas: "otro producto",
    sinJuicio: "sin juicio", validas: "válidas", tiendas: "tiendas por consultar",
  };
  for (const [k, v] of Object.entries(o)) {
    if (k === "busquedas" && Array.isArray(v)) partes.push(`busca ${v.map((x) => `«${x}»`).join(", ")}`);
    else if (k === "rubros" && Array.isArray(v)) partes.push(v.length ? `rubro ${v.map((x) => RUBRO[String(x)] ?? String(x)).join(", ")}` : "sin rubro");
    else if (k === "unidad") partes.push(`por ${v}`);
    else if (k === "via") partes.push(`de ${String(v).replace("pegadas", "las que pegaste").replace("duckduckgo", "DuckDuckGo").replace("tavily", "Tavily")}`);
    else if (k === "nota") partes.push(String(v));
    else if (k === "veredicto") partes.push(String(v));
    else if (k === "tiendas" && v && typeof v === "object") partes.push(`${Object.values(v as Record<string, string>).filter((x) => /productos/.test(x)).length} tiendas con resultados`);
    else if (typeof v === "number" && nombres[k]) partes.push(`${NUM.format(v)} ${nombres[k]}`);
  }
  return partes.join("; ");
}

function IconoPaso({ estado }: { estado: Paso["estado"] | undefined }) {
  if (estado === "listo") return <CheckCircle2 size={16} className="text-mossTexto" aria-hidden />;
  if (estado === "corriendo") return <Loader2 size={16} className="animate-spin text-clayTexto" aria-hidden />;
  if (estado === "error") return <XCircle size={16} className="text-crimsonTexto" aria-hidden />;
  if (estado === "saltado") return <CircleSlash size={16} className="text-mute" aria-hidden />;
  return <CircleDashed size={16} className="text-mute" aria-hidden />;
}

function Formulario({ onCreada, onContrato }: { onCreada: (id: string) => void; onContrato: (ocid: string) => void }) {
  const [modo, setModo] = useState<"texto" | "contrato">("texto");
  const [consulta, setConsulta] = useState("");
  const [especificacion, setEspecificacion] = useState("");
  const [unidad, setUnidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [ocid, setOcid] = useState("");
  const [item, setItem] = useState("");
  const [web, setWeb] = useState(true);
  const [enlaces, setEnlaces] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cuerpo: Record<string, unknown> = { web };
    if (modo === "contrato") {
      if (!/^[A-Za-z0-9-]{3,80}$/.test(ocid.trim())) return setError("Escribe el código del contrato (por ejemplo 1212841).");
      cuerpo.ocid = ocid.trim();
      if (item.trim()) cuerpo.item = Number(item);
      // Sin ítem: todos los ítems del contrato, escalonados (POST /admin/precios-lab/contrato).
      else {
        setEnviando(true);
        try {
          await adminFetch("/precios-lab/contrato", { method: "POST", body: JSON.stringify({ ocid: ocid.trim(), web }) });
          onContrato(ocid.trim());
        } catch (err) {
          setError(mensajeError(err));
        } finally {
          setEnviando(false);
        }
        return;
      }
    } else if (consulta.trim().length < 3) {
      return setError("Escribe el producto que quieres investigar.");
    }
    if (consulta.trim()) cuerpo.consulta = consulta.trim();
    if (especificacion.trim()) cuerpo.especificacion = especificacion.trim();
    if (unidad.trim()) cuerpo.unidad = unidad.trim();
    const p = Number(precio.replace(",", "."));
    if (precio.trim() && p > 0) cuerpo.precioReferencia = p;
    const urls = enlaces.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    if (urls.length > 10) return setError("Pega como mucho 10 enlaces.");
    if (urls.length) cuerpo.urls = urls;
    setEnviando(true);
    try {
      const r = await adminFetch<{ id: string }>("/precios-lab", { method: "POST", body: JSON.stringify(cuerpo) });
      onCreada(r.id);
      setConsulta("");
      setEspecificacion("");
      setPrecio("");
      setEnlaces("");
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const campo = "min-h-[38px] w-full rounded-lg border border-line bg-paperDeep px-3 text-dato text-ink placeholder:text-mute focus:border-granate/60";
  return (
    <Panel titulo="Nueva investigación" descripcion="Cada una cuesta centavos: GLM 5.3 flash y el contenedor de Crawl4AI mientras abre páginas.">
      <form onSubmit={enviar} className="space-y-3">
        <div role="radiogroup" aria-label="De dónde sale el producto" className="flex flex-wrap gap-2">
          {(["texto", "contrato"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              onClick={() => setModo(m)}
              className={claseBoton(modo === m ? "primario" : "secundario", "sm")}
            >
              {m === "texto" ? "Escribir el producto" : "Desde un contrato"}
            </button>
          ))}
        </div>
        {modo === "contrato" && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label className="space-y-1">
              <span className="text-meta text-mute">Código del contrato</span>
              <input className={campo} value={ocid} onChange={(e) => setOcid(e.target.value)} placeholder="1212841" inputMode="text" />
            </label>
            <label className="space-y-1">
              <span className="text-meta text-mute">Ítem</span>
              <input className={campo} value={item} onChange={(e) => setItem(e.target.value.replace(/\D/g, ""))} placeholder="todos" inputMode="numeric" />
            </label>
            {!item && (
              <p className="text-meta text-mute sm:col-span-2">Sin ítem se investigan todos los del contrato (hasta 12, uno cada 40 segundos) y ves el total.</p>
            )}
          </div>
        )}
        {(modo === "texto" || item) && (
          <>
            <label className="block space-y-1">
              <span className="text-meta text-mute">{modo === "contrato" ? "Producto (opcional: si lo dejas vacío, se usa el del ítem)" : "Producto"}</span>
              <input
                className={campo}
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                maxLength={300}
                placeholder="Papel bond A4 75 g, paquete de 500 hojas"
              />
            </label>
            <Expandable resumen="Especificación, unidad, precio a comparar y páginas" variante="caja">
              <div className="space-y-3 pt-1">
                <label className="block space-y-1">
                  <span className="text-meta text-mute">Especificación técnica (lo que piden las bases)</span>
                  <textarea className={`${campo} min-h-[96px] py-2`} value={especificacion} onChange={(e) => setEspecificacion(e.target.value)} maxLength={20000} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-meta text-mute">Unidad</span>
                    <input className={campo} value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="paquete" maxLength={60} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-meta text-mute">Precio unitario a comparar (S/)</span>
                    <input className={campo} value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="25.90" inputMode="decimal" />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-meta text-mute">Páginas que ya encontraste (una por línea, hasta 10): se leen siempre</span>
                  <textarea
                    className={`${campo} min-h-[72px] py-2 font-mono text-meta`}
                    value={enlaces}
                    onChange={(e) => setEnlaces(e.target.value)}
                    placeholder="https://www.tienda.pe/producto"
                  />
                </label>
              </div>
            </Expandable>
          </>
        )}
        <label className="flex items-center gap-2 text-dato text-ink">
          <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className="h-4 w-4 accent-granate" />
          Preguntar también a las tiendas del directorio (por rubro)
        </label>
        {error && <p className="text-meta text-crimsonTexto">{error}</p>}
        <button type="submit" disabled={enviando} className={claseBoton("primario", "md")}>
          {enviando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}{" "}
          {modo === "contrato" && !item ? "Investigar todos los ítems" : "Investigar precio"}
        </button>
      </form>
    </Panel>
  );
}

function VistaDetalle({ id, onContrato }: { id: string; onContrato?: (ocid: string) => void }) {
  const { data, error, mutate } = useAdmin<Detalle>(`/precios-lab/${id}`, {
    refreshInterval: (d) => (d && (d.estado === "listo" || d.estado === "error") ? 0 : 3_000),
  });
  const [verTodas, setVerTodas] = useState(false);
  if (error) return <ErrorBanner error={error} titulo="No se pudo leer la investigación" onReintentar={() => mutate()} />;
  if (!data) return <Panel titulo="Cargando la investigación"><Loader2 size={16} className="animate-spin text-mute" aria-hidden /></Panel>;
  const r = data.resumen;
  const pasos = new Map(data.pasos.map((p) => [p.nombre, p]));
  const ofertas = verTodas ? data.ofertas : data.ofertas.filter((o) => o.valida || o.coincidencia === "exacta" || o.coincidencia === "equivalente");
  const costo = data.costo_modelo + data.costo_web + (data.costo_contenedor ?? 0);
  const refs = data.entrada.referencias ?? [];

  const columnas: Columna<Oferta>[] = [
    {
      clave: "titulo",
      titulo: "Oferta",
      principal: true,
      celda: (o) => (
        <span className="block min-w-0">
          <a href={o.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
            {o.titulo}
          </a>
          <span className="block text-meta text-mute">
            {o.tienda}
            {o.vendedor ? `, vende ${o.vendedor}` : ""}
            {o.marca ? `, marca ${o.marca}` : ""}
          </span>
        </span>
      ),
    },
    { clave: "precio", titulo: "Precio", alinear: "derecha", celda: (o) => (o.moneda && o.moneda !== "PEN" ? `${o.moneda} ${o.precio}` : soles(o.precio)) },
    { clave: "unidades", titulo: "Unidades", alinear: "derecha", soloEscritorio: true, celda: (o) => (o.unidades != null ? NUM.format(o.unidades) : "") },
    { clave: "unitario", titulo: "Por unidad", alinear: "derecha", celda: (o) => <span className={o.valida ? "font-semibold" : "text-mute"}>{soles(o.precioUnitario)}</span> },
    {
      clave: "coincide",
      titulo: "Juicio",
      celda: (o) => (
        <span className="block">
          <Badge tono={COINCIDE[o.coincidencia].tono}>{COINCIDE[o.coincidencia].texto}</Badge>
          {o.razon && <span className="mt-0.5 block text-meta text-mute">{o.razon}</span>}
        </span>
      ),
      anchoCompletoMovil: true,
    },
    {
      clave: "lectura",
      titulo: "Cómo se leyó",
      soloEscritorio: true,
      celda: (o) => (
        <span className="block text-meta">
          {LECTURA[o.extraccion] ?? o.extraccion}
          {o.confirmado === true ? ", precio visto en la página" : o.confirmado === false ? ", precio NO visto en la página" : ""}
          {o.evidencia && (
            <a
              href={`/api/admin/precios-lab/${data.id}/evidencia/${o.evidencia.split("/").pop()}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-granate underline-offset-2 hover:underline"
            >
              evidencia <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </span>
      ),
    },
    {
      clave: "valida",
      titulo: "Cuenta",
      celda: (o) =>
        o.valida ? (
          <span className="flex flex-col items-start gap-1">
            <Badge tono="ok">Sí</Badge>
            {o.motivo && <span className="text-meta text-mute">{o.motivo}</span>}
          </span>
        ) : (
          <span className="text-meta text-mute">{o.motivo ?? "No"}</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <Panel
        titulo={data.consulta}
        descripcion={`Pedida ${hace(data.creado) ?? ""}${data.entrada.ocid ? `, del contrato ${data.entrada.ocid}${data.entrada.item ? ` ítem ${data.entrada.item}` : ""}` : ""}`}
        acciones={
          <span className="flex flex-wrap items-center gap-2">
            {data.entrada.ocid && onContrato && (
              <button type="button" className={claseBoton("secundario", "sm")} onClick={() => onContrato(data.entrada.ocid!)}>
                Todos los ítems del contrato
              </button>
            )}
            <Badge tono={ESTADO[data.estado].tono}>{ESTADO[data.estado].texto}</Badge>
          </span>
        }
      >
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PASOS.map((p, i) => {
            const e = pasos.get(p.clave);
            return (
              <li key={p.clave} className="flex gap-2 rounded-lg border border-line bg-paperSoft p-3">
                <IconoPaso estado={e?.estado} />
                <div className="min-w-0">
                  <p className="text-dato font-medium text-ink">
                    {i + 1}. {p.titulo}
                  </p>
                  <p className="text-meta text-mute">{e?.detalle ? detallePaso(e.detalle) : p.que}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {data.error && <p className="mt-3 text-meta text-crimsonTexto">Falló: {data.error}</p>}
      </Panel>

      {r && (
        <>
          <StatGrid columnas={4}>
            <StatCard etiqueta="Precio de mercado (mediana)" valor={r.mediana != null ? soles(r.mediana) : "Sin dato"} pista={data.ficha ? `por ${data.ficha.unidad_base}` : undefined} />
            <StatCard etiqueta="La mitad está entre" valor={r.p25 != null ? `${soles(r.p25)} y ${soles(r.p75)}` : "Sin dato"} pista={r.minimo != null ? `de ${soles(r.minimo)} a ${soles(r.maximo)}` : undefined} />
            <StatCard etiqueta="Ofertas que cuentan" valor={`${NUM.format(r.validas)} de ${NUM.format(r.n)}`} pista="mismo producto o equivalente, con precio confirmado" />
            <StatCard
              etiqueta="Frente a la referencia"
              valor={r.razon != null ? `${r.razon.toLocaleString("es-PE")} veces` : r.sinComparar ? "No se compara" : "Sin referencia"}
              pista={
                r.sinComparar
                  ? `${data.entrada.precioReferencia != null ? `${soles(data.entrada.precioReferencia)} por ${(data.entrada.unidad ?? "unidad").toLowerCase()}: ` : ""}${r.sinComparar}`
                  : r.referencia != null
                    ? `${soles(r.referencia)} por unidad`
                    : "Escribe un precio a comparar o parte de un contrato"
              }
              tono={tonoVeredicto(r.veredicto) === "danger" ? "danger" : tonoVeredicto(r.veredicto) === "warn" ? "warn" : "neutral"}
            />
          </StatGrid>
          <Panel titulo={r.veredicto} tono={tonoVeredicto(r.veredicto)}>
            <p className="text-dato text-ink">{r.nota}</p>
            {refs.length > 0 && (
              <ul className="mt-2 space-y-1 text-meta text-inkSoft">
                {refs.map((x) => (
                  <li key={x.fuente}>
                    El Estado: mediana de {soles(x.mediana)}
                    {x.unidad ? ` por ${x.unidad.toLowerCase()}` : ""} en {x.detalle}.
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {data.ficha && (
        <Expandable resumen="Lo que entendió el modelo" meta={data.ficha.nombre}>
          <KeyValue
            items={[
              { etiqueta: "Producto", valor: data.ficha.nombre },
              { etiqueta: "Se compara por", valor: data.ficha.unidad_base },
              { etiqueta: "Atributos", valor: data.ficha.atributos.map((a) => `${a.nombre}: ${a.valor}${a.obligatorio ? " (obligatorio)" : ""}`).join("; "), completo: true },
              { etiqueta: "Búsquedas en tiendas", valor: data.ficha.busquedas.map((b) => `«${b}»`).join(", "), completo: true },
              data.ficha.rubros
                ? { etiqueta: "Rubros", valor: data.ficha.rubros.length ? data.ficha.rubros.map((r) => RUBRO[r] ?? r).join(", ") : "ninguno", completo: true }
                : { etiqueta: "Búsqueda web", valor: data.ficha.busqueda_web, completo: true },
            ]}
          />
        </Expandable>
      )}

      {data.ofertas.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-dato font-semibold text-ink">Ofertas</h3>
            <button type="button" className={claseBoton("fantasma", "sm")} onClick={() => setVerTodas((v) => !v)}>
              {verTodas ? "Solo las que coinciden" : `Ver las ${NUM.format(data.ofertas.length)}, también las descartadas`}
            </button>
          </div>
          <DataTable etiqueta="Ofertas encontradas" columnas={columnas} filas={ofertas} claveFila={(o) => String(o.n)} porPagina={25} apilarHasta="lg" />
        </section>
      )}

      <p className="text-meta text-mute">
        Gasto: {usd(costo)} ({NUM.format(data.tokens_entrada + data.tokens_salida)} tokens de GLM 5.3 flash
        {data.busquedas_web ? `, ${data.busquedas_web} búsqueda web` : ""}
        {data.segundos_navegador ? `, ${Math.round(data.segundos_navegador)} s de navegador` : ""}
        {data.segundos_contenedor ? `, ${Math.round(data.segundos_contenedor)} s de Crawl4AI` : ""}).
      </p>
    </div>
  );
}

/** Todos los ítems de un contrato: lo que pagó el Estado frente a la mediana de las tiendas, ítem por ítem y en total. */
function VistaContrato({ ocid, abierto, onAbrir }: { ocid: string; abierto: string | null; onAbrir: (id: string) => void }) {
  const { data, error, mutate } = useAdmin<Contrato>(`/precios-lab/contrato/${encodeURIComponent(ocid)}`, {
    refreshInterval: (d) => (d?.items.some((i) => i.investigacion && (i.investigacion.estado === "en_cola" || i.investigacion.estado === "corriendo")) ? 8_000 : 0),
  });
  const [lanzando, setLanzando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  if (error) return <ErrorBanner error={error} titulo="No se pudo leer el contrato" onReintentar={() => mutate()} />;
  if (!data) return <Panel titulo={`Contrato ${ocid}`}><Loader2 size={16} className="animate-spin text-mute" aria-hidden /></Panel>;

  const faltan = data.items.filter((i) => !i.sinTiendas && (!i.investigacion || i.investigacion.estado === "error")).length;
  const enCurso = data.items.filter((i) => i.investigacion && (i.investigacion.estado === "en_cola" || i.investigacion.estado === "corriendo")).length;
  const { comparados, encima, pagado, mercado } = data.total;
  const diferencia = pagado - mercado;
  const lanzar = async (repetir = false) => {
    setLanzando(true);
    setAviso(null);
    try {
      const r = await adminFetch<{ lanzadas: { item: number; id?: string; error?: string }[]; quedan: number }>("/precios-lab/contrato", {
        method: "POST",
        body: JSON.stringify({ ocid, repetir }),
      });
      const ok = r.lanzadas.filter((x) => x.id).length;
      setAviso(`${ok} ${ok === 1 ? "ítem en cola" : "ítems en cola"}${r.quedan ? `; quedan ${r.quedan} para la siguiente tanda` : ""}.`);
      mutate();
    } catch (err) {
      setAviso(mensajeError(err));
    } finally {
      setLanzando(false);
    }
  };

  const pagoDe = (i: ItemContrato) => i.precioAdjudicado ?? i.precioReferencial;
  const columnas: Columna<ItemContrato>[] = [
    {
      clave: "item",
      titulo: "Ítem",
      principal: true,
      celda: (i) => (
        <span className="block min-w-0">
          <span className="text-ink">
            {i.item}. {i.descripcion}
          </span>
          <span className="block text-meta text-mute">
            {i.cantidad != null ? `${NUM.format(i.cantidad)} ${(i.unidad ?? "").toLowerCase()}` : i.unidad}
          </span>
        </span>
      ),
    },
    {
      clave: "pago",
      titulo: "Pagó el Estado",
      alinear: "derecha",
      celda: (i) => (
        <span className="block">
          {soles(pagoDe(i))}
          <span className="block text-meta text-mute">{i.precioAdjudicado != null ? "adjudicado" : i.precioReferencial != null ? "referencial" : ""}</span>
        </span>
      ),
    },
    {
      clave: "mercado",
      titulo: "Tiendas (mediana)",
      alinear: "derecha",
      celda: (i) => {
        const v = i.investigacion;
        if (!v || v.mediana == null) return "";
        return (
          <span className="block">
            {soles(v.mediana)}
            {v.p25 != null && <span className="block text-meta text-mute">{`${soles(v.p25)} a ${soles(v.p75)}`}</span>}
          </span>
        );
      },
    },
    { clave: "razon", titulo: "Veces", alinear: "derecha", celda: (i) => (i.investigacion?.razon != null ? i.investigacion.razon.toLocaleString("es-PE") : "") },
    {
      clave: "resultado",
      titulo: "Resultado",
      anchoCompletoMovil: true,
      celda: (i) => {
        const v = i.investigacion;
        if (i.sinTiendas) return <span className="text-meta text-mute">Servicio o monto global: no se compara en tiendas</span>;
        if (!v) return <span className="text-meta text-mute">Sin investigar</span>;
        if (v.estado !== "listo") return <Badge tono={ESTADO[v.estado].tono}>{v.estado === "corriendo" && v.paso ? `${ESTADO[v.estado].texto}: ${v.paso}` : ESTADO[v.estado].texto}</Badge>;
        return (
          <span className="flex flex-col items-start gap-1">
            <Badge tono={tonoVeredicto(v.veredicto ?? "")}>{v.veredicto}</Badge>
            {v.caja ? <span className="text-meta text-clayTexto">¿Caja de {v.caja}? Revisa la unidad en las bases</span> : null}
            {v.sinComparar ? <span className="text-meta text-clayTexto">No se compara: {v.sinComparar}</span> : null}
            {!i.cuentaEnTotal && !v.caja && !v.sinComparar ? <span className="text-meta text-mute">No entra en el total</span> : null}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Panel
        titulo={data.contrato.titulo ?? `Contrato ${ocid}`}
        descripcion={`${data.contrato.entidad ? `${data.contrato.entidad}, ` : ""}contrato ${data.contrato.codigo ?? ocid}, ${data.items.length} ${data.items.length === 1 ? "ítem" : "ítems"}`}
        acciones={
          faltan > 0 ? (
            <button type="button" className={claseBoton("primario", "sm")} onClick={() => lanzar()} disabled={lanzando}>
              {lanzando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />} Investigar {faltan === 1 ? "el que falta" : `los ${faltan} que faltan`}
            </button>
          ) : enCurso > 0 ? (
            <Badge tono="pending">{enCurso} en curso</Badge>
          ) : (
            <button type="button" className={claseBoton("secundario", "sm")} onClick={() => lanzar(true)} disabled={lanzando}>
              {lanzando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />} Volver a investigar
            </button>
          )
        }
      >
        <StatGrid columnas={4}>
          <StatCard etiqueta="Ítems comparados" valor={`${NUM.format(comparados)} de ${NUM.format(data.items.length)}`} pista={`${NUM.format(encima)} por encima del mercado`} tono={encima > 0 ? "warn" : "neutral"} />
          <StatCard etiqueta="Pagó el Estado" valor={comparados ? soles(pagado) : null} pista="en los ítems comparados" />
          <StatCard etiqueta="A la mediana de las tiendas" valor={comparados ? soles(mercado) : null} pista="mismas cantidades" />
          <StatCard
            etiqueta="Diferencia"
            valor={comparados ? soles(diferencia) : null}
            pista={comparados && mercado > 0 ? `${diferencia >= 0 ? "+" : ""}${Math.round((pagado / mercado - 1) * 100)} % frente a las tiendas` : undefined}
            tono={comparados && mercado > 0 && pagado / mercado >= 1.15 ? "danger" : "neutral"}
          />
        </StatGrid>
        <p className="mt-3 text-meta text-mute">
          El total suma solo los ítems con 3 o más ofertas válidas, sin sospecha de caja y cuya unidad se puede comparar. Es un indicio, no una prueba: el Estado compra por
          volumen y con entrega, y la tienda vende al por menor.
        </p>
        {aviso && <p className="mt-2 text-meta text-inkSoft">{aviso}</p>}
      </Panel>
      <DataTable
        etiqueta="Ítems del contrato"
        columnas={columnas}
        filas={data.items}
        claveFila={(i) => String(i.item)}
        onFila={(i) => i.investigacion && onAbrir(i.investigacion.id)}
        filaActiva={(i) => !!abierto && i.investigacion?.id === abierto}
        porPagina={15}
        apilarHasta="lg"
      />
    </div>
  );
}

function Laboratorio() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const contrato = params.get("contrato");
  const { data, error, mutate, isLoading } = useAdmin<{ investigaciones: Fila[]; total: { n: number; costo: number } }>("/precios-lab", { refreshInterval: 10_000 });
  // ?contrato= (todos los ítems de un contrato) y ?id= (una investigación) conviven: se abre un ítem sin perder el contrato.
  const ir = (c: string | null, i: string | null) => {
    const q = new URLSearchParams();
    if (c) q.set("contrato", c);
    if (i) q.set("id", i);
    router.replace(q.size ? `/admin/precios?${q}` : "/admin/precios", { scroll: false });
  };
  const elegir = (nuevo: string | null) => ir(null, nuevo);

  const columnas: Columna<Fila>[] = [
    {
      clave: "consulta",
      titulo: "Producto",
      principal: true,
      celda: (f) => (
        <span className="block min-w-0">
          {f.consulta}
          {f.ocid && <span className="block text-meta text-mute">contrato {f.ocid}{f.item ? `, ítem ${f.item}` : ""}</span>}
        </span>
      ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (f) => <Badge tono={ESTADO[f.estado].tono}>{f.estado === "corriendo" && f.paso ? `${ESTADO[f.estado].texto}: ${f.paso}` : ESTADO[f.estado].texto}</Badge>,
    },
    { clave: "veredicto", titulo: "Resultado", celda: (f) => f.veredicto ?? "" , anchoCompletoMovil: true },
    { clave: "mediana", titulo: "Mediana", alinear: "derecha", celda: (f) => soles(f.mediana) },
    { clave: "costo", titulo: "Costo", alinear: "derecha", soloEscritorio: true, celda: (f) => usd(f.costo ?? 0) },
    { clave: "creado", titulo: "Cuándo", alinear: "derecha", celda: (f) => hace(f.creado) ?? "" },
  ];

  return (
    <AdminShell title="Laboratorio de precios" subtitle="Precio de mercado de un producto: tiendas peruanas, el buscador propio de cada tienda del rubro y lo que pagó el Estado, con GLM 5.3 flash y Crawl4AI">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Formulario
            onCreada={(nuevo) => {
              mutate();
              elegir(nuevo);
            }}
            onContrato={(c) => {
              mutate();
              ir(c, null);
            }}
          />
          <div className="min-w-0 space-y-3">
            {error && <ErrorBanner error={error} titulo="No se pudo leer el laboratorio" onReintentar={() => mutate()} />}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-dato font-semibold text-ink">Investigaciones</h2>
              {data && (
                <span className="text-meta text-mute">
                  {NUM.format(data.total.n)} en total, {usd(data.total.costo ?? 0)} gastados
                </span>
              )}
            </div>
            <DataTable
              etiqueta="Investigaciones de precio"
              columnas={columnas}
              filas={data?.investigaciones}
              claveFila={(f) => f.id}
              onFila={(f) => elegir(f.id)}
              cargando={isLoading}
              porPagina={10}
              vacio={<EmptyState compacto titulo="Todavía no hay investigaciones" descripcion="Escribe un producto o parte de un contrato." />}
            />
          </div>
        </div>
        {contrato ? <VistaContrato ocid={contrato} abierto={id} onAbrir={(i) => ir(contrato, i)} /> : null}
        {id ? <VistaDetalle id={id} onContrato={contrato ? undefined : (c) => ir(c, id)} /> : null}
      </div>
    </AdminShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Laboratorio />
    </Suspense>
  );
}
