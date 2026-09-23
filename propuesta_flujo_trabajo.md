# Propuesta de flujo de trabajo, ambientes y despliegue

**Proyecto:** Vigía Perú
**Fecha:** 23 de septiembre de 2026
**Alcance:** cómo organizar GitHub, GCP y Jira ahora que se suman 3 personas al equipo (4 en total), para que cada cambio pase por revisión, se pruebe en un ambiente aislado y llegue a producción de forma automática, reversible y trazable.

---

## 0. Resumen ejecutivo

| # | Decisión | En una línea |
|---|----------|--------------|
| 1 | **Dos ambientes en dos proyectos de GCP separados: `vigia-dev` y `vigia-prod`**, más un tercer proyecto chico, `vigia-ops`, para lo compartido (imágenes, estado de Terraform, identidad de CI). | El aislamiento real en GCP es el proyecto: facturación, IAM, cuotas y red quedan separados sin esfuerzo. |
| 2 | **Dos ramas de larga vida: `main` = producción y `dev` = desarrollo.** Todo lo demás son ramas cortas (`feat/`, `fix/`, `hotfix/`) que entran por Pull Request. | Es lo que propusiste, y es lo correcto para 4 personas sin una suite de tests madura: `dev` hace de colchón antes de producción. |
| 3 | **CI/CD con GitHub Actions** y autenticación a GCP por **Workload Identity Federation** (sin llaves JSON). Merge a `dev` despliega a `vigia-dev`; merge a `main` despliega a `vigia-prod` con aprobación. | El repo es público: los minutos de Actions son gratis, y los PR, los checks y Jira quedan en un mismo lugar. |
| 4 | **Cada Pull Request tiene su propio ambiente de vista previa** en `vigia-dev` (una URL de Cloud Run con etiqueta `pr-123`), que se borra al cerrar el PR. | Se revisa el cambio funcionando, no sólo el código, sin pisar el trabajo de otra persona. |
| 5 | **Toda la infraestructura como código (Terraform)**, un solo módulo aplicado dos veces (dev y prod) con variables distintas. | El `infrastructure/terraform` que ya existe es la base; se extiende, no se reescribe. |
| 6 | **Accesos por grupos, nunca por persona**: `vigia-admins`, `vigia-devs`, `vigia-datos`, `vigia-facturacion`. Nadie despliega a producción a mano: despliega el pipeline. | Dar y quitar acceso a alguien se vuelve una sola acción (agregarlo o sacarlo de un grupo). |
| 7 | **Red privada en cada proyecto**: Cloud SQL sin IP pública, servicios internos con ingreso interno más IAM, y acceso de desarrolladores a la base por Cloud SQL Auth Proxy con usuario IAM. | Hoy la base se abre a una IP de casa: eso no escala a 4 personas y es el mayor riesgo actual. |
| 8 | **Jira como fuente de verdad del trabajo**, enlazado a GitHub (ramas, PR y despliegues aparecen solos en cada ticket). | La clave del ticket en el nombre de la rama es todo lo que hace falta para que se enlace. |

**Costo adicional estimado:** entre **US$ 20 y US$ 70 al mes**, casi todo por la base de datos y el uso de IA del ambiente de desarrollo. El detalle está en la sección 11. Producción cuesta lo mismo que hoy.

---

## 1. Punto de partida: lo que hay hoy y por qué no escala

Lo que sigue salió de revisar el repositorio y el proyecto de GCP el 23 de septiembre de 2026. No es teoría: son los riesgos concretos que motivan cada decisión.

| Hallazgo | Evidencia | Riesgo con 4 personas |
|----------|-----------|------------------------|
| **Un solo proyecto de GCP compartido con otros productos.** | El proyecto actual tiene 60 servicios de Cloud Run y 3 instancias de Cloud SQL; sólo 8 servicios y 1 instancia son de Vigía. El resto son de otros productos sin relación con Vigía. En Secret Manager conviven secretos de Vigía con llaves de otros proyectos. | Para dar a alguien acceso a Vigía hay que darle acceso a todo lo demás. Un error de IAM o un `gcloud run services delete` equivocado afecta a otros productos. La factura no dice cuánto cuesta Vigía. |
| **No hay ambiente de desarrollo.** | Todos los servicios apuntan a la misma base `vigia-db`. Hoy mismo hubo que borrar de producción datos de demo que un script de siembra había cargado ahí: 10 alertas, 6 denuncias, 21 entidades con RUC inventado y 2 entidades reales renombradas. | Cada prueba se hace sobre datos reales o ensucia producción. Con 4 personas probando, eso pasa todas las semanas. |
| **Despliegue manual desde la laptop.** | Los scripts `infrastructure/deploy/*.sh` ejecutan `gcloud run deploy --source` con la cuenta personal de quien los corre. Existe un `cloudbuild.yaml`, pero no hay ningún trigger configurado. | No se sabe qué versión está en producción ni quién la subió, y no hay forma de exigir revisión antes de desplegar. |
| **La base de datos está expuesta por IP pública.** | Cloud SQL tiene IP pública y una "red autorizada" con la IP de una conexión doméstica. | Cada persona nueva pide que se agregue su IP; las IPs domésticas cambian, y una IP autorizada olvidada queda abierta. |
| **Credenciales fuera de Secret Manager.** | La llave del servicio de consulta SUNAT está como variable de entorno en texto plano del orquestador, y hoy responde 401 (vencida). Existe un archivo `.cloudsql-password` local que ya no coincide con la contraseña real. | Quien puede ver la configuración del servicio ve la llave. Las copias locales se desincronizan y nadie sabe cuál vale. |
| **Servicios internos abiertos a internet.** | El orquestador de agentes acepta invocaciones sin autenticación (`allUsers`). | Cualquiera con la URL puede disparar análisis que cuestan dinero. |
| **Firebase compartido.** | El login usa el proyecto de Firebase de otro producto. | Los usuarios de Vigía quedan mezclados con los de otro producto, y no hay un Firebase de prueba. |
| **Sin reglas en GitHub.** | Se commitea directo a `main` y no hay checks obligatorios. | Un `git push` roto va directo a lo que después se despliega. |
| **Un componente externo sin monitoreo.** | El relay residencial de Lima (VPS) está caído: no responde a ping ni a HTTP, y la descarga de documentos está parada desde el 17 de septiembre. Nadie se enteró hasta la auditoría. | Sin alertas, una caída se descubre semanas después. |

