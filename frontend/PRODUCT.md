# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Cuatro audiencias reales, en orden de volumen:

- **Ciudadano de a pie** (mayoría). Llega por una obra concreta de su distrito: una pista que no se terminó, un colegio que se cayó. No sabe qué es OCDS, ni SEACE, ni un "procedimiento de selección". Entra desde el celular, con datos móviles, y decide en segundos si esto le sirve. Su trabajo: entender si algo huele mal cerca suyo, y dejar constancia de lo que ve.
- **Periodista / investigador local**. Sabe leer un expediente pero no tiene tiempo de descargar 40 PDFs del SEACE. Su trabajo: encontrar un hilo publicable y llegar a la evidencia oficial que lo respalda, con la norma citada, para poder publicarlo sin que lo desmientan.
- **Financiador (empresa, colectivo o persona)**. Paga S/3 por contrato leído. No elige qué se audita — la asignación es por antigüedad, en SQL. Su trabajo: ver que su dinero se convirtió en lectura real y verificable, y aparecer en el reconocimiento público con proporción honesta.
- **Contraloría / fiscalía / OECE**. Usuario de bajo volumen y alto impacto. Su trabajo: verificar que una señal es defendible antes de moverla — qué agente la produjo, qué documento leyó, qué artículo cita.

Un quinto actor pasivo: el **funcionario o proveedor auditado**, que tiene derecho a que la plataforma no lo acuse.

## Product Purpose

Vigía Perú descarga todos los contratos públicos del Perú desde la API OCDS del OECE/SEACE (~18 000 contratos, 25 regiones), hace que un pipeline determinista de 11 agentes de IA los lea de verdad — expediente, reglas de contratación, precios de mercado, prensa, red de personas, sanciones, cruzando 14 portales del Estado — y publica **señales de riesgo**, nunca acusaciones, cada una con su norma citada, la opinión OECE aplicable y la evidencia oficial que la sostiene.

El cuello de botella no es el dato: los contratos ya son públicos. El cuello es que nadie los lee. El producto convierte capacidad de lectura en algo que un ciudadano puede financiar por S/3 y verificar después.

Éxito = una señal que alguien con poder de actuar (periodista, contraloría, fiscalía) puede tomar y defender sin tener que rehacer el trabajo.

## Positioning

Ningún portal de transparencia del Estado peruano **lee** los contratos: los publica. Los observatorios ciudadanos leen algunos, a mano, tarde. Vigía Perú es el único que (a) lee el expediente completo con agentes de IA contra la norma vigente, (b) deja la traza de razonamiento pública y auditable — qué agente, qué documento, qué artículo, cuánto costó, cuánto tardó — y (c) financia esa lectura con aportes ciudadanos cuyo destino nadie puede dirigir, ni siquiera quien paga.

Esa última parte es la que no se puede copiar sin renunciar al modelo de negocio: **el que paga no elige**.

## Operating Context

- **Escena de uso dominante:** celular, en la calle o en casa, con conexión irregular, luz de día. El escritorio es la escena del periodista y del auditor, no la del ciudadano.
- **Pipeline:** determinista, corre en código (`deterministic.py`), no lo dirige un LLM orquestador. 4 servicios Cloud Run separados por tipo de contrato (bienes / servicios / obras / otros) vía `PIPELINE_PROFILE`.
- **Asignación de trabajo:** FIFO por antigüedad en SQL. El pipeline no sabe quién financió.
- **Fuentes:** API OCDS del OECE, SEACE, PNDA (sanciones, visitas, declaraciones juradas), MEF, Infogob, ONPE/Claridad. Varias bloquean IPs de GCP: hay un relay residencial en Lima para alcanzarlas.
- **Latencia real del análisis:** ~10 minutos por contrato tras paralelizar web∥news∥entity. No es instantáneo y la interfaz no debe fingir que lo es.
- **Datos personales:** DNI y último apellido de personas naturales van redactados tras vidrio esmerilado revelable al clic. Empresas y funcionarios públicos NO se censuran.

## Capabilities and Constraints

Capacidades confirmadas y en producción:

