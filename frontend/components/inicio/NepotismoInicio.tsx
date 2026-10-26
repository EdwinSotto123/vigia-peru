import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, CuerpoDetalle, DatosClave, PieDetalle } from "@/components/patrones/Detalle";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { BloqueInicio } from "./BloquesInicio";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona, PARAMS_EN_FICHA, SENAL } from "@/lib/personas";
import type { NepotismoEntidad } from "@/lib/api-client";

const GRADO: Record<string, string> = {
  hermano: "hermano(a)",
  conyuge: "cónyuge o conviviente",
  hijo: "hijo(a)",
  padre: "padre o madre",
  otro: "pariente",
};

/**
 * El funcionario, no completo: cargo + su primer apellido. La DJI es pública, pero basta para ubicarlo; y el nombre
 * completo junto al del pariente (que va tapado) destaparía justo el apellido escondido (docs/PRIVACIDAD.md).
 */
const funcionario = (cargo: string | null, apellido: string | null) => {
  const quien = cargo ? tituloNatural(cargo) : "Un funcionario";
  // Sin apellido cuando el parentesco podría destaparlo (lo decide el API): queda el cargo.
  return apellido ? `${quien}, ${tituloNatural(apellido)}` : quien;
};

const COLUMNAS: Columna[] = [
  { clave: "funcionario", titulo: "Funcionario que lo declaró", ancho: "minmax(0,1.3fr)" },
  { clave: "pariente", titulo: "Pariente que le vende", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo", corto: "Pariente" },
  { clave: "monto", titulo: "En órdenes", ancho: "112px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/**
 * La evidencia de la bandera de nepotismo en el Inicio de la entidad: un funcionario (cargo público) declaró en su DJI
 * a un pariente que figura como locador (proveedor) de ESTA entidad. La bandera es una fila de las Banderas de las
 * personas («Un funcionario de la entidad lo declaró como su pariente», con la lista filtrada); aquí va el detalle de
 * cada caso, una fila por caso, que abre el panel lateral con sus órdenes. Antes eran cajas ámbar sueltas (un cartel
 * aparte, contra la regla de banderas). Del pariente se tapa un apellido, como de cualquier locador. Server-safe.
 */
export function NepotismoInicio({
  nepotismo,
  href,
}: {
  nepotismo: NepotismoEntidad | null;
  href: (filtro: Record<string, string>) => string;
}) {
  const detalle = nepotismo?.detalle ?? [];
  if (!nepotismo || nepotismo.total === 0 || !detalle.length) return null;

  const filas: Fila[] = detalle.map((d, i) => {
    const quien = funcionario(d.cargo, d.funcionarioApellido);
    const grado = GRADO[d.grado] ?? "pariente";
    const pariente = tituloNatural(d.proveedorNombre);
    return {
      // El id va al DOM (`data-fila`): el código de su ficha, nunca el RUC 10 del locador (docs/PRIVACIDAD.md).
      id: `${d.proveedorCodigo ?? "caso"}-${i}`,
      buscable: `${d.cargo ?? ""} ${grado}`,
      celdas: {
        funcionario: <CeldaPrincipal titulo={quien} meta={[<Dato key="g" tipo="personas" nombre="Parentesco">Declaró a un(a) {grado}</Dato>]} />,
        pariente: <CeldaTexto>{pariente}</CeldaTexto>,
        monto: <CeldaNumero sub={plural(d.ordenes, "orden", "órdenes")}>{solesCompacto(d.monto)}</CeldaNumero>,
      },
      detalle: {
        titulo: quien,
        descripcion: `Declaró a un(a) ${grado} que le vende a la entidad`,
        contenido: (
          <CuerpoDetalle>
            <DatosClave
              items={[
                { etiqueta: "Funcionario", valor: quien },
                { etiqueta: "Parentesco declarado", valor: grado },
                { etiqueta: "Pariente que le vende", valor: pariente },
                { etiqueta: "Órdenes de servicio", valor: numero(d.ordenes), mono: true },
                { etiqueta: "Monto de esas órdenes", valor: soles(d.monto), mono: true },
              ]}
            />
            <BloqueDetalle titulo="Qué se cruzó">
              <p className="text-dato leading-relaxed text-inkSoft">{SENAL.nepotismo.explica}</p>
            </BloqueDetalle>
          </CuerpoDetalle>
        ),
        pie: (
          <PieDetalle
            principal={
              d.proveedorCodigo ? (
                <EnlaceAccion href={rutaPersona(d.proveedorCodigo)} flecha>
                  Ver sus órdenes
                </EnlaceAccion>
              ) : undefined
            }
            secundarias={
              d.declaranteFicha ? (
                <EnlaceAccion href={`/app/personas/planilla/${d.declaranteFicha}`} variante="secundario">
                  El funcionario en la planilla
                </EnlaceAccion>
              ) : undefined
            }
          />
        ),
      },
    };
  });

  return (
    <BloqueInicio
      nivel={3}
      titulo="Parientes de funcionarios que le venden"
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          Por ley, los funcionarios presentan una Declaración Jurada de Intereses (Ley 31227) donde declaran a sus parientes.
          Aquí se cruzan esos parientes con los locadores de su propia entidad. Del funcionario va el cargo y el primer
          apellido; del pariente se tapa un apellido. El impedimento depende del cargo (Ley 32069, art. 30).
        </Ayuda>
      }
      enlace={{ href: href({ [PARAMS_EN_FICHA.senal]: "nepotismo" }), texto: "Ver en personas" }}
    >
      <TablaPaginada
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Parientes de funcionarios que le venden"
        nombre="casos"
        tam={6}
        densidad="compacta"
        medida="contenedor"
        buscar={{ placeholder: "Buscar un cargo o un parentesco…", etiqueta: "Buscar entre los casos de parientes" }}
      />
    </BloqueInicio>
  );
}
