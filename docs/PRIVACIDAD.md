# Datos personales en Vigía Perú

Vigía vigila contratos del Estado, no personas. Esta es la regla de qué datos personales salen al
público, dónde se aplica y cómo se pide una corrección (Ley 29733). Vigente desde el 2026-10-13.

## La regla

| Dato | Al público | Panel admin |
|---|---|---|
| DNI en un campo (`dni`, `numero_documento`, `*_dni`…) | `ref·7K2Q9A` (referencia opaca) | completo, en vidrio |
| DNI dentro de un texto | `ref·…` si es de alguien del análisis; si no, `••••••••` | completo, en vidrio |
| RUC 10 (persona natural: lleva el DNI) | `10·ref·7K2Q9A` (la ref de su DNI) | completo, en vidrio |
| RUC 20 (empresa) | completo | completo |
| Nombre de una persona privada | un apellido tapado: `JOSE MANUEL SARA •••`, `CARPIO ••• ABEL` | completo, un apellido en vidrio |
| Familiar que deduce la IA (`pareja_o_familia`) | `•••` (sólo el vínculo) | completo |
| Autoridad electa (alcalde, gobernador, regidor) y empresa | completo | completo |
| Celular / correo en un texto | `9••••••••` / `a***@dominio` | completo |
| Traza del agente ("Cómo se hizo") | pasos, cifras, reglas, costo; sin entradas ni salidas de las herramientas ni pensamientos | entera |

- **Nunca un DNI, ni parcial.** Quitar 3 dígitos deja 1.000 combinaciones y la vieja máscara `43****80`,
  10.000: con el nombre al lado, un script contra un servicio de consulta DNI lo reconstruye.
- **La referencia** es un HMAC-SHA256 del documento con la clave `PRIVACIDAD_CLAVE` (30 bits, base 32
  de Crockford). La misma persona lleva la misma ref en todo Vigía (el grafo y los paneles cruzan
  registros con ella) y sin la clave no se vuelve al DNI. El repo es público: con una clave conocida
  bastaría recorrer los 10⁸ DNI, por eso es un secreto (`privacidad-clave` en Secret Manager de
  vivid-spot, y el mismo valor como secreto del Worker `vigia-api`). Sin la clave, cada instancia
  usa una al azar: nada se filtra, pero las refs no coinciden entre instancias.
- **Qué apellido:** el materno. La última palabra si el nombre va primero; la segunda en orden
  SUNAT/RNP (apellidos primero); con coma ("PEREZ QUISPE, JUAN"), el último antes de la coma. El orden
  sale del campo (RNP, ONPE, JNE y visitas van en orden SUNAT; actas, comités y funcionarios con el
  nombre primero) y lo afina una lista de nombres de pila.
- **Quién es persona** sale de la forma del JSON, no de adivinar: los papeles (`firmantes`,
  `comite_evaluacion`, `funcionarios_designados`, `socios`, `representantes_legales`, `visitas`,
  `aportes`, `candidaturas`, `pareja_o_familia`…), los pares RUC 10 + razón social, y en la prosa los
  nombres pegados a un DNI ("PEREZ QUISPE JUAN (DNI …)") o a una firma digital ("… FIR 4… hard").
  Cada persona se tapa en todo el JSON: valores, claves (`datos_peru_por_persona`) y texto libre, en
  los dos órdenes, sin tildes y por palabras completas.
- **Límite conocido:** un nombre que sólo aparece en prosa, sin un campo ni un DNI al lado, no se
  reconoce. Los DNI y RUC 10 se tapan igual (por forma).
- **URLs:** fuera las que llevan un DNI conocido o un RUC 10, los perfiles personales (LinkedIn) y las
  páginas de agregadores (DatosPerú, postor.pe…) con el nombre de una persona protegida. Dentro de un
  texto quedan como la raíz del sitio. Las fuentes oficiales y la prensa se quedan: ahí se verifica.

## Dónde se aplica

- **API** (`backend/api/src/lib/privacidad.ts`): `publicar()` sobre toda respuesta pública con datos
  de personas (dossier, ficha, listas de alertas y señales, contratos, procesamientos, denuncias) y
  `publicarTraza()` para "Cómo se hizo". El panel admin pide el dossier con `publico: false`.
  Pruebas: `backend/api/test/privacidad.test.ts`.
- **MCP** (`backend/mcp-worker/src/herramientas.ts`): la evidencia sin DNI, RUC 10, celulares ni
  correos, y el nombre pegado a un DNI entero (sin refs: no tiene la clave).
- **Frontend** (`frontend/lib/privacidad.ts`, `components/Redact.tsx`): lo tapado por la API se pinta
  como marca fija (`Tapado`, sin clic). El vidrio revelable al clic queda para el panel admin, que
  recibe los datos completos: es la única forma de "desenmascarar".
- **Cachés** al cambiar la regla: subir `VERSION_CACHE` en `backend/api/src/workers/cdn.ts` (borde de
  Cloudflare) y desplegar el frontend (sus cachés en memoria y la CDN de Firebase Hosting se vacían
  con el despliegue).

## Pedidos de las personas (Ley 29733)

- Página pública `/privacidad`: qué se publica y qué no, sus derechos (acceso, rectificación,
  cancelación, oposición) y el formulario. Cada análisis lleva la nota "¿Apareces aquí? Pide una
  corrección" con el enlace de la página.
- `POST /privacidad/solicitudes` (captcha y límite por IP) guarda nombre, correo, enlace y pedido en
  `solicitudes_privacidad` (migración 45). No se pide DNI. La API pública sólo puede insertar.
- El equipo los atiende en `/admin/privacidad` (sólo perfil admin): tomar, resolver con nota, rechazar.
  Plazo que se fija Vigía: 10 días hábiles. Cada cambio queda en la bitácora.
- Pendiente de revisar con un abogado: la inscripción del banco de datos ante la Autoridad Nacional de
  Protección de Datos Personales.