---

## 2. Principios que guían la propuesta

1. **Aislamiento por proyecto.** En GCP, el proyecto es la frontera natural de IAM, facturación, cuotas, red y auditoría. Separar ambientes con prefijos de nombre dentro de un mismo proyecto (`vigia-api-dev` y `vigia-api-prod`) parece más barato, pero cualquier permiso amplio los cruza.
2. **Todo como código.** Infraestructura en Terraform y pipelines en YAML versionado. Si algo existe en la consola y no en el repo, no existe.
3. **Mínimo privilegio y cero llaves.** Las personas acceden por grupos; los servicios, con cuentas de servicio propias; GitHub, con identidad federada. Ninguna llave JSON en ninguna laptop ni en GitHub.
4. **Producción sólo cambia por el pipeline.** Nadie despliega a mano a `vigia-prod`. Para emergencias existe un procedimiento de "rompe vidrio" (sección 4.5) que deja rastro.
5. **Construir una vez, promover el mismo artefacto.** La imagen que se probó en dev es exactamente la que llega a prod, identificada por su digest; no se recompila.
6. **Cambios chicos y frecuentes.** Es mejor tener PRs de horas o de un par de días que ramas de semanas.
7. **Todo es reversible.** Cloud Run guarda las revisiones anteriores, las migraciones de base se escriben compatibles hacia atrás y cada despliegue tiene su camino de vuelta.

---

## 3. Estructura en GCP

### 3.1 Organización y proyectos

```
Organización (vigiaperu.org, vía Cloud Identity Free)
└── Carpeta: vigia
    ├── vigia-prod    ← producción: lo que ve la ciudadanía
    ├── vigia-dev     ← desarrollo: integración, vistas previas de PR, pruebas
    └── vigia-ops     ← compartido: Artifact Registry, estado de Terraform, identidad de CI
```

**¿Por qué una organización?** Sin organización, los proyectos cuelgan de la cuenta personal de quien los creó. Con **Cloud Identity Free** (gratis hasta 50 usuarios) y un dominio propio se obtienen:
- carpetas y políticas de organización, por ejemplo "prohibido crear llaves JSON de cuentas de servicio" o "sólo la región us-central1";
- grupos administrados;
- la garantía de que los proyectos no dependen de la cuenta de una sola persona.

Hace falta un dominio. `vigiaperu.org` **no está registrado hoy**: registrarlo cuesta entre US$ 10 y 20 al año y resuelve también el correo de contacto del sitio.

> **Alternativa si no quieren organización todavía:** crear los tres proyectos bajo la misma cuenta de facturación y usar Google Groups normales (`@googlegroups.com`) para el IAM. Funciona, pero se pierden las políticas de organización y la propiedad de los proyectos sigue siendo personal. Es un buen paso intermedio y se puede migrar a organización después sin recrear nada.

**¿Por qué dos ambientes y no tres (dev, staging y prod)?**

| Opción | Pros | Contras | Veredicto |
|--------|------|---------|-----------|
| Sólo prod (hoy) | Barato | Todo se prueba en producción; ya causó datos falsos en prod | ❌ |
| **dev + prod** | Aísla las pruebas; las vistas previas por PR cubren lo que haría un staging; costo bajo | dev es a la vez integración y pruebas | ✅ **recomendado ahora** |
| dev + staging + prod | Ensayo idéntico a prod antes de publicar | Otra base de datos (entre US$ 25 y 50 al mes), más mantenimiento; con 4 personas, staging quedaría casi siempre igual a dev | ⏳ cuando haya más personas o compromisos de disponibilidad |

**¿Por qué un tercer proyecto `vigia-ops`?** Contiene lo que no pertenece a ningún ambiente:
- **Artifact Registry**, con las imágenes que se construyen una vez y se promueven de dev a prod;
- el **bucket del estado de Terraform**, con versionado activado;
- el **proveedor de Workload Identity Federation** para GitHub.

Si esto viviera en `vigia-prod`, el pipeline de dev necesitaría permisos sobre prod. En `vigia-ops` cada ambiente sólo lee de ahí.

### 3.2 Qué vive en cada proyecto de ambiente

Lo mismo en ambos, creado por el mismo módulo de Terraform con variables distintas:

| Componente | `vigia-prod` | `vigia-dev` |
|-----------|--------------|-------------|
| Cloud Run: `frontend`, `api`, `mcp`, orquestador y agentes por perfil | min-instances según tráfico | min-instances = 0 (escala a cero) |
| Cloud Run Jobs: `dispatcher`, `ingest`, scrapers | programados (Cloud Scheduler) | programados más espaciados, o pausados por defecto |
| Cloud SQL (PostgreSQL 16) | `db-custom-1-3840` (el actual); alta disponibilidad opcional | `db-f1-micro` o `db-g1-small`; sin HA |
| Buckets GCS (documentos, reportes) | versionado + ciclo de vida | ciclo de vida corto (30 días) |
| Secret Manager | secretos de prod | secretos de dev (otras llaves, cuotas propias) |
| Vertex AI, Document AI, RAG Engine | cuotas y presupuesto de prod | cuotas de dev + presupuesto con tope |
| Firebase (login) | proyecto `vigia-prod` | proyecto `vigia-dev` (usuarios de prueba) |
| Arize / Phoenix | proyecto "vigia-prod" | proyecto "vigia-dev" |
| Presupuesto y alertas de facturación | sí | sí, con umbral bajo |

### 3.3 Convenciones de nombres y etiquetas

- **Proyectos:** `vigia-{ambiente}` (el ID real puede llevar sufijo si el nombre está tomado; se fija en `terraform.tfvars`).
- **Servicios:** el mismo nombre en ambos ambientes (`vigia-api`, `vigia-frontend`…). El proyecto ya dice el ambiente; repetirlo en el nombre obliga a parametrizar cada script.
- **Cuentas de servicio:** `sa-{componente}@vigia-{ambiente}.iam.gserviceaccount.com`.
- **Etiquetas en cada recurso:** `app=vigia`, `env=dev|prod`, `componente=api|frontend|agente|…`, `equipo=vigia`. Con estas etiquetas, la factura se puede partir por componente.
- **Región única:** `us-central1`, donde ya está todo. Se fija con una política de organización para que nadie cree recursos en otra región por error.

