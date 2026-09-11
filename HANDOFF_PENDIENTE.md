# Luxury Finds — Estado del proyecto y pendientes

Proyecto: `C:\Users\rutil\Desktop\appluxury2` (repo `lizsoriano/luxuryfinds`, rama `main`).
App Next-like sobre `vinext`/`vite` + React Server Components, backend Supabase (schema `luxury_finds`), sin Tailwind (CSS plano en `app/globals.css`).

Este documento resume lo que ya está construido y, sobre todo, **lo que falta para que funcione con datos reales**. Está escrito para que otra IA (o tú) pueda retomarlo sin tener que releer todo el proyecto desde cero.

---

## ✅ Ya resuelto (verificado contra Supabase real y en producción)

- Las 4 migraciones corrieron y se confirmaron una por una contra la base real: `000_fix_clients_service_role_grant.sql`, `001_telegram_linking.sql`, `002_business_management.sql`, `003_product_sources_sync.sql`, `004_weekly_plan_checkout.sql`. `businesses`, `suppliers`, `cash_sessions`, `sales`, `sale_items`, `expenses`, `variant_stock`, `product_sources`, `sync_runs`, `price_change_log`, `product_match_reviews`, `products.weekly_plan_eligible`, `orders.requested_payment_mode`, `product_variants.barcode`, `clients.telegram_chat_id` — las 14 tablas/columnas nuevas responden correctamente.
  - *(Nota: `002` tuvo que corregirse una vez — tenía un `ALTER COLUMN` antes del `DROP VIEW` que lo necesitaba, orden inválido en Postgres. Ya está arreglado en el archivo; si vuelves a correrlo desde cero no debería fallar.)*
- `REFUND_ENCRYPTION_KEY` ya está generada y en `.env` local (64 caracteres hex). Devoluciones ya puede cifrar/descifrar CLABEs.
- **`main` está al día y desplegado en producción.** El trabajo vivía en la rama `feature/appluxury2` (PR #3, "Pedidos, plan semanal, Cobranza/Agenda/Devoluciones y limpieza de admin") y `main` se había quedado 5 commits atrás — por eso `https://luxuryfinds.vercel.app` mostraba una versión vieja. Se corrigieron dos bugs de deploy que tumbaban el build en Vercel (`vercel.json`: el cron cada 15 min no es válido en plan Hobby, y el bloque `functions` con un patrón que Vercel no reconocía porque el proyecto usa `nitro`/`vinext`, no el adaptador nativo de Next.js) y se fusionó el PR. El sitio en `https://luxuryfinds.vercel.app` ya sirve la versión actual.
- **Ya existe una cuenta de administradora real y se probó en producción de punta a punta**: login → `/admin` → dashboard con datos reales, sidebar con las secciones nuevas, todo cargando bien. Correo: `rutilia2511@gmail.com` (la contraseña no se guardó en ningún archivo del proyecto — la tienes tú). Si necesitas otra cuenta de admin, es: crear el usuario en Supabase Auth (dashboard → Authentication, o `/crear-cuenta` en el sitio) y luego insertar una fila en `luxury_finds.admin_users` con ese mismo `id`, un `username` único y `status = 'ACTIVE'`.
- Como consecuencia de lo anterior: **las variables de Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) ya están confirmadas funcionando en Vercel** — si no lo estuvieran, el login y el dashboard del admin no habrían cargado datos reales. Lo que **sigue sin confirmarse en Vercel** son las otras 5: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `SYNC_CRON_SECRET`, `REFUND_ENCRYPTION_KEY` — revísalas en Settings → Environment Variables antes de dar por hecho que Telegram/sincronización/devoluciones funcionan en producción.
  - ⚠️ **Lección real de esta ronda**: Vercel permite que una misma variable tenga varias filas, cada una con un solo ambiente marcado (Production/Preview/Development), en vez de una fila con las tres casillas. `SUPABASE_SECRET_KEY` tenía fila para Production y otra para Development, pero **ninguna para Preview** — eso rompió `/catalogo` en cualquier deploy de rama/PR (con `500`/página vacía) aunque producción funcionara perfecto. Si algo funciona en producción pero no en un preview de Vercel, **revisa esto primero** antes de sospechar del código: Settings → Environment Variables → ábrela → confirma que las tres casillas estén marcadas (o que exista una fila por cada ambiente que uses).
