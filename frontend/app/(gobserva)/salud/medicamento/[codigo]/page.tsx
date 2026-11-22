import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, CircleCheck, ClipboardList, Layers, Pill, ShieldCheck, TriangleAlert } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { Migas } from "@/components/patrones/Migas";
import { CabeceraPestana, Pestanas, type Pestana } from "@/components/patrones/Pestanas";
import { Pixel } from "@/components/pixel/Pixel";
import { FuenteFecha } from "@/components/salud/comun";
import { TarjetaMedicamento } from "@/components/salud/medicamentos/Catalogo";
import { FilaAlerta, FilaMedicamento, nombreMed, textoRevisadas } from "@/components/salud/medicamentos/piezas";
import { BotonGuardarSalud } from "@/components/salud/cuenta/BotonGuardar";
import { AnotarVisto } from "@/components/salud/vistos/Vistos";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { formaDe } from "@/lib/salud-formas";
import { concentracionLegible, fechaCorta, getMedicamento, vencimientoValido, mesLargo, numero, rutaMedicamento, soles, type FichaMedicamento } from "@/lib/gobserva-salud";

export const revalidate = 3600;

type Props = { params: { codigo: string }; searchParams: { seccion?: string | string[] } };

function titulo(f: FichaMedicamento): string {
  const p = f.producto;
  return [nombreMed(p.nombre), concentracionLegible(p.concentracion)].filter(Boolean).join(" ");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const f = await getMedicamento(params.codigo);
  if (!f) return { title: "Medicamento no encontrado", robots: { index: false } };
  const p = f.producto;
  const alertas = f.alertasRegistro.length;
  return {
    title: `${titulo(f)}: precio de referencia y alertas DIGEMID`,
    description: `${titulo(f)} (${nombreMed(p.forma)}), registro sanitario ${p.registro ?? "sin dato"}, de ${nombreMed(p.titular).replace(/\.$/, "")}. Precio típico ${soles(p.precioMediana)} por unidad en ${mesLargo(p.periodo)}. ${alertas ? `${alertas === 1 ? "Una alerta" : `${alertas} alertas`} de DIGEMID sobre su registro.` : "Sin alertas de DIGEMID sobre su registro."}`.slice(0, 300),
    alternates: { canonical: urlCanonica("salud", rutaMedicamento(p.codigo)) },
  };
}

function Dato({ t, children, mono }: { t: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-line py-2.5 last:border-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-meta font-medium text-mute">{t}</dt>
      <dd className={mono ? "font-mono text-dato text-ink" : "text-dato text-ink"}>{children}</dd>
    </div>
  );
}

/**
 * La ficha de un medicamento en Gobserva Salud (2026-11-21): arriba qué es, su precio típico y si DIGEMID emitió alertas
 * sobre su registro sanitario (lo primero que importa); en pestañas, sus datos, los que tienen el mismo principio activo
 * ordenados por precio, las alertas, sus otras presentaciones y cómo verificar la caja. GET /salud/medicamento/:codigo.
 */
