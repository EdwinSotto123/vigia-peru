import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, BadgeCheck, Building2, ChevronRight, Database, Gavel, Info, MapPin, ScanSearch, Stethoscope } from "lucide-react";
import { Medidor } from "@/components/charts/BarraSegmentada";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Migas } from "@/components/patrones/Migas";
import { Pestanas, type Pestana } from "@/components/patrones/Pestanas";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { FuenteFecha, InsigniaCategoria } from "@/components/salud/comun";
import { estadoRegistro } from "@/components/salud/ficha/Cabecera";
import { nombreServicio } from "@/components/salud/ficha/piezas";
import { CopiarNumero } from "@/components/salud/medico/CopiarNumero";
import { FormColegiatura } from "@/components/salud/medico/FormColegiatura";
import { PasosDeslizables } from "@/components/salud/medico/PasosDeslizables";
import { BotonGuardarSalud } from "@/components/salud/cuenta/BotonGuardar";
import { AnotarVisto } from "@/components/salud/vistos/Vistos";
import { URL_CMP } from "@/components/salud/fuentes/urls";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { fechaCorta, getMedico, nombrePropio, numero, rutaFicha, rutaMedico, type Medico } from "@/lib/gobserva-salud";
import { Respuesta, Respuestas } from "@/components/salud/Respuestas";

/** El resultado se pide a la API con 15 minutos de caché (getMedico); la página se arma en cada pedido (la base). */
export const revalidate = 900;

type Props = { params: { colegiatura: string }; searchParams?: { seccion?: string | string[] } };

const numeroDe = (crudo: string) => {
  const n = decodeURIComponent(crudo).replace(/\D/g, "").replace(/^0+/, "");
  return n && n.length <= 7 ? n : null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = numeroDe(params.colegiatura);
  if (!n) return { title: "Colegiatura no válida", robots: { index: false } };
  return {
    title: `Colegiatura N.° ${n} del CMP: cómo verificarla`,
    description: `Lo que dicen las fuentes abiertas de la colegiatura N.° ${n} del Colegio Médico del Perú (RENIPRESS) y cómo confirmar en el CMP si está habilitado.`,
    alternates: { canonical: urlCanonica("salud", rutaMedico(n)) },
    // Una página por número de colegiatura no tiene por qué estar en los buscadores: se llega desde aquí.
    robots: { index: false, follow: true },
  };
}

const EXTERNO = <span className="sr-only"> (se abre en otra pestaña)</span>;

/** El dibujo de un establecimiento por su categoría: hospital (II y III), posta (I-1 a I-4) o consultorio. */
const spriteDe = (categoria: string | null): NombreSprite =>
  /^I{2,3}/.test(categoria ?? "") ? "lugarHospital" : /^I-[1-4]/.test(categoria ?? "") ? "lugarPosta" : "lugarConsultorio";

/** Cada IPRESS donde la colegiatura figura como responsable: su dibujo, estado, lugar, RNE y las sanciones (de la IPRESS). */
function Establecimiento({ x, base }: { x: Medico["responsableDe"][number]; base: string }) {
  const estado = estadoRegistro({ enRegistro: true, activo: x.activo, estado: x.estado });
  const lugar = [nombrePropio(x.distrito), nombrePropio(x.departamento)].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
  const ficha = rutaEn(base, rutaFicha(x.codigo));
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-xl bg-paperSoft p-1.5">
        <Pixel nombre={spriteDe(x.categoria)} escala={3} animado={false} className="max-h-full max-w-full" />
      </span>
      <div className="min-w-0">
        <Link href={ficha} prefetch={false} className="text-cuerpo font-bold leading-snug text-ink underline decoration-line underline-offset-4 hover:text-granate hover:decoration-granate">
          {nombrePropio(x.nombre)}
        </Link>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <InsigniaCategoria categoria={x.categoria} />
          <Insignia tono={estado.tono} Icono={estado.Icono}>
            {estado.texto}
          </Insignia>
          {x.responsableRne && (
            <Insignia tono="acento" Icono={Stethoscope} className="font-mono">
              {`RNE ${x.responsableRne}`}
            </Insignia>
          )}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
          {lugar && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} aria-hidden className="text-mute" />
              {lugar}
            </span>
          )}
          {x.sanciones > 0 ? (
            <span className="inline-flex items-center gap-1 text-crimsonTexto">
              <Gavel size={13} aria-hidden />
              La IPRESS tiene {x.sanciones === 1 ? "una sanción firme" : `${numero(x.sanciones)} sanciones firmes`}
              {x.ultimaSancion ? ` (la última, ${fechaCorta(x.ultimaSancion)})` : ""}
              <Ayuda titulo="¿Es una sanción al médico?" etiqueta="¿La sanción es del médico?">
                No. La sanción de SUSALUD es de la clínica o el consultorio: no es una sanción al médico que figura como responsable ni dice
                nada de su habilitación.
              </Ayuda>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Gavel size={13} aria-hidden className="text-mute" />
              Sin sanciones firmes de la IPRESS
            </span>
          )}
        </p>
        {/* Lo que declaró el establecimiento (no la especialidad del profesional, que RENIPRESS no trae). */}
        {(x.especialidades?.length ?? 0) > 0 && (
          <div className="mt-2.5">
            <p className="text-rotulo font-semibold text-inkSoft">Especialidades que declaró este establecimiento (no son las del médico)</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {x.especialidades!.slice(0, 8).map((e) => (
                <li key={e} className="rounded-md bg-paperSoft px-1.5 py-0.5 text-rotulo text-inkSoft">
                  {nombreServicio(e)}
                </li>
              ))}
              {x.especialidades!.length > 8 && (
                <li className="px-1 py-0.5 text-rotulo font-semibold text-mute">y {numero(x.especialidades!.length - 8)} más</li>
              )}
            </ul>
          </div>
        )}
      </div>
      <Link href={ficha} prefetch={false} className={claseAccion("secundario", "col-span-2 min-h-11 sm:col-span-1")}>
        Ver la ficha <ChevronRight size={15} aria-hidden />
      </Link>
    </li>
  );
}

