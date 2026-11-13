import { Ayuda } from "@/components/patrones/Ayuda";
import { AyudaTermino } from "@/components/patrones/AyudaTermino";
import type { DatoClave } from "@/components/patrones/Detalle";
import { ListaPaginada } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { paraBuscar } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { EstructuraEntidad } from "@/lib/api-client";

/**
 * «Quién aprueba sus contratos», del grafo del Estado (migración 126): la autoridad que por ley aprueba las
 * contrataciones de la entidad (la AGA, Ley 32069, art. 25.1.b) y los altos funcionarios que hoy ocupan sus cargos, con
 * cargo y nombre completo (son funcionarios públicos). La AGA y quien la ocupa van en la caja «Quién la gobierna» del
 * Inicio; los demás funcionarios, en el panel de su fila de «Ver más».
 *
 * Antes era un grafo radial de 720 × 560 con la entidad al centro: 770 px de alto para dos nodos en Lima (la AGA y la
 * entidad), 520 px de ancho mínimo con scroll lateral en el celular y los nombres cortados a 24 letras. Todas sus
 * líneas iban de la entidad a una persona: no había relación que dibujar, sólo una lista. Ahora es la lista, en todos
 * los anchos; con más de 10 funcionarios, con buscador y paginada (la lista completa).
 */

const MAX_SIN_BUSCADOR = 10;

export type Funcionario = NonNullable<EstructuraEntidad["funcionarios"]>[number];

function Persona({ f }: { f: Funcionario }) {
  return (
    <span className="block min-w-0">
      <span className="block text-dato font-semibold leading-snug text-ink">{tituloNatural(f.persona)}</span>
      <span className="mt-0.5 block text-meta leading-snug text-mute">
        <Dato tipo="cargo">{f.cargo}</Dato>
      </span>
    </span>
  );
}

function Lista({ lista }: { lista: Funcionario[] }) {
  if (lista.length > MAX_SIN_BUSCADOR) {
    return (
      <ListaPaginada
        nombre="funcionarios"
        tam={MAX_SIN_BUSCADOR}
        className="divide-y divide-line/70"
        buscar={{ placeholder: "Buscar un cargo o un nombre…", etiqueta: "Buscar entre los altos funcionarios" }}
        items={lista.map((f, i) => ({
          id: `${f.persona}-${f.cargo}-${i}`,
          buscable: `${f.persona} ${f.cargo} ${f.organo}`,
          contenido: (
            <span className="block py-2">
              <Persona f={f} />
            </span>
          ),
        }))}
      />
    );
  }
  return (
    <ul className="divide-y divide-line/70">
      {lista.map((f, i) => (
        <li key={`${f.persona}-${f.cargo}-${i}`} className="py-2 first:pt-0 last:pb-0">
          <Persona f={f} />
        </li>
      ))}
    </ul>
  );
}

const esAgaDe = (aga: string) => (f: Funcionario) => paraBuscar(f.organo) === paraBuscar(aga);

/**
 * Quién aprueba sus contratos, como filas de `DatosClave` para la caja «Quién la gobierna» del Inicio: el órgano (la AGA)
 * y quién lo ocupa. Sin organigrama oficial, ninguna.
 */
export function datosQuienDecide(estructura: EstructuraEntidad | null): DatoClave[] {
  if (!estructura?.disponible) return [];
  const aga = estructura.apruebaContratos ?? "Autoridad de la gestión administrativa";
  const todos = estructura.funcionarios ?? [];
  const ocupan = todos.filter(esAgaDe(aga));
  return [
    {
      etiqueta: "Aprueba sus contratos",
      ayuda: <AyudaTermino clave="aga" />,
      valor: (
        <span className="block">
          <span className="font-semibold">{aga}</span>
          {ocupan.length ? (
            <span className="mt-1 block">
              <Lista lista={ocupan} />
            </span>
          ) : (
            <span className="block text-meta text-mute">Quién la ocupa: el organigrama oficial {todos.length ? "no lo dice" : "no lo trae"}</span>
          )}
        </span>
      ),
    },
  ];
}

/** Los demás altos funcionarios (sin quien ocupa la AGA): el panel que abre su fila de «Ver más». */
export function otrosFuncionarios(estructura: EstructuraEntidad | null): Funcionario[] {
  if (!estructura?.disponible) return [];
  const esAga = esAgaDe(estructura.apruebaContratos ?? "Autoridad de la gestión administrativa");
  return (estructura.funcionarios ?? []).filter((f) => !esAga(f));
}

/** La lista de los altos funcionarios, con buscador y paginada si son más de 10 (el panel del Inicio). */
export function ListaFuncionarios({ lista, corte }: { lista: Funcionario[]; corte?: string | null }) {
  return (
    <div className="space-y-3">
      <Lista lista={lista} />
      <p className="text-rotulo text-mute">
        Del organigrama oficial (grafo del Estado, corte {corte ?? "2026"}): es un corte en el tiempo y puede no estar al día.
      </p>
    </div>
  );
}

/** El ⓘ de quién aprueba sus contratos. */
export function AyudaQuienDecide({ corte }: { corte?: string | null }) {
  return (
    <Ayuda titulo="¿De dónde sale?">
      <span className="block">
        Del JNE, la autoridad electa que hoy está en el cargo y su organización política. Por ley, las contrataciones las aprueba
        su autoridad de la gestión administrativa: la Gerencia Municipal en una municipalidad, la Gerencia General Regional en
        un gobierno regional y la Secretaría General en un ministerio.
      </span>
      <span className="mt-2 block">
        Los nombres de quien la ocupa salen del organigrama oficial (grafo del Estado, corte {corte ?? "2026"}): es un corte en
        el tiempo y puede no estar al día.
      </span>
    </Ayuda>
  );
}