### 3.4 Cómo migrar lo que hoy está en el proyecto compartido

No hace falta un "big bang". Orden recomendado, de menor a mayor riesgo:

1. **Crear `vigia-ops` y `vigia-dev` desde cero con Terraform** (sección 12, fase 1). No se toca producción.
2. **Poner el pipeline a desplegar a `vigia-dev`.** El equipo empieza a trabajar ahí.
3. **Crear `vigia-prod` y migrar:**
   1. `gcloud sql export` e `import` de la base;
   2. copia de buckets con Storage Transfer Service;
   3. recreación de los secretos (con llaves rotadas);
   4. primer despliegue desde el pipeline;
   5. validación en paralelo;
   6. cambio de URL o dominio.
4. **Apagar los servicios de Vigía en el proyecto compartido** después de una semana sin incidentes; la base vieja se borra después de un último export.

Mientras tanto, el proyecto actual sigue siendo producción y `main` sigue desplegando ahí (sección 7.5).

---

## 4. Identidades y accesos (IAM)

### 4.1 Cuentas de personas

- **Con organización:** cada persona recibe una cuenta `nombre@vigiaperu.org` (Cloud Identity Free, gratis) y activa la verificación en dos pasos. La cuenta es del proyecto, no de la persona: si alguien se va, se suspende y listo.
- **Sin organización:** cada persona usa su cuenta Google, que se agrega a los Google Groups de abajo, con la verificación en dos pasos obligatoria.
- **Nadie trabaja con la cuenta del dueño del proyecto** ni con cuentas compartidas.

### 4.2 Grupos y roles

Los roles se asignan **a grupos**, nunca a personas sueltas.

| Grupo | Quiénes | En `vigia-dev` | En `vigia-prod` | En `vigia-ops` |
|-------|---------|----------------|-----------------|----------------|
| `vigia-admins` | 1 o 2 responsables técnicos | `roles/owner` | `roles/editor` + `roles/iam.securityReviewer` (sin owner permanente; ver "rompe vidrio") | `roles/owner` |
| `vigia-devs` | todo el equipo de desarrollo | `roles/run.developer`, `roles/cloudsql.client`, `roles/cloudsql.instanceUser`, `roles/logging.viewer`, `roles/secretmanager.secretAccessor` (sólo secretos de dev), `roles/aiplatform.user` | `roles/viewer` + `roles/logging.viewer` (**sólo lectura**) | `roles/artifactregistry.reader` |
| `vigia-datos` | quien necesita consultar datos reales | igual que devs | `roles/cloudsql.client` + `roles/cloudsql.instanceUser` con un usuario de base **de sólo lectura** | — |
| `vigia-facturacion` | quien paga y revisa costos | `roles/billing.viewer` | `roles/billing.viewer` | `roles/billing.viewer` |

**Por qué los devs no escriben en prod:** con 4 personas, lo que falta no es velocidad sino trazabilidad. Si todo cambio a prod pasa por un PR aprobado, siempre se sabe qué se desplegó, quién lo aprobó y cómo volver atrás.

### 4.3 Cuentas de servicio por componente

Hoy los servicios corren con la cuenta de servicio por defecto de Compute, que tiene rol de editor sobre todo el proyecto. Se reemplaza por una cuenta por componente, con sólo lo que ese componente usa:

| Cuenta | Corre | Permisos mínimos |
|--------|-------|------------------|
| `sa-frontend` | Cloud Run `frontend` | invocar `api` y orquestador (`run.invoker`); escribir en el bucket de reportes (subida de fotos) |
| `sa-api` | Cloud Run `api` | `cloudsql.client`; leer los secretos de la API; leer el bucket de documentos |
| `sa-agente` | orquestador y agentes por perfil | `cloudsql.client`; `aiplatform.user`; `documentai.apiUser`; secretos del agente; buckets de documentos |
| `sa-dispatcher` | job `dispatcher` | `run.invoker` sobre el orquestador; `cloudsql.client` |
| `sa-scrapers` | jobs de scrapers e ingesta | `cloudsql.client`; escribir en buckets de datos |
| `sa-mcp` | Cloud Run `mcp` | `cloudsql.client` con un usuario de base de sólo lectura |
| `sa-deployer-dev` / `sa-deployer-prod` | GitHub Actions (vía WIF) | `run.admin`, `iam.serviceAccountUser` sobre las cuentas de arriba, `artifactregistry.writer` (en ops), `cloudsql.client` (migraciones) |

**El orquestador deja de ser público:** ingreso `internal-and-cloud-load-balancing` más `run.invoker` sólo para `sa-frontend`, `sa-api` y `sa-dispatcher`. El código de los clientes ya quedó preparado para enviar el token de identidad; falta aplicar el cambio de IAM después del próximo despliegue.

### 4.4 GitHub sin llaves: Workload Identity Federation

GitHub Actions obtiene credenciales temporales de GCP presentando un token OIDC firmado por GitHub. **No se guarda ninguna llave en GitHub.** La federación se restringe con una condición:

```
assertion.repository == "EdwinSotto123/vigia-peru"
&& (assertion.ref == "refs/heads/dev" || assertion.ref == "refs/heads/main" || assertion.event_name == "pull_request")
```

Además, `sa-deployer-prod` sólo se puede suplantar desde el *environment* `prod` de GitHub (`assertion.environment == "prod"`), que exige aprobación (sección 6.3). Un PR de una rama cualquiera nunca obtiene credenciales de prod.

### 4.5 Acceso de emergencia ("rompe vidrio")

Para arreglar algo en prod que no puede esperar al pipeline:
1. Un miembro de `vigia-admins` se concede `roles/owner` en `vigia-prod` por 2 horas, con una condición IAM de expiración temporal, y deja el motivo en el ticket de Jira.
2. Los registros de auditoría (Cloud Audit Logs, activados en toda la organización) muestran todo lo que se hizo.
3. Después se escribe el cambio como código y se sube por el flujo normal, para que prod no quede distinto del repo.

