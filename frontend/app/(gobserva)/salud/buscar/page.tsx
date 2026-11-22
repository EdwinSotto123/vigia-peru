import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeCheck, Building2, Gavel, Hash, IdCard, ListChecks, LocateFixed, MapPinned, Pill, RotateCw, Search, ShieldCheck, Stethoscope, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha, InsigniaHecho } from "@/components/salud/comun";
import { URL_CMP, URL_RENIPRESS_CONSULTA, URL_SANCIONES } from "@/components/salud/fuentes/urls";
import { FilaEstablecimiento, PLACA_LISTA } from "@/components/salud/lista/FilaEstablecimiento";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { AvisoEmergencia, Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { TIPO_SANCION, buscarMedicamentos, buscarSalud, fechaCorta, getResumenSalud, nombrePropio, numero, rutaMedico, type PasoVerificar } from "@/lib/gobserva-salud";
import { FilaAlerta, FilaMedicamento } from "@/components/salud/medicamentos/piezas";
import { VistosRecientes } from "@/components/salud/vistos/Vistos";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Record<string, string | string[] | undefined> };

const leerQ = (p: Props["searchParams"]) => {
  const v = p?.q;
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 120);
};

export function generateMetadata({ searchParams }: Props): Metadata {
  const q = leerQ(searchParams);
  return {
    title: q ? `Verificar «${q}»` : "Verificar un establecimiento o a un médico",
    description: "Busca un establecimiento de salud por su nombre, su código IPRESS o su RUC, o un número de colegiatura, y mira lo que dicen RENIPRESS y el Registro de Sanciones de SUSALUD.",
    alternates: { canonical: urlCanonica("salud", "/buscar") },
    robots: q ? { index: false, follow: true } : undefined,
  };
}

/**
 * /buscar de Gobserva Salud (2026-11-20): un solo buscador (GET /salud/buscar). Un número corto puede ser una colegiatura:
 * se muestra lo que RENIPRESS dice de ese número (en qué establecimientos figura como responsable) y los pasos para
 * verificarlo en el Colegio Médico, con el enlace a su página. Luego los establecimientos (por nombre, código o RUC) y las
 * sanciones firmes de instituciones sin establecimiento (aseguradoras, por ejemplo). Si no hay nada, la nota de la API: los
 * médicos se verifican en el CMP; aquí nunca se buscan personas por su nombre.
 */
