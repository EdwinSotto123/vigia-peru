import Link from "next/link";
import type { ReactNode } from "react";
import { BriefcaseBusiness, HandCoins, Landmark, Vote, type LucideIcon } from "lucide-react";
import { EstadoVacio, FuenteDato } from "@/components/patrones";
import {
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Indicadores,
  ListaPaginada,
  Tabla,
  TablaFiltrable,
  type Columna,
  type FilaFiltrable,
  type Fila,
} from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Severidad } from "@/components/ui/Severidad";
import { Dato } from "@/components/ui/Dato";
import { fecha, fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { BUSCADOR_RNP, CLARIDAD_ONPE, DATASET_SOCIOS_RNP, DJI_CONSULTA, PLATAFORMA_JNE, djiEntidad, fichaRnp } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { rutaEmpresa, type DeclaracionDji, type SocioEnElEstado, type SociosEmpresa } from "@/lib/empresas";
import { rutaPartido } from "@/lib/partidos";
import { cargoEnOracion } from "@/lib/planilla";
import { rutaPersona } from "@/lib/personas";
import { lugarDelCargo } from "./casoAntecedente";
import { NoCargo } from "./comun";
import { P_ANTECEDENTES } from "./antecedentes";

/** La pestaña Socios: sus socios y representantes y las empresas vinculadas por ellos. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Socios y empresas vinculadas ─────────────────────────────────────────────

const COLUMNAS_SOCIOS: Columna[] = [
  { clave: "persona", titulo: "Persona", ancho: "minmax(0,1.4fr)" },
  { clave: "papel", titulo: "Papel", ancho: "minmax(0,1fr)" },
  { clave: "desde", titulo: "Desde", ancho: "100px", desde: "md" },
  { clave: "otras", titulo: "Otras empresas", ancho: "112px", alinear: "der", desde: "lg" },
];

const COLUMNAS_VINCULADAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1.4fr)" },
  { clave: "comun", titulo: "En común", ancho: "minmax(0,1.2fr)", desde: "md", apilar: true },
  { clave: "antecedentes", titulo: "Antecedentes", ancho: "132px" },
  { clave: "monto", titulo: "Recibió", ancho: "104px", alinear: "der", desde: "lg" },
];

const papeles = (r: string[]) => r.map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(", ");
const mayus = (s: string) => s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
const ENLACE = "font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink";
/** Los papeles en el orden en que pesan: quien la representa, quien es dueño, quien la dirige. */
const ORDEN_PAPEL = ["representante legal", "socio", "directivo"];
const porPapel = (r: string[]) => [...r].sort((a, b) => (ORDEN_PAPEL.indexOf(a) + 1 || 9) - (ORDEN_PAPEL.indexOf(b) + 1 || 9));

type Persona = SociosEmpresa["socios"][number];

/** Un renglón de «En el Estado»: un ícono, qué es (con su referencia), el detalle y, si lo hay, el antecedente que genera. */
function FilaEstado({
  icono: Icono,
  titulo,
  detalle,
  alerta = false,
  enlace,
}: {
  icono: LucideIcon;
  titulo: ReactNode;
  detalle?: ReactNode;
  /** En rojo: lo que toca a esta empresa (es locador de una entidad que le compra). */
  alerta?: boolean;
  enlace?: { texto: string; href: string } | null;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${alerta ? "bg-crimson/10 text-crimsonTexto" : "bg-paperDeep text-inkSoft"}`}
        aria-hidden
      >
        <Icono size={15} strokeWidth={2} />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className={`text-dato ${alerta ? "font-semibold text-crimsonTexto" : "text-ink"}`}>{titulo}</p>
        {detalle && <div className="text-meta text-inkSoft">{detalle}</div>}
        {enlace && (
          <Link href={enlace.href} className={`inline-flex min-h-8 items-center text-meta ${ENLACE}`}>
            {enlace.texto}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * Lo que la persona es en el Estado según su documento (que no sale de la API), cada cosa en su renglón con su
 * referencia: el cargo de elección con su lugar, su partido y su periodo; cada candidatura con su resultado; a qué
 * partidos aportó; si es locador (en rojo si lo es de una entidad que le compra a esta empresa). Si la empresa tiene ese
 * antecedente, el enlace lleva a él.
 */
function EnElEstado({ e, ruc, tipos }: { e: SocioEnElEstado; ruc: string; tipos: Set<string> }) {
  const alAntecedente = (...ts: string[]) => {
    const t = ts.find((x) => tipos.has(x));
    return t ? { texto: "Ver el antecedente", href: rutaEmpresa(ruc, "antecedentes", { [P_ANTECEDENTES.tipo]: t }) } : null;
  };
  const a = e.autoridad;
  const lugar = a ? lugarDelCargo({ distrito: a.distrito ?? null, provincia: a.provincia ?? null, departamento: a.departamento ?? null }, a.cargo) : null;
  const posts = e.postulaciones ?? [];
  const partidos = e.aportes?.partidos?.filter(Boolean) ?? [];
  return (
    <ul className="space-y-3" aria-label="Lo que es en el Estado">
      {a && (
        <FilaEstado
          icono={Landmark}
          titulo={
            <>
              {a.vigente ? "Es " : "Fue "}
              <b className="font-semibold">{cargoEnOracion(a.cargo) ?? "autoridad electa"}</b>
              {lugar ? ` de ${lugar}` : ""}
            </>
          }
          detalle={
            <>
              {a.organizacion ? (
                <>
                  Por{" "}
                  <Link href={rutaPartido(a.organizacion, a.desde)} className={ENLACE}>
                    {tituloNatural(a.organizacion)}
                  </Link>
                  {", "}
                </>
              ) : null}
              {a.desde ? `de ${[a.desde, a.hasta].filter(Boolean).join(" a ")}` : ""}
              {a.vigente != null ? `. ${a.vigente ? "Sigue en el cargo" : "Ya dejó el cargo"}.` : ""}
            </>
          }
          enlace={alAntecedente("autoridad")}
        />
      )}
      {posts.length > 0 && (
        <FilaEstado
          icono={Vote}
          titulo={e.candidaturas > 1 ? `Postuló ${numero(e.candidaturas)} veces` : "Postuló una vez"}
          detalle={
            <ul className="space-y-0.5">
              {posts.map((p, i) => {
                const donde = lugarDelCargo({ distrito: p.distrito, provincia: p.provincia, departamento: p.departamento }, p.cargo, true);
                return (
                  <li key={i}>
                    {p.anio ? <span className="font-mono tabular-nums text-ink">{p.anio}</span> : null}
                    {p.anio ? ": " : ""}
                    {cargoEnOracion(p.cargo, !p.anio) ?? "candidatura"}
                    {donde ? ` de ${donde}` : ""}
                    {p.partido ? (
                      <>
                        {" por "}
                        <Link href={rutaPartido(p.partido, p.anio)} className={ENLACE}>
                          {tituloNatural(p.partido)}
                        </Link>
                      </>
                    ) : null}
                    {p.resultado ? (/^electo/i.test(p.resultado) ? <>; <b className="font-semibold text-ink">fue elegido</b></> : "; no fue elegido") : ""}
                  </li>
                );
              })}
              {e.candidaturas > posts.length && <li className="text-mute">{`Y ${plural(e.candidaturas - posts.length, "candidatura más", "candidaturas más")}`}</li>}
            </ul>
          }
          enlace={alAntecedente("candidato")}
        />
      )}
      {!posts.length && e.candidaturas > 0 && (
        <FilaEstado icono={Vote} titulo={plural(e.candidaturas, "candidatura", "candidaturas")} enlace={alAntecedente("candidato")} />
      )}
      {e.aportes && (
        <FilaEstado
          icono={HandCoins}
          titulo={`Aportó ${solesCompacto(e.aportes.monto)} a partidos`}
          detalle={
            <>
              {`${plural(e.aportes.n, "aporte", "aportes")}`}
              {partidos.length ? " a " : ""}
              {partidos.map((p, i) => (
                <span key={p}>
                  {i > 0 && (i === partidos.length - 1 ? " y " : ", ")}
                  <Link href={rutaPartido(p, e.aportes?.hasta)} className={ENLACE}>
                    {tituloNatural(p)}
                  </Link>
                </span>
              ))}
              {e.aportes.desde ? `, ${e.aportes.desde === e.aportes.hasta || !e.aportes.hasta ? `en ${e.aportes.desde}` : `entre ${e.aportes.desde} y ${e.aportes.hasta}`}` : ""}
              .
            </>
          }
          enlace={alAntecedente("partido_gobernante", "aporte")}
        />
      )}
      {e.locador && (
        <FilaEstado
          icono={BriefcaseBusiness}
          alerta={e.locador.clientes > 0}
          titulo={`Locador de ${plural(e.locador.entidades, "entidad", "entidades")} (${solesCompacto(e.locador.monto)})`}
          detalle={
            e.locador.clientes > 0
              ? `${e.locador.clientes === e.locador.entidades ? (e.locador.entidades === 1 ? "Esa entidad" : "Todas") : `${numero(e.locador.clientes)} de ellas`} también le ${e.locador.clientes === 1 && e.locador.entidades === 1 ? "compra" : "compran"} a esta empresa: quien vende y quien presta servicios a la entidad son la misma persona.`
              : "Ninguna de esas entidades le compra a esta empresa."
          }
          enlace={e.locador.codigo ? { texto: "Ver lo que cobró como locador", href: rutaPersona(e.locador.codigo, "recorrido") } : alAntecedente("socio_en_entidad")}
        />
      )}
    </ul>
  );
}

/** Una persona de la empresa: su nombre (un apellido tapado), sus papeles, desde cuándo, en cuántas otras empresas está y lo que es en el Estado. */
function PersonaDeLaEmpresa({ p, ruc, tipos }: { p: Persona; ruc: string; tipos: Set<string> }) {
  return (
    <article className={`tarjeta space-y-3 rounded-xl border p-3.5 ${p.enElEstado ? "border-line bg-paper" : "border-line/80 bg-paperSoft"}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1.5">
          <h4 className="text-cuerpo font-semibold text-ink">{p.nombre}</h4>
          <ul className="flex flex-wrap gap-1.5" aria-label="Su papel en la empresa">
            {porPapel(p.roles).map((r) => (
              <li key={r}>
                <Badge variant={r === "representante legal" ? "ink" : "neutral"}>{mayus(r)}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-meta">
          <div>
            <dt className="text-mute">En la empresa desde</dt>
            <dd className="font-mono tabular-nums text-ink">{p.desde ? fechaCorta(p.desde) : <span className="font-sans text-mute">Sin fecha</span>}</dd>
          </div>
          <div>
            <dt className="text-mute">En otras empresas</dt>
            <dd className="text-ink">
              {p.otrasEmpresas ? (
                <a href="#empresas-vinculadas" className={ENLACE}>
                  {plural(p.otrasEmpresas, "empresa", "empresas")}
                </a>
              ) : (
                <span className="text-mute">Ninguna</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      {p.enElEstado && (
        <div className="space-y-2 border-t border-line/70 pt-3">
          <h5 className="text-meta font-semibold text-ink">En el Estado</h5>
          <EnElEstado e={p.enElEstado} ruc={ruc} tipos={tipos} />
        </div>
      )}
    </article>
  );
}

const QUE_DECLARO: Record<number, string> = {
  1: "Tiene acciones o participación",
  2: "Tiene un poder o la representa",
  3: "Está en su directorio",
  4: "Trabajó o la asesoró",
};

/** La fuente del RNP: el dataset de la conformación jurídica y, con el RUC de la empresa (RUC 20), su ficha. */
const FUENTE_RNP = "OECE, Registro Nacional de Proveedores (conformación jurídica)";

export async function SociosEmpresa({
  datos,
  ruc,
  tipos = [],
}: {
  datos: Promise<SociosEmpresa | null>;
  /** El RUC de la empresa: la fuente lleva a su ficha en el RNP (sin él, o con un RUC 10, al buscador del RNP). */
  ruc?: string;
  /** Los tipos de antecedente que tiene la empresa: lo que una persona es en el Estado lleva al suyo si existe. */
  tipos?: string[];
}) {
  const d = await datos;
  if (!d) return <NoCargo que="sus socios" />;
  // fichaRnp sólo arma la ficha de un RUC 20: un RUC 10 lleva el DNI y va al buscador.
  const fichaEmpresa = fichaRnp(ruc);
  const sinNada = !d.socios.length && !d.empresasSocias.length && !d.vinculadas.length && !d.sociaDe.length;
  if (sinNada) {
    return (
      <EstadoVacio compacto titulo="Sin socios ni representantes en el RNP">
        El Registro Nacional de Proveedores no publica su conformación: puede no estar inscrita como proveedora vigente.
      </EstadoVacio>
    );
  }
  // Primero quien tiene algo en el Estado (lo que más pesa); después, en el orden de la API (representantes, socios, nombre).
  const personas = [...d.socios].sort((a, b) => Number(!!b.enElEstado) - Number(!!a.enElEstado));
  const enEstado = personas.filter((p) => p.enElEstado).length;
  const conOtras = personas.filter((p) => p.otrasEmpresas > 0).length;
  const cuenta = (r: string) => personas.filter((p) => p.roles.includes(r)).length;
  const reparto = [
    cuenta("representante legal") ? plural(cuenta("representante legal"), "representante legal", "representantes legales") : null,
    cuenta("socio") ? plural(cuenta("socio"), "socio", "socios") : null,
    cuenta("directivo") ? plural(cuenta("directivo"), "directivo", "directivos") : null,
  ].filter(Boolean).join(", ");
  const conjunto = new Set(tipos);
  const tarjetas = personas.map((p, i) => ({
    id: `p-${i}`,
    contenido: <PersonaDeLaEmpresa p={p} ruc={ruc ?? ""} tipos={conjunto} />,
    // Sin el nombre (no se busca a una persona por su nombre: docs/PRIVACIDAD.md): sus papeles y lo que es en el Estado.
    buscable: [
      ...p.roles,
      p.enElEstado?.autoridad?.cargo, p.enElEstado?.autoridad?.distrito, p.enElEstado?.autoridad?.provincia, p.enElEstado?.autoridad?.departamento,
      p.enElEstado?.autoridad?.organizacion,
      ...(p.enElEstado?.postulaciones ?? []).flatMap((x) => [x.cargo, x.partido, x.distrito, x.provincia, x.departamento]),
      ...(p.enElEstado?.aportes?.partidos ?? []),
      p.enElEstado?.locador ? "locador" : null,
    ].filter(Boolean).join(" "),
  }));
  const filasEmpresas: Fila[] = [
    ...d.empresasSocias.map((s, i) => ({
      id: `e-${i}`,
      href: s.ruc ? rutaEmpresa(s.ruc) : undefined,
      celdas: {
        persona: <CeldaPrincipal titulo={s.nombre} meta={s.ruc ? [<Dato key="ruc" tipo="ruc" mono>{s.ruc}</Dato>] : undefined} />,
        papel: <span className="text-meta text-ink">{papeles(s.roles)}</span>,
        desde: <CeldaFecha fecha={s.desde} />,
        otras: <CeldaNumero><span className="font-sans text-mute">No aplica</span></CeldaNumero>,
      },
    })),
  ];
  const filasVinculadas: FilaFiltrable[] = d.vinculadas.map((v) => ({
    id: v.ruc,
    href: rutaEmpresa(v.ruc),
    buscable: `${v.nombre ?? ""} ${v.ruc}`,
    valores: {
      antecedentes: !v.vende ? "no_vende" : v.graves > 0 ? "grave" : v.antecedentes > 0 ? "con" : "sin",
      vende: v.monto > 0 || v.contratos > 0 ? "si" : "no",
      inhabilitada: v.inhabilitada ? "si" : "no",
      papel: [...new Set(v.socios.flatMap((s) => s.roles))],
    },
    claves: { monto: v.monto, nombre: v.nombre ?? v.ruc, personas: v.socios.length },
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={v.nombre ?? `RUC ${v.ruc}`}
          meta={[
            <Dato key="ruc" tipo="ruc" mono>{v.ruc}</Dato>,
            v.inhabilitada && <Badge key="inh" variant="crimson">Inhabilitada</Badge>,
          ]}
        />
      ),
      comun: (
        <ul className="space-y-0.5 text-meta text-ink">
          {/* recorte: tres y «y N más» al final */}
          {v.socios.slice(0, 3).map((s, i) => (
            <li key={i}>
              <b className="font-semibold">{s.nombre}</b>
              <span className="text-inkSoft">
                {s.roles.join(", ") === s.rolesAlla.join(", ")
                  ? ` (${s.roles.join(", ")} en las dos)`
                  : ` (${s.roles.join(", ")} aquí; ${s.rolesAlla.join(", ")} allá)`}
              </span>
            </li>
          ))}
          {v.socios.length > 3 && <li className="text-mute">{`y ${v.socios.length - 3} más`}</li>}
        </ul>
      ),
      antecedentes: !v.vende ? (
        <span className="text-meta text-mute">No le vende al Estado</span>
      ) : v.antecedentes ? (
        <span className="flex flex-wrap items-center gap-1 text-meta text-ink">
          {plural(v.antecedentes, "tipo", "tipos")}
          {v.graves > 0 && <Severidad bandera="alta" />}
        </span>
      ) : (
        <span className="text-meta text-mute">Ninguno</span>
      ),
      monto: <CeldaNumero sub={v.contratos ? plural(v.contratos, "contrato", "contratos") : undefined}>{v.monto ? solesCompacto(v.monto) : <span className="font-sans text-mute">Nada</span>}</CeldaNumero>,
    },
  }));
  return (
    <div className="space-y-6">
      {(personas.length > 0 || filasEmpresas.length > 0) && (
        <section className="space-y-3" aria-labelledby="quienes-estan-detras">
          <div className="space-y-1">
            <h3 id="quienes-estan-detras" className="font-display text-bloque font-bold text-ink">Quiénes están detrás</h3>
            <p className="max-w-prose text-meta text-inkSoft">
              Lo que la empresa declaró al Registro Nacional de Proveedores{d.corte ? ` (corte del ${fechaCorta(d.corte)})` : ""}. Sin
              documento y con un apellido tapado.
            </p>
          </div>
          {personas.length > 0 && (
            <Indicadores
              items={[
                { etiqueta: personas.length === 1 ? "Persona" : "Personas", valor: numero(personas.length), contexto: reparto || undefined },
                {
                  etiqueta: "Con un cargo o un vínculo en el Estado",
                  valor: numero(enEstado),
                  tono: enEstado ? "alta" : "neutro",
                  contexto: enEstado ? "Autoridad, candidato, aportante o locador: va en su tarjeta" : "Ninguna es autoridad, candidata, aportante ni locadora",
                },
                {
                  etiqueta: "Están en otras empresas",
                  valor: numero(conOtras),
                  contexto: d.vinculadas.length ? `${plural(d.vinculadas.length, "empresa vinculada", "empresas vinculadas")}, más abajo` : "Ninguna empresa vinculada",
                  href: d.vinculadas.length ? "#empresas-vinculadas" : undefined,
                },
              ]}
            />
          )}
          {personas.length > 0 && (
            <ListaPaginada
              items={tarjetas}
              tam={8}
              nombre="personas"
              buscar={{ placeholder: "Buscar por papel, cargo, lugar o partido…", etiqueta: "Buscar en su gente por papel, cargo, lugar o partido" }}
            />
          )}
          {filasEmpresas.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-cuerpo font-semibold text-ink">Empresas que son sus socias</h4>
              <Tabla columnas={COLUMNAS_SOCIOS} filas={filasEmpresas} etiqueta="Empresas socias" />
            </div>
          )}
          <FuenteDato
            fuente={FUENTE_RNP}
            href={DATASET_SOCIOS_RNP}
            enlaces={[
              { texto: fichaEmpresa === BUSCADOR_RNP ? "Buscador de proveedores del RNP (OECE)" : "Su ficha en el RNP (OECE)", href: fichaEmpresa },
              { texto: "Candidaturas y autoridades (JNE)", href: PLATAFORMA_JNE },
              { texto: "Aportes a partidos (ONPE)", href: CLARIDAD_ONPE },
            ]}
          />
        </section>
      )}
      {(d.declaradaDji?.length ?? 0) > 0 && <DeclaradaDji filas={d.declaradaDji!} />}
      {d.sociaDe.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-bloque font-bold text-ink">Es socia de</h3>
          <ul className="flex flex-wrap gap-2">
            {d.sociaDe.map((s) => (
              <li key={s.ruc}>
                <Link href={rutaEmpresa(s.ruc)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-meta text-ink hover:border-granate/40">
                  {s.nombre ?? `RUC ${s.ruc}`} <span className="text-mute">{`(${papeles(s.roles).toLowerCase()})`}</span>
                </Link>
              </li>
            ))}
          </ul>
          <FuenteDato fuente={FUENTE_RNP} href={DATASET_SOCIOS_RNP} />
        </section>
      )}
      {filasVinculadas.length > 0 && (
        <section id="empresas-vinculadas" className="scroll-mt-24 space-y-2">
          <h3 className="font-display text-bloque font-bold text-ink">Empresas vinculadas</h3>
          <p className="max-w-prose text-meta text-inkSoft">
            Otras empresas con alguien de su gente. Si compitieron en un mismo proceso, figura en sus antecedentes.
          </p>
          <TablaFiltrable
            columnas={COLUMNAS_VINCULADAS}
            filas={filasVinculadas}
            etiqueta="Empresas vinculadas"
            tam={15}
            nombre="empresas"
            buscar={{ placeholder: "Buscar empresa por nombre o RUC…", etiqueta: "Buscar en las empresas vinculadas" }}
            filtros={[
              {
                clave: "antecedentes", etiqueta: "Sus antecedentes", corta: "Antecedentes",
                opciones: [
                  { valor: "grave", etiqueta: "Con alguno de señal alta" }, { valor: "con", etiqueta: "Con antecedentes, sin señal alta" },
                  { valor: "sin", etiqueta: "Sin antecedentes" }, { valor: "no_vende", etiqueta: "No le vende al Estado" },
                ],
              },
              { clave: "papel", etiqueta: "Papel de la persona en común", corta: "Papel en común", opciones: [{ valor: "socio", etiqueta: "Socio" }, { valor: "representante legal", etiqueta: "Representante legal" }, { valor: "directivo", etiqueta: "Directivo" }] },
              { clave: "inhabilitada", etiqueta: "Inhabilitada hoy", corta: "Inhabilitada", opciones: [{ valor: "si", etiqueta: "Inhabilitada hoy" }, { valor: "no", etiqueta: "No inhabilitada" }] },
            ]}
            ordenes={[
              { valor: "monto", etiqueta: "Más dinero recibido", clave: "monto", dir: "desc" },
              { valor: "personas", etiqueta: "Más personas en común", clave: "personas", dir: "desc" },
              { valor: "nombre", etiqueta: "Por nombre", clave: "nombre", dir: "asc" },
            ]}
          />
          <FuenteDato fuente={FUENTE_RNP} href={DATASET_SOCIOS_RNP} />
        </section>
      )}
    </div>
  );
}

/**
 * Lo que funcionarios declararon sobre la empresa en su Declaración Jurada de Intereses (Contraloría, secciones 1 a 4):
 * del funcionario, su cargo, su entidad y su primer apellido; nunca su nombre completo. Si la empresa le vende a esa
 * entidad, la ficha de cada contrato lo marca como «interés declarado».
 */
function DeclaradaDji({ filas }: { filas: DeclaracionDji[] }) {
  const venden = filas.filter((f) => f.leVende).length;
  // Las declaraciones juradas presentadas en cada entidad (la consulta pública de la Contraloría), una vez por entidad: la
  // lista de la entidad, no la declaración de una persona.
  const porEntidad = filas
    .filter((f, i) => filas.findIndex((x) => x.entidadRuc === f.entidadRuc) === i)
    .map((f) => ({ texto: `Las declaraciones juradas de ${tituloNatural(f.entidad ?? f.entidadRuc)}`, href: djiEntidad(f.entidadRuc) }))
    .filter((x) => x.href !== DJI_CONSULTA);
  return (
    <section className="space-y-2">
      <h3 className="font-display text-bloque font-bold text-ink">Lo que declararon funcionarios</h3>
      <p className="max-w-prose text-meta text-inkSoft">
        {`${plural(filas.length, "declaración", "declaraciones")} en Declaraciones Juradas de Intereses de funcionarios`}
        {venden ? `; en ${plural(venden, "caso", "casos")} la empresa le vende a la entidad de quien declaró` : ""}. Del funcionario se
        muestra su cargo, su entidad y su primer apellido.
      </p>
      <Tabla
        etiqueta="Declaraciones de funcionarios sobre la empresa"
        medida="contenedor"
        densidad="compacta"
        columnas={[
          { clave: "quien", titulo: "Quién declaró", ancho: "minmax(0,1.3fr)" },
          { clave: "que", titulo: "Qué declaró", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
          { clave: "vende", titulo: "Le vende a su entidad", corto: "Le vende", ancho: "8rem" },
        ]}
        filas={filas.map((f, i) => ({
          id: String(i),
          href: `/entidad/${f.entidadRuc}`,
          celdas: {
            quien: (
              <CeldaPrincipal
                titulo={f.cargo ? tituloNatural(f.cargo) : "Funcionario"}
                meta={[
                  f.apellido ? <Dato key="ap" tipo="personas" nombre="Funcionario">{f.apellido}</Dato> : null,
                  <Dato key="en" tipo="entidad">{tituloNatural(f.entidad ?? f.entidadRuc)}</Dato>,
                ]}
              />
            ),
            que: (
              <span className="text-meta text-ink">
                {QUE_DECLARO[f.seccion] ?? "Declaró un vínculo"}
                {f.desde ? <span className="text-inkSoft">{` (desde ${fechaCorta(f.desde)}${f.hasta ? ` hasta ${fechaCorta(f.hasta)}` : ""})`}</span> : null}
              </span>
            ),
            vende: f.leVende ? <Badge variant="crimson">Sí, le vende</Badge> : <span className="text-meta text-mute">No</span>,
          },
        }))}
      />
      <FuenteDato fuente="Contraloría, Declaraciones Juradas de Intereses (secciones 1 a 4)" href={DJI_CONSULTA} enlaces={porEntidad} />
    </section>
  );
}