### 4.6 Altas y bajas de personas (checklist)

**Alta** (menos de 30 minutos):
- [ ] Crear la cuenta (`@vigiaperu.org`) o registrar su cuenta Google, con verificación en dos pasos.
- [ ] Agregarla a `vigia-devs` (y a `vigia-datos` si corresponde).
- [ ] Invitarla a la organización o repo de GitHub con rol *Write* (no *Admin*).
- [ ] Invitarla a Jira (proyecto `VIG`) y al canal del equipo.
- [ ] Compartirle la guía de arranque local (sección 13).

**Baja:**
- [ ] Quitarla de los grupos (el acceso a GCP se corta en minutos).
- [ ] Quitarla de GitHub y Jira.
- [ ] Si tenía acceso de lectura a prod, rotar la contraseña del usuario de base de sólo lectura.

---

## 5. Red

"Grupos de red", en GCP, son tres cosas distintas; esta sección cubre las tres: la **red privada (VPC)** de cada proyecto, **quién puede entrar** a cada servicio y **cómo sale** el tráfico hacia internet.

### 5.1 Red privada por proyecto

Cada proyecto de ambiente tiene su propia VPC (`vigia-vpc`), con una subred en `us-central1`. **Dev y prod no están conectadas entre sí**: no existe ruta de dev a la base de prod, ni por error.

```
vigia-prod / vigia-vpc (10.10.0.0/20)
├── subred-servicios  10.10.0.0/24   ← salida de Cloud Run (Direct VPC egress)
├── rango privado     10.10.16.0/20  ← Private Service Access: Cloud SQL con IP privada
└── Cloud NAT (opcional) con IP fija ← sólo si un sitio del Estado exige IP conocida

vigia-dev / vigia-vpc (10.20.0.0/20)  ← mismo diseño, rangos distintos
```

- **Cloud SQL sólo con IP privada.** Se elimina la IP pública y la "red autorizada" doméstica.
- **Cloud Run con Direct VPC egress** hacia la subred de servicios, para llegar a la base por IP privada. No necesita el conector Serverless VPC Access, que cobra por instancias propias.

### 5.2 Quién puede entrar a cada servicio

| Servicio | Ingreso | Autenticación |
|----------|---------|---------------|
| `frontend` | todo internet | pública (es la web) |
| `api` | todo internet | pública para lectura (las escrituras validan token de Firebase o de admin, como hoy) |
| `mcp` | todo internet | pública de sólo lectura, con límite de uso |
| orquestador y agentes | **interno** | **IAM** (`run.invoker` sólo para las cuentas de servicio que lo llaman) |
| jobs | no reciben tráfico | los dispara Cloud Scheduler con su propia cuenta de servicio |

Para los servicios públicos se puede poner **Cloud Armor** delante (límite de peticiones por IP), si alguna vez hay abuso. No es necesario de entrada.

### 5.3 Acceso de desarrolladores a la base de datos

Se hace con el **Cloud SQL Auth Proxy** y **autenticación IAM de base de datos**: la persona entra con su cuenta de Google, sin contraseña compartida y sin tocar IPs autorizadas.

```bash
# Una vez: tener el rol cloudsql.client + cloudsql.instanceUser (vía el grupo vigia-devs)
cloud-sql-proxy --auto-iam-authn --private-ip vigia-dev:us-central1:vigia-db &
psql "host=127.0.0.1 user=tu.correo@vigiaperu.org dbname=vigia"
```

Con la base sólo en IP privada, el proxy se corre desde una máquina dentro de la VPC (Cloud Shell no sirve para IP privada), o se habilita IAP para TCP sobre una VM "bastión" mínima (`e2-micro`, unos US$ 7 al mes). Si eso resulta incómodo al principio, una alternativa aceptable para **dev** es mantener la IP pública **sin redes autorizadas** y entrar sólo por el proxy, que cifra la conexión y exige IAM. **En prod, siempre IP privada.**

### 5.4 El relay residencial de Lima

OECE y SEACE bloquean las IPs de GCP, y por eso existe el VPS en Lima. Se mantiene, pero se profesionaliza:
- Se autentica con un token guardado en Secret Manager (como ya se hace) y acepta sólo las IPs de salida del Cloud NAT de cada ambiente.
- Tiene **monitoreo de disponibilidad**: un uptime check de Cloud Monitoring cada 5 minutos que alerte al canal del equipo. Hoy está caído y nadie se enteró.
- Se documenta en Terraform como dependencia externa (la URL y el token son variables por ambiente). Idealmente, dev usa un relay distinto o una cuota separada, para que las pruebas no saturen el de producción.

---

## 6. GitHub: ramas, reglas y convenciones

### 6.1 Modelo de ramas

```
main  ──●───────────────●───────────────●──────  → despliega a vigia-prod (con aprobación)
         \             ↑ PR de release  ↑ hotfix
dev   ────●──●──●──●───●──●──●──●───────●──────  → despliega a vigia-dev (automático)
             ↑  ↑  ↑
   feat/VIG-12-mapa-provincias   fix/VIG-31-contador-cero   (ramas cortas, desde dev)
```

| Rama | Sale de | Entra a | Cómo | Despliega |
|------|---------|---------|------|-----------|
| `main` | — | — | sólo por PR | **vigia-prod**, con aprobación |
| `dev` | `main` (al inicio) | `main` | PR de release (merge commit) | **vigia-dev**, automático |
| `feat/VIG-123-descripcion` | `dev` | `dev` | PR con *squash merge* | vista previa `pr-123` en vigia-dev |
| `fix/VIG-123-descripcion` | `dev` | `dev` | PR con *squash merge* | vista previa `pr-123` |
| `hotfix/VIG-123-descripcion` | `main` | `main` y después `dev` | PR a `main`; luego merge de `main` en `dev` | prod (con aprobación) |

