import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, LocateFixed, Search } from "lucide-react";
import { FuenteFecha } from "@/components/salud/comun";
import { URL_DATOS_SUSALUD, URL_RENIPRESS_CONSULTA, URL_SANCIONES } from "@/components/salud/fuentes/urls";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { CienEstablecimientos } from "@/components/salud/pixel/CienEstablecimientos";
import { EscenaPuerta } from "@/components/salud/pixel/EscenaPuerta";
import { Pixel } from "@/components/pixel/Pixel";
import { Puertas } from "@/components/pixel/Puertas";
import type { NombreSprite } from "@/components/pixel/sprites";
import { AvisoEmergencia } from "@/components/salud/portada/Piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getResumenSalud, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { NECESIDADES_RAPIDAS } from "@/lib/salud-necesidades";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Salud: verifica tu clínica y a tu médico con fuentes oficiales" },
  description:
    "Antes de atenderte, revisa si el establecimiento está registrado y activo en RENIPRESS, su categoría, sus servicios y si tiene sanciones firmes de SUSALUD, y cómo verificar a tu médico en el Colegio Médico. Cada dato con su fuente y su fecha. Gratis y sin cuenta.",
  alternates: { canonical: urlCanonica("salud", "/") },
};

/** El ícono de píxeles de cada necesidad de la portada (lib/salud-necesidades.ts; components/pixel/sprites.ts). */
const ICONO_NECESIDAD: Record<string, NombreSprite> = {
  emergencia: "iconoEmergencia", dientes: "iconoDientes", parto: "iconoParto", ninos: "iconoNinos", ojos: "iconoOjos", piel: "iconoPiel",
  corazon: "iconoCorazon", huesos: "iconoHuesos", mental: "iconoMental", analisis: "iconoAnalisis", imagenes: "iconoImagenes", operacion: "iconoOperacion",
};

/**
 * Portada de Gobserva Salud. Rehecha el 2026-11-21 (el usuario: mejorar la UX/UI; la portada medía 10,5 pantallas en
 * la computadora y 18,7 en el celular, con partes de tablero: 25 departamentos, 7 fuentes en tabla, 4 teselas de cifras,
 * las clases de hecho y los estados de la ficha). Ahora es un relato corto para quien va a atenderse:
 * 1. el héroe: la frase, el buscador (el producto) y la escena de la vecina en la puerta de la clínica;
 * 2. «¿Qué necesitas hoy?»: tres puertas con su gente (la clínica, el médico, cerca de mí) y las necesidades directas;
 * 3. de cada 100 establecimientos: la proporción con sanción firme, tres cifras con su fuente, tu departamento y una
 *    línea a /fuentes;
 * 4. el cierre con el buscador.
 * Segunda vuelta, el mismo día (el usuario: «todo desordenado en subsecciones… ¿por qué generas scrolls infinitos?»): se
 * fueron «Lo que no se ve desde la puerta», el bloque del asistente (está en el menú), la lista de fuentes, la franja del
 * MCP (tiene su página) y las preguntas frecuentes, que pasaron enteras al pie de /fuentes.
 * GET /salud/resumen (10 min en caché); sin él, la portada se arma sin las cifras.
 */
