import { EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { fecha, numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { type ClienteEmpresa } from "@/lib/empresas";
import { entidadTexto, NoCargo, opcionesLocales, paraClave } from "./comun";

/** La pestaña Clientes: las entidades que le adjudicaron o le compraron. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Clientes ─────────────────────────────────────────────────────────────────

const COLUMNAS_CLIENTES: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.6fr)" },
  { clave: "contratos", titulo: "Contratos", ancho: "124px", alinear: "der" },
  { clave: "ordenes", titulo: "Órdenes", ancho: "124px", alinear: "der", desde: "md" },
  { clave: "visitas", titulo: "Visitas", ancho: "76px", alinear: "der", desde: "lg" },
  { clave: "ultima", titulo: "Última", ancho: "92px", desde: "xl" },
];

export function filasClientes(data: ClienteEmpresa[]): FilaFiltrable[] {
  return data.map((c) => {
    const entidad = entidadTexto(c.entidad, c.entidadRuc);
    return {
      id: c.entidadRuc,
      href: `/entidad/${c.entidadRuc}`,
      buscable: `${entidad} ${c.entidadRuc} ${c.departamento ?? ""}`,
      valores: {
        region: c.departamento ? paraClave(c.departamento) : null,
        relacion: [c.contratos ? "contratos" : "", c.ordenes ? "ordenes" : "", c.visitas ? "visitas" : "", c.dudosas ? "dudosas" : ""].filter(Boolean),
      },
      claves: {
        pagado: c.adjudicado + c.ordenado, contratos: c.contratos, ordenes: c.ordenes, ultima: c.ultima, primera: c.primera, nombre: entidad,
      },
      celdas: {
        entidad: (
          <CeldaPrincipal
            titulo={entidad}
            meta={[
              c.departamento && <Dato key="lugar" tipo="lugar">{tituloNatural(c.departamento)}</Dato>,
              c.primera && (
                <Dato key="fecha" tipo="fecha" nombre="Desde">
                  {c.primera.slice(0, 4) === c.ultima?.slice(0, 4) ? c.primera.slice(0, 4) : `${c.primera.slice(0, 4)} a ${c.ultima?.slice(0, 4) ?? ""}`}
                </Dato>
              ),
              c.dudosas > 0 && <Badge key="dud" variant="amber">{plural(c.dudosas, "orden con posible error de carga", "órdenes con posible error de carga")}</Badge>,
            ]}
          />
        ),
        contratos: (
          <CeldaNumero sub={c.contratos ? plural(c.contratos, "proceso", "procesos") : undefined}>
            {c.contratos ? solesCompacto(c.adjudicado) : <span className="font-sans text-mute">Ninguno</span>}
          </CeldaNumero>
        ),
        ordenes: (
          <CeldaNumero sub={c.ordenes ? plural(c.ordenes, "orden", "órdenes") : undefined}>
            {c.ordenes ? solesCompacto(c.ordenado) : <span className="font-sans text-mute">Ninguna</span>}
          </CeldaNumero>
        ),
        visitas: <CeldaNumero>{c.visitas ? numero(c.visitas) : <span className="font-sans text-mute">Ninguna</span>}</CeldaNumero>,
        ultima: <CeldaFecha fecha={c.ultima} />,
      },
    };
  });
}

export async function ClientesEmpresa({ datos }: { datos: Promise<{ total: number; data: ClienteEmpresa[] } | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus clientes" />;
  if (!d.total) return <EstadoVacio compacto titulo="Ninguna entidad le adjudicó ni le compró">Sólo figura como postor.</EstadoVacio>;
  const filas = filasClientes(d.data);
  return (
    <TablaFiltrable
      columnas={COLUMNAS_CLIENTES}
      filas={filas}
      etiqueta="Entidades que le adjudicaron o le compraron"
      tam={20}
      nombre="entidades"
      buscar={{ placeholder: "Buscar entidad o RUC…", etiqueta: "Buscar en sus clientes" }}
      filtros={[
        { clave: "region", etiqueta: "Región de la entidad", corta: "Región", opciones: opcionesLocales(filas.map((f) => f.valores?.region as string | null), (v) => tituloNatural(v)) },
        {
          clave: "relacion", etiqueta: "Qué le dio", corta: "Qué le dio",
          opciones: [
            { valor: "contratos", etiqueta: "Le adjudicó contratos" },
            { valor: "ordenes", etiqueta: "Le compró por órdenes" },
            { valor: "visitas", etiqueta: "Su gente la visitó" },
            { valor: "dudosas", etiqueta: "Órdenes con posible error" },
          ],
        },
      ]}
      ordenes={[
        { valor: "pagado", etiqueta: "La que más le pagó", clave: "pagado", dir: "desc" },
        { valor: "contratos", etiqueta: "Más contratos", clave: "contratos", dir: "desc" },
        { valor: "ordenes", etiqueta: "Más órdenes", clave: "ordenes", dir: "desc" },
        { valor: "reciente", etiqueta: "Venta más reciente", clave: "ultima", dir: "desc" },
        { valor: "antigua", etiqueta: "Relación más antigua", clave: "primera", dir: "asc" },
        { valor: "nombre", etiqueta: "Por nombre", clave: "nombre", dir: "asc" },
      ]}
    />
  );
}