**¿Por qué no trunk-based puro, con una sola rama `main`?** Es el objetivo a mediano plazo y el que usan los equipos maduros. Pero exige tests automáticos que den confianza y *feature flags* para esconder trabajo a medias. Hoy el repo tiene pocos tests, y los cambios grandes (como el rediseño de esta semana) tocan 150 archivos. `dev` da un lugar donde integrar y mirar todo junto antes de publicarlo. Cuando la cobertura de tests crezca, se puede pasar a trunk-based eliminando `dev` sin cambiar nada más.

**¿Por qué no GitFlow completo, con `release/*` y `develop`?** Es demasiado ceremonial para 4 personas y un producto web sin versiones instaladas. El "release" es simplemente el PR de `dev` a `main`.

### 6.2 Reglas de protección (Rulesets de GitHub)

| Regla | `main` | `dev` |
|-------|--------|-------|
| Prohibido el push directo | ✅ | ✅ |
| Pull Request obligatorio | ✅ | ✅ |
| Aprobaciones requeridas | 1 (de `vigia-admins` vía CODEOWNERS) | 1 (cualquier otra persona) |
| Descarta aprobaciones si llegan commits nuevos | ✅ | ✅ |
| Checks obligatorios en verde (sección 7.1) | ✅ | ✅ |
| Rama actualizada con la base antes de mergear | ✅ | ✅ |
| Historial lineal | — (merge commit del release) | ✅ (squash) |
| Prohibido el force push y el borrado | ✅ | ✅ |
| Conversaciones resueltas antes de mergear | ✅ | ✅ |

**CODEOWNERS** (`.github/CODEOWNERS`) exige que revise alguien de `vigia-admins` en lo delicado:

```
/infrastructure/        @EdwinSotto123
/backend/db/migrations/ @EdwinSotto123
/.github/               @EdwinSotto123
/backend/api/src/lib/publicacion.ts  @EdwinSotto123   # qué se publica y qué no
/frontend/components/Redact.tsx      @EdwinSotto123   # datos personales
```

> En un repo **público**, rulesets, CODEOWNERS y *environments* con aprobadores son gratis. Si en algún momento el repo pasa a privado, requiere GitHub Team (US$ 4 por usuario al mes).

### 6.3 Environments de GitHub

- **`dev`**: sin aprobación. Tiene las variables del proyecto `vigia-dev` (ID del proyecto, proveedor WIF, cuenta de despliegue).
- **`prod`**: **requiere aprobación** de un miembro de `vigia-admins`, sólo acepta despliegues desde `main` y tiene las variables de `vigia-prod`. Los despliegues quedan listados en la pestaña *Deployments* del repo, y Jira los muestra en cada ticket.

### 6.4 Convenciones

- **Rama:** `tipo/VIG-123-descripcion-corta` (`feat`, `fix`, `hotfix`, `chore`, `docs`). La clave de Jira en el nombre es lo que enlaza la rama con el ticket.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/es/) en español, con la clave de Jira: `feat(mapa): pinta provincias por monto (VIG-123)`. Así el changelog de cada release sale automáticamente.
- **PR:** plantilla (`.github/pull_request_template.md`) con qué cambia, por qué, cómo se probó, capturas si es UI, y un checklist (sin datos inventados, sin datos personales en claro, migración compatible hacia atrás).
- **Tamaño:** idealmente menos de 400 líneas cambiadas. Si un cambio es grande, se parte en PRs encadenados.
- **Versiones:** cada merge a `main` crea una etiqueta `vAAAA.MM.DD-N` y un *GitHub Release* con el changelog. Es la referencia para "volver a la versión de ayer".
- **Seguridad del repo:** Dependabot (dependencias), CodeQL (análisis estático) y *secret scanning* con *push protection* activados, todos gratis en repos públicos.

---

## 7. CI/CD: del commit a Cloud Run

### 7.1 En cada Pull Request (CI)

Se ejecutan en paralelo y sólo los que tocan lo que cambió (filtros por ruta del monorepo):

| Check | Cuándo corre | Qué hace |
|-------|--------------|----------|
| `frontend` | cambios en `frontend/` | `npm ci`, `tsc --noEmit`, `next lint`, `next build` |
| `api` | cambios en `backend/api/` | `npm ci`, `tsc --noEmit`, tests |
| `python` | cambios en `backend/agent`, `mcp`, `dispatcher`, `scrapers` | `ruff check`, `pytest` |
| `migraciones` | cambios en `backend/db/migrations/` | aplica todas las migraciones sobre un PostgreSQL efímero (servicio de Actions) y verifica que no fallen |
| `terraform` | cambios en `infrastructure/terraform/` | `fmt -check`, `validate` y `plan` contra dev, comentado en el PR |
| `secretos` | siempre | `gitleaks` (que nadie suba una llave) |
| `vista previa` | siempre que el PR sea del mismo repo | despliega a vigia-dev con etiqueta `pr-123`, sin tráfico, y comenta la URL en el PR |

**Vistas previas por PR sin costo fijo:** Cloud Run permite desplegar una revisión con `--no-traffic --tag pr-123`. Esa revisión tiene su propia URL (`https://pr-123---vigia-frontend-xxxx.a.run.app`), escala a cero y no afecta a la URL principal de dev. Al cerrar el PR, un workflow quita la etiqueta.

### 7.2 Al mergear a `dev` (despliegue continuo a desarrollo)

1. Se construyen las imágenes de los componentes que cambiaron, **una sola vez**, etiquetadas con el SHA del commit, y se suben a Artifact Registry en `vigia-ops`.
2. Se aplican las migraciones pendientes sobre la base de dev (job de migración, sección 7.4).
3. Se despliega a `vigia-dev` usando el **digest** exacto de la imagen.
4. Se corren pruebas de humo: la home responde 200, la API responde, una ruta del dossier carga.
5. Si algo falla, el workflow falla, el PR que lo rompió queda marcado y Jira lo muestra.

### 7.3 Al mergear a `main` (despliegue a producción)

1. El workflow espera **aprobación** en el *environment* `prod`.
2. **Promueve el mismo digest** que ya pasó por dev; no recompila.
3. Toma un respaldo de la base (`gcloud sql backups create`) y aplica las migraciones de prod.
4. Despliega con **tráfico gradual**: la nueva revisión recibe 10%, se corren las pruebas de humo y se vigila la tasa de errores durante 5 minutos; si todo está bien, pasa a 100%.
5. Crea la etiqueta y el *GitHub Release*, y notifica a Jira el despliegue.