export default async function Buscar({ searchParams }: Props) {
  const base = baseProducto("salud");
  const q = leerQ(searchParams);
  const ruta = (p: string) => rutaEn(base, p);
  // También los medicamentos (2026-11-21): un solo buscador para la clínica, el médico y la medicina.
  const [res, r, meds] = q.length >= 2
    ? await Promise.all([buscarSalud(q), getResumenSalud(), buscarMedicamentos(new URLSearchParams({ q, tamano: "5" }))])
    : [null, null, null];
  const cobertura = r?.fuentes.detalle;

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: ruta("/") }, { etiqueta: "Verificar" }]} />
      <Encabezado figura="vecina"
        className="mt-2"
        titulo={q ? <>Resultados para «{q}»</> : "Verifica un establecimiento, un médico o un medicamento"}
        bajada={q ? undefined : "Escribe el nombre de la clínica, el hospital o el consultorio, su código IPRESS, su RUC, el número de colegiatura del médico o el nombre de un medicamento."}
      />
      <div className="mt-5 max-w-3xl">
        <BuscadorSalud accion={ruta("/buscar")} q={q} autoFocus={!q} />
        <p className="mt-2 text-meta text-mute">
          Un médico se verifica con su número de colegiatura, no por su nombre. Algunos consultorios figuran en RENIPRESS con el nombre de su dueño.
        </p>
        <Link
          href={`${ruta("/cerca")}?ubicar=1`}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline"
        >
          <LocateFixed size={16} aria-hidden /> ¿Ya estás adentro? Busca con tu ubicación
        </Link>
      </div>

      {!q && <VistosRecientes base={base} fila className="mt-8" />}
      {!q && <Guia ruta={ruta} />}

      {q && q.length < 2 && (
        <div className="mt-8 rounded-2xl border border-line bg-paper">
          <EstadoVacio Icono={Search} titulo="Escribe un poco más" texto="Al menos 2 letras o un número." />
        </div>
      )}

      {q.length >= 2 && !res && (
        <div className="mt-8 rounded-2xl border border-line bg-paper">
          <EstadoError
            texto="No pudimos buscar ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
            acciones={
              <a href={`${ruta("/buscar")}?q=${encodeURIComponent(q)}`} className={claseAccion("secundario", "min-h-11")}>
                <RotateCw size={15} aria-hidden /> Volver a intentar
              </a>
            }
          />
        </div>
      )}

      {res && (
        <div className="mt-10 space-y-12">
          {/* ── Una colegiatura ─────────────────────────────────────────────── */}
          {res.colegiatura && (
            <section aria-labelledby="colegiatura-t" className="rounded-2xl border border-line bg-paper p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="colegiatura-t" className="flex flex-wrap items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                    <IdCard size={20} aria-hidden className="text-granate" /> Número de colegiatura {res.colegiatura.numero}
                  </h2>
                  <p className="mt-1.5 max-w-[66ch] text-dato leading-relaxed text-inkSoft">
                    Si es el número de un médico, esto es lo que dicen las fuentes abiertas. Su habilitación y su especialidad sólo las confirma el
                    Colegio Médico del Perú.
                  </p>
                </div>
                <InsigniaHecho tipo="verificacion_externa" />
              </div>

              <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
                    <Building2 size={16} aria-hidden className="text-granate" /> En RENIPRESS
                  </h3>
                  {res.colegiatura.responsableDe.length > 0 ? (
                    <>
                      <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">
                        Figura como responsable de la atención en{" "}
                        {res.colegiatura.responsableDe.length === 1 ? "un establecimiento" : `${numero(res.colegiatura.responsableDe.length)} establecimientos`}:
                      </p>
                      <ul className={`mt-3 ${PLACA_LISTA}`}>
                        {res.colegiatura.responsableDe.map((x) => (
                          <li key={x.codigo}>
                            <FilaEstablecimiento x={x} base={base}>
                              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
                                <Dato icono={IdCard} nombre="Colegio">
                                  {nombrePropio(x.colegio)}
                                </Dato>
                                {x.responsableRne && (
                                  <Dato icono={BadgeCheck} nombre="Especialidad registrada (RNE)">
                                    RNE {x.responsableRne}
                                  </Dato>
                                )}
                                {x.leidoAl && <Dato tipo="fecha">Leído en RENIPRESS el {fechaCorta(x.leidoAl)}</Dato>}
                              </p>
                            </FilaEstablecimiento>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">
                      En el detalle de RENIPRESS que ya leímos
                      {cobertura ? ` (${numero(cobertura.leidas)} de ${numero(cobertura.total)} establecimientos)` : ""}, este número no figura como
                      responsable de la atención de ningún establecimiento. Eso no dice nada de su habilitación: la confirma su colegio.
                    </p>
                  )}
                  <p className="mt-3">
                    <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={cobertura?.ultimaLectura?.slice(0, 10)} />
                  </p>
                </div>

                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
                    <ListChecks size={16} aria-hidden className="text-granate" /> Cómo verificarlo
                  </h3>
                  <ol className="mt-3 space-y-4">
                    {res.colegiatura.verificar.map((p, i) => (
                      <PasoVerificacion key={p.paso} n={i + 1} p={p} ruta={ruta} />
                    ))}
                  </ol>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                  <UserX size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                  <span>No guardamos ni mostramos nombres ni documentos de los profesionales.</span>
                </p>
                <Link href={ruta(rutaMedico(res.colegiatura.numero))} className={claseAccion("primario", "min-h-11")}>
                  <Stethoscope size={16} aria-hidden /> Ver la página de la colegiatura {res.colegiatura.numero}
                </Link>
              </div>
            </section>
          )}

          {/* ── Establecimientos ─────────────────────────────────────────────── */}
          {res.establecimientos.length > 0 && (
            <section aria-labelledby="ipress-t">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <h2 id="ipress-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                    <Building2 size={20} aria-hidden className="text-granate" />
                    {res.colegiatura ? "Establecimientos con ese código" : res.establecimientos.length === 1 ? "Un establecimiento" : "Establecimientos"}
                  </h2>
                  <p className="mt-1 text-meta text-inkSoft">
                    Los activos primero. Toca uno para ver su verificación completa: registro, categoría, servicios, sanciones y denuncias.
                  </p>
                </div>
                {res.establecimientos.length >= 12 && (
                  <Link
                    href={`${ruta("/establecimientos")}?q=${encodeURIComponent(q)}&estado=todos`}
                    className="inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
                  >
                    Ver todos en la lista <ArrowRight size={15} aria-hidden />
                  </Link>
                )}
              </div>
              <ul className={`mt-4 ${PLACA_LISTA}`} aria-label="Establecimientos encontrados">
                {res.establecimientos.map((x) => (
                  <li key={x.codigo}>
                    <FilaEstablecimiento x={x} base={base} />
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={r?.fuentes.renipressAl} />
              </p>
            </section>
          )}

          {/* ── Medicamentos (DIGEMID) ────────────────────────────────────────── */}
          {meds && (meds.total > 0 || (meds.alertasTotal ?? 0) > 0) && (
            <section aria-labelledby="medicamentos-t">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <h2 id="medicamentos-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                    <Pill size={20} aria-hidden className="text-granate" /> Medicamentos
                  </h2>
                  <p className="mt-1 text-meta text-inkSoft">
                    {meds.alertasTotal
                      ? `${numero(meds.alertasTotal)} ${meds.alertasTotal === 1 ? "alerta de DIGEMID lo nombra" : "alertas de DIGEMID lo nombran"}. `
                      : "Ninguna alerta de DIGEMID lo nombra. "}
                    {meds.total > 0 ? "El precio es el típico por unidad en farmacias y boticas." : ""}
                  </p>
                </div>
                <Link
                  href={`${ruta("/medicamentos")}?q=${encodeURIComponent(q)}`}
                  className="inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
                >
                  {meds.alertasTotal ? "Ver las alertas y los precios" : meds.total > 5 ? `Ver los ${numero(meds.total)}` : "Verificar el medicamento"} <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
              {meds.filas.length > 0 ? (
                <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper" aria-label="Medicamentos encontrados">
                  {meds.filas.map((m) => (
                    <li key={m.codigo}>
                      <FilaMedicamento m={m} base={base} />
                    </li>
                  ))}
                </ul>
              ) : (
                // Sin productos pero con alertas que lo nombran: las alertas mismas (antes, sólo un título y un enlace).
                meds.alertas.length > 0 && (
                  <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper" aria-label="Alertas de DIGEMID que lo nombran">
                    {/* recorte: dos; «Ver las alertas y los precios» lleva a todas. */}
                    {meds.alertas.slice(0, 2).map((a) => (
                      <li key={a.id}>
                        <FilaAlerta a={a} base={base} sinTabla conDibujo />
                      </li>
                    ))}
                  </ul>
                )
              )}
            </section>
          )}

          {/* ── Sanciones a instituciones sin establecimiento ────────────────── */}
          {res.sancionesSinEstablecimiento.length > 0 && (
            <section aria-labelledby="sanciones-t">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <h2 id="sanciones-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                    <Gavel size={20} aria-hidden className="text-crimsonTexto" /> En el Registro de Sanciones
                  </h2>
                  <p className="mt-1 max-w-[70ch] text-meta text-inkSoft">
                    Sanciones firmes a instituciones que el registro no une a un establecimiento: aseguradoras (IAFAS), unidades de gestión
                    (UGIPRESS) o nombres que no calzan con RENIPRESS.
                  </p>
                </div>
                <Link
                  href={`${ruta("/sanciones")}?q=${encodeURIComponent(q)}`}
                  className="inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
                >
                  Verlas en el registro <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-paper">
                {res.sancionesSinEstablecimiento.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0">
                      <p className="text-dato font-semibold leading-snug text-ink">{nombrePropio(s.nombre)}</p>
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
                        {s.administradaTipo && <Dato tipo="tipo">{s.administradaTipo}</Dato>}
                        <Dato tipo="fecha">Emitida el {fechaCorta(s.fechaEmision)}</Dato>
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-wrap gap-1.5">
                      <InsigniaHecho tipo="sancion_firme" />
                      <span className="inline-flex items-center rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-rotulo font-semibold text-inkSoft">
                        {TIPO_SANCION[s.tipoSancion] ?? s.tipoSancion}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={r?.fuentes.sancionesAl} />
              </p>
            </section>
          )}

          {/* ── Nada ──────────────────────────────────────────────────────────── */}
          {!res.colegiatura && res.establecimientos.length === 0 && res.sancionesSinEstablecimiento.length === 0 && !meds?.total && !meds?.alertasTotal && (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoVacio
                titulo="Ningún resultado para esa búsqueda"
                texto={
                  <>
                    {res.nota ??
                      "Prueba con menos palabras (el distrito en vez del nombre exacto), con el código IPRESS de 8 cifras o con el RUC."}{" "}
                    Aquí no buscamos personas por su nombre: no guardamos nombres de profesionales.
                  </>
                }
                acciones={
                  <>
                    <Link href={ruta("/medico")} className={claseAccion("primario", "min-h-11")}>
                      <Stethoscope size={16} aria-hidden /> Verificar a un médico
                    </Link>
                    <a href={res.urlCmp || URL_CMP} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "min-h-11")}>
                      Abrir «Conoce a tu médico» <ArrowUpRight size={15} aria-hidden />
                      <span className="sr-only"> (Colegio Médico del Perú, se abre en otra pestaña)</span>
                    </a>
                    <Link href={ruta("/establecimientos")} className={claseAccion("secundario", "min-h-11")}>
                      Ver la lista completa
                    </Link>
                  </>
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Un paso para verificar a un médico (de la API): su enlace va al sitio oficial o, si es de esta web, a su página. */
function PasoVerificacion({ n, p, ruta }: { n: number; p: PasoVerificar; ruta: (r: string) => string }) {
  const externo = /^https?:\/\//.test(p.url);
  const etiqueta = /cmp\.org\.pe/.test(p.url) ? "Abrir «Conoce a tu médico»" : /sunedu/.test(p.url) ? "Abrir el registro de SUNEDU" : externo ? "Abrir la fuente" : "Buscar el establecimiento";
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-granate font-display text-dato font-bold text-paper">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-dato font-semibold leading-snug text-ink">{p.paso}</p>
        <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">{p.detalle}</p>
        {externo ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
            {etiqueta} <ArrowUpRight size={13} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : (
          <Link href={ruta(p.url)} className="mt-1 inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
            {etiqueta} <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}

/** Sin búsqueda: qué se puede escribir, las entradas rápidas y el aviso de emergencias. */
function Guia({ ruta }: { ruta: (r: string) => string }) {
  const formas: { Icono: LucideIcon; titulo: string; ejemplo: string; q: string; texto: string }[] = [
    { Icono: Building2, titulo: "El nombre", ejemplo: "Hospital Loayza", q: "hospital loayza", texto: "De la clínica, el hospital, el centro o el consultorio. Con el distrito encuentras más rápido." },
    { Icono: Hash, titulo: "El código IPRESS", ejemplo: "00006207", q: "00006207", texto: "Las 8 cifras con que SUSALUD registra cada establecimiento en RENIPRESS." },
    { Icono: ShieldCheck, titulo: "El RUC", ejemplo: "RUC de 11 cifras", q: "", texto: "El de la empresa que figura en tu boleta o factura: aparecen todos sus establecimientos." },
    { Icono: IdCard, titulo: "La colegiatura del médico", ejemplo: "Número del CMP", q: "", texto: "Te mostramos dónde figura como responsable en RENIPRESS y cómo verificarlo en el Colegio Médico." },
  ];
  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-12">
      <section aria-labelledby="formas-t" className="min-w-0">
        <h2 id="formas-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Qué puedes buscar
        </h2>
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-paper">
          {formas.map((x) => (
            <li key={x.titulo} className="flex gap-3.5 px-4 py-4 sm:px-5">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                <x.Icono size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="text-cuerpo font-semibold text-ink">{x.titulo}</h3>
                <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">{x.texto}</p>
                {x.q ? (
                  <Link
                    href={`${ruta("/buscar")}?q=${encodeURIComponent(x.q)}`}
                    className="mt-1 inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8"
                  >
                    <Search size={13} aria-hidden /> Probar con «{x.ejemplo}»
                  </Link>
                ) : (
                  <p className="mt-1 font-mono text-rotulo text-mute">{x.ejemplo}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="min-w-0 space-y-4">
        <h2 className="font-display text-seccion font-bold leading-tight text-ink">Otras formas de buscar</h2>
        <div className="grid gap-2.5">
          <Link href={ruta("/medico")} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40">
            <Stethoscope size={18} aria-hidden className="text-granate" /> Verificar a un médico, paso a paso
          </Link>
          <Link href={ruta("/establecimientos")} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40">
            <Building2 size={18} aria-hidden className="text-granate" /> Recorrer la lista por departamento y categoría
          </Link>
          <Link href={ruta("/mapa")} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40">
            <MapPinned size={18} aria-hidden className="text-granate" /> Ver en el mapa los de tu departamento
          </Link>
          <Link href={ruta("/sanciones")} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40">
            <Gavel size={18} aria-hidden className="text-granate" /> Revisar el Registro de Sanciones de SUSALUD
          </Link>
        </div>
        <AvisoEmergencia className="pt-2" />
      </div>
    </div>
  );
}
