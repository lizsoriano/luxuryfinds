# Luxury Finds — Estado del proyecto y pendientes

Proyecto: `C:\Users\rutil\Desktop\appluxury2` (repo `lizsoriano/luxuryfinds`, rama `main`).
App Next-like sobre `vinext`/`vite` + React Server Components, backend Supabase (schema `luxury_finds`), sin Tailwind (CSS plano en `app/globals.css`).

Este documento resume lo que ya está construido y, sobre todo, **lo que falta para que funcione con datos reales**. Está escrito para que otra IA (o tú) pueda retomarlo sin tener que releer todo el proyecto desde cero.

---

## 🔴 ACCIÓN INMEDIATA — nada de esto sirve sin esto

### 1. Correr 3 migraciones SQL pendientes (en este orden, en el SQL editor de Supabase)

Ya corriste `000_fix_clients_service_role_grant.sql` y `001_telegram_linking.sql`. **Faltan:**

```
database/migrations/002_business_management.sql
database/migrations/003_product_sources_sync.sql
database/migrations/004_weekly_plan_checkout.sql
```

Sin `002`: **Vender, Balance, Proveedores e Inventario fallan** (crea `businesses`, `suppliers`, `cash_sessions`, `sales`, `sale_items`, `expenses`, la vista `variant_stock`, columnas nuevas en `products`/`product_variants`: `product_kind`, `internal_code`, `tax_rate_percent`, `cost_cents`, `min_quantity`, `barcode`, `unit_label`; `sale_id` en `inventory_movements`; RLS y bucket de comprobantes).

Sin `003`: **la sincronización de catálogo (Maw Maw/Oskin) no escribe nada** — corre en modo simulado y avisa qué migración falta en vez de fallar (crea `product_sources`, `sync_runs`, `price_change_log`, `product_match_reviews`).

Sin `004`: **nadie puede pedir plan semanal** — el checkbox "Admite plan de pago semanal" en Productos y el selector de modalidad en el checkout público existen en el código pero se degradan a comportamiento normal (pago de contado) sin fallar, porque las columnas nuevas (`products.weekly_plan_eligible`, `orders.requested_payment_mode`, `orders.requested_number_of_weeks`) no existen todavía. En cuanto corras la migración, ambas cosas funcionan solas, sin volver a tocar código.

Ninguna de las tres toca `database/schema.sql` original ni borra nada existente.

### 2. Variables de entorno — ya están en `.env`, verifica que se repliquen en producción (Vercel)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
SYNC_CRON_SECRET=
```

Todas tienen valor real en `.env` local. **Al desplegar a Vercel, cópialas en Project Settings → Environment Variables** — si no, el bot de Telegram y el cron de sincronización no van a funcionar en producción aunque el código esté listo.

**Nueva variable que falta generar: `REFUND_ENCRYPTION_KEY`.** Sin ella, Devoluciones (`/admin/devoluciones`) no puede cifrar ni descifrar la CLABE que la clienta captura al pedir un reembolso (`lib/crypto.ts`). Genera un valor y agrégalo a `.env` y a Vercel:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Debe ser una cadena hexadecimal de 64 caracteres. **Nunca reutilices `SUPABASE_SECRET_KEY` ni ningún otro secreto para esto** — es la única llave que puede descifrar cuentas bancarias reales de clientas, trátala igual de en serio.

### 3. Registrar el webhook de Telegram (solo funciona con el sitio ya desplegado, no en localhost)

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<tu-dominio>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

El bot ya existe: `@LuxuryFindsMx_bot`. Hasta que no se registre el webhook, los clientes pueden vincular su Telegram (`/start <id>`) pero el bot no recibirá esos mensajes.

### 4. Cron de sincronización cada 15 min — límite de plan de Vercel

`vercel.json` ya declara:
```json
{
  "crons": [{ "path": "/api/sync/run?type=INCREMENTAL&source=all", "schedule": "*/15 * * * *" }],
  "functions": { "app/api/sync/run/route.ts": { "maxDuration": 60 } }
}
```

**El plan gratuito (Hobby) de Vercel solo ejecuta cron jobs una vez al día**, sin importar el schedule declarado. Para los 15 minutos reales necesitas:
- Plan **Pro** de Vercel, o
- Un programador externo (cron-job.org, GitHub Actions con `schedule`, Supabase `pg_cron` con `net.http_post`, etc.) golpeando `POST /api/sync/run?type=INCREMENTAL&source=all` con el header `x-sync-secret: <SYNC_CRON_SECRET>` cada 15 min.

El endpoint ya está protegido y probado (401 si falta/está mal el secreto, con GET y POST).

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

1. **Nadie ha probado los flujos reales con sesión de administradora real** (crear venta, cerrar caja, sincronizar catálogo, confirmar/cancelar un pedido, plan semanal de punta a punta, aprobar un comprobante en Cobranza, agendar una entrega, procesar una devolución) — todo se verificó con `build`/`typecheck`/`lint` y, cuando fue posible, navegación sin sesión (redirects correctos a `/login`). Hace falta un pase manual tuyo logueada como admin — es la deuda más grande del proyecto en este momento, cubre literalmente todo lo construido en las últimas dos rondas.
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

1. Correr `002_business_management.sql`, `003_product_sources_sync.sql` y `004_weekly_plan_checkout.sql` en Supabase, y generar/agregar `REFUND_ENCRYPTION_KEY` (ver arriba) a `.env` y Vercel.
2. Loguearte como admin y probar el flujo completo: crear categoría → crear producto (prueba también marcar "Admite plan de pago semanal") → verlo en inventario/vender → abrir caja → hacer una venta → ver que baja el stock y sube en Balance → cerrar caja → probar "Cancelar" esa venta y ver que el stock regrese.
3. Probar Pedidos + Cobranza de punta a punta: agregar al carrito un producto con plan semanal activado → checkout con "Plan semanal" → confirmar el pedido en `/admin/pedidos` (o crear uno manual en `/admin/pedidos/nuevo`) → verificar que se generen los tickets, el `payment_plan` y sus cuotas → subir un comprobante desde `/cuenta` con esa clienta → aprobarlo en `/admin/cobranza` → confirmar que la cuota quede pagada y el ticket avance.
4. Probar la logística: mover un ticket por `/admin/por-ordenar` → `/admin/en-camino` → márcalo `READY_FOR_DELIVERY` → publicar una disponibilidad en `/admin/agenda` → reservarlo → completarlo, y ver que llegue el aviso de Telegram en cada paso.
5. Probar Devoluciones con una CLABE de prueba (no una real todavía) para validar que el cifrado/descifrado funcione antes de confiarle datos bancarios reales — ver la nota de deuda conocida.
6. Ir a `/admin/inventario/sincronizacion` y correr "Sincronizar ahora" — ya no debería estar en modo simulado.
7. Desplegar a Vercel con las variables de entorno de `.env` copiadas, registrar el webhook de Telegram, y decidir cómo resolver el cron de 15 min (Pro de Vercel vs. programador externo).
8. Seguir con lo que falta de Fase 2 (Cotizaciones, Empleados) y luego Fase 3 (Estadísticas, Reportes) cuando quieras continuar el sistema administrativo. Facturación sigue fuera de alcance hasta que contrates un PAC certificado por el SAT.
