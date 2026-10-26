import Link from "next/link";
import { EstadoVacio } from "@/components/patrones";
import {
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  TablaFiltrable,
  TablaPaginada,
  type Columna,
  type FilaFiltrable,
  type Fila,
} from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Severidad } from "@/components/ui/Severidad";
import { Dato } from "@/components/ui/Dato";
import { fecha, fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { rutaEmpresa, type SociosEmpresa } from "@/lib/empresas";
import { NoCargo } from "./comun";

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

export async function SociosEmpresa({ datos }: { datos: Promise<SociosEmpresa | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus socios" />;
  const sinNada = !d.socios.length && !d.empresasSocias.length && !d.vinculadas.length && !d.sociaDe.length;
  if (sinNada) {
    return (
      <EstadoVacio compacto titulo="Sin socios ni representantes en el RNP">
        El Registro Nacional de Proveedores no publica su conformación: puede no estar inscrita como proveedora vigente.
      </EstadoVacio>
    );
  }
  const filasSocios: Fila[] = d.socios.map((s, i) => ({
    id: `p-${i}`,
    celdas: {
      persona: <CeldaPrincipal titulo={s.nombre} />,
      papel: <span className="text-meta text-ink">{papeles(s.roles)}</span>,
      desde: <CeldaFecha fecha={s.desde} />,
      otras: <CeldaNumero>{s.otrasEmpresas ? numero(s.otrasEmpresas) : <span className="font-sans text-mute">Ninguna</span>}</CeldaNumero>,
    },
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
      {(filasSocios.length > 0 || filasEmpresas.length > 0) && (
        <section className="space-y-2">
          <h3 className="font-display text-bloque font-bold text-ink">Su gente en el RNP</h3>
          <p className="max-w-prose text-meta text-inkSoft">
            Socios, representantes legales y directivos que la empresa declaró al Registro Nacional de Proveedores
            {d.corte ? ` (corte del ${fechaCorta(d.corte)})` : ""}. Por privacidad, sin documento y con un apellido tapado.
          </p>
          {filasSocios.length > 0 && <TablaPaginada columnas={COLUMNAS_SOCIOS} filas={filasSocios} etiqueta="Socios, representantes y directivos" tam={15} nombre="personas" />}
          {filasEmpresas.length > 0 && <Tabla columnas={COLUMNAS_SOCIOS} filas={filasEmpresas} etiqueta="Empresas socias" />}
        </section>
      )}
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
        </section>
      )}
      {filasVinculadas.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-bloque font-bold text-ink">Empresas vinculadas</h3>
          <p className="max-w-prose text-meta text-inkSoft">
            Otras empresas con un mismo socio, representante o directivo. Si compitieron en un mismo proceso, eso figura en sus
            antecedentes («comparte socio con otro postor»).
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
        </section>
      )}
    </div>
  );
}
