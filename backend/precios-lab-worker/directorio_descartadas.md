# Tiendas probadas y rechazadas (sondeo del 2026-11-12)

Se respetaron estas reglas en cada sitio: UA `VigiaPeru-PreciosLab/0.1`, robots.txt según RFC 9309 (gana la regla más larga y, si empatan, Allow), al menos 1,25 s entre pedidos y ningún login, carrito ni desafío. Cuando robots.txt respondía 401/403/429 o un desafío, se paró ahí. Un robots.txt con 5xx se tomó como "no rastrear".

## 1. Bloqueo: robots.txt, 403/429, desafío

| Tienda | Dominio | Rubro | Plataforma | Motivo |
|---|---|---|---|---|
| Boticas Perú | boticasperu.pe | farmacia | ? | robots.txt da 403 con captcha (Cloudflare) |
| Tottus | tottus.com.pe | alimentos, limpieza | ? | robots.txt da 403 con captcha |
| Vivanda | vivanda.com.pe | alimentos | VTEX (Next.js) | robots.txt pone `Disallow: /api/` para `*`, lo que bloquea la API de catálogo |
| Decor Center | decorcenter.pe | ferretería | Magento | robots.txt pone `Disallow: /` para `*` (solo deja entrar a Google) |
| Drimer | drimer.pe | hogar | VTEX | robots.txt pone `Disallow: /*?`, que bloquea cualquier búsqueda con parámetros |
| Thomas | thomas.com.pe | hogar | Magento | `/graphql` responde vacío con licuadora, plancha y aspiradora, y la búsqueda HTML queda bloqueada por `Disallow: /*?` |
| Rosen | rosen.com.pe | hogar | Magento | `/graphql` da 403 |
| HP (sitio oficial) | hp.com/pe-es/shop | cómputo | Magento | `/graphql` da 403 (la alternativa hpstore.com.pe sí funciona) |
| Suministros Perú | suministrosperu.pe | oficina, cómputo | WooCommerce | la Store API da 403 |
| iShop | ishop.com.pe | cómputo | ? | robots.txt da 503 (RFC 9309: no rastrear) |
| Juntoz | juntoz.com | marketplace | ? | robots.txt da 403 con captcha |
| PC Factory | pcfactory.com.pe | cómputo | ? | robots.txt da 403 con captcha |
| El Sótano | elsotano.com | oficina (libros) | ? | robots.txt da 403 con captcha |
| Goodyear | goodyear.com.pe | automotriz | ? | robots.txt da 403 con captcha |
| Llantas Express | llantasexpress.pe | automotriz | ? | robots.txt da 403 con captcha |
| Euroshop | euroshop.com.pe | automotriz | ? | robots.txt da 403 |
| Autoland | autoland.com.pe | automotriz | ? | robots.txt da 403 |
| Nestlé | nestle.com.pe | alimentos | ? | robots.txt da 403 con captcha |
| JBL | jbl.com.pe | cómputo | ? | robots.txt da 403 con captcha |
| Philips | philips.com.pe | cómputo, hogar | ? | robots.txt da 403 con captcha |
| Brother | brother.com.pe | cómputo, oficina | ? | robots.txt da 403 con captcha |
| TechStore | techstore.pe | cómputo | ? | robots.txt da 403 |
| Maxtec | maxtec.pe | cómputo | ? | la portada da 403 |
| Würth Perú | wurth.com.pe | ferretería, automotriz, seguridad | ? | la portada da 403 |
| Biomédica | biomedica.pe | médico | ? | la portada da 403 |
| Sillas.pe | sillas.pe | oficina (muebles) | ? | la portada da 403 |
| Faber (campanas) | faber.com.pe | hogar | ? | la portada da 403 |

## 2. Responde, pero sin precios útiles o no en soles

