/**
 * Las sanciones del Tribunal de Contrataciones de quien ganó, por tipo (inhabilitación definitiva, temporal, multa:
 * migración 121): UNA línea de resumen con los datos («30 definitivas, ninguna vigente al ganar este proceso; la última
 * terminó el 5 jun. 2024»), la tabla con cada resolución plegada debajo (motivo, desde–hasta, multa, si seguía vigente
 * al ganar) y la fuente y la evidencia una sola vez al pie.
 *
 * Antes cada sanción era una oración entera («El Tribunal de Contrataciones le impuso a EMPRESA una inhabilitación
 * definitiva (…), por …, (Res. …). Ya había terminado cuando ganó este proceso. Fuente: …»): con 49 sanciones eran
 * ~1,100 px en escritorio y ~1,900 en el celular de la misma frase repetida (evaluación 2026-10-26). Toda la información
 * sigue ahí: es la evidencia. Server-safe (`TablaPaginada` es la isla de cliente).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { FuenteDato } from "@/components/patrones";
import { CeldaNumero, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { esPersonaNatural, type CruceProveedor, type EvidenciaCruce } from "@/lib/contratos";
import { enlaceProveedor } from "@/lib/empresas";
import { fechaConAnio, hoyLima, numero, oracion, soles, solesCompacto } from "@/lib/formato";
import { txt } from "@/lib/utils";
import { EvidenciaDelCruce } from "./EvidenciaCruce";

/** Los antecedentes que son sanciones del Tribunal, una fila por resolución. `sancion_vigente` no: es una sola frase. */
export const TIPOS_SANCION = new Set(["sancion", "sancion_definitiva", "sancion_temporal", "sancion_multa"]);

/** Sólo el día (los `detalle` traen fechas como texto, a veces con hora). */
const dia = (v: unknown): string | null => txt(v)?.slice(0, 10) ?? null;

/**
 * Una sanción frente a la buena pro de este proceso (pedido del usuario, 2026-10-22: «Sancionado» no decía si lo estaba
 * cuando contrató o antes): si ya había terminado o si seguía vigente al ganar. Una multa no tiene esa vigencia.
 */
export const vigenteEl = (tipo: string | null, desde: string | null, hasta: string | null, fecha: string) =>
  tipo !== "multa" && !!desde && desde <= fecha && (!hasta || hasta >= fecha);

type Clase = "definitivo" | "temporal" | "multa";
const claseDe = (c: CruceProveedor): Clase => {
  const t = txt(c.detalle.tipo);
  return t === "multa" ? "multa" : t === "definitivo" ? "definitivo" : "temporal";
};

const unir = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/**
 * «30 definitivas, ninguna vigente al ganar este proceso (23 set. 2026); la última terminó el 5 jun. 2024.» Sólo datos.
 * Las fechas siempre con el año: al lado de una de otro año, «23 set.» no decía de cuál era.
 */
function Resumen({ grupo, buenaPro }: { grupo: CruceProveedor[]; buenaPro: string | null }) {
  const cuenta = { definitivo: 0, temporal: 0, multa: 0 };
  for (const c of grupo) cuenta[claseDe(c)]++;
  const inhab = grupo.filter((c) => claseDe(c) !== "multa");
  const multas = grupo.filter((c) => claseDe(c) === "multa");
  const nInhab = inhab.length;
  const { definitivo: nDef, temporal: nTem } = cuenta;
  // Un grupo de un solo tipo ya lo nombra su título («Inhabilitación definitiva antes de este proceso»): «30 definitivas».
  const corto = grupo[0].tipo === "sancion_definitiva" || grupo[0].tipo === "sancion_temporal";
  const def = (n: number, largo: boolean) => `${numero(n)} ${largo ? (n === 1 ? "inhabilitación definitiva" : "inhabilitaciones definitivas") : n === 1 ? "definitiva" : "definitivas"}`;
  const tem = (n: number, largo: boolean) => `${numero(n)} ${largo ? (n === 1 ? "inhabilitación temporal" : "inhabilitaciones temporales") : n === 1 ? "temporal" : "temporales"}`;
  const partes: string[] = [];
  if (nDef && nTem) partes.push(`${numero(nInhab)} inhabilitaciones (${def(nDef, false)} y ${tem(nTem, false)})`);
  else if (nDef) partes.push(def(nDef, !corto));
  else if (nTem) partes.push(tem(nTem, !corto));
  const totalMultas = multas.reduce((s, c) => s + (c.montoSoles ?? 0), 0);
  if (multas.length) partes.push(`${numero(multas.length)} ${multas.length === 1 ? "multa" : "multas"}${totalMultas > 0 ? ` por ${solesCompacto(totalMultas)}${multas.length > 1 ? " en total" : ""}` : ""}`);
  const cabeza = unir(partes);

  // Lo que pasa con las inhabilitaciones el día que ganó (o, sin esa fecha, hasta hoy).
  const corte = buenaPro ?? hoyLima();
  const vigentes = buenaPro ? inhab.filter((c) => vigenteEl(claseDe(c), dia(c.detalle.desde), dia(c.detalle.hasta), buenaPro)).length : 0;
  const terminadas = inhab.map((c) => dia(c.detalle.hasta)).filter((h): h is string => !!h && h < corte).sort();
  const ultima = terminadas[terminadas.length - 1];
  const masReciente = multas.map((c) => dia(c.fecha) ?? dia(c.detalle.desde)).filter((f): f is string => !!f).sort().pop();

  if (vigentes > 0) {
    const cuantas =
      vigentes === 1 ? (nInhab === 1 ? "seguía vigente" : "una seguía vigente") : vigentes === nInhab ? "todas seguían vigentes" : `${numero(vigentes)} seguían vigentes`;
    return (
      <p className="text-meta leading-relaxed text-ink">
        {cabeza};{" "}
        <b className="font-semibold text-crimsonTexto">
          {cuantas} al ganar este proceso ({fechaConAnio(buenaPro)})
        </b>
        .
      </p>
    );
  }
  // Con multas al lado, «ninguna» tiene que decir de qué habla (una multa no tiene vigencia).
  const mixto = multas.length > 0 && nInhab > 0;
  const ninguna = mixto ? (nInhab === 1 ? "la inhabilitación no estaba vigente" : "ninguna inhabilitación estaba vigente") : nInhab === 1 ? "no estaba vigente" : "ninguna vigente";
  const cola: ReactNode[] = [];
  if (nInhab && buenaPro) cola.push(<span key="v">{ninguna} al ganar este proceso ({fechaConAnio(buenaPro)})</span>);
  if (nInhab && ultima) cola.push(<span key="u">la última terminó el <b className="font-semibold">{fechaConAnio(ultima)}</b></span>);
  if (!nInhab && masReciente) cola.push(<span key="m">la más reciente, del {fechaConAnio(masReciente)}</span>);
  return (
    <p className="text-meta leading-relaxed text-ink">
      {cabeza}
      {cola.map((x, i) => (
        <span key={i}>
          {i === 0 ? (nInhab && buenaPro ? ", " : "; ") : "; "}
          {x}
        </span>
      ))}
      .{nInhab && buenaPro ? <span className="text-inkSoft"> Son antecedentes, no un impedimento.</span> : null}
    </p>
  );
}