- Migraciones nuevas de esta ronda:
  - `005_product_images_index.sql` — arregla que `/admin/productos` (y el catálogo público) tardara ~4s por página: faltaba el índice en `product_images.product_id`. **Falta correrla.**
  - `006_favorites.sql` — tabla nueva para la lista de deseos (ver abajo). **Falta correrla.**
- **WhatsApp reemplazado por Telegram** en todo el sitio público (Contacto, ayuda de login/registro, confirmación de checkout) — ya en producción, no requiere nada más.
- **Header público rediseñado** con dos grupos de atajos: izquierda (Todo/Marcas/Nuevo/Más vendidos), derecha (Mi cuenta/Favoritos/Dudas). "Entrega inmediata" y "Por pedido" se movieron al pie de página (ya no estaban en la referencia visual que se pidió imitar).
- **Favoritos (lista de deseos) — nuevo, funcional en código, pendiente de `006`**: corazón en cada `ProductCard`, página `/favoritos` (requiere sesión, igual que `/checkout`), `app/api/favorites` (GET lista los favoritos del cliente, POST agrega/quita). Es server-side por cliente (no `localStorage` como el carrito) para que se vea igual en cualquier dispositivo. Probado en vivo: con la tabla `favorites` aplicada debería andar sin tocar código — el único error visto fue justamente "no existe la tabla", exactamente lo esperado antes de correr `006`.
- **"Más vendidos" — nuevo sort real en el catálogo**, no un filtro decorativo: suma cantidades vendidas de `order_items` + `sale_items` y ordena por eso. Como todavía no hay ventas reales registradas, hoy muestra "No encontramos productos" en ese filtro — es el comportamiento correcto (honesto) hasta que haya datos, no un bug.

## 🔴 ACCIÓN INMEDIATA — lo único que falta para producción

### 0. Habilitar el proveedor "Phone" en Supabase Auth (nuevo — login solo con celular)

Se agregó un modo de acceso "Solo mi celular" en `/login` (pestaña junto a "Correo y contraseña"): la clienta solo escribe su celular, sin contraseña ni código — pensado para que cualquier clienta que la admin registre en `/admin/clientes` (donde ya solo nombre, apellido y celular son obligatorios) pueda entrar de inmediato. El código (`app/(public)/login/actions.ts` → `phoneLoginAction`) ya está escrito, ya pasó `typecheck` y ya se probó de punta a punta contra Supabase real (creando y borrando una clienta de prueba) — **pero falló con el error `Phone logins are disabled`**: el proyecto de Supabase tiene el proveedor de teléfono apagado a nivel de Auth, así que ningún inicio de sesión por celular funciona todavía (ni el nuevo, ni el que ya existía por celular+contraseña en la otra pestaña).

**Para desbloquearlo:** entra al dashboard de Supabase → tu proyecto → **Authentication → Sign In / Providers → Phone** → actívalo. No se envía ningún SMS real (las cuentas se crean con `phone_confirm: true` desde el panel admin, y el login pasa por un password temporal generado en el servidor, invisible para la clienta), así que no debería requerir configurar un proveedor de SMS de verdad para que esto funcione — pero si el dashboard de Supabase no te deja guardar el toggle sin elegir un proveedor de SMS (Twilio, etc.), avísame y lo resolvemos juntos (hay opciones gratuitas). Una vez activado, pruebo de nuevo con una clienta real y confirmo que quede funcionando.