**Excepción:** el frontend de Next.js "hornea" las variables `NEXT_PUBLIC_*` (Firebase) al compilar, así que su imagen se construye **una vez por ambiente** desde el mismo commit. El resto de los servicios promueve el mismo artefacto.

### 7.4 Migraciones de base de datos

Hoy existen migraciones numeradas en `backend/db/migrations` y un `apply_all.py`. Se mantiene el formato y se agrega:
- **Una tabla `schema_migrations`** que registra qué se aplicó y cuándo, para que cada migración corra una sola vez por ambiente.
- **Un Cloud Run Job `migrar`** en cada ambiente, que ejecuta las pendientes; el pipeline lo llama antes de desplegar.
- **Regla "expandir y contraer":** una migración nunca rompe la versión anterior del código. Para renombrar una columna: primero se agrega la nueva, se despliega el código que escribe en ambas, se copian los datos y, en un release posterior, se borra la vieja. Así, volver a la revisión anterior de Cloud Run siempre funciona.
- **Los scripts de datos no son migraciones.** Siembras, limpiezas y correcciones de datos van en `backend/db/cleanup/` o `backend/scripts/`, se ejecutan a mano con aprobación y dejan respaldo. **Ningún script de datos de demo puede apuntar a prod**; el de siembra debe negarse a correr si el proyecto es `vigia-prod`.

### 7.5 Transición: mientras prod siga en el proyecto actual

Hasta completar la migración (sección 3.4), el workflow de `main` despliega al proyecto actual con una cuenta de servicio de despliegue propia (vía WIF), y deja de usarse `gcloud` desde laptops. El `cloudbuild.yaml` actual se puede retirar cuando el workflow esté andando.

### 7.6 Esqueleto de los workflows

`.github/workflows/deploy.yml` (resumido; los valores salen de las variables de cada *environment*):

```yaml
name: deploy
on:
  push:
    branches: [dev, main]

permissions:
  id-token: write   # necesario para Workload Identity Federation
  contents: read

jobs:
  cambios:
    runs-on: ubuntu-latest
    outputs:
      api: ${{ steps.f.outputs.api }}
      frontend: ${{ steps.f.outputs.frontend }}
    steps:
      - uses: actions/checkout@v4
      - id: f
        uses: dorny/paths-filter@v3
        with:
          filters: |
            api: ['backend/api/**']
            frontend: ['frontend/**']

  api:
    needs: cambios
    if: needs.cambios.outputs.api == 'true'
    runs-on: ubuntu-latest
    environment: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.WIF_PROVIDER }}
          service_account: ${{ vars.DEPLOYER_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Imagen (se construye en dev; en prod se promueve el mismo digest)
        run: ./infrastructure/ci/imagen.sh api "${{ github.sha }}"
      - name: Migraciones
        run: gcloud run jobs execute migrar --region us-central1 --project "${{ vars.PROJECT_ID }}" --wait
      - name: Desplegar
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: vigia-api
          region: us-central1
          project_id: ${{ vars.PROJECT_ID }}
          image: ${{ env.IMAGEN }}   # por digest, no por etiqueta
      - name: Humo
        run: ./infrastructure/ci/humo.sh api
```

`.github/workflows/pr.yml` corre los checks de la sección 7.1 y la vista previa. `.github/workflows/pr-cerrado.yml` quita la etiqueta de la vista previa al cerrar el PR.

---

## 8. Datos por ambiente

| | `vigia-prod` | `vigia-dev` |
|-|--------------|-------------|
| Contratos OCDS, entidades, datasets públicos | carga real (scrapers programados) | subconjunto real reciente (por ejemplo, 90 días y 3 regiones), recargable con un script |
| Análisis de agentes | reales | reales, sobre el subconjunto (con presupuesto de IA topado) |
| Denuncias ciudadanas y cuentas de usuarios | reales (datos personales) | **nunca copiadas de prod**; se generan datos de prueba rotulados como tales |
| Datos de demo o maqueta | **prohibidos** | permitidos, siempre identificables (prefijo `DEMO-`) y excluidos de la API por la misma regla que hoy filtra los de prod |

**Refrescar dev desde prod**, cuando haga falta, se hace con un script que exporta sólo las tablas públicas (contratos, entidades, alertas publicadas) y **nunca** denuncias, cuentas, contribuciones ni datos personales. La lección de esta semana: las semillas de demo terminaron en producción y se mostraron como hechos. Con ambientes separados eso no puede volver a pasar.

---

## 9. Observabilidad y alertas

- **Uptime checks** (Cloud Monitoring, gratis hasta cierto volumen) cada 5 minutos para: frontend, API, MCP y el **relay de Lima**. Alertan a un canal del equipo (correo, Slack o Google Chat).
- **Alertas de errores:** tasa de respuestas 5xx por servicio mayor a 2% durante 5 minutos, y jobs de scrapers o del dispatcher que fallen 2 veces seguidas.
- **Alertas de negocio simples:** "ningún contrato procesado en 48 horas" y "pedidos de documentos pendientes por más de 24 horas". Son una consulta SQL programada que habría detectado la caída del relay el 17 de septiembre, no semanas después.
- **Arize/Phoenix:** un proyecto por ambiente, para que las trazas de pruebas no ensucien las métricas de producción.
- **Presupuestos de facturación** por proyecto, con alertas al 50%, 90% y 100%. En dev, además, cuotas de Vertex AI topadas para que un bucle en una prueba no genere una factura sorpresa.
- **Logs de auditoría** (Admin Activity, gratis y siempre activos; Data Access para Secret Manager y Cloud SQL en prod).

---

## 10. Jira

### 10.1 Estructura

- **Proyecto `VIG`** (Scrum o Kanban; con 4 personas, Kanban con revisión semanal es suficiente).
- **Tipos de incidencia:** Historia (valor para el usuario), Tarea (técnica), Bug, Épica (agrupa, por ejemplo "Migración a vigia-prod"). Se suma una **Subtarea** si el PR se parte.
- **Flujo:** `Por hacer → En curso → En revisión (PR abierto) → En dev (mergeado a dev) → En prod (desplegado) → Hecho`.

