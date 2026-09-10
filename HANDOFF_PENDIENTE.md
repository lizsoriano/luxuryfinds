# Luxury Finds — Estado del proyecto y pendientes

Proyecto: `C:\Users\rutil\Desktop\appluxury2` (repo `lizsoriano/luxuryfinds`, rama `main`).
App Next-like sobre `vinext`/`vite` + React Server Components, backend Supabase (schema `luxury_finds`), sin Tailwind (CSS plano en `app/globals.css`).

Este documento resume lo que ya está construido y, sobre todo, **lo que falta para que funcione con datos reales**. Está escrito para que otra IA (o tú) pueda retomarlo sin tener que releer todo el proyecto desde cero.

---

## 🔴 ACCIÓN INMEDIATA — nada de esto sirve sin esto

### 1. Correr 2 migraciones SQL pendientes (en este orden, en el SQL editor de Supabase)

Ya corriste `000_fix_clients_service_role_grant.sql` y `001_telegram_linking.sql`. **Faltan:**

```
database/migrations/002_business_management.sql
database/migrations/003_product_sources_sync.sql
```

Sin `002`: **Vender, Balance, Proveedores e Inventario fallan** (crea `businesses`, `suppliers`, `cash_sessions`, `sales`, `sale_items`, `expenses`, la vista `variant_stock`, columnas nuevas en `products`/`product_variants`: `product_kind`, `internal_code`, `tax_rate_percent`, `cost_cents`, `min_quantity`, `barcode`, `unit_label`; `sale_id` en `inventory_movements`; RLS y bucket de comprobantes).

Sin `003`: **la sincronización de catálogo (Maw Maw/Oskin) no escribe nada** — corre en modo simulado y avisa qué migración falta en vez de fallar (crea `product_sources`, `sync_runs`, `price_change_log`, `product_match_reviews`).

Ninguna de las dos toca `database/schema.sql` original ni borra nada existente.

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
- Confirmación por Telegram al cliente: `lib/telegram/send.ts` + webhook `app/api/telegram/webhook/route.ts` que vincula el `chat_id` cuando el cliente hace `/start <id>` en el bot. Card de vinculación visible en `/cuenta` y tras confirmar un pedido.

### 3. Sistema administrativo completo — Fase 1 (de 4 fases planeadas)
Construido y probado (`typecheck`/`lint`/`build` limpios):
- **Categorías** (`/admin/categorias`) — CRUD completo sobre `categories`.
- **Productos** (`/admin/productos`) — 3 tipos (básico/variantes/medidas), imágenes, categoría inline, switch de catálogo público, validaciones.
- **Inventario** (`/admin/inventario`) — KPIs, buscador, filtros, paginación real, acciones con confirmación.
- **Clientes** (`/admin/clientes`) — reutiliza `clients` existente (no duplica), historial de compras derivado.
- **Proveedores** (`/admin/proveedores`) — tabla nueva `suppliers`, CRUD.
- **Vender** (`/admin/vender`, `SellTerminal.tsx`) — punto de venta completo: buscador, código de barras/SKU, carrito con cantidades, "Nueva venta libre", "Nuevo gasto", **apertura/cierre de caja real** (no placeholder), descuenta stock vía `inventory_movements` con rollback si algo falla.
- **Balance** (`/admin/balance`) — KPIs (Balance/Ventas/Gastos), transacciones, cierres de caja, filtros por fecha.

**Fase 2 — en progreso:**
- **Pedidos** (`/admin/pedidos`) — ya no es un placeholder. Lista los pedidos reales creados desde el carrito público (tabla `orders`/`order_items`, que ya existe en `database/schema.sql` base, sin depender de las migraciones 002/003). Cada pedido se puede **confirmar** (genera un `ticket` FULL por artículo, valida existencia vía `variant_stock` y descuenta inventario con `inventory_movements`) o **cancelar** (si ya tenía tickets, los marca `CANCELLED_INCIDENT` y libera el inventario reservado). No incluye: registrar pedidos manuales desde el panel, ni planes de pago semanales/apartado (el checkout público solo genera pagos de contado, así que no hay UI todavía para elegir esas modalidades).

**Placeholders honestos** ("Próximamente", no botones muertos) para fases futuras:
- Fase 2: Por ordenar, En camino, Agenda, Cobranza, Devoluciones, Cotizaciones, Empleados.
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