| Tienda | Dominio | Rubro | Plataforma | Motivo |
|---|---|---|---|---|
| PCBYTE | pcbyte.com.pe | cómputo | WooCommerce | precios en USD (`currency_code` = USD) |
| Ferretería Espinoza | ferreteriaespinoza.com | ferretería | WooCommerce | precios en USD |
| Antryx | antryx.com | cómputo | WooCommerce | precio 0 y moneda USD (solo catálogo) |
| Vicsa Safety | vicsasafety.com → vicsa.cl | seguridad | Shopify | redirige a la tienda de Chile: precios en CLP |
| Steelpro Safety | steelprosafety.com | seguridad | Shopify | es un selector de país y la tienda que responde está en CLP |
| EPP Perú | eppperu.pe | seguridad | WooCommerce | todos los precios son S/ 1.00 de relleno ("cotizar") |
| Segurindustria (segusa.com.pe redirige aquí) | segurindustria.pe | seguridad | WooCommerce | mezcla S/ 1.00 de relleno con "liquidación" a precios anómalos (casco 3M H-700 a S/ 6.73): no es fiable |
| Grupo Epps Perú | eppsperu.pe | seguridad | WooCommerce | precio 0 en todo (catálogo B2B) |
| Halion | halion.com.pe | cómputo | WooCommerce | precio 0 (catálogo de marca) |
| Cantol | cantol.com.pe | ferretería | WooCommerce | precio 0 (catálogo) |
| Laive | laive.pe | alimentos | WooCommerce | precio 0 |
| La Ibérica | laiberica.com.pe | alimentos | Shopify | precio 0.00 en los resultados |
| Insumed | insumed.pe | médico | WooCommerce | precio 0 (sin búsqueda: guantes y jeringa no traen nada) |
| Bateria.pe | bateria.pe | automotriz | WooCommerce | precio 0 en casi todo |
| Smart Shop | smartshop.pe | cómputo | WooCommerce | la Store API responde [] con laptop, mouse y cargador |
| Herramientas.pe | herramientas.pe | ferretería | WooCommerce | la Store API responde [] con taladro, martillo y llave |
| Cerámica San Lorenzo | sanlorenzo.com.pe | ferretería | WooCommerce | la Store API responde [] |
| Bata Industrials | bataindustrials.pe | seguridad | WooCommerce | la Store API responde [] (zapato, botín) |
| Medical Store | medicalstore.pe | médico | WooCommerce | la Store API responde [] (tensiómetro, guantes, mascarilla) |
| Ortopedia Tecnisalud | ortopediatecnisalud.com | médico | WooCommerce | la Store API responde [], también con tildes |
| Filtros.pe | filtros.pe | automotriz | WooCommerce | catálogo vacío en la Store API |
| Tracklink | tracklink.com.pe | automotriz | WooCommerce | la Store API responde [] (es un servicio de GPS) |
| Lubricantes Perú | lubricantesperu.com | automotriz | WooCommerce | `/wp-json/wc/store/...` devuelve HTML, no JSON |
| Nicoll | nicoll.com.pe | ferretería | WooCommerce | la Store API da 404 (catálogo sin tienda) |
| Clute | clute.com.pe | seguridad | WooCommerce | la Store API da 404 |
| EPP Perú (.com) | eppperu.com | seguridad | WooCommerce | la Store API da 404 |
| Hankook | hankook.com.pe | automotriz | ? | `/graphql` da 404 (no es Magento) |

## 3. Sin tienda online o sin JSON público (posibles candidatos para navegador)