### 10.2 Integración con GitHub

Con la app **"GitHub for Jira"** (gratis):
- la **clave del ticket en la rama o el commit** (`VIG-123`) enlaza automáticamente ramas, commits y PRs al ticket;
- los **despliegues** de GitHub Actions a los *environments* `dev` y `prod` aparecen en el ticket ("desplegado en prod el 30/09");
- con **Jira Automation**, las transiciones se hacen solas: PR abierto → *En revisión*; PR mergeado a `dev` → *En dev*; despliegue a `prod` exitoso → *En prod*.

### 10.3 Definición de "Hecho"

Un ticket está hecho cuando:
- [ ] el PR fue revisado y aprobado, y los checks pasaron;
- [ ] se probó en la vista previa o en dev (con captura si es UI, en escritorio y celular);
- [ ] está desplegado en prod y las pruebas de humo pasaron;
- [ ] no introduce datos inventados, datos personales sin redactar, "·" como separador ni voseo (las reglas de producto que ya existen);
- [ ] si cambia algo operativo, está actualizado el `README` o este documento.

---

## 11. Costos

Estimaciones mensuales en **US$**, con precios de lista de `us-central1` a mediados de 2026. Son órdenes de magnitud para decidir, **no una cotización**: conviene confirmarlas en la [calculadora de precios de Google Cloud](https://cloud.google.com/products/calculator) y fijar presupuestos con alertas desde el primer día.

### 11.1 Lo que se agrega

| Concepto | Mínimo | Típico | Notas |
|----------|-------:|-------:|-------|
| Cloud SQL de dev (`db-f1-micro` / `db-g1-small`, 20 GB SSD) | 11 | 29 | La partida más grande. Se puede apagar de noche y fin de semana con un job programado (ahorro de ~50%). |
| Cloud Run de dev (escala a cero) y vistas previas | 0 | 5 | La capa gratuita (180 mil vCPU-segundo y 2 millones de peticiones al mes) cubre casi todo el uso de desarrollo. |
| Vertex AI, Gemini y Document AI en dev | 5 | 30 | Depende de cuántos análisis de prueba se corran; topar con cuota y presupuesto. |
| Artifact Registry (imágenes) | 1 | 3 | US$ 0,10 por GB al mes; con limpieza de imágenes de más de 30 días. |
| Secret Manager (dev + ops) | 0,5 | 1 | US$ 0,06 por versión activa al mes. |
| Cloud Scheduler (jobs de dev) | 0 | 1 | 3 jobs gratis por cuenta de facturación; US$ 0,10 por job extra. |
| Bastión para acceso a la base (`e2-micro`, opcional) | 0 | 7 | Sólo si se opta por IP privada estricta también en dev. |
| Cloud NAT con IP fija (opcional) | 0 | 5 | Sólo si algún sitio exige una IP de salida conocida. |
| Dominio `vigiaperu.org` | 1 | 2 | US$ 10–20 al año. |
| **Total agregado** | **~US$ 20** | **~US$ 70** | |

### 11.2 Lo que no cuesta

| Herramienta | Costo | Condición |
|-------------|-------|-----------|
| GitHub (repo, Actions, rulesets, environments, Dependabot, CodeQL) | US$ 0 | Mientras el repo sea público. Si pasa a privado: GitHub Team, US$ 4 por usuario al mes, más minutos de Actions. |
| Jira | US$ 0 | Plan Free hasta 10 usuarios. Standard: aprox. US$ 8 por usuario al mes, si se necesitan permisos finos o más automatizaciones. |
| Cloud Identity Free | US$ 0 | Hasta 50 usuarios. |
| Workload Identity Federation, IAM, VPC, auditoría de actividad | US$ 0 | |
| Cloud Build | US$ 0 | Si se usa como alternativa a Actions: 2.500 minutos de build gratis al mes. |

### 11.3 Producción

**No cambia**: es lo que ya se paga hoy por los servicios de Vigía (la base `db-custom-1-3840`, unos US$ 50 al mes más almacenamiento, más Cloud Run y el uso de IA). Hay dos decisiones opcionales para cuando el producto tenga compromisos de disponibilidad:
- **Alta disponibilidad en Cloud SQL:** duplica el costo de la instancia, unos US$ 50 más al mes. Hoy no se justifica.
- **min-instances = 1 en frontend y API:** entre US$ 10 y 25 al mes, y elimina el arranque en frío de la primera visita.

Al migrar prod a su propio proyecto, **la factura de Vigía se separa por fin de la de los otros productos**. Hoy no se puede saber cuánto cuesta Vigía.

---

## 12. Plan de implementación por fases

| Fase | Duración | Qué se hace | Resultado |
|------|----------|-------------|-----------|
| **0. Reglas del repo** | 1 día | Crear la rama `dev` desde `main`; rulesets de `main` y `dev`; CODEOWNERS; plantilla de PR; Dependabot, CodeQL y *secret scanning*; proyecto `VIG` en Jira con la app de GitHub. | Nadie más commitea directo a `main`. Cada cambio tiene ticket y PR. |
| **1. Base en GCP** | 2–3 días | Dominio y Cloud Identity (u opción sin organización); grupos; proyectos `vigia-ops` y `vigia-dev`; WIF para GitHub; bucket de estado de Terraform; Artifact Registry. | El equipo tiene cuentas y accesos correctos. |
| **2. Dev como código** | 3–5 días | Extender `infrastructure/terraform` a módulos por ambiente; aplicar a `vigia-dev`: VPC, Cloud SQL, buckets, secretos, cuentas de servicio, servicios y jobs; Firebase de dev; datos de dev (sección 8). | Un ambiente de desarrollo completo, sin tocar prod. |
| **3. CI/CD** | 3–4 días | Workflows de PR (checks y vistas previas), de `dev` (despliegue continuo) y de `main` (hacia el proyecto actual, sección 7.5); job de migraciones; pruebas de humo. | Merge a `dev` despliega solo. Merge a `main` despliega a prod con aprobación. |
| **4. Endurecer el prod actual** | 1–2 días | Cerrar el orquestador (IAM); pasar la llave de SUNAT a Secret Manager (con una llave nueva: la actual está vencida); quitar la red autorizada doméstica; uptime checks, incluido el relay; presupuestos. | Los riesgos más graves de la sección 1 quedan cerrados antes de migrar. |
| **5. Migrar prod** | 1 semana | Crear `vigia-prod` con el mismo Terraform; export e import de la base; copia de buckets; secretos rotados; despliegue desde el pipeline; validación en paralelo; cambio de URL; apagado de lo viejo. | Vigía vive en sus propios proyectos, con la factura separada. |
| **6. Mejora continua** | continuo | Subir la cobertura de tests; evaluar pasar a trunk-based con *feature flags*; considerar staging si el equipo crece. | |

Las fases 0 y 1 se pueden hacer apenas se apruebe esta propuesta. La fase 4 conviene no postergarla: son riesgos presentes en producción.

---

## 13. Guía de arranque para quien se suma

1. **Accesos:** recibir la cuenta, entrar a los grupos (sección 4.6) y aceptar las invitaciones de GitHub y Jira.
2. **Herramientas:** Git, Node 20, Python 3.12, Docker, `gcloud` CLI y `cloud-sql-proxy`.
3. **Autenticación local, sin llaves:**
   ```bash
   gcloud auth login
   gcloud auth application-default login   # credenciales para las librerías, sin llave JSON
   gcloud config set project vigia-dev
   ```
4. **Correr local:** `docker compose -f infrastructure/docker-compose.yml up -d` levanta PostgreSQL local. Copiar `frontend/.env.example` a `.env.local`; las llaves de dev se leen de Secret Manager de `vigia-dev` con un script, nunca se copian por chat.
5. **Primer cambio:** tomar un ticket `VIG-…`, crear `feat/VIG-…` desde `dev`, abrir el PR, revisar la vista previa, pedir revisión y mergear.
6. **Reglas del producto que se revisan en cada PR:**
   - ningún dato inventado ni de maqueta presentado como real;
   - datos personales redactados (`components/Redact.tsx`);
   - textos en tuteo, sin "·" como separador;
   - contraste AA.

---

## 14. Riesgos y decisiones abiertas

| Tema | Decisión que falta | Recomendación |
|------|--------------------|---------------|
| Dominio y organización | ¿Se registra `vigiaperu.org` y se crea la organización? | Sí: US$ 10–20 al año resuelve identidad, correo de contacto y propiedad de los proyectos. |
| Correo de contacto del sitio | Hoy los enlaces van a los *issues* de GitHub porque `vigiaperu.org` no existe. | Con el dominio, crear `hola@` y `prensa@` y actualizar el sitio. |
| Llave de SUNAT | La actual responde 401: la verificación de RUC del pipeline no funciona. | Renovar la llave y guardarla en Secret Manager (fase 4). |
| Relay de Lima | Está caído desde el 17 de septiembre; es un punto único de falla externo. | Reiniciarlo desde el panel del proveedor; agregar uptime check; evaluar un segundo relay. |
| Firebase | Hoy es el proyecto de otro producto. | Un proyecto de Firebase por ambiente; migrar usuarios de prod con la herramienta de exportación de Firebase Auth. |
| Staging | ¿Hace falta un tercer ambiente? | No por ahora (sección 3.1). Revisar si el equipo supera las 6 personas o hay acuerdos de disponibilidad. |
| Repo público o privado | ¿Se mantiene público? | Público mantiene gratis Actions y las protecciones; ya hay una regla de no subir secretos ni menciones internas, y *secret scanning* la refuerza. |

---

## Anexo A. Comandos de referencia

Crear los proyectos y enlazar la facturación:

```bash
gcloud projects create vigia-dev --folder=<ID_CARPETA_VIGIA> --labels=app=vigia,env=dev
gcloud projects create vigia-ops --folder=<ID_CARPETA_VIGIA> --labels=app=vigia,env=ops
gcloud billing projects link vigia-dev --billing-account=<CUENTA_DE_FACTURACION>
gcloud billing projects link vigia-ops --billing-account=<CUENTA_DE_FACTURACION>
```

Dar un rol a un grupo (nunca a una persona):

```bash
gcloud projects add-iam-policy-binding vigia-dev \
  --member="group:vigia-devs@vigiaperu.org" --role="roles/run.developer"
```

Workload Identity Federation para GitHub (una vez, en `vigia-ops`):

```bash
gcloud iam workload-identity-pools create github --project=vigia-ops --location=global
gcloud iam workload-identity-pools providers create-oidc vigia-peru \
  --project=vigia-ops --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository=='EdwinSotto123/vigia-peru'"

# El deployer de prod sólo puede suplantarse desde el environment "prod" de GitHub
gcloud iam service-accounts add-iam-policy-binding sa-deployer-prod@vigia-prod.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/<NUM_PROYECTO_OPS>/locations/global/workloadIdentityPools/github/attribute.environment/prod"
```

Cerrar el orquestador a internet (después de desplegar los clientes que ya envían token):

```bash
gcloud run services update agent-orchestrator-adk --region us-central1 --ingress internal-and-cloud-load-balancing
gcloud run services add-iam-policy-binding agent-orchestrator-adk --region us-central1 \
  --member="serviceAccount:sa-dispatcher@<PROYECTO>.iam.gserviceaccount.com" --role="roles/run.invoker"
gcloud run services remove-iam-policy-binding agent-orchestrator-adk --region us-central1 \
  --member="allUsers" --role="roles/run.invoker"
```

Vista previa de un PR sin tráfico:

```bash
gcloud run deploy vigia-frontend --image "$IMAGEN" --region us-central1 --project vigia-dev \
  --no-traffic --tag "pr-${PR_NUMERO}"
```

## Anexo B. Plantilla de Pull Request

```markdown
## Qué cambia
<!-- 1 a 3 líneas. Enlaza el ticket: VIG-123 -->

## Por qué

## Cómo lo probé
- [ ] Vista previa: <URL de pr-###>
- [ ] Escritorio y celular (capturas si es UI)

## Checklist
- [ ] Sin datos inventados ni de maqueta presentados como reales
- [ ] Datos personales redactados
- [ ] Migración compatible con la versión anterior (o no hay migración)
- [ ] Sin secretos en el diff
```