/**
 * El resultado de una colegiatura (GET /salud/medico/:colegiatura). Rehecho el 2026-11-22 (el usuario: «no tiene jerarquía…
 * esfuérzate»): arriba la credencial (el número, el colegio, su RNE, copiar y guardar) y, al lado, las tres respuestas que
 * busca quien llega (¿está habilitado?, ¿qué especialidad?, ¿dónde atiende?) con lo que hay que hacer. Debajo, otro número.
 * El detalle, en pestañas: los pasos para confirmarlo en el CMP (tarjetas que se deslizan), los establecimientos donde
 * figura como responsable y las fuentes con cuánto revisamos. Las aclaraciones van en ventanas de ayuda (ⓘ), no en párrafos.
 */
export default async function ResultadoMedico({ params, searchParams }: Props) {
  const n = numeroDe(params.colegiatura);
  if (!n) notFound();
  const m = await getMedico(n);
  const base = baseProducto("salud");
  // Sin la respuesta de la API (falló o no respondió), igual sirve la guía: el número listo y el botón al CMP (2026-11-22:
  // antes caía en el 404 de Vigía).
  if (!m) return <SinRespuesta n={n} base={base} />;
  const cob = m.cobertura;
  const parte = cob.total ? cob.leidas / cob.total : 0;
  const lugares = m.responsableDe;
  const activos = lugares.filter((x) => x.activo).length;
  const conSancion = lugares.filter((x) => x.sanciones > 0).length;
  const seccion = typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined;
  const ficha = rutaEn(base, rutaMedico(m.colegiatura));
  const ico = (I: LucideIcon) => <I size={15} aria-hidden />;

  const pestanas: Pestana[] = [
    {
      clave: "confirmar",
      etiqueta: "Cómo confirmarlo",
      titulo: "Cómo confirmar que está habilitado",
      icono: ico(BadgeCheck),
      contenido: (
        <div className="space-y-5">
          <PasosDeslizables pasos={m.verificar} base={base} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-paperSoft px-4 py-3 text-meta text-inkSoft">
            <span className="font-semibold text-ink">Lo que vas a ver en el CMP:</span>
            <span className="inline-flex items-center gap-1">
              Hábil
              <Ayuda titulo="Hábil">Que el Colegio Médico lo tiene habilitado para ejercer. Es lo primero que hay que ver.</Ayuda>
            </span>
            <span className="inline-flex items-center gap-1">
              RNE
              <Ayuda titulo="RNE: Registro Nacional de Especialistas">
                El número de la especialidad que el CMP le tiene registrada. Si no figura un RNE, no está registrado como especialista.
              </Ayuda>
            </span>
            <span className="inline-flex items-center gap-1">
              Recertificación
              <Ayuda titulo="Recertificación">La certificación que el CMP renueva cada cierto tiempo; ahí ves si la tiene vigente.</Ayuda>
            </span>
          </div>
        </div>
      ),
    },
    {
      clave: "establecimientos",
      etiqueta: "Dónde es responsable",
      titulo: lugares.length === 1 ? "El establecimiento donde figura como responsable" : "Los establecimientos donde figura como responsable",
      icono: ico(Building2),
      conteo: lugares.length || null,
      contenido: lugares.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {lugares.map((x) => (
            <Establecimiento key={x.codigo} x={x} base={base} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-paper px-5 py-10 text-center">
          <Pixel nombre="lugarConsultorio" escala={4} animado={false} />
          <p className="max-w-[52ch] text-dato leading-relaxed text-inkSoft">
            No figura como responsable en los {numero(cob.leidas)} establecimientos cuyo detalle leímos. Puede atender en otro sin ser el
            responsable que declaró la IPRESS.
          </p>
        </div>
      ),
    },
    {
      clave: "fuentes",
      etiqueta: "Fuentes",
      titulo: "De dónde sale cada dato",
      icono: ico(Database),
      contenido: (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
            <h3 className="text-cuerpo font-bold text-ink">Fuentes</h3>
            <ul className="mt-2 space-y-1.5">
              {m.fuentes.map((x) => (
                <li key={x.nombre}>
                  <FuenteFecha nombre={x.nombre} url={x.url} al={x.al} className="text-meta" />
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-meta leading-relaxed text-inkSoft">
              <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              {m.aviso}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
            <h3 className="text-cuerpo font-bold text-ink">Cuánto revisamos</h3>
            <p className="mt-2 font-display text-cifra font-bold leading-none tabular-nums text-ink">
              {Math.round(parte * 100)}
              <span className="text-bloque">%</span>
            </p>
            <p className="mt-1 text-meta leading-snug text-inkSoft">
              del detalle de RENIPRESS: {numero(cob.leidas)} de {numero(cob.total)} establecimientos{cob.al ? `, al ${fechaCorta(cob.al)}` : ""}.
            </p>
            <Medidor parte={parte} etiqueta={`Detalle de RENIPRESS revisado: ${numero(cob.leidas)} de ${numero(cob.total)} establecimientos`} className="mt-3" />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="container-page pb-8 pt-5 sm:pt-8">
      <AnotarVisto tipo="medico" codigo={m.colegiatura} nombre={`Colegiatura N.° ${m.colegiatura}`} detalle={m.colegio ?? null} />
      <Migas
        items={[
          { etiqueta: "Inicio", href: rutaEn(base, "/") },
          { etiqueta: "Verificar a un médico", href: rutaEn(base, "/medico") },
          { etiqueta: `Colegiatura N.° ${m.colegiatura}` },
        ]}
      />

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
        {/* ── La credencial: el número es el título de la página ── */}
        <section aria-labelledby="credencial-t" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_10px_30px_-18px_rgb(var(--ink)/0.35)]">
          <div className="flex items-center justify-between gap-3 bg-granate px-5 py-3 text-paper">
            <p className="min-w-0 truncate text-dato font-semibold">{m.colegio ?? "Colegio profesional sin precisar"}</p>
            <Stethoscope size={18} aria-hidden className="shrink-0 opacity-80" />
          </div>
          <div className="flex flex-1 items-center gap-4 px-5 py-5">
            <span aria-hidden className="grid h-24 w-20 shrink-0 place-items-end justify-center overflow-hidden rounded-xl border border-line bg-paperSoft pb-1">
              <Pixel nombre="doctora" escala={4} retardo={600} />
            </span>
            <div className="min-w-0">
              <h1 id="credencial-t" className="font-display text-cuerpo font-semibold leading-tight text-inkSoft">
                Colegiatura N.°
                <span className="mt-0.5 block font-mono text-cifra font-bold tracking-tight text-ink sm:text-titulo">{m.colegiatura}</span>
              </h1>
              {m.rne.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {m.rne.map((r) => (
                    <Insignia key={r} tono="acento" Icono={Stethoscope} className="font-mono">{`RNE ${r}`}</Insignia>
                  ))}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paperSoft/60 px-5 py-3">
            <CopiarNumero numero={m.colegiatura} />
            <BotonGuardarSalud tipo="medico" codigo={m.colegiatura} nombre={`Colegiatura N.° ${m.colegiatura}`} base={base} />
          </div>
        </section>

        {/* ── Las tres respuestas ── */}
        <Respuestas etiqueta="Lo que puedes saber de esta colegiatura">
            <Respuesta Icono={BadgeCheck} tono="pendiente" pregunta="¿Está habilitado para ejercer?" respuesta="Lo confirma sólo el Colegio Médico">
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={m.habilitacion.url} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "min-h-11")}>
                  Confirmarlo en el CMP <ArrowUpRight size={15} aria-hidden />
                  {EXTERNO}
                </a>
                <span className="inline-flex items-center gap-1 text-meta text-inkSoft">
                  ¿Por qué no lo vemos aquí?
                  <Ayuda titulo="¿Por qué no lo vemos aquí?">
                    La consulta «Conoce a tu médico» del CMP pide una cuenta gratuita y un captcha, y limita las consultas: no la leemos de forma
                    automática. Copia el número y búscalo allá.
                  </Ayuda>
                </span>
              </div>
            </Respuesta>
            <Respuesta
              Icono={Stethoscope}
              tono={m.rne.length ? "bien" : "pendiente"}
              pregunta="¿Es especialista?"
              respuesta={m.rne.length ? "Sí, es especialista registrado" : "RENIPRESS no le registra un RNE"}
            >
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-inkSoft">
                {m.rne.length ? (
                  <>
                    Tiene el RNE <span className="font-mono font-semibold text-ink">{m.rne.join(", ")}</span>. Cuál especialidad es lo dice el CMP.
                    <Ayuda titulo="¿Por qué no decimos qué especialidad es?">
                      RENIPRESS sólo publica el número del Registro Nacional de Especialistas (RNE), y ese número no dice la especialidad: el
                      CMP lo asigna en orden de registro. El nombre de la especialidad se ve en «Conoce a tu médico», que pide cuenta y captcha.
                    </Ayuda>
                  </>
                ) : (
                  "Si tiene una especialidad, figura en el CMP; si no figura un RNE, no está registrado como especialista."
                )}
              </p>
            </Respuesta>
            <Respuesta
              Icono={Building2}
              tono={!lugares.length ? "neutro" : conSancion ? "ojo" : "bien"}
              pregunta="¿Dónde figura como responsable?"
              respuesta={
                lugares.length
                  ? `En ${lugares.length === 1 ? "un establecimiento" : `${numero(lugares.length)} establecimientos`}${activos < lugares.length ? ` (${activos === 1 ? "1 activo" : `${numero(activos)} activos`})` : ""}`
                  : "En ninguno de los que revisamos"
              }
            >
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
                {conSancion > 0 && (
                  <span className="inline-flex items-center gap-1 text-crimsonTexto">
                    {conSancion === 1 ? "Uno tiene sanciones firmes" : `${numero(conSancion)} tienen sanciones firmes`}
                    <Ayuda titulo="¿Es una sanción al médico?" etiqueta="¿La sanción es del médico?">
                      No. Es una sanción de SUSALUD a la clínica o al consultorio, no al médico, y no dice nada de su habilitación.
                    </Ayuda>
                  </span>
                )}
                {lugares.length > 0 && (
                  <Link href={`${ficha}?seccion=establecimientos#secciones`} className="font-semibold text-granate underline-offset-4 hover:underline">
                    Ver {lugares.length === 1 ? "cuál" : "cuáles"}
                  </Link>
                )}
              </p>
            </Respuesta>
        </Respuestas>
      </div>

      {/* ── Otro número, a la vista ── */}
      <section aria-labelledby="otro-t" className="mt-5 flex flex-col gap-3 rounded-2xl border border-line bg-paperSoft px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <h2 id="otro-t" className="flex shrink-0 items-center gap-2 font-display text-bloque font-bold text-ink">
          <ScanSearch size={18} aria-hidden className="text-granate" /> Verificar otro número
        </h2>
        <FormColegiatura base={base} className="min-w-0 flex-1" />
      </section>

      <div id="secciones" className="mt-8 scroll-mt-16">
        <Pestanas pestanas={pestanas} activa={seccion} etiqueta={`Detalle de la colegiatura N.° ${m.colegiatura}`} fija className="[&>div:first-child]:top-16" />
      </div>
    </div>
  );
}

/** La colegiatura sin la respuesta de las fuentes abiertas: el número listo para copiar y cómo verificarlo en el CMP. */
function SinRespuesta({ n, base }: { n: string; base: string }) {
  return (
    <div className="container-page pb-6 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Verificar a un médico", href: rutaEn(base, "/medico") }, { etiqueta: `Colegiatura N.° ${n}` }]} />
      <h1 className="mt-4 font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">
        Colegiatura N.° <span className="font-mono">{n}</span>
      </h1>
      <div className="tarjeta mt-5 max-w-2xl rounded-2xl border border-line bg-paper p-5">
        <p className="text-cuerpo leading-relaxed text-inkSoft">
          Ahora no pudimos leer lo que dicen las fuentes abiertas sobre este número. Su habilitación la confirma el Colegio Médico: copia el número
          y búscalo en «Conoce a tu médico».
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <CopiarNumero numero={n} />
          <a href={URL_CMP} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "min-h-11")}>
            Abrir «Conoce a tu médico» <ArrowUpRight size={15} aria-hidden />
            <span className="sr-only"> (Colegio Médico del Perú, se abre en otra pestaña)</span>
          </a>
          <Link href={rutaEn(base, rutaMedico(n))} className={claseAccion("secundario", "min-h-11")}>
            Volver a intentar
          </Link>
        </div>
      </div>
    </div>
  );
}