**Nota de seguridad, para que la decisión sea informada:** este modo es intencionalmente débil — quien conozca el celular de una clienta puede entrar a su cuenta (ver su historial de pedidos, dirección, etc.), sin ninguna otra verificación. Se implementó así porque fue lo que pediste explícitamente ("con poner su celular basta, sin factor de autenticación"); la pestaña de correo+contraseña sigue disponible para quien prefiera más seguridad. Las cuentas de administradoras (`admin_users`) están excluidas de este modo aunque compartan la misma tabla de autenticación — ese acceso siempre exige correo+contraseña.

### 1. Copiar las variables de entorno a Vercel (3 de 8 ya confirmadas)

Las 3 de Supabase ya están funcionando en producción — se comprobó al loguearse en `/admin` y ver datos reales. **Faltan confirmar las otras 5** (Telegram, sync, cifrado de devoluciones). Todas ya tienen valor real en tu `.env` local — **Vercel no las lee de ahí, hay que copiarlas a mano** (o por CLI) en el proyecto de Vercel:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME
TELEGRAM_WEBHOOK_SECRET
SYNC_CRON_SECRET
REFUND_ENCRYPTION_KEY
```

**Cuáles marcar como "Sensitive" (el checkbox de Vercel, no existe un tipo "secret" separado):**

| Variable | ¿Sensitive? | Por qué |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No | `NEXT_PUBLIC_*` se inyecta en el JS del navegador al compilar — ya es pública por diseño, marcarla Sensitive no la oculta. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | No | Mismo caso — es la llave anon de Supabase, protegida por RLS en la base, no por estar oculta. |
| `TELEGRAM_BOT_USERNAME` | No | Es público — es el `@LuxuryFindsMx_bot` que cualquiera busca en Telegram. |
| `SUPABASE_SECRET_KEY` | **Sí** | Salta RLS por completo, acceso total a la base. |
| `TELEGRAM_BOT_TOKEN` | **Sí** | Controla el bot por completo. |
| `TELEGRAM_WEBHOOK_SECRET` | **Sí** | Verifica que los mensajes al webhook vengan de Telegram. |
| `SYNC_CRON_SECRET` | **Sí** | Protege el endpoint de sincronización. |
| `REFUND_ENCRYPTION_KEY` | **Sí** | Descifra CLABEs bancarias reales de clientas — la más delicada. |

Marcarla Sensitive solo oculta el valor en el dashboard después de guardarlo (ya no se puede volver a ver, solo sobrescribir); el código del servidor la sigue leyendo igual vía `process.env`.

**Cómo agregarlas (dashboard, la forma más simple):**
1. Entra a [vercel.com](https://vercel.com) → tu proyecto (Luxury Finds / appluxury2).
2. **Settings → Environment Variables**.
3. Por cada variable de la lista: pega el **Name** (ej. `TELEGRAM_BOT_TOKEN`) y el **Value** (cópialo tal cual de tu `.env` local, sin comillas), marca los 3 entornos (**Production**, **Preview**, **Development**) salvo que quieras separarlos, y dale **Save**.
4. Repite para las 8. Puedes pegar varias a la vez si usas el botón "Import .env" / "Paste .env" que Vercel ofrece en esa misma pantalla — subes tu archivo `.env` completo y las crea todas de un jalón (revisa que no se cuele nada que no deba ir ahí).
5. Cuando termines, hace falta un **nuevo deploy** (push a la rama, o "Redeploy" desde el dashboard) para que la app tome las variables — cambiarlas no reinicia un deploy ya corriendo.

**Alternativa por terminal (Vercel CLI), si ya tienes el proyecto vinculado:**
```bash
vercel env add TELEGRAM_BOT_TOKEN production
```
Te pide el valor por prompt; repite por cada variable y por cada entorno donde la necesites (`production`, `preview`, `development`).

⚠️ Sin este paso, el bot de Telegram, la sincronización de catálogo y Devoluciones van a fallar en producción aunque en tu máquina funcionen — el código lee `process.env`, y en Vercel ese `process.env` es el que configures en el dashboard, no tu archivo local.

### 2. Registrar el webhook de Telegram (solo funciona con el sitio ya desplegado, no en localhost)

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<tu-dominio>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

El bot ya existe: `@LuxuryFindsMx_bot`. Hasta que no se registre el webhook, los clientes pueden vincular su Telegram (`/start <id>`) pero el bot no recibirá esos mensajes.

### 3. Cron de sincronización — hoy corre 1 vez al día, no cada 15 min

`vercel.json` quedó así (el `functions` y el `*/15 * * * *` originales tumbaban el deploy, ver arriba):
```json
{
  "crons": [{ "path": "/api/sync/run?type=INCREMENTAL&source=all", "schedule": "0 9 * * *" }]
}
```

**El plan gratuito (Hobby) de Vercel solo ejecuta cron jobs una vez al día** — Vercel directamente rechaza el deploy si declaras algo más frecuente, no lo ignora en silencio. Para los 15 minutos reales que pedía el diseño original necesitas:
- Plan **Pro** de Vercel, o
- Un programador externo (cron-job.org, GitHub Actions con `schedule`, Supabase `pg_cron` con `net.http_post`, etc.) golpeando `POST /api/sync/run?type=INCREMENTAL&source=all` con el header `x-sync-secret: <SYNC_CRON_SECRET>` cada 15 min.

El endpoint ya está protegido y probado (401 si falta/está mal el secreto, con GET y POST). Nota aparte: como se quitó el bloque `functions`, la duración máxima de esa función usa el default de Vercel en vez de los 60s que se habían pedido — si una corrida completa de sincronización tarda más que eso y se corta, hay que resolverlo por el lado de la configuración de `nitro` (su propio preset de Vercel), no repitiendo el bloque `functions` en `vercel.json`.

---

## ✅ Lo que ya está construido y funcionando

### 1. Rediseño del panel de administración (estilo Tiendanube)
- Sidebar blanco ~300px con navegación agrupada, estado activo real por ruta, drawer mobile funcional.
- Topbar rediseñada: buscador que **sí busca de verdad** (navega a `?q=` en clientas/productos/inventario/proveedores), "Ayuda" enlaza a `/admin/ayuda`, "Notificaciones" abre un diálogo honesto que dice que aún no existe (no es un botón decorativo mudo).
- Paleta terracota `#9C5651` + variables `--terracotta*`/`--admin-*` en `app/globals.css`.
- Archivos clave: `app/admin/layout.tsx`, `components/navigation/AdminSidebar.tsx`, `components/navigation/AdminTopbar.tsx`.

