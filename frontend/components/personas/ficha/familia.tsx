import Link from "next/link";
import { Building2, HeartHandshake, Receipt, UsersRound } from "lucide-react";
import { Ayuda, CabeceraPestana, EstadoVacio, Nota } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Indicadores, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { numero, plural, solesCompacto } from "@/lib/formato";
import type { FamiliaDeLaPersona, ItemFamiliar } from "@/lib/funcionarios";
import { tituloNatural } from "@/lib/landing";

/**
 * La red de familia de una persona con cargo público (API `familia`, migración 351): qué obtuvo del Estado cada familiar
 * que declaró en su declaración jurada de intereses, y cuánto de eso salió de una entidad en la que ella misma declaró.
 * El familiar nunca lleva nombre, documento ni enlace: va numerado. Las empresas (RUC 20) sí enlazan a su ficha.
 */

const esRuc20 = (r: string | null | undefined): r is string => !!r && /^20\d{9}$/.test(r);
const anios = (a: number | null, b: number | null) => (a && b && a !== b ? `${a} a ${b}` : a || b ? String(a ?? b) : null);
/** «socio_accionista_titular, representante_legal» → «socio y representante legal». */
const rolLegible = (r: string | null | undefined) => {
  const xs = (r ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) =>
    x.startsWith("socio") ? "socio" : x.startsWith("representante") ? "representante legal" : x.startsWith("organo") ? "directivo" : x.replace(/_/g, " "));
  const u = [...new Set(xs)];
  return u.length ? u.join(" y ") : "socio o representante";
};

const COLUMNAS: Columna[] = [
  { clave: "familiar", titulo: "Familiar y qué obtuvo", ancho: "minmax(0,1.7fr)" },
  { clave: "cuanto", titulo: "Del Estado", ancho: "9rem", alinear: "der" },
  {
    clave: "suya",
    titulo: "De su propia entidad",
    ancho: "minmax(9rem,0.9fr)",
    desde: "md",
    apilar: "con-rotulo",
    corto: "Su entidad",
    ayuda: (
      <Ayuda titulo="¿Qué es «su propia entidad»?">
        <span className="block">
          Una entidad en la que esta persona presentó declaración jurada de intereses, es decir, donde tiene o tuvo un cargo con poder de
          decisión. Que un familiar le venda a esa misma entidad es el indicio que conviene revisar.
        </span>
      </Ayuda>
    ),
  },
  { clave: "periodo", titulo: "Años", ancho: "6.5rem", desde: "lg", apilar: "con-rotulo" },
];