/**
 * "5 jun. 2023 – 5 jun. 2024"; sin fin, "desde el 5 jun. 2023". Siempre con el año: «26 mar. – 26 jul.» de una sanción
 * de este año no decía si cruzaba de un año a otro.
 */
function Vigencia({ desde, hasta }: { desde: string | null; hasta: string | null }) {
  if (!desde && !hasta) return <span className="text-meta text-mute">Sin fecha</span>;
  return (
    <span className="text-meta tabular-nums text-ink">
      {desde && hasta ? `${fechaConAnio(desde)} – ${fechaConAnio(hasta)}` : desde ? `desde el ${fechaConAnio(desde)}` : `hasta el ${fechaConAnio(hasta)}`}
    </span>
  );
}

/** Frente a la buena pro: el chip si seguía vigente; si no, en palabras. */
function AlGanar({ c, buenaPro }: { c: CruceProveedor; buenaPro: string }) {
  const desde = dia(c.detalle.desde);
  const hasta = dia(c.detalle.hasta);
  if (claseDe(c) === "multa") return <span className="text-meta text-mute">No aplica a una multa</span>;
  if (vigenteEl(claseDe(c), desde, hasta, buenaPro)) {
    return (
      <Badge variant="crimson" className="gap-1">
        <AlertTriangle size={12} className="shrink-0" aria-hidden />
        Vigente al ganar
      </Badge>
    );
  }
  if (hasta && hasta < buenaPro) return <span className="text-meta text-inkSoft">Ya había terminado</span>;
  if (desde && desde > buenaPro) return <span className="text-meta text-inkSoft">Empezó después</span>;
  return <span className="text-meta text-mute">Sin fecha de inicio</span>;
}

/** La empresa de la que es la sanción (con varios ganadores o un consorcio). Una persona natural llega tapada de la API. */
function empresaDe(c: CruceProveedor): string | null {
  if (!c.proveedor) return null;
  return c.consorcio ? `${c.proveedor} (integrante de ${c.consorcio.nombre ?? "un consorcio"})` : c.proveedor;
}

/**
 * La misma empresa en la fila, con el enlace a su ficha si es una (RUC 20): con dos ganadores o un consorcio, ver a la
 * otra sin tener que buscarla. Una persona natural (RUC 10) no lleva enlace: su RUC nunca va en una URL.
 */
function EmpresaDeLaSancion({ c }: { c: CruceProveedor }) {
  const href = enlaceProveedor(c.rucProveedor);
  const integrante = c.consorcio ? ` (integrante de ${c.consorcio.nombre ?? "un consorcio"})` : "";
  return (
    <>
      {href ? (
        <Link href={href} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
          {c.proveedor}
        </Link>
      ) : (
        c.proveedor
      )}
      {integrante}
    </>
  );
}