### 2. Carrito de compra público + registro + checkout + Telegram
- Carrito 100% client-side (`localStorage`, `lib/cart/CartContext.tsx`), **no requiere cuenta para acumular productos**.
- Ícono de carrito con badge en `components/navigation/PublicHeader.tsx`, página `/carrito`.
- "Añadir al carrito" en catálogo (`components/ui/ProductCard.tsx`) y en detalle de producto (`app/(public)/catalogo/[slug]/AddToCartForm.tsx`).
- Registro de cuenta nuevo: `app/(public)/crear-cuenta/` (nombre, apellido, teléfono, correo, contraseña) — crea usuario de Supabase Auth + fila en `clients` vía service role, inicia sesión automáticamente.
- Checkout gateado por sesión (`app/(public)/checkout/`): si no hay sesión, redirige a `/login?next=/checkout` (con link a "Crea una cuenta"). Al confirmar, **revalida precios reales en el servidor** (nunca confía en lo que mande el navegador) y crea `orders`/`order_items` reales en Supabase.
- **Plan de pago semanal en el checkout** (requiere migración `004`, ver arriba): si **todos** los productos del carrito tienen el flag "Admite plan de pago semanal" activado en Productos, aparece un selector "Pago completo" / "Plan semanal" con número de semanas (4 a 16). La elegibilidad se revalida siempre en el servidor (`lib/supabase/orders.ts` → `checkWeeklyPlanEligibility`), nunca se confía en lo que mande el navegador. Si el carrito mezcla productos elegibles y no elegibles, solo se ofrece pago completo (no se parte el pedido en dos).
- Confirmación por Telegram al cliente: `lib/telegram/send.ts` + webhook `app/api/telegram/webhook/route.ts` que vincula el `chat_id` cuando el cliente hace `/start <id>` en el bot. Card de vinculación visible en `/cuenta` y tras confirmar un pedido.