function fila(n: number, parentesco: string, x: ItemFamiliar, i: number): Fila {
  const quien = `Familiar ${n}: ${parentesco.toLowerCase()}`;
  const periodo = anios(x.desde, x.hasta);
  const esOrden = x.tipo === "orden";
  const destino = esOrden ? (
    <>
      Recibe órdenes de{" "}
      {esRuc20(x.entidadRuc) ? (
        <Link href={`/entidad/${x.entidadRuc}?seccion=gente`} prefetch={false} className={CLASE_ENLACE_CELDA}>
          {x.entidad ? tituloNatural(x.entidad) : "una entidad"}
        </Link>
      ) : (
        <>{x.entidad ? tituloNatural(x.entidad) : "una entidad"}</>
      )}
    </>
  ) : (
    <>
      Es {rolLegible(x.rol)} de{" "}
      {esRuc20(x.empresaRuc) ? (
        <Link href={`/empresa/${x.empresaRuc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
          {x.empresa ? tituloNatural(x.empresa) : "una empresa"}
        </Link>
      ) : (
        <>{x.empresa ? tituloNatural(x.empresa) : "una empresa"}</>
      )}
    </>
  );
  const cuenta = esOrden
    ? x.ordenes != null ? plural(x.ordenes, "orden", "órdenes") : undefined
    : [x.ordenes ? plural(x.ordenes, "orden", "órdenes") : null, x.procesos ? plural(x.procesos, "proceso ganado", "procesos ganados") : null].filter(Boolean).join(" y ") || undefined;
  const montoSuyo = esOrden ? x.monto : x.suEntidadMonto;
  const ordenesSuyas = esOrden ? x.ordenes : x.suEntidadOrdenes;
  return {
    id: `familiar-${n}-${i}`,
    enlaces: true,
    textos: { familiar: `${quien} ${x.entidad ?? ""} ${x.empresa ?? ""}`, periodo: periodo ?? "" },
    celdas: {
      familiar: <CeldaPrincipal dosLineas titulo={quien} meta={<span className="block">{destino}</span>} />,
      cuanto: <CeldaNumero sub={cuenta}>{x.monto != null ? solesCompacto(x.monto) : "Reservado"}</CeldaNumero>,
      suya: x.suEntidad ? (
        <span className="flex flex-col items-start gap-0.5 md:items-end">
          <Badge variant="crimson">En su entidad</Badge>
          <span className="text-rotulo text-mute">
            {x.reservado
              ? "Cifras reservadas"
              : [montoSuyo != null ? solesCompacto(montoSuyo) : null, ordenesSuyas ? plural(ordenesSuyas, "orden", "órdenes") : null].filter(Boolean).join(", ")}
          </span>
        </span>
      ) : (
        <CeldaTexto>No</CeldaTexto>
      ),
      periodo: periodo ? <CeldaTexto>{periodo}</CeldaTexto> : undefined,
    },
  };
}

export function PestanaFamilia({ familia: f }: { familia: FamiliaDeLaPersona | null | undefined }) {
  const ayuda = (
    <Ayuda titulo="¿De dónde sale su familia?">
      <span className="block">
        De su declaración jurada de intereses: quien tiene un cargo con poder de decisión declara a la Contraloría a su cónyuge, sus hijos,
        padres, hermanos, cuñados, suegros y otros parientes, con su documento. Los proveedores del Estado no presentan esa declaración.
      </span>
      <span className="mt-2 block">
        Vigía cruza ese documento con las órdenes del Estado y con los socios y representantes del Registro Nacional de Proveedores. No muestra
        el nombre ni el documento de ningún familiar: van numerados.
      </span>
    </Ayuda>
  );
  if (!f) {
    return (
      <div className="space-y-3">
        <CabeceraPestana ayuda={ayuda}>Lo que obtuvo del Estado cada familiar que declaró a la Contraloría.</CabeceraPestana>
        <EstadoVacio titulo="No declaró familiares con documento">
          No hay una declaración jurada de intereses suya leída con familiares, o no presentó ninguna. Quien sólo figura en una planilla no declara
          a su familia.
        </EstadoVacio>
      </div>
    );
  }
  const filas = f.parientes.flatMap((p) => p.items.map((x, i) => fila(p.n, p.parentesco, x, i)));
  const conAlgo = f.parientes.length + f.masParientes;
  return (
    <div className="space-y-4">
      <CabeceraPestana ayuda={ayuda}>
        {conAlgo
          ? `Declaró ${plural(f.declarados, "familiar", "familiares")}; ${conAlgo === 1 ? "uno obtuvo" : `${numero(conAlgo)} obtuvieron`} algo del Estado${f.enSuEntidad ? `, ${f.enSuEntidad === 1 ? "uno de ellos" : `${numero(f.enSuEntidad)} de ellos`} de su propia entidad` : ""}.`
          : `Declaró ${plural(f.declarados, "familiar", "familiares")}. Ninguno figura con órdenes del Estado ni en empresas que le vendan.`}
      </CabeceraPestana>
      <Indicadores
        franja
        items={[
          { valor: numero(f.declarados), etiqueta: f.declarados === 1 ? "familiar declarado" : "familiares declarados", contexto: "con documento, en su declaración jurada", icono: <UsersRound size={15} strokeWidth={1.9} aria-hidden />, parte: null },
          { valor: numero(f.conOrdenes), etiqueta: "con órdenes del Estado", contexto: f.conOrdenes ? `${solesCompacto(f.montoOrdenes)} a su nombre` : "ninguno recibe órdenes", icono: <Receipt size={15} strokeWidth={1.9} aria-hidden />, parte: null },
          { valor: numero(f.conEmpresas), etiqueta: "en empresas que le venden al Estado", contexto: "como socios, representantes o directivos", icono: <Building2 size={15} strokeWidth={1.9} aria-hidden />, parte: null },
          {
            valor: numero(f.enSuEntidad),
            etiqueta: "obtuvieron algo de su entidad",
            contexto: f.enSuEntidad ? (f.montoSuEntidad > 0 ? solesCompacto(f.montoSuEntidad) : "cifras reservadas") : "ninguno",
            icono: <HeartHandshake size={15} strokeWidth={1.9} aria-hidden />,
            tono: f.enSuEntidad ? "alta" : "neutro",
            parte: null,
          },
        ]}
      />
      {filas.length > 0 ? (
        <TablaPaginada
          columnas={COLUMNAS}
          filas={filas}
          etiqueta="Lo que obtuvo del Estado cada familiar declarado"
          nombre="filas"
          tam={20}
          buscar={{ placeholder: "Buscar por entidad, empresa o parentesco…", etiqueta: "Buscar en su red de familia" }}
        />
      ) : null}
      {f.masParientes > 0 && <Nota>Hay {plural(f.masParientes, "familiar más", "familiares más")} con algo del Estado que no entraron en esta lista.</Nota>}
      <Nota>
        Que un familiar le venda al Estado no es una falta. En la entidad donde esta persona tiene cargo es un indicio para revisar: la ley impide
        contratar a ciertos parientes según el cargo (artículo 30 de la Ley 32069), y no prueba que ella haya intervenido en la compra.
      </Nota>
    </div>
  );
}