- Cola real de ~18 000 contratos OCDS con ubigeo distrital; clasificación tipo × etapa.
- Dossier por contrato: dictamen, ítems y comparación de mercado, proveedor y su red, documentos fuente, traza de agentes.
- Financiamiento: zonas, aportes, contribuciones, comprobante público de impacto por código.
- Denuncias ciudadanas con foto y geolocalización; convergencia automática entre denuncia y alerta.
- Muro de aliados con reconocimiento proporcional y bloqueo por conflicto de interés.
- Tablero de auditoría en vivo: cola → procesando → procesado, con bitácora de eventos.
- Panel de administración con sesión por token.

Restricciones técnicas vinculantes:

- Next.js 14.2.5 App Router. Server Components async por defecto. **Un Server Component no puede pasar una función como prop a un Client Component: rompe solo en producción, ni `tsc` ni `next build` lo detectan.** Ya ocurrió dos veces en este repo.
- No hay librería de animación (framer-motion, GSAP) ni de charts (d3, recharts, visx). Todo es CSS y SVG propio, deliberadamente.
- Despliegue en Cloud Run por Buildpacks; el peso del bundle se paga en cold start.
- El backend expone endpoints que el frontend a veces no llama, y `mock-data.ts` sigue sirviendo pantallas que parecen reales. Cualquier visualización nueva debe declarar de qué lado vive.

Terminología del producto (es la que ve el usuario, no se traduce ni se adorna):

**señal** (nunca "hallazgo de corrupción"), **dictamen**, **convocatoria**, **convergencia**, **aliado**, **zona/ubigeo**, **expediente**, **entidad**, **proveedor**.

## Brand Commitments

- Nombre: **Vigía Perú**. Voz en español peruano, directa, sin jerga de consultoría ni épica de startup.
- **Señales, no acusaciones.** Toda afirmación de riesgo se publica con norma citada y enlace a la fuente oficial. La interfaz nunca puede hacer que una señal parezca un veredicto.
- **El que paga no elige.** Cualquier elemento visual que sugiera que un financiador dirigió una auditoría es un defecto de producto, no de estilo.
- **Los resultados se publican igual**, incluso si señalan a quien financió.
- Reconocimiento medido en **contratos leídos**, jamás en soles: 300 vecinos que financian 300 contratos valen lo mismo que una empresa que financia 300.
- Paleta comprometida: `heroViolet #4F3D96` (marca), `heroGreen #2FA84C` (positivo). `rust` / `amber` / `clay` / `moss` son **semántica de severidad y estado**, no decoración.
- Atribución pública del proyecto: Antigravity. La landing y su propuesta de valor ya fueron aprobadas y NO están en alcance de rediseño.

## Evidence on Hand

- Datos reales en producción: 18 000+ contratos OCDS, 25 regiones, dossiers ya procesados con traza completa de agentes, contribuciones y aliados reales.
- Observabilidad real: spans y evaluaciones en Arize Phoenix, self-eval inline con 4 jueces por corrida, costo y duración por agente.
- **Ausencias que no se deben inventar:** no hay pasarela de pagos en vivo (Mercado Pago pendiente), no hay envío de correos, y varias pantallas siguen leyendo `mock-data.ts`. Ninguna cifra, testimonio, logo de aliado o caso de éxito puede fabricarse: este producto acusa de falta de transparencia, y un dato inventado en su propia interfaz lo destruye.

## Product Principles

1. **La evidencia es el producto.** Si un número no se puede rastrear hasta un documento oficial, no merece protagonismo visual.
2. **Nunca acusar.** El diseño baja el tono donde el dato es fuerte; la severidad la carga el sistema de color semántico, no el adjetivo.
3. **El que paga no elige, y se nota.** La independencia se demuestra en la interfaz, no se declara en un párrafo.
4. **Primero el celular, en la calle.** Densidad y potencia para el periodista, pero nunca a costa de que el vecino entienda su distrito en diez segundos.
5. **Mostrar el trabajo.** El pipeline de agentes es la prueba de que esto se leyó de verdad: es contenido protagónico, no un detalle de implementación.

## Accessibility & Inclusion

- Español peruano, registro llano. El usuario mediano no conoce vocabulario de contrataciones del Estado: todo término técnico se define en el punto de uso.
- Móvil con datos limitados es un requisito, no un breakpoint.
- Toda interacción disponible con mouse debe estar disponible con teclado — el mapa es el caso crítico conocido y hoy no lo cumple.
- Los datos personales redactados deben poder revelarse deliberadamente, nunca por accidente ni por hover.