### 3. Sistema administrativo completo — Fase 1 (de 4 fases planeadas)
Construido y probado (`typecheck`/`lint`/`build` limpios):
- **Categorías** (`/admin/categorias`) — CRUD completo sobre `categories`.
- **Productos** (`/admin/productos`) — 3 tipos (básico/variantes/medidas), imágenes, categoría inline, switch de catálogo público, switch "Admite plan de pago semanal" (requiere migración `004`; si no está aplicada, el producto se guarda igual y solo ese campo se ignora con un aviso), validaciones.
- **Inventario** (`/admin/inventario`) — KPIs, buscador, filtros, paginación real, acciones con confirmación.
- **Clientes** (`/admin/clientes`) — reutiliza `clients` existente (no duplica), historial de compras derivado.
- **Proveedores** (`/admin/proveedores`) — tabla nueva `suppliers`, CRUD.
- **Vender** (`/admin/vender`, `SellTerminal.tsx`) — punto de venta completo: buscador, código de barras/SKU, carrito con cantidades, "Nueva venta libre", "Nuevo gasto", **apertura/cierre de caja real** (no placeholder), descuenta stock vía `inventory_movements` con rollback si algo falla. **Cancelar venta**: desde `/admin/balance`, un botón "Cancelar" por cada venta libera el inventario que había descontado (`sales.status`/`cancelled_at` existían en el schema sin usarse).

**Fase 2 — construida en esta ronda (además de lo de la ronda anterior):**
- **Pedidos** (`/admin/pedidos`) — lista los pedidos reales creados desde el carrito público o desde el panel. Cada pedido se puede **confirmar** (genera un `ticket` por artículo — `FULL` o `WEEKLY_PLAN` — valida existencia vía `variant_stock` y descuenta inventario) o **cancelar** (libera inventario y cancela su `payment_plan` si tenía uno).
  - **`/admin/pedidos/nuevo`**: crear un pedido manual (WhatsApp/teléfono/en persona) eligiendo clienta, productos y modalidad de pago — el equivalente del checkout público pero desde el panel (`origin = ADMIN_MANUAL`).
  - **Plan semanal** (requiere migración `004`): confirmar un pedido con plan semanal genera el `payment_plan` (4-16 semanas) y sus `installments`.
- **Cobranza** (`/admin/cobranza`) — ya no es un placeholder. Las clientas ya podían subir comprobantes de pago desde `/cuenta` (`app/cuenta/payment-proof-actions.ts`, construido en una sesión anterior a esta) pero nada del lado admin revisaba esos comprobantes hasta ahora. Aquí se **aprueban o rechazan**: aprobar registra un `payment`, reparte el monto entre las cuotas más antiguas del `payment_plan` (o marca pagado directo si el ticket es `FULL`), y si sobra dinero después de pagar todas las cuotas, el excedente se guarda como saldo a favor en `clients.credit_balance_cents`. Ambas acciones avisan a la clienta por Telegram y en su campanita de notificaciones (`notifications`, ya usada por `/cuenta`).
- **Por ordenar** (`/admin/por-ordenar`) y **En camino** (`/admin/en-camino`) — bandejas de tickets por `logistics_status` (`WAITING_TO_ORDER`/`READY_TO_ORDER` y `ORDERED`/`IN_TRANSIT`/`RECEIVED_LA_PAZ`). Un botón "Actualizar estado" avanza el ticket y notifica a la clienta; puedes anotar tienda/folio de compra (se guarda en `order_items.notes`, que no tenía otro uso).
- **Agenda de entregas** (`/admin/agenda`) — publica una disponibilidad por ubicación y fecha/hora, y **genera automáticamente los horarios de 10 minutos** que exige el schema (`delivery_slots`). Puedes reservar un ticket `READY_FOR_DELIVERY` en un horario, marcar la entrega completada (el ticket pasa a `DELIVERED`) o cancelarla (el ticket vuelve a `READY_FOR_DELIVERY` para reagendar). Las clientas todavía no tienen una pantalla propia para autoagendar — hoy todo lo agenda la admin a mano, igual que un pedido manual.
- **Devoluciones** (`/admin/devoluciones`) — las clientas piden un reembolso desde `/cuenta` (nuevo formulario: banco, titular, CLABE, motivo — la CLABE se cifra antes de guardarse, ver `REFUND_ENCRYPTION_KEY` arriba). Desde el panel se marca "en proceso", se **completa** (registra el `refund` con monto/método/referencia una vez que ya hiciste la transferencia real desde tu banco, y marca el ticket `REFUNDED`) o se **rechaza**. ⚠️ **Esta pieza específica no se probó contra una base de datos real** (no tengo credenciales de admin ni acceso a Supabase) — el formato `bytea`/hex que usa Postgres para `clabe_encrypted` está implementado según la documentación de PostgREST, pero antes de confiarle CLABEs reales de clientas, haz una prueba de extremo a extremo: pide un reembolso de prueba, ve a `/admin/devoluciones` y confirma que la CLABE se vea correcta y completa.

