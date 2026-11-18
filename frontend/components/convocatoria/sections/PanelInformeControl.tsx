"use client";

/**
 * Pestaña «Informe para control» del dictamen (pedido del dueño, 2026-11-16: «un AGENTE que cree ese tipo de documentos
 * [los informes de la Contraloría] para las banderas»). Las señales del contrato y su evidencia en un documento con la forma
 * de un informe de control: I. Información general, II. Alcance y fuentes, III. Resultados (una observación por hecho, con
 * condición, criterio, efecto, causa, evidencia y precedentes), IV. Conclusión, V. Recomendaciones y el anexo de fuentes.
 * Lo arma la API (GET /v1/contratos/:ocid/informe-control): el texto lo redacta un modelo abierto con la evidencia que se
 * le da y lo revisa el código; las cifras, las fechas, los enlaces y las normas los pone el código.
 *
 * Módulo aparte y sin render en el servidor (PanelesDossier): sólo baja al abrir la pestaña. La primera vez el documento se
 * redacta (hasta un minuto); después queda guardado. «Imprimir o guardar PDF» imprime sólo el documento (lib/imprimir.ts):
 * sin menús ni franjas, en modo día y con todas las observaciones abiertas.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BookMarked, CalendarDays, ChevronDown, CircleHelp, Download, ExternalLink, FileSearch, FileText, Gavel, Hash, Landmark, ListChecks,
  Loader2, MapPin, Printer, RefreshCw, Scale, ScanSearch, ShieldAlert, Table2, Target, TriangleAlert, Building2, BriefcaseBusiness,
  Coins, Link2, ListOrdered, Newspaper, GraduationCap, Users, ArrowRight, LogIn,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { idToken } from "@/lib/cuentas";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { Nota } from "@/components/patrones";
import { Skeleton } from "@/components/ui/Skeleton";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { SEVERIDAD } from "@/lib/severidad";
import { cn } from "@/lib/utils";
import { descargarTexto, imprimirParte } from "@/lib/imprimir";
import {
  fechaInforme, pedirInformeControl, solesExactos, type InformeControl, type ObservacionInforme, type PerfilUso, type PrecedenteInforme,
  type RespuestaInformeControl, type ResultadoInformeControl, type SeveridadInforme,
} from "@/lib/informeControl";

/** Cuántas veces se vuelve a preguntar mientras otro pedido lo redacta (cada 30 s más o menos). */
const REINTENTOS = 6;

/** «S/ 23,199,000.00» sin partirse en dos renglones: un espacio duro entre el símbolo y la cifra. */
const montos = (t: string) => t.replace(/S\/ (?=\d)/g, "S/\u00a0");

export function PanelInformeControl({ ocidContrato }: PanelDossierProps) {
  const [resultado, setResultado] = useState<ResultadoInformeControl | null>(null);
  const [intento, setIntento] = useState(0);
  // Con sesión, el pedido lleva el token: sólo una cuenta puede hacer que se redacte (lo guardado lo ve cualquiera).
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!ocidContrato || loading) return;
    const control = new AbortController();
    let espera: ReturnType<typeof setTimeout> | undefined;
    let vueltas = 0;
    const pedir = async () => {
      setResultado(null);
      const token = uid ? await idToken() : null;
      if (control.signal.aborted) return;
      pedirInformeControl(ocidContrato, control.signal, token)
        .then((r) => {
          if (r.tipo === "generando" && vueltas < REINTENTOS) {
            vueltas++;
            setResultado(r);
            espera = setTimeout(() => void pedir(), Math.min(60, Math.max(10, r.reintentarEn)) * 1000);
            return;
          }
          setResultado(r);
        })
        .catch(() => undefined);
    };
    void pedir();
    return () => {
      control.abort();
      if (espera) clearTimeout(espera);
    };
  }, [ocidContrato, intento, uid, loading]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  if (!ocidContrato) {
    return <AvisoSeccion titulo="Sin código del proceso">No se pudo identificar el contrato para armar su informe.</AvisoSeccion>;
  }
  if (!resultado || resultado.tipo === "generando") return <Redactando enCurso={resultado?.tipo === "generando"} />;
  if (resultado.tipo === "requiere_cuenta") return <PedirConCuenta senales={resultado.senales} />;
  if (resultado.tipo === "sin_senales") {
    return (
      <AvisoSeccion titulo="Este contrato no tiene señales" icono={<ScanSearch size={16} aria-hidden />}>
        {resultado.detalle} El informe para control reúne los indicios de un contrato; si aparecen señales nuevas, se podrá armar.
      </AvisoSeccion>
    );
  }
  if (resultado.tipo === "tope" || resultado.tipo === "error") {
    return (
      <AvisoSeccion titulo={resultado.tipo === "tope" ? "Vuelve a intentarlo en un rato" : "No pudimos preparar el informe"} icono={<TriangleAlert size={16} aria-hidden />}>
        <p>{resultado.detalle}</p>
        <button type="button" onClick={reintentar} className={BOTON_SECUNDARIO}>
          <RefreshCw size={14} aria-hidden /> Volver a intentar
        </button>
      </AvisoSeccion>
    );
  }
  return <DocumentoControl datos={resultado.datos} />;
}

