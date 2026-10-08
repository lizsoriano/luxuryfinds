# Encargo: rediseñar "Vender" como la pantalla "Ventas" de Tiendanube

Para: otra IA (ChatGPT/Codex) o persona. Léelo junto con `HANDOFF_PENDIENTE.md` (reglas de oro, stack, estado). Está escrito en español porque la dueña (Ruth Soriano) trabaja en español.
Estado: **pausado a medias (2026-10-06)**. Hay dos borradores sin terminar en la rama `wip/ventas-tiendanube` (ver §7). No hay nada de esto en `main`.

## 1. Qué pidió la dueña (textual)
Mandó la URL `https://www.luxuryfinds.com.mx/admin/vender` y capturas de la pantalla **Ventas de Tiendanube** con "**debe verse así**". Hoy `/admin/vender` es el terminal de punto de venta (`SellTerminal.tsx`). Quiere que esa sección se vea como la lista de ventas y el detalle de venta de Tiendanube.

## 2. Especificación visual (descripción de sus capturas; no tienes las imágenes)
**Lista "Ventas"**
- Título grande **"Ventas"** con contador gris "N abiertas". Arriba a la derecha botones (ej. "Cancelación automática", "Exportar").
- Una tarjeta con: buscador **"Buscar"** a la izquierda y, a la derecha, **chips de estado con contador** ("Por cobrar 0", "Por empaquetar 0", "Por enviar 0", …).
- Tabla con casilla de selección y columnas: **Venta** (número como enlace azul, ej. #103) · **Fecha** (ordenable con flecha; "12 may" y la hora en gris "17:24") · **Cliente** (enlace azul, truncado con …) · **Total** · **Productos** (enlace azul "2 unid. ▾" que despliega las líneas) · **Pago** (pastillas apiladas: "⊘ Cancelada" gris + "$ Reembolsado" gris, o "$ Recibido" verde; debajo en texto el método: "Mercado Pago - Tarjeta de débito" / "Personalizado - A convenir").
- Pie: "Mostrando 1-4 ventas de 4" y enlace de ayuda.

**Detalle de una venta (#103)**
- Flecha atrás; número grande con insignia ("Venta cancelada"); título "Detalle de la venta" con fecha ("12 de mayo de 2024 - 17:24") y canal ("Web").
- Columna izquierda:
  - Tarjeta "**2 unidades**" con insignia de estado de entrega (ej. "Por empaquetar"); cada producto con foto, nombre (azul), variante (gris), "1 x $5.00" con la cantidad en cajita gris, importe a la derecha; texto del método de entrega y botón **Imprimir**.
  - Tarjeta "**Pago**" con insignia (Reembolsado): Subtotal (N unidades) · Envío · **Total** (fila resaltada) · Reembolso (fila roja, -$) · **Total pagado por el cliente**; debajo método de pago ("Tarjeta de débito | Mercado Pago") y "Detalles ▾".
  - Tarjeta "**Tus notas**" con botón editar.
- Columna derecha "Más información": **Datos del cliente** (nombre azul, correo, "Editar información"); **Dirección de envío y facturación**; **Historial** (línea de tiempo vertical con íconos: "Pago reembolsado", "$X en Tarjeta de débito reembolsados", "Cancelada · Por Ruth", "Productos devueltos al stock", "Pago recibido", "$X con Tarjeta de débito", "Está siendo revisado", cada uno con fecha y hora a la derecha); **Página de seguimiento** ("Comparte esta página con tu cliente para que pueda seguir la compra." con "Copiar link" y "Acceder").
- Estilo: fondo gris claro, tarjetas blancas de borde suave y radio grande, tipografía Inter, insignias en pastilla. Usa el sistema del panel (variables `--admin-*`/`--terracotta*`, `components/ui/{Badge,Card,PageHeader}`, tablas `admin-data-table`; botones de texto 39 px / radius 12 px; íconos 36×36 / radius 10 px; en móvil controles ≥ 44 px).

## 3. Decisiones de diseño tomadas (propuestas; ajústalas si encuentras razón concreta)
1. **`/admin/vender` = lista "Ventas" UNIFICADA** de dos fuentes: ventas de mostrador (`sales`+`sale_items`, número `VD-…`, estado COMPLETED/CANCELLED) y pedidos (`orders`+`order_items`+`tickets`, origen WEBSITE/ADMIN_MANUAL, estados financiero/logístico, `payments`, comprobantes).
2. **El terminal de venta actual se conserva ÍNTEGRO** y se mueve a **`/admin/vender/nueva`**, con botón principal "Nueva venta" (y "Abrir caja"/"Nuevo gasto") en la lista. Actualiza todos los `href="/admin/vender"` que debían abrir el terminal (grep: fichas de clienta "Nueva venta", resúmenes, menú) para que apunten a `/admin/vender/nueva`. El grupo "Vender" del menú (Pedidos / Por ordenar / En camino / Agenda) se queda.
3. **Etapas / chips** (derivadas de los datos reales): Por confirmar · Por cobrar · Por ordenar · En camino · Listas para entrega · Entregadas · Canceladas. "Abiertas" = ni entregadas ni canceladas. Etapa de un pedido = la del artículo MENOS avanzado; tickets `CANCELLED_INCIDENT` no cuentan.
4. **Detalle**: ids que distingan venta de mostrador vs pedido sin colisión (ej. `s-<uuid>` / `p-<uuid>`); los enlaces existentes a `/admin/pedidos/[id]` deben seguir funcionando. Reutiliza acciones existentes (cancelar venta de mostrador: `app/admin/balance`; confirmar/cancelar pedido: `app/admin/pedidos/actions.ts`); **no las reescribas**. "Tus notas": `sales.notes` / `orders.internal_notes` con server action `requireAdminActor` + `logActivity`. "Imprimir": CSS `@media print`, sin librerías. Historial con datos REALES (creación, pagos con método y monto, cambios logísticos, cancelación y quién —`cancelled_at`, `activity_logs`—, devolución al stock —`inventory_movements`—, reembolsos).
5. **Página de seguimiento pública** `/seguimiento/[token]`: solo lectura, `noindex`, token aleatorio ≥ 128 bits (el borrador usa 256 bits) en tabla propia, se puede revocar/regenerar. **Solo** nombre de pila, productos con foto, estado y fechas. **NUNCA** costos, teléfono completo, dirección completa ni pagos detallados. Si no puedes cerrar un riesgo de privacidad, recórtalo al mínimo seguro.
6. **Rendimiento:** una consulta eficiente para la lista (sin N+1; PostgREST `.in()` en lotes ≤ 150; un `select()` sin paginar corta en 1,000 filas). El borrador propone una vista SQL `sales_feed` con `UNION ALL` + contadores `sales_feed_counts`, **con modo de respaldo en memoria si falta la migración** (las 1,000 ventas y 1,000 pedidos más recientes).
7. Los pedidos de **Compras con shopper** (`variant_id` NULL, `product_name_snapshot`) y los tickets sin producto deben verse bien. **Estadísticas/Balance no se tocan.**

## 4. Reglas duras (del proyecto)
- **Nadie ejecuta SQL salvo la dueña** (editor SQL de Supabase). Escribe la migración y degrada con gracia si falta (avisos que nombren el archivo; el resto idéntico). Siguiente número libre: **017** (hoy existen 000–016); si en `origin/main` ya hay una 017, usa la siguiente.
- No cambies lógica de pagos, pedidos, Cobranza, inventario, compras ni empleado. Sin librerías nuevas.
- **No toques datos reales** (≈4,600 productos, 402 de Bath & Body Works ocultos `BBW-…`, clientas reales). Pruebas con filas `TEMP-…` que BORRAS (ojo: `clients.id` apunta a `auth.users`, no crees cuentas en producción; crear/borrar ventas avanza los contadores de folio). Para lógica de lista/tokens usa **PGlite** instalado en un scratchpad, **no** en `package.json`.
- **Nunca escribas contraseñas** en formularios. Para ver la UI usa un harness HTML estático temporal en `public/` (markup real + copia de `app/globals.css`), captura a 1440 px y 375 px, y bórralo (`git status --short` limpio).
- `npm run typecheck && npm run lint && npm run build` con 0 errores (hay ~15 avisos `<img>` preexistentes).
- Git: tu propia rama y `git worktree` (otra IA/agente trabaja en paralelo); `app/globals.css` son reglas minificadas, una por línea → agrega las tuyas **al final**; antes del PR `git fetch origin && git merge origin/main`; PR → esperar Vercel → `gh pr merge --merge` → confirmar `gh api repos/lizsoriano/luxuryfinds/commits/<sha>/status --jq '.state'` = `success`; `/`, `/catalogo`, `/login` = 200, rutas admin = 307. El código debe quedar desplegado y funcionando **aun sin la migración nueva**.

## 5. Datos reales relevantes (2026-10-06)
- Producción tiene **0 ventas y 0 pedidos reales**; la lista nacerá vacía (estado vacío bonito con botón "Nueva venta").
- Hay 3 admins/clientas reales; `admin_users.role` (OWNER/EMPLOYEE) existe (migración 012). Solo OWNER ve `/admin/*`.
- Ayudas existentes: `lib/supabase/admin-commerce.ts`, `admin-orders.ts`, `lib/format.ts` (dinero y fechas con zona `America/Mazatlan`; `LOGISTICS_STATUS_LABELS`, `FINANCIAL_STATUS_LABELS`), `app/admin/pedidos/[id]/page.tsx` (detalle actual), `app/admin/balance/*` (cancelar venta), `app/admin/vender/*` (POS).

## 6. Criterios de "terminado"
- [ ] `/admin/vender` muestra la lista (buscador, chips con contadores, columnas y pastillas como §2, fila expandible "N unid. ▾", orden por fecha, paginación real).
- [ ] `/admin/vender/nueva` = POS completo y funcionando; todos los enlaces actualizados.
- [ ] Detalle con las 5 tarjetas (productos, pago, notas, cliente/dirección, historial) + Imprimir.
- [ ] `/seguimiento/[token]` público, sin datos sensibles, revocable; tarjeta "Copiar link / Acceder".
- [ ] Migración nueva (vista de la lista + contadores + tokens), idempotente, con RLS y grants solo a `service_role`; modo de respaldo sin ella.
- [ ] Pruebas (PGlite): venta cancelada con reembolso, pedido con plan semanal, pedido de compras sin variante, venta sin cliente, paginación > 1 página, orden por fecha mezclando fuentes.
- [ ] Capturas a 1440 y 375 px; typecheck/lint/build limpios; PR fusionado y desplegado.

## 7. Lo que ya existe (borradores sin terminar, sin probar, NO fusionados)
En la rama **`wip/ventas-tiendanube`** (partió de `origin/main` al 2026-10-06; solo tiene estos 2 archivos + este md):
- `database/migrations/017_sales_feed_tracking.sql` (178 líneas): índices (`ix_sales_sold_at`, `ix_orders_created_at`, `ix_order_items_order`), vista `sales_feed` (UNION ALL de ventas y pedidos con etapa, `to_collect` y `search_text` sin acentos), `sales_feed_counts` (contadores de chips) y tabla `sale_tracking_links` (token de 256 bits, `revoked_at`), RLS y solo `service_role`. **Sin probar** (ni siquiera en PGlite): revísala con cuidado, sobre todo la etapa de pedidos, `to_collect` y los permisos.
- `lib/sales-feed.ts` (349 líneas): reglas puras (sin imports) de la lista: `SalesStage`, `STAGE_LABELS`/`STAGE_TONES`, `SALES_FILTERS` (chips), búsqueda y texto de la columna Pago; debe mantenerse en sincronía con la vista SQL.
No hay nada de UI (`app/admin/vender/*`), ni del detalle, ni de `/seguimiento`.

## 8. Orden sugerido
1. Probar/ajustar la 017 y `sales-feed.ts` en PGlite. 2. Lista + chips + fila expandible con modo de respaldo. 3. Mover el POS a `/vender/nueva` y arreglar enlaces. 4. Detalle (ventas de mostrador y pedidos). 5. Historial. 6. Seguimiento público + tokens. 7. Imprimir, móvil, capturas, PR.