**Placeholders honestos** ("Próximamente", no botones muertos) que siguen pendientes — no se tocaron en esta ronda a propósito (Facturación sigue fuera de alcance porque necesita un PAC certificado por el SAT; los demás no se priorizaron esta vez):
- Fase 2: Cotizaciones, Empleados.
- Fase 3: Estadísticas, Reportes.
- Fase 4: Facturación, Facturación global, Reportería (facturación electrónica — fuera de alcance deliberadamente).
- Multi-negocio: la base de datos ya guarda `business_id` en todo, pero "Agregar otro negocio" abre un diálogo honesto; falta la pantalla real de crear/cambiar de negocio.

### 4. Sincronización de catálogo — Maw Maw Beauty + Oskin → Luxury Finds
Código completo, **probado con una corrida real en modo simulado (dry-run) contra el catálogo real de Supabase** (sin escribir nada porque faltan las migraciones 002/003):

| | Maw Maw | Oskin |
|---|---|---|
| Productos detectados | 2,167 | 3,506 |
| Ya coincidían con Luxury Finds | 448 | 3,413 |
| Nuevos que se crearían | 1,533 | 88 |
| Precios que subirían | 466 | 63 |
| En cola de revisión (coincidencia dudosa) | 186 | 5 |
| Errores | 0 | 0 |

- **Limpieza puntual de datos (ya aplicada, no requiere acción)**: 1,687 filas (`products.name`/`description`/`relevant_information`, `product_variants.name`, `brands.name`) tenían entidades HTML sin decodificar (`&amp;`, `&#8211;`, etc.) — venían de una carga de catálogo anterior a este pipeline de sync, que ya decodifica entidades correctamente (`lib/sync/normalize.ts` → `decodeEntities`/`cleanProductName`/`stripHtml`). Se corrigieron directamente en Supabase con un script puntual (no versionado, ya no existe) que solo decodificó texto — ninguna otra columna se tocó. No hace falta volver a correrlo.
- Ninguna tienda necesitó Playwright: Oskin (WooCommerce) expone su Store API pública (`/wp-json/wc/store/v1/products`); Maw Maw (Tiendanube) imprime las variantes completas en el HTML del listado.
- `fetch` nativo de Node no puede hablar con `oskinmx.com` (rechaza la renegociación TLS) — `lib/sync/http.ts` usa `node:https` como respaldo automático.
- Regla de precio verificada en ambas direcciones con ejemplos reales: sube cuando una fuente tiene precio mayor, **nunca baja** aunque el competidor/aliado baje el suyo. Precio máximo aplicado **por variante**, no por producto genérico.
- Panel admin: `/admin/inventario/sincronizacion` — estado de cada fuente, botón "Sincronizar ahora", resumen de última corrida, comparador de precio por producto, cola de "Revisar coincidencias".
- Endpoint protegido: `app/api/sync/run/route.ts` (header `x-sync-secret`).