export default async function FichaMedicamentoPagina({ params, searchParams }: Props) {
  const f = await getMedicamento(params.codigo);
  if (!f) notFound();
  const base = baseProducto("salud");
  const p = f.producto;
  const nombre = titulo(f);
  const seccion = typeof searchParams.seccion === "string" ? searchParams.seccion : undefined;
  const ico = (I: typeof Pill) => <I size={15} aria-hidden />;
  const r = f.equivalentesResumen;
  const masBarato = f.equivalentes.find((e) => e.precioMediana != null && p.precioMediana != null && e.precioMediana < p.precioMediana) ?? null;
  // Las alertas por nombre (2026-11-22, cacería de errores): las de seguridad o modificación son del principio activo y LE
  // APLICAN; las demás (falsificados, calidad) son de otras cajas que usan su marca: no son de este producto. Un genérico
  // (se llama como su principio activo) sólo trae las primeras: no se le atribuyen cajas de otros laboratorios.
  const deSeguridad = f.alertasNombre.filter((a) => a.tipo === "seguridad" || a.tipo === "modificacion");
  const deMarca = f.generico ? [] : f.alertasNombre.filter((a) => a.tipo !== "seguridad" && a.tipo !== "modificacion");
  const alertas = f.alertasRegistro.length + f.alertasNombre.length;
  const masNombre = Math.max(0, (f.alertasNombreTotal ?? 0) - f.alertasNombre.length);
  // Los lotes de las cajas de esta marca que nombran esas alertas, con su vencimiento: se comparan con el de la caja. Sólo
  // las filas con TODAS las palabras de la marca (no «DOLO» de Dolo-Neurobión para Dolo Neuropress).
  const juntar = (t: string) => ` ${t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
  const palabrasMarca = juntar(f.marca).trim().split(" ").filter(Boolean);
  const lotesMarca = [
    ...new Map(
      deMarca.flatMap((a) =>
        (a.observados ?? [])
          .filter((o) => palabrasMarca.every((w) => juntar(`${o.producto} ${o.presentacion ?? ""}`).includes(` ${w} `)))
          .flatMap((o) =>
            o.lotes.map((l) => [l, { lote: l, numero: a.numero, vence: o.vencimientos.find(vencimientoValido) ?? null }] as const),
          ),
      ),
    ).values(),
  ];
  const falsificadas = deMarca.filter((a) => a.tipo === "falsificado").length;

  const pestanas: Pestana[] = [
    {
      clave: "alertas",
      etiqueta: "Alertas",
      icono: ico(TriangleAlert),
      // Las de su registro y las de seguridad (le aplican); no las de otras cajas que usan su marca.
      conteo: f.alertasRegistro.length + deSeguridad.length || null,
      contenido: (
        <div className="space-y-4">
          <CabeceraPestana acciones={<FuenteFecha nombre="Alertas DIGEMID" url={f.fuente.avisos.url} al={f.fuente.avisos.al} />}>
            Las alertas de DIGEMID que nombran su registro sanitario o su marca.
          </CabeceraPestana>
          <form action={rutaEn(base, "/medicamentos")} className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-3 sm:flex-row sm:items-center">
            <label htmlFor="lote-caja" className="shrink-0 px-1 text-dato font-semibold text-ink">
              ¿Tienes la caja?
            </label>
            {/* Con el registro de esta ficha: la página responde por los dos (el lote está o no en una alerta). */}
            {p.registro ? <input type="hidden" name="q" value={p.registro} /> : null}
            <input
              id="lote-caja"
              name={p.registro ? "lote" : "q"}
              required
              minLength={4}
              placeholder="El lote de tu caja (Lote o L.)"
              className="h-11 min-h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/25 sm:flex-1 sm:text-dato"
            />
            <button type="submit" className="gs-hunde inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep">
              Buscar el lote en las alertas
            </button>
          </form>
          {f.lotesObservados && f.lotesObservados.length > 0 && (
            <section aria-labelledby="lotes-t" className="rounded-2xl border border-crimson/30 bg-paper">
              <h3 id="lotes-t" className="border-b border-line px-5 py-3 text-cuerpo font-bold text-ink">
                {f.lotesObservados.length === 1 ? "Un lote observado" : `${f.lotesObservados.length} lotes observados`} de este registro sanitario
              </h3>
              <ul className="divide-y divide-line">
                {f.lotesObservados.map((l, i) => (
                  <li key={`${l.lote}-${i}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-2.5 text-meta">
                    <span className="rounded-md bg-crimson-soft px-1.5 py-0.5 font-mono font-semibold text-crimsonTexto">{l.lote}</span>
                    {l.vencimiento && <span className="text-inkSoft">Vence {l.vencimiento}</span>}
                    {l.presentacion && <span className="text-inkSoft">{l.presentacion}</span>}
                    <span className="text-mute">{l.numero ? `Alerta N.° ${l.numero}` : "Alerta"}, {fechaCorta(l.fecha)}</span>
                    {l.detalle && <span className="basis-full text-inkSoft">{l.detalle}</span>}
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-2.5 text-meta text-mute">Si tu caja no es de estos lotes, estas alertas no hablan de ella.</p>
            </section>
          )}
          {f.alertasRegistro.length > 0 && (
            <section aria-labelledby="por-registro" className="rounded-2xl border border-crimson/30 bg-crimson-soft/40">
              <h3 id="por-registro" className="border-b border-crimson/20 px-5 py-3 text-cuerpo font-bold text-ink">
                Sobre su registro sanitario {p.registro}
              </h3>
              <ul className="divide-y divide-crimson/15">
                {f.alertasRegistro.map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} base={base} resaltar={p.registro} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {deSeguridad.length > 0 && (
            <section aria-labelledby="por-seguridad" className="rounded-2xl border border-amber/40 bg-amber-soft/30">
              <h3 id="por-seguridad" className="border-b border-amber/30 px-5 py-3 text-cuerpo font-bold text-ink">
                {deSeguridad.length === 1 ? "Una alerta de seguridad" : `${deSeguridad.length} alertas de seguridad`} sobre{" "}
                {f.generico ? `el ${nombreMed(f.marca).toLowerCase()}` : `«${nombreMed(f.marca)}»`}
              </h3>
              <p className="px-5 pt-3 text-dato leading-relaxed text-inkSoft">
                Son sobre su principio activo{nombreMed(p.ifa) ? ` (${nombreMed(p.ifa).toLowerCase()})` : ""}: le aplican a este producto y a los demás
                que lo contienen. Léelas antes de tomarlo.
              </p>
              <ul className="mt-2 divide-y divide-amber/25 bg-paper">
                {deSeguridad.map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} base={base} plegada />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {deMarca.length > 0 && (
            <section aria-labelledby="por-nombre" className="rounded-2xl border border-line bg-paper">
              <h3 id="por-nombre" className="border-b border-line px-5 py-3 text-cuerpo font-bold text-ink">
                {falsificadas === deMarca.length
                  ? `Cajas falsificadas que usan el nombre «${nombreMed(f.marca)}»`
                  : `Otras cajas que usan el nombre «${nombreMed(f.marca)}»`}
              </h3>
              <p className="px-5 pt-3 text-dato leading-relaxed text-inkSoft">
                No son alertas sobre este producto{p.registro ? ` (registro ${p.registro})` : ""}
                {nombreMed(p.titular) ? `, de ${nombreMed(p.titular)}` : ""}: DIGEMID incautó o retiró cajas
                {falsificadas ? " falsificadas" : ""} que usan su nombre. Lo que importa es el lote de tu caja.
              </p>
              {lotesMarca.length > 0 && (
                <div className="mx-5 mt-3 rounded-xl border border-amber/40 bg-amber-soft/50 px-4 py-3">
                  <p className="text-dato font-semibold text-ink">
                    {lotesMarca.length === 1 ? "El lote de una caja observada" : "Los lotes de las cajas observadas"}, con su vencimiento cuando la alerta lo
                    dice. Si tu caja tiene el mismo lote y el mismo vencimiento, no la uses y pregunta donde la compraste.
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {lotesMarca.map((l) => (
                      <span key={l.lote} className="rounded-md bg-paper px-1.5 py-0.5 text-meta tabular-nums text-ink ring-1 ring-amber/40" title={l.numero ? `Alerta N.° ${l.numero}` : undefined}>
                        <span className="font-mono font-semibold">{l.lote}</span>
                        {l.vence ? <span className="text-inkSoft">, vence {l.vence}</span> : null}
                      </span>
                    ))}
                  </p>
                </div>
              )}
              <ul className="mt-2 divide-y divide-line">
                {deMarca.map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} base={base} resaltar={p.registro} soloDe={f.marca} plegada />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {masNombre > 0 && (
            <p className="text-meta">
              <Link
                href={`${rutaEn(base, "/medicamentos")}?${new URLSearchParams({ q: nombreMed(f.marca), seccion: "alertas" })}`}
                className="inline-flex min-h-11 items-center font-semibold text-granate underline-offset-4 hover:underline"
              >
                Ver las {numero(f.alertasNombreTotal ?? 0)} alertas que nombran «{nombreMed(f.marca)}»
              </Link>
            </p>
          )}
          {alertas === 0 && (
            <p className="flex gap-3 rounded-2xl border border-line bg-paper px-5 py-4 text-dato leading-relaxed text-inkSoft">
              <CircleCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
              <span>
                Ninguna alerta nombra su registro ni su marca. {textoRevisadas(f.fuente.alertas, f.fuente.ultimaAlerta)}
              </span>
            </p>
          )}
        </div>
      ),
    },
    {
      clave: "datos",
      etiqueta: "Datos",
      icono: ico(ClipboardList),
      contenido: (
        <div className="space-y-4">
          <CabeceraPestana acciones={<FuenteFecha nombre="Observatorio de precios de DIGEMID" url={f.fuente.precios.url} al={p.periodo} />}>
            Lo que DIGEMID publica de esta presentación.
          </CabeceraPestana>
          <dl className="tarjeta rounded-2xl border border-line bg-paper px-5 py-2">
            <Dato t="Registro sanitario" mono>{p.registro ?? "Sin dato"}</Dato>
            <Dato t="Principio activo">{nombreMed(p.ifa) || "Sin dato"}</Dato>
            <Dato t="Concentración">{concentracionLegible(p.concentracion) || "Sin dato"}</Dato>
            <Dato t="Forma">{nombreMed(p.forma) || "Sin dato"}</Dato>
            <Dato t="Presentación">{nombreMed(p.presentacion) || "Sin dato"}{p.fracciones ? `, ${numero(p.fracciones)} ${p.fracciones === 1 ? "unidad" : "unidades"}` : ""}</Dato>
            <Dato t="Titular del registro">{nombreMed(p.titular) || "Sin dato"}</Dato>
            <Dato t="Fabricante">{[nombreMed(p.fabricante), nombreMed(p.pais)].filter(Boolean).join(", ") || "Sin dato"}</Dato>
            <Dato t="Clasificación">{/^GEN/.test(p.clasificacion ?? "") ? "Genérico" : p.clasificacion ? "De marca" : "Sin dato"}{p.grupo ? `, ${nombreMed(p.grupo).toLowerCase()}` : ""}</Dato>
          </dl>
          <p className="text-meta leading-relaxed text-mute">
            Que figure aquí quiere decir que se vendió con ese registro y que farmacias o boticas reportaron su precio. Para ver si el registro
            sigue vigente, búscalo en la{" "}
            <a href={f.fuente.registroSanitario} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline underline-offset-2">
              consulta de registro sanitario de DIGEMID
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            .
          </p>
        </div>
      ),
    },
    {
      clave: "equivalentes",
      etiqueta: "Mismo principio activo",
      icono: ico(Layers),
      conteo: r.n || null,
      contenido: (
        <div className="space-y-4">
          <CabeceraPestana>
            Con el mismo principio activo, concentración y forma, del más barato al más caro. Antes de cambiar uno por otro, pregúntale a tu
            médico o en la farmacia.
          </CabeceraPestana>
          {f.equivalentes.length ? (
            <>
              {/* Tarjetas, como el catálogo (2026-11-22): ocho, del más barato al más caro; el resto, en el catálogo. */}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Medicamentos con el mismo principio activo">
                {f.equivalentes.slice(0, 8).map((m) => (
                  <li key={m.codigo} className="min-w-0">
                    <TarjetaMedicamento m={m} base={base} masBarato={p.precioMediana != null && m.precioMediana != null && m.precioMediana < p.precioMediana} />
                  </li>
                ))}
              </ul>
              {r.n > 8 && (
                <Link href={`${rutaEn(base, "/medicamentos")}?${new URLSearchParams({ q: [p.ifa, p.concentracion].filter(Boolean).join(" ") })}`} className="inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline">
                  Ver los {numero(r.n)} con {nombreMed(p.ifa)}
                </Link>
              )}
            </>
          ) : (
            <p className="rounded-2xl border border-line bg-paper px-5 py-4 text-dato text-inkSoft">Ningún otro producto con precio reportado tiene el mismo principio activo, concentración y forma.</p>
          )}
        </div>
      ),
    },
    ...(f.presentaciones.length
      ? [
          {
            clave: "presentaciones",
            etiqueta: "Otras presentaciones",
            icono: ico(Pill),
            conteo: f.presentaciones.length,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Con el mismo registro sanitario ({p.registro}).</CabeceraPestana>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                  {f.presentaciones.slice(0, 10).map((m) => (
                    <li key={m.codigo}>
                      <FilaMedicamento m={m} base={base} />
                    </li>
                  ))}
                </ul>
              </div>
            ),
          } satisfies Pestana,
        ]
      : []),
    {
      clave: "verificar",
      etiqueta: "Cómo verificarlo",
      icono: ico(ShieldCheck),
      contenido: (
        <div className="space-y-4">
          <CabeceraPestana>Con la caja en la mano, en cinco minutos.</CabeceraPestana>
          <ol className="tarjeta space-y-3 rounded-2xl border border-line bg-paper px-5 py-4 text-dato leading-relaxed text-inkSoft">
            <li><b className="font-semibold text-ink">El registro sanitario de la caja</b> debe ser {p.registro ? <span className="font-mono text-ink">{p.registro}</span> : "el que figura en DIGEMID"}. Si no tiene registro, no lo compres.</li>
            <li><b className="font-semibold text-ink">El lote y el vencimiento</b> deben estar impresos, no en una etiqueta pegada. Busca el lote aquí: te decimos si una alerta lo nombra.</li>
            <li><b className="font-semibold text-ink">Dónde lo compras</b>: en farmacias y boticas autorizadas. En redes sociales, ferias o ambulantes aparecen la mayoría de los falsificados.</li>
            <li>
              <b className="font-semibold text-ink">El precio</b>:{" "}
              {p.precioMediana != null ? `si es mucho más barato que ${soles(p.precioMediana)} por unidad, desconfía.` : "si es mucho más barato que en otras farmacias, desconfía."}
            </li>
          </ol>
          <p className="flex flex-wrap gap-x-5 gap-y-1">
            <a href={f.fuente.registroSanitario} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline">
              Consulta oficial del registro sanitario <ArrowUpRight size={13} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <a href={f.fuente.precios.consulta} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline">
              Precios por farmacia cerca de ti (Observatorio) <ArrowUpRight size={13} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="container-page pb-6 pt-5 sm:pt-8">
      <AnotarVisto tipo="medicamento" codigo={String(p.codigo)} nombre={nombre} detalle={[nombreMed(p.forma), p.registro ? `R.S. ${p.registro}` : null].filter(Boolean).join(", ")} />
      <Migas
        items={[
          { etiqueta: "Inicio", href: rutaEn(base, "/") },
          { etiqueta: "Medicamentos", href: rutaEn(base, "/medicamentos") },
          { etiqueta: nombre },
        ]}
        pestanas={{ etiquetas: Object.fromEntries(pestanas.map((x) => [x.clave, x.etiqueta])), primera: pestanas[0].clave, activa: seccion }}
      />

      <div className="mt-4 overflow-hidden rounded-3xl border border-granate/20 bg-granate-50 px-5 py-6 sm:px-8 sm:py-7">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <h1 className="min-w-0 text-balance font-display text-cifra font-bold leading-tight tracking-[-0.02em] text-ink sm:text-titulo">{nombre}</h1>
              <BotonGuardarSalud tipo="medicamento" codigo={String(p.codigo)} nombre={nombre} base={base} />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              {/* En el celular, el dibujo de su forma junto a las insignias (en la computadora va grande, a la derecha). */}
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-paper lg:hidden">
                <Pixel nombre={formaDe(p.formaGrupo).sprite} escala={2} animado={false} acento="accion" />
              </span>
              {/^GEN/.test(p.clasificacion ?? "") ? <Insignia tono="exito">Genérico</Insignia> : <Insignia>De marca</Insignia>}
              {p.registro && <Insignia className="font-mono">R.S. {p.registro}</Insignia>}
              {!p.enCatalogo && <Insignia tono="aviso">Sin precio reportado en el último mes</Insignia>}
            </p>
            <p className="mt-1.5 text-cuerpo text-inkSoft">
              {[nombreMed(p.forma), nombreMed(p.ifa) && `de ${nombreMed(p.ifa).toLowerCase()}`, nombreMed(p.titular) && `titular: ${nombreMed(p.titular)}`].filter(Boolean).join(", ")}
            </p>
            <p
              className={`mt-3 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-dato font-semibold leading-snug ${
                f.alertasRegistro.length
                  ? "border-crimson/30 bg-crimson-soft text-crimsonTexto"
                  : f.alertasNombre.length
                    ? "border-amber/40 bg-amber-soft text-amberTexto"
                    : "border-line bg-paper text-mossTexto"
              }`}
            >
              {f.alertasRegistro.length ? <TriangleAlert size={17} aria-hidden className="mt-0.5 shrink-0" /> : f.alertasNombre.length ? <TriangleAlert size={17} aria-hidden className="mt-0.5 shrink-0" /> : <CircleCheck size={17} aria-hidden className="mt-0.5 shrink-0" />}
              <span>
                {f.alertasRegistro.length
                  ? `DIGEMID emitió ${f.alertasRegistro.length === 1 ? "una alerta" : `${f.alertasRegistro.length} alertas`} sobre su registro sanitario. Compara el lote de tu caja con el de la alerta.`
                  : deSeguridad.length
                    ? `Su registro sanitario no tiene alertas, pero hay ${deSeguridad.length === 1 ? "una alerta de seguridad" : `${deSeguridad.length} alertas de seguridad`} sobre su principio activo: léelas en «Alertas».`
                  : deMarca.length
                    ? `Su registro sanitario no tiene alertas. Ojo: DIGEMID ${falsificadas ? "incautó cajas falsificadas" : "observó otras cajas"} que usan el nombre «${nombreMed(f.marca)}»: compara el lote de la tuya en «Alertas».`
                    : "Ninguna alerta de DIGEMID nombra su registro sanitario ni su marca."}
              </span>
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper px-4 py-3.5">
                <p className="text-meta font-medium text-mute">Precio típico por unidad</p>
                <p className="mt-0.5 font-display text-cifra font-bold tabular-nums text-ink">{soles(p.precioMediana)}</p>
                <p className="text-rotulo leading-snug text-mute">
                  {p.precioMediana != null
                    ? p.establecimientos === 1
                      ? `La única farmacia o botica que lo reportó en ${mesLargo(p.periodo)} lo vendía a este precio.`
                      : `La mitad de las ${numero(p.establecimientos)} farmacias y boticas que lo reportaron en ${mesLargo(p.periodo)} lo vendía a este precio o menos.`
                    : `Ninguna farmacia o botica reportó su precio en ${mesLargo(p.periodo)}.`}
                </p>
              </div>
              {/* Las alertas ya se dicen en la línea de arriba: aquí, si lo hay, el más barato con lo mismo. */}
              {masBarato ? (
                <a href="#secciones" className="gs-hunde block rounded-2xl border border-line bg-paper px-4 py-3.5 hover:border-granate/50">
                  <p className="text-meta font-medium text-mute">Con el mismo principio activo</p>
                  <p className="mt-0.5 font-display text-cifra font-bold tabular-nums text-mossTexto">desde {soles(r.minimo)}</p>
                  <p className="text-rotulo leading-snug text-mute">
                    {r.n === 1 ? "Un producto" : `${numero(r.n)} productos`}
                    {r.genericos ? `, ${r.genericos === 1 ? "un genérico" : `${numero(r.genericos)} genéricos`}` : ""}. Pregunta antes de cambiar.
                  </p>
                </a>
              ) : (
                <div className="rounded-2xl border border-line bg-paper px-4 py-3.5">
                  <p className="text-meta font-medium text-mute">Con el mismo principio activo</p>
                  <p className="mt-0.5 text-dato font-semibold text-ink">
                    {p.precioMediana == null ? "Sin precio para comparar" : r.n ? "Es de los de menor precio típico" : "No hay otro con precio reportado"}
                  </p>
                  <p className="text-rotulo leading-snug text-mute">Entre los que reportan farmacias y boticas privadas.</p>
                </div>
              )}
            </div>
          </div>
          <div aria-hidden className="hidden flex-col items-center lg:flex">
            <Pixel nombre={formaDe(p.formaGrupo).sprite} escala={7} animado={false} acento="accion" />
            <span className="mt-1 h-0 w-36 border-t-2 border-dotted border-granate/40" />
          </div>
        </div>
      </div>

      <div id="secciones" className="mt-8 scroll-mt-16">
        <Pestanas pestanas={pestanas} activa={seccion} etiqueta={`Secciones de la ficha de ${nombre}`} fija className="[&>div:first-child]:top-16" />
      </div>
    </div>
  );
}