const BOTON = "inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-dato font-semibold transition-colors duration-rapido";
const BOTON_PRIMARIO = cn(BOTON, "bg-granate text-paper hover:bg-granate-deep");
const BOTON_SECUNDARIO = cn(BOTON, "mt-3 border border-line bg-paper text-ink hover:border-granate/40");

/** La página de este contrato con su pestaña (el panel sólo se monta en el navegador: PanelesDossier, sin SSR). */
const aquiActual = () => (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`);

/** Para qué lo pide cada quien: la tarjeta lleva a crear la cuenta con ese perfil y vuelve a este contrato. */
const PERFILES: { clave: PerfilUso; titulo: string; para: string; icono: ReactNode }[] = [
  { clave: "periodista", titulo: "Soy periodista", para: "Para una nota: cada indicio con su evidencia y la norma de su fecha.", icono: <Newspaper size={18} aria-hidden /> },
  { clave: "investigador", titulo: "Investigo o enseño", para: "Para un estudio, una tesis o una auditoría ciudadana.", icono: <GraduationCap size={18} aria-hidden /> },
  { clave: "control", titulo: "Trabajo en control", para: "Contraloría u OCI: para evaluar si amerita un servicio de control.", icono: <Landmark size={18} aria-hidden /> },
  { clave: "ciudadano", titulo: "Vigilo mi localidad", para: "Para presentar una denuncia con sustento o seguir el caso.", icono: <Users size={18} aria-hidden /> },
];

const PASOS = [
  { titulo: "Crea tu cuenta", texto: "Un nombre de usuario y una contraseña. Sin correo." },
  { titulo: "Vuelves a este contrato", texto: "Te traemos de regreso a esta pestaña." },
  { titulo: "Se redacta y queda guardado", texto: "Menos de un minuto; después lo ve cualquiera." },
];

/**
 * Sin cuenta y sin informe guardado (pedido del dueño, 2026-11-18): redactarlo usa un modelo con costo, así que en vez de
 * redactarlo para cualquier visita (o un rastreador) se pide con una cuenta. Quién es y para qué lo quiere, en tarjetas;
 * los tres pasos numerados; y las señales del contrato, que se ven sin cuenta, a un clic.
 */
function PedirConCuenta({ senales }: { senales: number }) {
  const aqui = aquiActual();
  const conTab = (tab: string) => {
    const u = new URL(aqui, "https://vigia.local");
    u.searchParams.set("vista", "dictamen");
    u.searchParams.set("tab", tab);
    return `${u.pathname}${u.search}`;
  };
  const crear = (perfil: PerfilUso) => `/signup?perfil=${perfil}&next=${encodeURIComponent(aqui)}`;
  return (
    <section aria-labelledby="informe-cuenta" className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-paperSoft text-granate">
          <FileText size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id="informe-cuenta" className="text-destacado font-semibold leading-snug text-ink">El informe para control se pide con una cuenta</h3>
          <p className="mt-1 max-w-3xl text-meta leading-relaxed text-inkSoft">
            {senales > 0 ? `Reúne ${senales === 1 ? "la señal" : `las ${senales} señales`} de este contrato` : "Reúne las señales de este contrato"} con su
            evidencia y la norma de su fecha. Redactarlo usa un modelo de inteligencia artificial: lo hacemos para quien lo va a usar.
          </p>
        </div>
      </div>

      <h4 className="mt-5 text-meta font-semibold uppercase tracking-wide text-mute">¿Para qué lo necesitas?</h4>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {PERFILES.map((p) => (
          <li key={p.clave}>
            <Link
              href={crear(p.clave)}
              className="group flex h-full items-start gap-3 rounded-xl border border-line p-3 transition-colors duration-rapido hover:border-granate/50 hover:bg-paperSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate"
            >
              <span className="mt-0.5 shrink-0 text-granate">{p.icono}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-dato font-semibold text-ink">{p.titulo}</span>
                <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{p.para}</span>
              </span>
              <ArrowRight size={16} aria-hidden className="mt-1 shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate" />
            </Link>
          </li>
        ))}
      </ul>

      <ol className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
        {PASOS.map((p, i) => (
          <li key={p.titulo} className="flex items-start gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-granate/40 text-meta font-semibold tabular-nums text-granate">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-meta font-semibold text-ink">{p.titulo}</span>
              <span className="block text-meta leading-snug text-inkSoft">{p.texto}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Link href={`/login?next=${encodeURIComponent(aqui)}`} className={BOTON_PRIMARIO}>
          <LogIn size={15} aria-hidden /> Ya tengo cuenta: entrar
        </Link>
        {senales > 0 && (
          <Link href={conTab("resumen")} className={cn(BOTON, "border border-line bg-paper text-ink hover:border-granate/40")}>
            <ShieldAlert size={15} aria-hidden /> Ver las señales sin cuenta
          </Link>
        )}
      </div>
    </section>
  );
}

/** Mientras se redacta: la forma del documento y qué está pasando (la primera vez tarda). */
function Redactando({ enCurso }: { enCurso: boolean }) {
  return (
    <div role="status" aria-busy className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-paperSoft p-4">
        <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-granate motion-reduce:animate-none" aria-hidden />
        <div className="min-w-0">
          <p className="text-dato font-semibold text-ink">{enCurso ? "Otra persona lo está redactando en este momento" : "Preparando el informe para control"}</p>
          <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">
            Se reúnen las señales del contrato, su evidencia y la norma que regía en su fecha, y se redacta cada observación. La
            primera vez tarda hasta un minuto; después queda guardado.
          </p>
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-line bg-paper p-6">
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

// ─── El documento ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que cambia en el papel: sin bordes de tarjeta, los enlaces sin su dirección (salvo en el anexo), los títulos pegados a su texto. */
const ESTILOS_IMPRESION = `
body[data-imprimir], #vigia-impresion { background: rgb(var(--paper)) !important; }
#vigia-impresion [data-informe-control] { border: 0 !important; padding: 0 !important; background: none !important; }
#vigia-impresion [data-informe-control] a[href^="http"]::after { content: none; }
#vigia-impresion [data-informe-control] [data-anexo] a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 8px; word-break: break-all; }
#vigia-impresion [data-informe-control] summary { list-style: none; }
#vigia-impresion [data-informe-control] summary::-webkit-details-marker { display: none; }
#vigia-impresion [data-informe-control] h3, #vigia-impresion [data-informe-control] h4, #vigia-impresion [data-informe-control] summary { break-after: avoid; }
#vigia-impresion [data-informe-control] [data-bloque] { break-inside: avoid; }
`;

function DocumentoControl({ datos }: { datos: RespuestaInformeControl }) {
  const d = datos.informe;
  const doc = useRef<HTMLElement>(null);
  const aqui = aquiActual();
  const [todas, setTodas] = useState(false);

  const imprimir = () => {
    if (!doc.current) return;
    imprimirParte(doc.current, {
      estilos: ESTILOS_IMPRESION,
      preparar: (copia) => {
        copia.querySelectorAll("details").forEach((x) => x.setAttribute("open", ""));
        copia.querySelectorAll("[data-sin-imprimir]").forEach((x) => x.remove());
      },
    });
  };
  const alternarTodas = () => {
    const abrir = !todas;
    doc.current?.querySelectorAll<HTMLDetailsElement>("details[data-observacion]").forEach((x) => (x.open = abrir));
    setTodas(abrir);
  };
  /** Un enlace del índice a una observación la abre antes de bajar a ella. */
  const abrir = (id: string) => {
    const x = document.getElementById(id);
    if (x instanceof HTMLDetailsElement) x.open = true;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paperSoft p-4 sm:flex-row sm:items-center sm:justify-between" data-sin-imprimir>
        <div className="min-w-0 text-meta leading-relaxed text-inkSoft">
          <p className="font-semibold text-ink">
            Versión {datos.version}, del {fechaInforme(datos.generadoAt)}
          </p>
          <p>
            {datos.modelo ? `Redactado con ${nombreModelo(datos.modelo)} (modelo abierto) y revisado contra la evidencia: ` : "Texto armado con los datos: "}
            {d.verificacion.cifrasRevisadas} cifras y fechas cotejadas
            {d.verificacion.oracionesQuitadas === 1 ? ", una oración sin respaldo quitada" : d.verificacion.oracionesQuitadas > 1 ? `, ${d.verificacion.oracionesQuitadas} oraciones sin respaldo quitadas` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={imprimir} className={BOTON_PRIMARIO}>
            <Printer size={15} aria-hidden /> Imprimir o guardar PDF
          </button>
          <button type="button" onClick={() => descargarTexto(datos.markdown, `informe-control-${d.general.proceso.codigo ?? d.general.proceso.ocid}.md`)} className={cn(BOTON, "border border-line bg-paper text-ink hover:border-granate/40")}>
            <Download size={15} aria-hidden /> Descargar texto
          </button>
        </div>
      </div>
      {datos.aviso && (
        <Nota icono={<TriangleAlert size={15} aria-hidden />}>
          {datos.aviso}
          {/entra con tu cuenta/i.test(datos.aviso) && (
            <>
              {" "}
              <Link href={`/login?next=${encodeURIComponent(aqui)}`} className="font-semibold text-granate underline underline-offset-2">
                Entrar
              </Link>
            </>
          )}
        </Nota>
      )}

      <article ref={doc} data-informe-control aria-labelledby="ic-titulo" className="rounded-2xl border border-line bg-paper px-4 py-6 text-ink sm:px-8 sm:py-8">
        <header className="space-y-3 border-b border-line pb-5">
          <p className="flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-mute">
            <Gavel size={13} aria-hidden /> Vigía by Gobserva
          </p>
          <h2 id="ic-titulo" className="font-display text-seccion font-bold leading-tight text-ink">{d.titulo}</h2>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums"><Hash size={13} className="text-mute" aria-hidden />{d.numero}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} className="text-mute" aria-hidden />{fechaInforme(d.fecha)}</span>
          </p>
          <Nota icono={<ShieldAlert size={15} aria-hidden />}>{d.aviso}</Nota>
        </header>

        <Indice d={d} abrir={abrir} />

        <Seccion id="ic-general" titulo="I. Información general">
          <InformacionGeneral d={d} />
        </Seccion>

        <Seccion id="ic-alcance" titulo="II. Alcance y fuentes">
          <Alcance d={d} />
        </Seccion>

        <Seccion id="ic-resultados" titulo="III. Resultados">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-sin-imprimir>
            <p className="text-meta text-inkSoft">
              {d.observaciones.length === 1 ? "Una observación" : `${d.observaciones.length} observaciones`}, de la más grave a la más leve.
            </p>
            {d.observaciones.length > 1 && (
              <button type="button" onClick={alternarTodas} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line px-3 text-rotulo font-semibold text-inkSoft hover:border-granate/40 hover:text-ink">
                <ListOrdered size={13} aria-hidden /> {todas ? "Cerrar las observaciones" : "Abrir todas las observaciones"}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {d.observaciones.map((o, i) => <ObservacionBloque key={o.id} o={o} abierta={i === 0} />)}
          </div>
          {d.otrasSenales.length > 0 && (
            <div className="mt-4 rounded-xl border border-line bg-paperSoft px-4 py-3" data-bloque>
              <p className="text-dato font-semibold text-ink">Otras señales del proceso, sin desarrollar</p>
              <ul className="mt-2 space-y-1.5">
                {d.otrasSenales.map((s, i) => (
                  <li key={`${s.etiqueta}-${i}`} className="flex items-start gap-2 text-meta text-inkSoft">
                    <IconoSeveridad s={s.severidad} />
                    <span>{s.etiqueta}. <span className="text-mute">Fuente: {s.fuente}.</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Seccion>

        <Seccion id="ic-conclusion" titulo="IV. Conclusión">
          <p className="text-cuerpo leading-relaxed">{montos(d.conclusion[0])}</p>
          <ol className="mt-3 space-y-2">
            {d.observaciones.map((o) => (
              <li key={o.id} className="flex items-start gap-2.5 text-dato leading-relaxed">
                <span className="mt-0.5 shrink-0 font-mono text-meta font-semibold tabular-nums text-mute">{o.numero}.</span>
                <span className="min-w-0"><PildoraNivel s={o.severidad} /> {montos(o.sumilla)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-dato leading-relaxed text-inkSoft">{d.conclusion[d.conclusion.length - 1]}</p>
        </Seccion>

        <Seccion id="ic-recomendaciones" titulo="V. Recomendaciones al órgano de control">
          <ol className="space-y-2.5">
            {d.recomendaciones.map((r, i) => (
              <li key={i} className="flex items-start gap-2.5 text-dato leading-relaxed">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-semibold tabular-nums text-ink">{i + 1}</span>
                <span className="min-w-0">{montos(r)}</span>
              </li>
            ))}
          </ol>
        </Seccion>

        <Seccion id="ic-fuentes" titulo="Anexo: fuentes">
          <ul className="space-y-1.5" data-anexo>
            {d.fuentes.map((f) => (
              <li key={f.url} className="flex items-start gap-2 text-meta leading-relaxed">
                <Link2 size={13} className="mt-1 shrink-0 text-mute" aria-hidden />
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                  {f.texto}
                </a>
              </li>
            ))}
          </ul>
        </Seccion>

        <footer className="mt-8 border-t border-line pt-4 text-rotulo leading-relaxed text-mute">
          Documento generado por {d.general.elaboradoPor}. Versión del redactor: {d.version}. Cada observación es un indicio para
          revisar, no una acusación: la determinación de hechos y responsabilidades corresponde a la Contraloría General de la
          República y a los órganos competentes.
        </footer>
      </article>
    </div>
  );
}

/** «glm-5.3» → «GLM 5.3»; «deepseek-v4-pro-0813 + glm-5.3» → «DeepSeek V4 Pro y GLM 5.3». */
function nombreModelo(m: string): string {
  return m.split(/\s*\+\s*/).map((x) => x
    .replace(/-\d{4}$/, "")
    .replace(/^glm-/i, "GLM ")
    .replace(/^deepseek-/i, "DeepSeek ")
    .replace(/^qwen/i, "Qwen ")
    .replace(/-flash$/i, " Flash")
    .replace(/-pro$/i, " Pro")
    .replace(/-/g, " ")
    .replace(/\bv(\d)/i, "V$1")
    .trim()).join(" y ");
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="mt-7 scroll-mt-28">
      <h3 id={`${id}-t`} className="mb-3 font-display text-bloque font-bold text-ink">{titulo}</h3>
      {children}
    </section>
  );
}

function Indice({ d, abrir }: { d: InformeControl; abrir: (id: string) => void }) {
  return (
    <nav aria-label="Contenido del informe" className="mt-5 rounded-xl border border-line bg-paperSoft px-4 py-3" data-sin-imprimir>
      <p className="flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-mute"><ListChecks size={13} aria-hidden /> Contenido</p>
      <ol className="mt-2 grid gap-x-6 gap-y-1 text-meta sm:grid-cols-2">
        {[
          ["ic-general", "I. Información general"], ["ic-alcance", "II. Alcance y fuentes"], ["ic-resultados", `III. Resultados (${d.observaciones.length})`],
          ["ic-conclusion", "IV. Conclusión"], ["ic-recomendaciones", "V. Recomendaciones"], ["ic-fuentes", "Anexo: fuentes"],
        ].map(([id, texto]) => (
          <li key={id}>
            <a href={`#${id}`} className="font-medium text-granate hover:underline">{texto}</a>
          </li>
        ))}
      </ol>
      <ol className="mt-2 space-y-1 border-t border-line pt-2 text-meta">
        {d.observaciones.map((o) => (
          <li key={o.id} className="flex items-start gap-2">
            <IconoSeveridad s={o.severidad} />
            <a href={`#ic-${o.id}`} onClick={() => abrir(`ic-${o.id}`)} className="min-w-0 text-inkSoft hover:text-ink hover:underline">
              Observación N.° {o.numero}: {montos(o.sumilla)}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Fila({ icono, etiqueta, children }: { icono: ReactNode; etiqueta: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[190px,1fr]">
      <dt className="flex items-center gap-1.5 text-meta font-semibold text-mute">
        <span className="shrink-0" aria-hidden>{icono}</span>
        {etiqueta}
      </dt>
      <dd className="min-w-0 text-dato leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

function InformacionGeneral({ d }: { d: InformeControl }) {
  const g = d.general;
  const cifras: [string, number | null][] = [["Valor referencial", g.montos.referencial], ["Monto adjudicado", g.montos.adjudicado], ["Monto contratado", g.montos.contratado]];
  const fechas: [string, string | null][] = [["Convocatoria", g.fechas.convocatoria], ["Buena pro", g.fechas.buenaPro], ["Contrato", g.fechas.contrato]];
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line/70">
        <Fila icono={<FileText size={14} />} etiqueta="Título">{g.titulo}</Fila>
        <Fila icono={<Target size={14} />} etiqueta="Objetivo">{g.objetivo}</Fila>
        <Fila icono={<Building2 size={14} />} etiqueta="Entidad">
          {g.entidad.nombre ?? "Sin dato"}
          {g.entidad.ruc && <span className="ml-1.5 font-mono text-meta tabular-nums text-inkSoft">RUC {g.entidad.ruc}</span>}
        </Fila>
        <Fila icono={<Hash size={14} />} etiqueta="Procedimiento">
          {[g.proceso.nomenclatura, g.proceso.procedimiento].filter(Boolean).join(", ") || "Sin dato"}
          <span className="ml-1.5 font-mono text-meta tabular-nums text-inkSoft">código SEACE {g.proceso.codigo ?? g.proceso.ocid}</span>
        </Fila>
        <Fila icono={<BriefcaseBusiness size={14} />} etiqueta={g.contratistas.length > 1 ? "Contratistas" : "Contratista"}>
          {g.contratistas.length ? (
            <ul className="space-y-0.5">
              {g.contratistas.map((c, i) => (
                <li key={`${c.ruc ?? c.nombre}-${i}`}>
                  {c.nombre ?? "Sin nombre"}
                  {c.ruc && <span className="ml-1.5 font-mono text-meta tabular-nums text-inkSoft">RUC {c.ruc}</span>}
                  {c.monto != null && g.contratistas.length > 1 && <span className="ml-1.5 text-meta text-inkSoft">({solesExactos(c.monto)})</span>}
                </li>
              ))}
            </ul>
          ) : "Sin dato"}
        </Fila>
        <Fila icono={<MapPin size={14} />} etiqueta="Lugar">{g.lugar ?? "Sin dato"}</Fila>
        <Fila icono={<CalendarDays size={14} />} etiqueta="Fecha del documento">{fechaInforme(d.fecha)}</Fila>
        <Fila icono={<Gavel size={14} />} etiqueta="Elaborado por">{g.elaboradoPor}</Fila>
      </dl>
      <div className="grid gap-2 sm:grid-cols-3" data-bloque>
        {cifras.map(([t, v]) => (
          <div key={t} className="rounded-xl border border-line bg-paperSoft px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-rotulo font-semibold text-mute"><Coins size={13} aria-hidden />{t}</p>
            <p className="mt-1 font-mono text-destacado font-semibold tabular-nums text-ink">{solesExactos(v)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3" data-bloque>
        {fechas.map(([t, v]) => (
          <div key={t} className="rounded-xl border border-line px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-rotulo font-semibold text-mute"><CalendarDays size={13} aria-hidden />{t}</p>
            <p className="mt-0.5 text-dato text-ink">{v ? fechaInforme(v) : "Sin dato"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Alcance({ d }: { d: InformeControl }) {
  const a = d.alcance;
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line/70">
        <Fila icono={<CalendarDays size={14} />} etiqueta="Periodo revisado">
          Del {a.periodo.desde ? fechaInforme(a.periodo.desde) : "inicio del procedimiento"} al {fechaInforme(a.periodo.hasta)}
          {a.antecedentesDesde && <>, con antecedentes del contratista desde el {fechaInforme(a.antecedentesDesde)}</>}.
        </Fila>
        <Fila icono={<Scale size={14} />} etiqueta="Normativa aplicable">{a.regimen}, vigente a la fecha de la convocatoria.</Fila>
        <Fila icono={<CalendarDays size={14} />} etiqueta="Datos al">{fechaInforme(a.corte)}</Fila>
      </dl>
      <Nota>{a.nota}</Nota>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-dato font-semibold text-ink">Registros consultados</p>
          <ul className="space-y-1">
            {a.registros.map((r) => (
              <li key={r} className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <FileSearch size={13} className="mt-1 shrink-0 text-mute" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-dato font-semibold text-ink">Documentos del expediente publicados en el SEACE</p>
          {a.documentos.length ? (
            <ul className="space-y-1">
              {a.documentos.map((x) => (
                <li key={x.url} className="flex items-start gap-2 text-meta leading-relaxed">
                  <FileText size={13} className="mt-1 shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0">
                    <a href={x.copia ?? x.url} target="_blank" rel="noopener noreferrer" className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                      {x.titulo}
                    </a>
                    {x.fecha && <span className="text-mute">, {fechaInforme(x.fecha)}</span>}
                    {x.copia && (
                      <a href={x.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-rotulo text-mute underline underline-offset-2 hover:text-ink">
                        original en el SEACE
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-meta text-inkSoft">El registro del proceso no lista documentos.</p>
          )}
        </div>
      </div>
      {d.antecedentesControl.length > 0 && (
        <div data-bloque>
          <p className="mb-1.5 text-dato font-semibold text-ink">Informes de control sobre contrataciones parecidas</p>
          <ul className="space-y-2">
            {d.antecedentesControl.map((q) => <PrecedenteFila key={q.codigo} q={q} usarTitulo />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ObservacionBloque({ o, abierta }: { o: ObservacionInforme; abierta: boolean }) {
  return (
    <details id={`ic-${o.id}`} data-observacion open={abierta} className="group scroll-mt-28 rounded-xl border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 shrink-0 font-mono text-rotulo font-semibold uppercase tracking-wide text-mute">N.° {o.numero}</span>
        <span className="min-w-0 flex-1">
          <PildoraNivel s={o.severidad} />
          <h4 className="mt-1 text-cuerpo font-semibold leading-snug text-ink">{montos(o.sumilla)}</h4>
        </span>
        <ChevronDown size={16} className="mt-1 shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" aria-hidden data-sin-imprimir />
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4">
        <Parte icono={<FileSearch size={14} />} titulo="Condición">
          <div className="space-y-2.5">
            {o.condicion.map((p, i) => <p key={i} className="text-dato leading-relaxed text-ink">{montos(p)}</p>)}
          </div>
          {o.redaccion === "datos" && <p className="mt-2 text-rotulo text-mute">Texto armado con los datos del registro (la redacción automática no se sostuvo con la evidencia).</p>}
        </Parte>

        <Parte icono={<Scale size={14} />} titulo="Criterio">
          <p className="text-meta leading-relaxed text-inkSoft">
            Normativa vigente a la fecha {o.criterio.base === "hecho" ? "del hecho" : "de la convocatoria"} ({fechaInforme(o.criterio.fecha)}): {o.criterio.ley}.
          </p>
          {o.criterio.normas.length === 0 && (
            <p className="mt-1.5 text-meta text-inkSoft">La búsqueda normativa no devolvió artículos para este hecho: vale la referencia de la señal.</p>
          )}
          <ul className="mt-2 space-y-2">
            {o.criterio.normas.map((n) => (
              <li key={n.id} className="rounded-lg border-l-2 border-line bg-paperSoft px-3 py-2" data-bloque>
                <p className="text-dato font-semibold text-ink">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:decoration-granate">
                      {tituloNorma(n)}
                    </a>
                  ) : (
                    tituloNorma(n)
                  )}
                  {n.epigrafe && <span className="font-normal text-inkSoft"> ({n.epigrafe})</span>}
                </p>
                {n.version && <p className="mt-0.5 text-rotulo text-mute">{n.version}</p>}
                <p className="mt-1 text-meta leading-relaxed text-inkSoft">«{n.extracto}»</p>
              </li>
            ))}
            {o.criterio.referencias.map((r) => (
              <li key={r} className="flex items-start gap-2 text-meta text-inkSoft">
                <BookMarked size={13} className="mt-1 shrink-0 text-mute" aria-hidden /> Referencia de la señal: {r}
              </li>
            ))}
          </ul>
        </Parte>

        <Parte icono={<TriangleAlert size={14} />} titulo="Efecto">
          <p className="text-dato leading-relaxed text-ink">{montos(o.efecto)}</p>
        </Parte>

        <Parte icono={<CircleHelp size={14} />} titulo="Causa">
          <p className="text-dato leading-relaxed text-ink">{o.causa}</p>
        </Parte>

        <Parte icono={<Link2 size={14} />} titulo="Evidencia">
          <ul className="space-y-1.5">
            {o.evidencia.map((e) => (
              <li key={e.url} className="flex items-start gap-2 text-meta leading-relaxed">
                <ExternalLink size={13} className="mt-1 shrink-0 text-mute" aria-hidden />
                <span className="min-w-0">
                  <a href={e.copia ?? e.url} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                    {e.texto}
                  </a>
                  {e.copia && (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-rotulo text-mute underline underline-offset-2 hover:text-ink">
                      original en el SEACE
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {o.registros.map((r) => <TablaRegistros key={r.titulo} r={r} />)}
          <p className="mt-2 text-rotulo text-mute">Señales que sostienen esta observación: {o.senales.map((s) => s.etiqueta).join("; ")}.</p>
        </Parte>

        <Parte icono={<Landmark size={14} />} titulo="Precedentes">
          {o.precedentes.length ? (
            <ul className="space-y-2">
              {o.precedentes.map((q) => <PrecedenteFila key={q.codigo} q={q} />)}
            </ul>
          ) : (
            <p className="text-meta text-inkSoft">Sin observaciones comparables en los informes de control disponibles.</p>
          )}
        </Parte>
      </div>
    </details>
  );
}

function Parte({ icono, titulo, children }: { icono: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div className="grid items-start gap-x-4 gap-y-1.5 md:grid-cols-[130px,1fr]">
      <p className="flex items-center gap-1.5 text-rotulo font-semibold uppercase tracking-wide text-mute md:pt-0.5">
        <span className="shrink-0" aria-hidden>{icono}</span>
        {titulo}
      </p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TablaRegistros({ r }: { r: ObservacionInforme["registros"][number] }) {
  return (
    <div className="mt-3" data-bloque>
      <p className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-ink">
        <Table2 size={13} className="text-mute" aria-hidden />
        {r.titulo}
        {r.total != null && r.total > r.filas.length && <span className="font-normal text-mute">({r.filas.length} de {r.total})</span>}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[480px] border-collapse text-rotulo">
          <thead>
            <tr className="bg-paperDeep text-left">
              {r.columnas.map((c) => <th key={c} scope="col" className="px-2.5 py-1.5 font-semibold text-ink">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {r.filas.map((f, i) => (
              <tr key={i} className="border-t border-line align-top">
                {f.map((v, k) => <td key={k} className="px-2.5 py-1.5 text-inkSoft">{v ?? "Sin dato"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** «Ley N.° 32069, artículo 30»; si el documento ya nombra el artículo, no se repite. */
function tituloNorma(n: { documento: string; articulo: string | null }): string {
  if (!n.articulo) return n.documento;
  const yaLoDice = new RegExp(`art[ií]culo\\s+${n.articulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(n.documento);
  return yaLoDice ? n.documento : `${n.documento}, artículo ${n.articulo}`;
}

const RESPONSABILIDAD: Record<string, string> = {
  penal: "penal", civil: "civil", administrativa_entidad: "administrativa (entidad)", administrativa_pas: "administrativa (sancionador)", administrativa: "administrativa",
};

function PrecedenteFila({ q, usarTitulo = false }: { q: PrecedenteInforme; usarTitulo?: boolean }) {
  const texto = usarTitulo ? q.titulo : q.observacion ?? q.titulo;
  return (
    <li className="rounded-lg border border-line px-3 py-2 text-meta leading-relaxed" data-bloque>
      <p className="font-semibold text-ink">
        {q.url ? (
          <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
            Informe N.° {q.numero ?? q.codigo}
          </a>
        ) : (
          <>Informe N.° {q.numero ?? q.codigo}</>
        )}
        <span className="font-normal text-inkSoft">
          {q.entidad && `, ${q.entidad}`}
          {q.anio && ` (${q.anio})`}
        </span>
      </p>
      {texto && <p className="mt-0.5 text-inkSoft">{texto}</p>}
      {(q.modalidad || q.responsabilidades.length > 0) && (
        <p className="mt-0.5 text-rotulo text-mute">
          {q.modalidad && <>{q.modalidad.toLocaleLowerCase("es").replace(/^\p{L}/u, (c) => c.toLocaleUpperCase("es"))}. </>}
          {q.responsabilidades.length > 0 && <>Responsabilidad presunta señalada: {q.responsabilidades.map((x) => RESPONSABILIDAD[x] ?? x).join(", ")}.</>}
        </p>
      )}
    </li>
  );
}

const NIVEL: Record<SeveridadInforme, string> = { alta: "alto", media: "medio", baja: "bajo" };

function PildoraNivel({ s }: { s: SeveridadInforme }) {
  const ui = SEVERIDAD[s];
  const Icono = ICONO_NIVEL[s];
  return (
    <span className={cn("pill align-middle font-semibold", ui.fondo, ui.texto, ui.borde)}>
      <Icono size={11} aria-hidden />
      Indicio de nivel {NIVEL[s]}
    </span>
  );
}

function IconoSeveridad({ s }: { s: SeveridadInforme }) {
  const Icono = ICONO_NIVEL[s];
  return (
    <span className={cn("mt-0.5 shrink-0", SEVERIDAD[s].texto)} title={`Nivel ${NIVEL[s]}`}>
      <Icono size={13} aria-hidden />
      <span className="sr-only">Nivel {NIVEL[s]}</span>
    </span>
  );
}