- Ninguna tienda necesitó Playwright: Oskin (WooCommerce) expone su Store API pública (`/wp-json/wc/store/v1/products`); Maw Maw (Tiendanube) imprime las variantes completas en el HTML del listado.
- `fetch` nativo de Node no puede hablar con `oskinmx.com` (rechaza la renegociación TLS) — `lib/sync/http.ts` usa `node:https` como respaldo automático.
- Regla de precio verificada en ambas direcciones con ejemplos reales: sube cuando una fuente tiene precio mayor, **nunca baja** aunque el competidor/aliado baje el suyo. Precio máximo aplicado **por variante**, no por producto genérico.
- Panel admin: `/admin/inventario/sincronizacion` — estado de cada fuente, botón "Sincronizar ahora", resumen de última corrida, comparador de precio por producto, cola de "Revisar coincidencias".
- Endpoint protegido: `app/api/sync/run/route.ts` (header `x-sync-secret`).

---

## ⚠️ Cosas a tener en cuenta / deuda conocida

1. **Nadie ha probado los flujos reales con sesión de administradora real** (crear venta, cerrar caja, sincronizar catálogo) — todos los agentes verificaron con `build`/`typecheck`/`lint` y, cuando pudieron, navegación sin sesión (redirects 307 correctos a `/login`). Hace falta un pase manual tuyo logueada como admin.
2. **Error de dev-server intermitente y preexistente** (no relacionado con este trabajo): a veces aparece un overlay rojo `"Cannot read properties of undefined (reading 'import')"` desde `@vitejs/plugin-rsc` al correr `npm run dev`. Es un bug conocido del stack `vinext`/`vite-rsc` en beta, no bloquea el renderizado real y no aparece en `npm run build` de producción. Ver conversación previa — se investigó a fondo, no tiene una solución limpia todavía en la versión actual de esas dependencias.
3. **Imágenes copiadas de Maw Maw/Oskin**: aunque ambas tiendas son tuyas/aliadas, revisa que tengas derecho a usar esas imágenes en Luxury Finds antes de publicarlas masivamente (mismo criterio que ya aplicó el pipeline previo de Oskin en `C:\Users\rutil\Desktop\oskin_luxury_finds_pipeline\`).
4. **Empleados** hoy no tiene perfiles propios ni permisos — cada venta/gasto se registra a nombre del usuario de `admin_users` que la captura. Está listado como Fase 2.
5. **4 errores de lint preexistentes**, no de este trabajo, en `app/(public)/catalogo/page.tsx`, `app/(public)/catalogo/[slug]/page.tsx` y `components/navigation/PublicHeader.tsx` (`no-html-link-for-pages` / `no-autofocus`) — quedaron fuera del alcance de los agentes porque pertenecían a otra tarea ya cerrada (el carrito). Vale la pena limpiarlos en algún momento.
6. Recurso de referencia si necesitas re-scrapear Oskin manualmente: `C:\Users\rutil\Desktop\oskin_luxury_finds_pipeline\` (pipeline Playwright independiente, con su propio `README.md`).

---

## Resumen de rutas nuevas en `/admin`

```
/admin/vender                      ← Punto de venta (completo)
/admin/balance                     ← Balance, transacciones, cierres de caja (completo)
/admin/inventario                  ← Listado + KPIs (completo)
/admin/inventario/sincronizacion   ← Sincronización Maw Maw/Oskin (completo, dry-run hasta migrar)
/admin/productos                   ← CRUD productos (completo)
/admin/categorias                  ← CRUD categorías (completo)
/admin/clientes                    ← CRUD clientes (completo)
/admin/proveedores                 ← CRUD proveedores (completo)
/admin/configuracion                ← (completo)
/admin/ayuda                        ← (completo)
/admin/{pedidos,por-ordenar,en-camino,agenda,cobranza,devoluciones,
        cotizaciones,empleados,estadisticas,reportes,facturacion,
        facturacion/global,facturacion/reporteria,sitio-web}  ← Placeholders "Próximamente"
```

---

## Orden sugerido para la próxima sesión

1. Correr `002_business_management.sql` y `003_product_sources_sync.sql` en Supabase.
2. Loguearte como admin y probar el flujo completo: crear categoría → crear producto → verlo en inventario/vender → abrir caja → hacer una venta → ver que baja el stock y sube en Balance → cerrar caja.
3. Ir a `/admin/inventario/sincronizacion` y correr "Sincronizar ahora" — ya no debería estar en modo simulado.
4. Desplegar a Vercel con las variables de entorno de `.env` copiadas, registrar el webhook de Telegram, y decidir cómo resolver el cron de 15 min (Pro de Vercel vs. programador externo).
5. Seguir con Fase 2 (Pedidos/Cotizaciones/Empleados/Agenda) cuando quieras continuar el sistema administrativo.