export function GrupoSanciones({ grupo, fuente }: { grupo: CruceProveedor[]; fuente: string }) {
  const buenaPro = dia(grupo.find((c) => c.buenaPro?.fecha)?.buenaPro?.fecha);
  const conInhab = grupo.some((c) => claseDe(c) !== "multa");
  const conMulta = grupo.some((c) => claseDe(c) === "multa");
  const conEmpresa = new Set(grupo.map((c) => c.rucProveedor)).size > 1 || grupo.some((c) => c.consorcio);
  const filasOrdenadas = [...grupo].sort((a, b) => (dia(b.detalle.desde) ?? dia(b.fecha) ?? "").localeCompare(dia(a.detalle.desde) ?? dia(a.fecha) ?? ""));

  const columnas: Columna[] = [
    { clave: "motivo", titulo: "Motivo y resolución", ancho: "minmax(0,1fr)" },
    ...(conInhab ? [{ clave: "vigencia", titulo: "Desde – hasta", corto: "Vigencia", ancho: "184px", desde: "md", apilar: "con-rotulo" } satisfies Columna] : []),
    ...(conMulta ? [{ clave: "multa", titulo: "Multa", ancho: "112px", alinear: "der", desde: "md", apilar: "con-rotulo" } satisfies Columna] : []),
    ...(conInhab && buenaPro ? [{ clave: "alGanar", titulo: "Al ganar este proceso", corto: "Al ganar", ancho: "168px", desde: "md", apilar: "con-rotulo" } satisfies Columna] : []),
  ];

  const filas: Fila[] = filasOrdenadas.map((c, i) => {
    const d = c.detalle;
    const infraccion = txt(d.infraccion)?.replace(/^[-\s]*(i+\)\s*)?/i, "") ?? null;
    const resolucion = txt(d.resolucion);
    const empresa = conEmpresa ? empresaDe(c) : null;
    return {
      // Un índice, no el RUC del ganador (va al DOM y puede ser el de una persona natural).
      id: `sancion-${i}`,
      buscable: [infraccion, resolucion, empresa && !esPersonaNatural(c.rucProveedor) ? empresa : null].filter(Boolean).join(" "),
      celdas: {
        motivo: (
          <span className="block w-full min-w-0">
            {/* El motivo entero, sin recortar: es lo que dice la resolución. */}
            <span className="block text-dato leading-snug text-ink">{infraccion ? oracion(infraccion) : "La fuente no registra el motivo"}</span>
            <span className="mt-0.5 block text-meta text-mute">
              <Partes
                partes={[
                  resolucion && <Dato key="r" tipo="documento" nombre="Resolución">Res. {resolucion}</Dato>,
                  empresa && (
                    <Dato key="e" tipo="entidad" nombre="Empresa">
                      <EmpresaDeLaSancion c={c} />
                    </Dato>
                  ),
                ]}
              />
            </span>
          </span>
        ),
        vigencia: claseDe(c) === "multa" ? <span className="text-meta text-mute">No aplica a una multa</span> : <Vigencia desde={dia(d.desde)} hasta={dia(d.hasta)} />,
        multa: claseDe(c) === "multa" ? (c.montoSoles ? <CeldaNumero>{soles(c.montoSoles)}</CeldaNumero> : <span className="text-meta text-mute">Sin monto</span>) : <span className="text-meta text-mute">No aplica</span>,
        alGanar: buenaPro ? <AlGanar c={c} buenaPro={buenaPro} /> : undefined,
      },
    };
  });

  // La evidencia (las sanciones del RUC en el registro) llega igual en cada fila de ese RUC: va una vez, al pie de la
  // tabla. El enlace lleva el RUC (el perfil del proveedor en el OSCE): con dos ganadores, cada uno conserva la suya.
  const vistas = new Set<string>();
  const evidencia: EvidenciaCruce[] = [];
  for (const e of grupo.flatMap((c) => c.evidencia ?? [])) {
    const clave = `${e.titulo}|${e.enlace?.url ?? ""}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    evidencia.push(e);
  }
  const n = grupo.length;

  return (
    <div className="space-y-2">
      <Resumen grupo={grupo} buenaPro={buenaPro} />
      <details className="group/san">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-lg text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
          <span className="group-open/san:hidden">Ver {n === 1 ? "la resolución" : `las ${numero(n)} resoluciones`}</span>
          <span className="hidden group-open/san:inline">Ocultar las resoluciones</span>
          <ChevronDown size={14} aria-hidden className="shrink-0 transition-transform duration-rapido group-open/san:rotate-180" />
        </summary>
        <div className="mt-2 space-y-2">
          <TablaPaginada
            columnas={columnas}
            filas={filas}
            etiqueta="Sanciones del Tribunal de Contrataciones de quien ganó"
            nombre="resoluciones"
            tam={10}
            buscar={{ placeholder: "Buscar por motivo o número de resolución…", etiqueta: "Buscar en las sanciones" }}
          />
          <FuenteDato fuente={fuente} href={grupo.find((c) => c.fuenteUrl)?.fuenteUrl ?? null} />
          {evidencia.length > 0 && <EvidenciaDelCruce evidencia={evidencia} />}
        </div>
      </details>
    </div>
  );
}