export default async function InicioSalud() {
  const base = baseProducto("salud");
  const r = await getResumenSalud();
  const ruta = (p: string) => rutaEn(base, p);
  const f = r?.fuentes;
  const deCada100 = r && r.ipress > 0 ? Math.max(r.conSanciones > 0 ? 1 : 0, Math.round((r.conSanciones / r.ipress) * 100)) : null;

  return (
    <>
      {/* ── 1. Héroe: la frase, el buscador y la escena ─────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
        <div className="container-page relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:py-20">
          <div className="min-w-0">
            <h1 id="heroe-t" className="text-balance font-display text-cifra font-bold leading-[1.06] tracking-[-0.025em] sm:text-portada lg:text-cartel">
              Verifica tu clínica y a tu médico <span className="text-maiz">antes de atenderte.</span>
            </h1>
            <p className="mt-5 max-w-[56ch] text-pretty text-cuerpo leading-relaxed text-paper/75 sm:text-bloque">
              Busca cualquier establecimiento de salud del Perú: si está registrado y activo, qué servicios declaró y si tiene sanciones firmes de
              SUSALUD. Con la fuente oficial y su fecha. Gratis y sin cuenta.
            </p>
            <BuscadorSalud accion={ruta("/buscar")} oscuro className="mt-7" id="buscar" />
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="text-meta text-paper/65">Prueba con</span>
              <ul className="flex flex-wrap gap-2" aria-label="Búsquedas de ejemplo">
                {[
                  { t: "Hospital Loayza", q: "hospital loayza" },
                  { t: "Clínicas de Miraflores", q: "clinica miraflores" },
                  { t: "00006207", q: "00006207" },
                ].map((x) => (
                  <li key={x.q}>
                    <Link
                      href={`${ruta("/buscar")}?q=${encodeURIComponent(x.q)}`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-paper/20 px-3.5 text-meta font-medium text-paper/85 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10 hover:text-paper sm:min-h-9"
                    >
                      <Search size={13} aria-hidden /> {x.t}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <AvisoEmergencia oscuro className="mt-7 border-t border-paper/10 pt-6" />
          </div>
          <EscenaPuerta renipressAl={f?.renipressAl ?? null} sancionesAl={f?.sancionesAl ?? null} className="lg:mt-6" />
        </div>
      </section>

      <div className="container-page space-y-20 py-14 sm:space-y-28 sm:py-20">
        {/* ── 2. ¿Qué necesitas hoy? ──────────────────────────────────────────── */}
        <section aria-labelledby="necesitas-t">
          <h2 id="necesitas-t" className="text-balance font-display text-titulo font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-vitrina">
            ¿Qué necesitas hoy?
          </h2>
          <Puertas
            etiqueta="Lo que puedes hacer en Gobserva Salud"
            className="mt-8"
            puertas={[
              {
                gente: (
                  <>
                    <Pixel nombre="vecina" escala={3} retardo={300} className="px-salta" />
                    <Pixel nombre="clinica" escala={2} retardo={1100} className="max-md:hidden" />
                  </>
                ),
                necesidad: "Me van a atender en una clínica",
                que: "Mira si está registrada y activa, qué servicios declaró, como el centro quirúrgico, y si tiene sanciones firmes.",
                accion: "Verificar la clínica",
                href: ruta("/buscar"),
              },
              {
                gente: (
                  <>
                    <Pixel nombre="doctora" escala={3} retardo={800} className="px-salta" />
                    <Pixel nombre="carnet" escala={3} acento="accion" className="mb-2 max-md:hidden" />
                  </>
                ),
                necesidad: "Quiero saber si mi médico está habilitado",
                que: "Con su número de colegiatura te llevamos, paso a paso, a confirmarlo en el Colegio Médico y su título en SUNEDU.",
                accion: "Verificar al médico",
                href: ruta("/medico"),
              },
              {
                gente: (
                  <>
                    <Pixel nombre="vecinaCamina" escala={3} retardo={1500} className="px-salta" />
                    <Pixel nombre="alfiler" escala={3} acento="accion" className="max-md:hidden" />
                  </>
                ),
                necesidad: "Necesito atenderme cerca de mí",
                que: "Usa tu ubicación y te mostramos los establecimientos cercanos y activos, con lo que declararon atender.",
                accion: "Buscar cerca de mí",
                href: `${ruta("/cerca")}?ubicar=1`,
              },
            ]}
          />
          <div className="mt-8">
            <h3 className="font-display text-bloque font-bold leading-snug text-ink">¿Ya sabes lo que necesitas? Te decimos dónde lo atienden cerca.</h3>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Lo que necesitas">
              {NECESIDADES_RAPIDAS.map((n) => {
                const icono = ICONO_NECESIDAD[n.clave];
                return (
                  <li key={n.clave}>
                    <Link
                      href={`${ruta("/cerca")}?ubicar=1&necesidad=${n.clave}`}
                      prefetch={false}
                      className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper py-1.5 pl-2.5 pr-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                    >
                      {icono && <Pixel nombre={icono} escala={2} acento="accion" animado={false} className="px-salta" />}
                      {n.etiqueta}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-start gap-1.5 text-meta leading-relaxed text-inkSoft">
              <LocateFixed size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              <span>Tu ubicación no se guarda. En una emergencia no busques: llama al 106.</span>
            </p>
          </div>
        </section>

        {/* ── 3. De cada 100 establecimientos ─────────────────────────────────── */}
        {r && deCada100 != null && (
          <section aria-labelledby="pais-t" className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-16">
            <CienEstablecimientos marcadas={Math.max(r.conSanciones > 0 ? 1 : 0, (r.conSanciones / r.ipress) * 100)} className="h-auto w-36 sm:w-[11.5rem]" />
            <div className="min-w-0">
              <h2 id="pais-t" className="max-w-[24ch] text-balance font-display text-titulo font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-vitrina">
                De cada 100 establecimientos, {deCada100} {deCada100 === 1 ? "tiene" : "tienen"} una sanción firme
              </h2>
              <p className="mt-3 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
                Al menos una, en el Registro de Sanciones de SUSALUD. Los demás no figuran en él. La sanción es de la institución, no de sus médicos.
              </p>
              <dl className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
                <Cifra
                  valor={numero(r.activas)}
                  etiqueta="establecimientos activos"
                  detalle={`De ${numero(r.ipress)} registrados en RENIPRESS.`}
                  href={ruta("/establecimientos")}
                  pie={<FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={f?.renipressAl} />}
                />
                <Cifra
                  valor={numero(r.sanciones)}
                  etiqueta="sanciones firmes"
                  detalle={`${numero(r.sancionesUltimoAnio)} en los últimos 12 meses.`}
                  href={ruta("/sanciones")}
                  pie={<FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={f?.sancionesAl} />}
                />
                <Cifra
                  valor={numero(r.denuncias)}
                  etiqueta={`denuncias en ${r.denunciasAnio ?? "el último año"}`}
                  detalle="Pedidos de ciudadanos: no son sanciones."
                  pie={<FuenteFecha nombre="Consultas y denuncias (SUSALUD)" url={URL_DATOS_SUSALUD} al={r.denunciasAnio} />}
                />
              </dl>
              {r.porDepartamento.length > 0 && (
                <form method="get" action={ruta("/establecimientos")} className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 sm:max-w-sm">
                    <span className="block text-dato font-semibold text-ink">¿Y en tu departamento?</span>
                    <select
                      name="departamento"
                      defaultValue=""
                      required
                      className="mt-2 h-12 w-full rounded-2xl border border-line bg-caja px-4 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
                    >
                      <option value="" disabled>
                        Elige tu departamento
                      </option>
                      {[...r.porDepartamento]
                        .sort((a, b) => nombreLugar(a.clave).localeCompare(nombreLugar(b.clave), "es"))
                        .map((d) => (
                          <option key={d.clave} value={d.clave}>
                            {nombreLugar(d.clave)}: {numero(d.activas)} activos, {numero(d.conSanciones)} con sanción firme
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-granate px-6 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2"
                  >
                    Ver su lista
                  </button>
                </form>
              )}
              <p className="mt-6 text-dato text-inkSoft">
                Sólo registros oficiales, cada uno con su fecha.{" "}
                <Link href={ruta("/fuentes")} className="font-semibold text-granate underline-offset-4 hover:underline">
                  De dónde sale cada dato y preguntas frecuentes
                </Link>
              </p>
            </div>
          </section>
        )}

        {/* ── 4. Cierre ───────────────────────────────────────────────────────── */}
        <section aria-labelledby="cierre-t" className="sobre-oscuro overflow-hidden rounded-3xl border border-paper/10 bg-ink p-6 text-paper sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <div className="min-w-0">
              <h2 id="cierre-t" className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] sm:text-vitrina">
                Antes de tu próxima cita, búscala aquí.
              </h2>
              <p className="mt-3 flex items-start gap-2 text-dato leading-relaxed text-paper/75">
                <CalendarClock size={16} aria-hidden className="mt-0.5 shrink-0 text-maiz" />
                <span>Registros de SUSALUD al {f?.renipressAl ? <FechaCorta f={f.renipressAl} /> : "último viernes"}.</span>
              </p>
            </div>
            <div className="min-w-0">
              <div aria-hidden className="mb-5 flex items-end gap-3">
                <Pixel nombre="vecina" escala={4} retardo={1600} />
                <Pixel nombre="doctora" escala={4} retardo={300} />
              </div>
              <BuscadorSalud accion={ruta("/buscar")} oscuro id="buscar-cierre" />
              <AvisoEmergencia oscuro className="mt-5" />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function FechaCorta({ f }: { f: string }) {
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  return <>{d && m && a ? `${d} de ${meses[m - 1]} de ${a}` : f}</>;
}

function Cifra({ valor, etiqueta, detalle, pie, href }: { valor: string; etiqueta: string; detalle: string; pie: ReactNode; href?: string }) {
  return (
    <div className="flex min-w-0 flex-col bg-paper p-4 sm:p-5">
      <dt className="order-2 mt-1 text-dato font-semibold leading-snug text-ink">
        {href ? (
          <Link href={href} className="underline decoration-line underline-offset-4 hover:decoration-ink">
            {etiqueta}
          </Link>
        ) : (
          etiqueta
        )}
      </dt>
      <dd className="order-1 font-display text-cifra font-bold leading-none tabular-nums text-ink">{valor}</dd>
      <dd className="order-3 mt-0.5 text-meta leading-snug text-inkSoft">{detalle}</dd>
      <dd className="order-4 mt-auto pt-3">{pie}</dd>
    </div>
  );
}