---

## ⚠️ Cosas a tener en cuenta / deuda conocida

1. **Login y dashboard del admin ya se probaron con sesión real en producción** (ver arriba), pero eso solo confirma que el panel carga — **los flujos operativos de verdad siguen sin probarse**: crear venta, cerrar caja, sincronizar catálogo, confirmar/cancelar un pedido, plan semanal de punta a punta, aprobar un comprobante en Cobranza, agendar una entrega, procesar una devolución. Sigue siendo la deuda más grande — ahora que ya puedes entrar a `/admin`, es el siguiente paso lógico (ver "Orden sugerido" abajo).
2. **Error de dev-server intermitente y preexistente** (no relacionado con este trabajo): a veces aparece un overlay rojo `"Cannot read properties of undefined (reading 'import')"` desde `@vitejs/plugin-rsc` al correr `npm run dev`. Es un bug conocido del stack `vinext`/`vite-rsc` en beta; normalmente se resuelve recargando la página y no aparece en `npm run build` de producción. En esta sesión llegó a quedarse pegado incluso recargando — si te pasa, cierra el proceso de `npm run dev` (o la terminal donde corre) y vuelve a arrancarlo.
3. **Imágenes copiadas de Maw Maw/Oskin**: aunque ambas tiendas son tuyas/aliadas, revisa que tengas derecho a usar esas imágenes en Luxury Finds antes de publicarlas masivamente (mismo criterio que ya aplicó el pipeline previo de Oskin en `C:\Users\rutil\Desktop\oskin_luxury_finds_pipeline\`).
4. **Empleados** hoy no tiene perfiles propios ni permisos — cada venta/gasto se registra a nombre del usuario de `admin_users` que la captura. Sigue en Fase 2, no se construyó esta ronda (decidiste priorizar Cobranza/Agenda/Devoluciones). Cuando lo retomes: la idea acordada es que un empleado normal solo pueda usar Vender y ver Inventario, sin acceso a Balance ni Configuración — habría que agregar un rol/permiso a `admin_users` (hoy todos los admins tienen el mismo acceso completo).
5. **Devoluciones no probada contra Supabase real** — ver el punto en la sección de arriba sobre `REFUND_ENCRYPTION_KEY`. El cifrado en sí (`lib/crypto.ts`, AES-256-GCM con Node `crypto`) es estándar y confiable; lo que no pude verificar es el formato exacto en que PostgREST espera/devuelve una columna `bytea` en JSON. Prueba de punta a punta antes de usarla con datos bancarios reales.
6. **Agenda no tiene autoagendado para clientas** — hoy toda cita se crea desde el panel (`/admin/agenda`), a mano. Las tablas (`delivery_locations`, `delivery_slots`, RLS de solo lectura para clientes autenticados) ya están listas para que en el futuro una clienta reserve su propio horario desde `/cuenta`, pero esa pantalla no existe todavía.
7. ~~4 errores de lint preexistentes~~ — corregidos en una sesión anterior (`no-html-link-for-pages` en catálogo, `no-autofocus` en `PublicHeader`). `npm run lint` sigue en 0 errores (solo 12 warnings de `<img>` sin optimizar, fuera de alcance).
8. Recurso de referencia si necesitas re-scrapear Oskin manualmente: `C:\Users\rutil\Desktop\oskin_luxury_finds_pipeline\` (pipeline Playwright independiente, con su propio `README.md`).

---

## Resumen de rutas nuevas en `/admin`

```
/admin/vender                      ← Punto de venta (completo) + cancelar venta desde Balance
/admin/balance                     ← Balance, transacciones (con "Cancelar" por venta), cierres de caja (completo)
/admin/inventario                  ← Listado + KPIs + "Ajustar stock" (entradas/ajustes manuales) (completo)
/admin/inventario/sincronizacion   ← Sincronización Maw Maw/Oskin (completo, dry-run hasta migrar)
/admin/productos                   ← CRUD productos + switch de plan semanal (completo)
/admin/categorias                  ← CRUD categorías (completo)
/admin/clientes                    ← CRUD clientes (completo)
/admin/proveedores                 ← CRUD proveedores (completo)
/admin/pedidos                     ← Lista, confirma, cancela (completo)
/admin/pedidos/nuevo               ← Pedido manual desde el panel (completo)
/admin/cobranza                    ← Aprobar/rechazar comprobantes de pago (completo)
/admin/por-ordenar                 ← Tickets WAITING_TO_ORDER/READY_TO_ORDER (completo)
/admin/en-camino                   ← Tickets ORDERED/IN_TRANSIT/RECEIVED_LA_PAZ (completo)
/admin/agenda                      ← Disponibilidad, horarios de 10 min, reservar/completar/cancelar entregas (completo)
/admin/devoluciones                ← Revisar y procesar solicitudes de reembolso (completo, sin probar en vivo — ver deuda conocida)
/admin/configuracion                ← (completo, solo lectura por diseño)
/admin/ayuda                        ← (completo)
/admin/{cotizaciones,empleados,estadisticas,reportes,facturacion,
        facturacion/global,facturacion/reporteria,sitio-web}  ← Placeholders "Próximamente"
```

---

## Orden sugerido para la próxima sesión

1. ~~Correr las 4 migraciones y generar `REFUND_ENCRYPTION_KEY`~~ — ya hecho y verificado contra la base real.
1b. ~~Arreglar que `main` estuviera desactualizado y que el deploy de Vercel fallara~~ — ya hecho, PR #3 fusionado, producción al día en `https://luxuryfinds.vercel.app`.
1c. ~~Crear una cuenta de administradora y confirmar que el login + `/admin` funcionan en producción~~ — ya hecho, ver credenciales arriba.
2. Con esa misma cuenta, probar el flujo operativo completo: crear categoría → crear producto (prueba también marcar "Admite plan de pago semanal") → verlo en inventario/vender → abrir caja → hacer una venta → ver que baja el stock y sube en Balance → cerrar caja → probar "Cancelar" esa venta y ver que el stock regrese.
3. Probar Pedidos + Cobranza de punta a punta: agregar al carrito un producto con plan semanal activado → checkout con "Plan semanal" → confirmar el pedido en `/admin/pedidos` (o crear uno manual en `/admin/pedidos/nuevo`) → verificar que se generen los tickets, el `payment_plan` y sus cuotas → subir un comprobante desde `/cuenta` con esa clienta → aprobarlo en `/admin/cobranza` → confirmar que la cuota quede pagada y el ticket avance.
4. Probar la logística: mover un ticket por `/admin/por-ordenar` → `/admin/en-camino` → márcalo `READY_FOR_DELIVERY` → publicar una disponibilidad en `/admin/agenda` → reservarlo → completarlo, y ver que llegue el aviso de Telegram en cada paso.
5. Probar Devoluciones con una CLABE de prueba (no una real todavía) para validar que el cifrado/descifrado funcione antes de confiarle datos bancarios reales — ver la nota de deuda conocida.
6. Ir a `/admin/inventario/sincronizacion` y correr "Sincronizar ahora" — ya no debería estar en modo simulado.
7. Desplegar a Vercel: copiar las 8 variables de entorno (dashboard → Settings → Environment Variables, o "Import .env"), redeploy, registrar el webhook de Telegram, y decidir cómo resolver el cron de 15 min (Pro de Vercel vs. programador externo).
8. Seguir con lo que falta de Fase 2 (Cotizaciones, Empleados) y luego Fase 3 (Estadísticas, Reportes) cuando quieras continuar el sistema administrativo. Facturación sigue fuera de alcance hasta que contrates un PAC certificado por el SAT.
