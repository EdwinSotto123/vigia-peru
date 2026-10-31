# Relay de Lima

La salida con IP peruana de los scrapers. Algunas fuentes del Estado sólo responden a IPs del Perú: desde Cloudflare, y también
por el relay de Zúrich, dan 522 o 403. Este relay corre en una instancia EC2 de la **Local Zone de AWS en Lima**
(`us-east-1-lim-1a`), cuya IP ubican en Lima ipinfo e ip-api, y los Workers lo usan como cualquier otra salida.

```
Worker vigia-scrapers ──binding RELAY_LIMA (Workers VPC)──▶ túnel vigia-lima ──▶ cloudflared ──▶ relay.py 127.0.0.1:8080 ──▶ *.gob.pe
                                                              (sólo salida)        └──────── EC2 t3.medium en Lima ────────┘
```

- **Sin puertos abiertos.** El grupo de seguridad no tiene reglas de entrada. cloudflared abre la conexión hacia Cloudflare y
  los Workers llegan por el servicio de Workers VPC `vigia-relay-lima`, igual que Hyperdrive llega a PgBouncer por `vigia-db`.
- **Misma API que el relay de Zúrich** (`POST /raw`), más lo que una página con sesión necesita: `metodo` (GET, HEAD o
  POST), `cabeceras`, `cuerpo`, y de vuelta `x-relay-url` y `x-relay-cookies`. Detalle en el docstring de `relay.py`.
- **Sólo `*.gob.pe`,** también tras cada redirección, y nunca hacia una IP privada. Pide `X-Vigia-Token` (SSM
  `/vigia/relay-lima/token` = secreto `RELAY_LIMA_TOKEN` del Worker).
- **Siempre la misma IP:** una IP elástica de Lima en una interfaz de red propia; si la instancia se reemplaza, la IP queda.
- Se administra por SSM (Run Command), sin SSH. IMDSv2 obligatorio, disco cifrado, parches de seguridad automáticos
  (dnf-automatic) y protección contra borrado.

## Qué pasa por aquí

Probado el 2026-10-31 desde el Worker (`GET /diagnostico?partes=lima,cgr`):

| Fuente | Directo desde Cloudflare | Por Zúrich | Por Lima |
|---|---|---|---|
| Contraloría, buscador de informes (`contraloria_informes`) | 522 | 522 | 200, 0,5 s |
| INFOBRAS | 522 | 522 | 200 |
| SERVIR, plazas CAS | 403 | 403 | 200 |
| Procuraduría Anticorrupción (MINJUS) | no resuelve | no resuelve | no resuelve |

La Procuraduría no es un bloqueo por país: el propio DNS de MINJUS (`ns1.opticalip.com.pe`) responde NXDOMAIN para
`procuraduriaanticorrupcion.minjus.gob.pe`, también desde una PC en el Perú. El sitio se mudó o se cayó; cuando aparezca su
nueva dirección, puede ir directo o por aquí.

## ¿Y sólo con Cloudflare?

Probado el 2026-10-31 con Workers de prueba. Un Worker sale a internet con IPs de Cloudflare que se ubican en el país del
centro de datos donde corre: desde Buenos Aires salió con 104.23.237.16 (Argentina) y desde Miami con 104.22.86.131 (EE.
UU.). Cloudflare tiene un centro de datos en Lima, pero no hay forma de hacer correr ahí un Worker:

| Intento | Resultado |
|---|---|
| Worker directo (corre donde entra el pedido: Ohio con `placement`, Buenos Aires desde el Perú, Miami desde AWS Lima) | Contraloría e INFOBRAS 522, SERVIR 403. Desde Miami la Contraloría contestó 6 de 10 veces: algunas IP de salida pasan y otras no, así que no sirve para una carga. |
| Relay de Zúrich | 522 y 403. |
| Browser Rendering | La Contraloría no responde. |
| `placement` por `hostname` o `host` (el servidor de la Contraloría o de INFOBRAS) | El Worker no se mueve: sigue corriendo donde entra el pedido. |
| `placement` por región `aws:us-east-1-lim-1` (la zona de Lima) | Cloudflare lo rechaza: «unsupported Cloud Region». Sólo acepta regiones de AWS, GCP y Azure, y ninguna está en el Perú. |
| IP de salida dedicada de Cloudflare | Sólo en planes Enterprise. |

Por eso la salida es una máquina con IP peruana. Cloudflare pone todo lo demás: el Worker, el cron, los reintentos, la
bitácora, el túnel y la red privada (Workers VPC). La máquina no tiene que ser de AWS: el mismo relay.py y cloudflared
corren en cualquier Linux con IP del Perú (un VPS peruano o una mini PC), con `relay_lima.py` adaptado.

## Uso

```bash
# Todo lo que falte (idempotente): subred, grupo de seguridad, rol, secretos, túnel, servicio VPC, IP e instancia
AWS_PROFILE=founder.edwin python infrastructure/deploy/aws/relay_lima.py crear
# Subir un relay.py nuevo y reiniciarlo (--cloudflared: también el cloudflared más nuevo)
AWS_PROFILE=founder.edwin python infrastructure/deploy/aws/relay_lima.py actualizar
# Instancia, túnel, servicios y /health
AWS_PROFILE=founder.edwin python infrastructure/deploy/aws/relay_lima.py estado
# Un comando en la instancia (por SSM)
AWS_PROFILE=founder.edwin python infrastructure/deploy/aws/relay_lima.py ejecutar 'journalctl -u vigia-relay -n 50 --no-pager'
```

Desde el Worker: `obtener(env, url, { relay: "lima" })` (src/http.ts). Diagnóstico:
`GET https://vigia-scrapers.vigiaperu.workers.dev/diagnostico?partes=lima` con `Authorization: Bearer <SCRAPERS_TOKEN>`.

## Costo

Precios de AWS para la zona de Lima (2026-10-31):

| Concepto | Precio | Al mes |
|---|---|---|
| t3.medium (la más chica que ofrece la zona), encendida siempre | US$ 0,084 la hora | ~US$ 61 |
| Disco gp2 de 20 GB | US$ 0,266 el GB al mes | ~US$ 5,3 |
| IP pública | US$ 0,005 la hora | ~US$ 3,7 |
| **Total** | | **~US$ 70** |

Las fuentes que la usan corren unas horas por semana. Encenderla sólo de 07:45 a 10:45 (hora de Lima) con EventBridge
Scheduler dejaría la instancia en ~US$ 8 y el total en ~US$ 17 al mes; una corrida a mano fuera de esa ventana tendría que
encenderla antes.

## Si algo falla

- **`lima_salud` con error en el diagnóstico:** `relay_lima.py estado`. Si el túnel no está `healthy`, reiniciar cloudflared
  (`ejecutar 'systemctl restart cloudflared-vigia'`). Si la instancia no responde por SSM, mirar la consola serie
  (`aws ec2 get-console-output --instance-id … --region us-east-1 --latest`).
- **Un sitio vuelve a dar 403 o 522 por Lima:** el sitio cambió de regla. La IP es fija, así que se le puede pedir al sitio
  que la permita, o liberar la IP elástica y pedir otra.
- **Rotar el token:** un valor nuevo en SSM (`aws ssm put-parameter --region us-east-2 --name /vigia/relay-lima/token
  --type SecureString --overwrite …`), `relay_lima.py actualizar` (lo vuelve a leer de SSM) y el mismo valor en
  `wrangler secret put RELAY_LIMA_TOKEN` de vigia-scrapers y de su `--env dev` (con una tubería desde
  `aws ssm get-parameter`, sin que pase por la pantalla).
