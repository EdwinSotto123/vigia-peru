"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Download, Printer, SearchX } from "lucide-react";
import { Buscador } from "@/components/listado/BarraFiltros";
import { Paginacion } from "@/components/ui/Paginacion";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import type { EvidenciaCruce } from "@/lib/contratos";
import { coincide, fechaCorta, numero, oracion, paraBuscar, porcentaje, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { descargarCsv, nombreArchivo } from "@/lib/csv";

/**
 * Los registros de la fuente bajo un antecedente del ganador (lib/evidencia.ts de la API): en escritorio una tabla, en
 * el teléfono una tarjeta por registro. Con más de `TAM` registros, paginados y con un buscador que filtra en el
 * navegador por lo que se ve en cada fila (sin tildes ni mayúsculas, todas las palabras). Antes se veían todos de una
 * vez (hasta 60) o "los 60 más recientes de 400".
 *
 * Lo que la fila muestra ya llega sin DNI ni nombres de personas naturales (la API), así que buscar en ella no
 * descubre nada que no esté a la vista. «Descargar CSV» (fase 6) baja lo que se ve, con el enlace de cada registro y
 * la fuente de la evidencia, para revisarla fuera de Vigía. «Imprimir o guardar PDF» imprime sólo esta evidencia (la
 * sección `[data-evidencia]` que la contiene, con todas sus filas, no la página), en modo día y con la dirección de cada
 * enlace: una copia en `#vigia-impresion` que globals.css deja como lo único en el papel.
 */

const TAM = 10;
const BOTON =
  "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line px-3 text-rotulo font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink disabled:opacity-60";

export function TablaEvidencia({
  columnas,
  filas,
  titulo,
  fuente,
}: {
  columnas: EvidenciaCruce["columnas"];
  filas: EvidenciaCruce["filas"];
  /** El nombre de la evidencia (el del archivo CSV). */
  titulo?: string;
  /** La fuente de toda la evidencia: va en cada fila del CSV. */
  fuente?: EvidenciaCruce["enlace"];
}) {
  const [consulta, setConsulta] = useState("");
  const [pagina, setPagina] = useState(1);
  const raiz = useRef<HTMLDivElement>(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  // Al imprimir, la tabla ya tiene todas las filas (abajo): se copia su sección, se imprime y se deja todo como estaba.
  useEffect(() => {
    if (!imprimiendo) return;
    const objetivo = raiz.current?.closest<HTMLElement>("[data-evidencia]") ?? raiz.current;
    if (!objetivo) {
      setImprimiendo(false);
      return;
    }
    const html = document.documentElement;
    const modo = html.dataset.modo;
    const copia = document.createElement("div");
    copia.id = "vigia-impresion";
    const cabecera = document.createElement("div");
    cabecera.className = "vigia-impresion-cabecera";
    const hoy = new Date().toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });
    for (const t of [
      `Vigía Perú: evidencia de «${titulo ?? "un antecedente"}»`,
      `${document.title}. ${window.location.href}`,
      `Impreso el ${hoy}. Es un indicio para revisar, no una acusación: cada registro enlaza a su fuente oficial.`,
    ]) {
      const p = document.createElement("p");
      p.textContent = t;
      cabecera.appendChild(p);
    }
    copia.appendChild(cabecera);
    copia.appendChild(objetivo.cloneNode(true));
    document.body.appendChild(copia);
    document.body.dataset.imprimir = "evidencia";
    html.dataset.modo = "dia"; // en papel, siempre el modo día
    let listo = false;
    const impresora = window.matchMedia("print");
    const fin = () => {
      if (listo) return;
      listo = true;
      copia.remove();
      delete document.body.dataset.imprimir;
      if (modo) html.dataset.modo = modo;
      else delete html.dataset.modo;
      setImprimiendo(false);
    };
    const alCambiar = (e: MediaQueryListEvent) => {
      if (!e.matches) fin();
    };
    window.addEventListener("afterprint", fin);
    impresora.addEventListener("change", alCambiar);
    window.print();
    return () => {
      window.removeEventListener("afterprint", fin);
      impresora.removeEventListener("change", alCambiar);
    };
  }, [imprimiendo, titulo]);
  const indice = useMemo(() => filas.map((f) => paraBuscar(columnas.map((c) => textoDe(c.tipo, f[c.clave])).join(" "))), [filas, columnas]);
  const q = paraBuscar(consulta);
  const vistas = useMemo(() => (q ? filas.filter((_, i) => coincide(indice[i], q)) : filas), [filas, indice, q]);
  const paginas = Math.max(1, Math.ceil(vistas.length / TAM));
  const actual = Math.min(pagina, paginas);
  // Para imprimir, todas las filas que pasan la búsqueda; si no, las de la página.
  const pagina_ = imprimiendo ? vistas : vistas.slice((actual - 1) * TAM, actual * TAM);
  const largo = filas.length > TAM;
  const bajar = () => {
    const absoluta = (url: string) => (url.startsWith("/") ? `${window.location.origin}${url}` : url);
    const hayDespues = vistas.some((f) => f.posterior === true);
    const cols = [
      ...columnas.flatMap((c) => (c.tipo === "enlace" ? [c.titulo, `${c.titulo} (enlace)`] : [c.titulo])),
      ...(hayDespues ? ["Después de este proceso"] : []),
      ...(fuente ? ["Fuente", "Enlace a la fuente"] : []),
    ];
    const csv = vistas.map((f) => {
      const fila: Record<string, unknown> = {};
      for (const c of columnas) {
        const v = f[c.clave];
        if (c.tipo === "enlace" && v && typeof v === "object") {
          const { texto, url } = v as { texto: string; url: string };
          fila[c.titulo] = texto;
          fila[`${c.titulo} (enlace)`] = absoluta(url);
        } else fila[c.titulo] = v ?? "";
      }
      if (hayDespues) fila["Después de este proceso"] = f.posterior === true ? "sí" : "no";
      if (fuente) Object.assign(fila, { Fuente: fuente.texto, "Enlace a la fuente": absoluta(fuente.url) });
      return fila;
    });
    descargarCsv(cols, csv, `evidencia-${nombreArchivo(titulo ?? "registros")}`);
  };
  const control = vistas.length > TAM && !imprimiendo && (
    <div className="flex justify-end">
      <Paginacion actual={actual} paginas={paginas} total={vistas.length} tam={TAM} navegacion="interna" onChange={setPagina} cargando={false} nombre="registros" />
    </div>
  );

  return (
    <div ref={raiz} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
        {largo && (
          <Buscador
            placeholder="Buscar en estos registros…"
            etiqueta="Buscar en los registros de la evidencia"
            valor={consulta}
            onBuscar={(v) => {
              setConsulta(v);
              setPagina(1);
            }}
          />
        )}
        {q && (
          <span className="text-meta tabular-nums text-mute" aria-live="polite">
            {numero(vistas.length)} de {numero(filas.length)}
          </span>
        )}
        {vistas.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={bajar} className={BOTON}>
              <Download size={14} aria-hidden /> Descargar CSV ({numero(vistas.length)})
            </button>
            <button type="button" onClick={() => setImprimiendo(true)} disabled={imprimiendo} className={BOTON}>
              <Printer size={14} aria-hidden /> Imprimir o guardar PDF
            </button>
          </span>
        )}
      </div>
      {q && vistas.length === 0 ? (
        <EstadoVacio icono={<SearchX size={16} />}>Ningún registro coincide con “{consulta}”.</EstadoVacio>
      ) : (
        <>
          {control}
          {/* Escritorio: tabla. */}
          {/* Dentro de una tarjeta, sin marco propio (sólo el filete de arriba): una caja dentro de otra era ruido. */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-paper sm:block [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0">
            <table className="w-full text-left text-meta">
              <thead className="bg-paperDeep/60 text-rotulo text-mute">
                <tr>
                  {columnas.map((col) => (
                    <th key={col.clave} scope="col" className={`px-3 py-1.5 font-medium ${col.tipo === "soles" || col.tipo === "pct" ? "text-right" : ""}`}>
                      {col.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pagina_.map((f, i) => (
                  <tr key={i} className={`align-top ${f.posterior ? "opacity-55" : ""}`}>
                    {columnas.map((col) => (
                      <td
                        key={col.clave}
                        className={`px-3 py-1.5 text-ink ${col.tipo === "soles" || col.tipo === "pct" ? "whitespace-nowrap text-right font-mono tabular-nums" : ""} ${col.tipo === "fecha" ? "whitespace-nowrap" : ""}`}
                      >
                        <Celda tipo={col.tipo} valor={f[col.clave]} />
                        {col.tipo === "fecha" && f.posterior === true && <MarcaDespues />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Teléfono: un registro por tarjeta. */}
          <ul className="space-y-2 sm:hidden">
            {pagina_.map((f, i) => (
              <li key={i} className={`rounded-lg border border-line bg-paper px-3 py-2 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-t-0 [.tarjeta_&]:px-0 ${f.posterior ? "opacity-55" : ""}`}>
                <dl className="space-y-1 text-meta">
                  {columnas.map((col) => (
                    <div key={col.clave} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-mute">{col.titulo}</dt>
                      <dd className="min-w-0 text-right text-ink">
                        <Celda tipo={col.tipo} valor={f[col.clave]} />
                        {col.tipo === "fecha" && f.posterior === true && <MarcaDespues />}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          {control}
        </>
      )}
    </div>
  );
}

/** El texto en que busca una celda: lo mismo que se ve. */
function textoDe(tipo: EvidenciaCruce["columnas"][number]["tipo"], valor: unknown): string {
  if (valor == null || valor === "") return "";
  if (tipo === "fecha") return fechaCorta(String(valor));
  if (tipo === "enlace" && typeof valor === "object") return String((valor as { texto?: string }).texto ?? "");
  return String(valor);
}

/** Junto a la fecha de un registro posterior a la convocatoria: no era un antecedente cuando se adjudicó. */
function MarcaDespues() {
  return <span className="ml-1.5 whitespace-nowrap rounded bg-paperDeep px-1.5 py-px text-micro font-medium text-inkSoft">después</span>;
}

/** Un valor de la evidencia según su columna: fecha, soles, porcentaje, enlace (interno o a la fuente) o texto. */
function Celda({ tipo, valor }: { tipo?: EvidenciaCruce["columnas"][number]["tipo"]; valor: unknown }) {
  if (valor == null || valor === "") return <span className="text-mute">Sin dato</span>;
  if (tipo === "fecha") return <>{fechaCorta(String(valor))}</>;
  if (tipo === "soles") return <>{soles(Number(valor))}</>;
  if (tipo === "pct") {
    const v = Number(valor);
    // S/ 4 mil de una campaña de S/ 127 M es 0,0035 %: decir "0 %" haría pensar que no hubo nada.
    if (v > 0 && v < 0.01) return <>menos de 0.01 %</>;
    return <>{porcentaje(v, { decimales: v < 1 ? 2 : 1 })}</>;
  }
  if (tipo === "enlace" && typeof valor === "object") {
    const { texto, url } = valor as { texto: string; url: string };
    const etiqueta = texto.length > 30 ? oracion(texto) : texto;
    // Las descripciones del SEACE llegan a 600 caracteres: tres líneas y el resto en el title.
    return url.startsWith("/") ? (
      <Link href={url} title={etiqueta} className="line-clamp-3 text-ink underline decoration-line underline-offset-2 hover:decoration-ink">{etiqueta}</Link>
    ) : (
      <a href={url} target="_blank" rel="noopener noreferrer" title={etiqueta} className="line-clamp-3 text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
        {etiqueta} <ArrowUpRight size={11} aria-hidden className="inline align-baseline" />
      </a>
    );
  }
  const t = String(valor);
  // Los textos de las fuentes vienen en mayúsculas: nombres cortos a título, descripciones como oración.
  return <>{t === t.toUpperCase() ? (t.length > 60 ? oracion(t) : tituloNatural(t)) : t}</>;
}