| Tienda | Dominio | Rubro | Plataforma | Motivo |
|---|---|---|---|---|
| Tiendas Mass | tiendasmass.com.pe | alimentos | WordPress | sitio institucional sin tienda (vende por apps de terceros) |
| Mayorsa | mayorsa.com.pe | alimentos | WordPress | sitio institucional sin tienda |
| Boticas y Salud (ByS) | boticasysalud.com | farmacia | Next.js propio | sin endpoint JSON público identificado: **candidato a navegador** |
| Tambo | tambo.pe | alimentos | app propia | precios en el HTML, sin JSON público: candidato a navegador |
| CompuTienda | computienda.pe | cómputo | Next.js propio | robots bloquea `/api/*` pero **permite `/api/feed/google` y `/api/feed/facebook`** (feed de catálogo): candidato a feed o navegador |
| Laptop Store | laptopstore.pe | cómputo | HTML propio | precios en el HTML: candidato a navegador |
| Infotec | infotec.com.pe | cómputo | propio | la portada vuelve vacía sin JS: hace falta navegador |
| C&C Computer | cyccomputer.pe | cómputo | propio | la portada vuelve vacía sin JS. Content-Signal: search=yes, ai-train=no, use=reference |
| Compudiskett | compudiskett.com.pe | cómputo | propio | sin plataforma detectable: navegador |
| Standford | standford.com.pe | oficina | Next.js | sin API pública |
| Utilex | utilex.pe | oficina | Next.js | "Tienda no disponible" (404) |
| Artesco | artesco.com.pe | oficina | propio | sitio de marca sin carrito detectable |
| Vinifan | vinifan.com | oficina | propio | sitio de marca |
| DeWalt | dewalt.com.pe | ferretería | Next.js (Shopify headless) | sin endpoint público en el dominio |
| American Colors | americancolors.com.pe | ferretería | Next.js | sin API pública |
| Llantas Perú | llantasperu.com | automotriz | propio | catálogo con precios en HTML: candidato a navegador |
| Medicalshop (Jaén) | medicalshop.pe | médico | propio | sin JSON |
| Farmacia El Sol | farmaciaselsol.com | farmacia | propio | sin JSON |
| Soltrak (institucional) | soltrak.com.pe | seguridad | WordPress | la tienda está en tiendaonline.soltrak.com.pe (incluida) |
| Varios de marca o institucionales | epson.com.pe, makita.pe, pe.blackanddecker.global, bosch-professional.com, michelin.com.pe, repsol.pe, yokohama.pe, etna.com.pe, enerjet.com.pe, vistony.pe, derco.com.pe, logitech.pe, klipxtreme.com, teroslatinamerica.com, impulso.pe, chema.com.pe, anypsa.com.pe, cpp.com.pe, qroma.com.pe, tekno.com.pe, rey.com.pe, alicorp.com.pe, dimexa.com.pe, medicorp.pe, bateriasperu.com, bateriasexpress.pe, baterias.pe, extintores.com.pe, dispositivosmedicos.pe | varios | WordPress, propio | sin carrito ni precios públicos |

## 4. Sin conexión o TLS inválido

| Dominio | Rubro | Motivo |
|---|---|---|
| celima.com.pe, ingco.pe, totaltools.com.pe, teka.com.pe, maxxis.com.pe, firestone.com.pe, valvoline.com.pe, motul.pe, vistony.com, lubricantes.pe, mi-store.pe | varios | tiempo de espera agotado en el puerto 443 |
| layconsa.com, indeco.com.pe | oficina, ferretería | conexión rechazada (con y sin www) |
| trebol.com.pe, stihl.com.pe, steelpro.com, tecseg.com.pe, oficinas.pe | varios | el certificado TLS no corresponde al dominio (no se forzó) |
| mabe.com.pe, gloria.com.pe, compupalace.com.pe | hogar, alimentos, cómputo | falla el handshake TLS |
| faber-castell.com.pe | oficina | cadena TLS incompleta; con curl se ve que es un sitio corporativo (Sitecore) sin tienda |

## Notas

- Las "conocidas" que se pidió verificar: **Makro** (makro.plazavea.com.pe, VTEX), **Hogar y Salud** y **Crisol** se incluyeron. **Vivanda** queda fuera por robots (`/api/`), **Mass** no tiene tienda online y **Boticas Perú** responde 403 con captcha.
- Varios dominios sin `www` rechazan la conexión y solo responden con `www.` (casaideas, florayfauna, rotoplas, oster, farmaciauniversal). En tiendas.json el `base` ya lleva el host correcto.
- Los dominios que no resolvían DNS no se listan.
