# Luxury Finds — Roadmap funcional

Este roadmap complementa los requerimientos maestros. Admin y Portal Cliente permanecen como interfaces separadas sobre el mismo modelo de negocio.

## Experiencias y rutas

- Página pública: `/` y `/catalogo-publico.html`.
- Portal Cliente: `/client/`.
- Panel Administrativo: `/admin/`.
- Datos compartidos: `/js/shared/data.js`, actualmente respaldado por `localStorage` y sustituible posteriormente por una API.

## Estado actual — Base estabilizada

- Clientes unificados por `clientId`.
- Pedidos y partidas con precios históricos.
- Estados logísticos individuales y fechas.
- Cancelaciones sin eliminación física.
- Por ordenar, En camino, Disponibles y Agenda.
- Portal Cliente independiente, actualmente de consulta local.
- Migraciones versionadas y repositorio compartido para `localStorage`.
- Bitácora base `activityLog` para cambios operativos.

La versión 6 del esquema conserva la base y agrega el núcleo financiero de Fase 2:

- Direcciones múltiples y etiquetas de clientes.
- Variantes históricas.
- Productos especiales sin catálogo.
- Imagen, enlace, marca, tienda esperada y presupuesto máximo.
- Costo previsto.
- Notas internas separadas de notas visibles para clienta.
- Tracking de entrada y salida.
- Historial de precios del catálogo.

## Fase 2 — Tickets y cobranza (implementada)

- Tickets y folios.
- Descuentos por partida y ticket.
- Recargos y costos de entrega cobrados.
- Contado y planes de pagos.
- Plantillas de planes.
- Pagos, abonos y comprobantes.
- Cobranza y vencimientos.
- Saldos a favor como movimientos.
- Reembolsos independientes.
- Resolución financiera de cancelaciones.

Dependencias nuevas: apartados con anticipo, penalizaciones y comprobantes.

## Fase 3 — Catálogo e inventario

- Stock cuantitativo.
- Inventario libre y reservado.
- Movimientos de inventario.
- Apartados, vencimiento y liberación.
- Entrega inmediata y por encargo.
- Variantes administrables.
- Stock bajo y alertas.
- Historial de precios visible en Admin.

## Fase 4A — Lista de compras por tienda

Prioridad alta.

- Productos especiales desde pedido y fotografía.
- Agrupación automática por tienda/proveedor.
- Órdenes de compra internas.
- Lista mobile-first por tienda.
- Precio/costo máximo, variante y notas internas.
- Intentos de compra y resultados.
- Sustituciones pendientes de aprobación.

## Fase 4B — Modo día de compras y costos

- Conseguido, no encontrado, cambio de precio y revisar después.
- Costo estimado contra costo real.
- Compras para clientas e inventario en una misma compra.
- Compras USD y tipo de cambio histórico.
- Tiendas, viajes, shoppers y proveedores.
- Distribución de gastos y costo real.

## Fase 5 — Posventa

- Cambios y devoluciones sin alterar la venta original.
- Diferencias de precio.
- Reembolsos.
- Saldo a favor.
- Tracking de envíos a clientas.
- Direcciones y entregas avanzadas.

## Fase 6 — Operación y negocio

- Centro de alertas.
- Búsqueda universal.
- Centro de actividad por clienta.
- Configuración del negocio.
- Metas.
- Cierre diario y mensual.
- Caja y gastos.
- Reportes y exportaciones.

## Fase 7 — Portal Cliente completo

- Tickets reales.
- Planes, pagos, abonos y comprobantes.
- Notificaciones internas.
- Cancelaciones con resolución financiera pública.
- Solicitudes de productos y actualización de perfil.

## Fase 8 — Arquitectura online

- Backend y base de datos.
- Autenticación y autorización.
- Roles Owner, Empleado y Shopper.
- Archivos protegidos.
- Bitácora con usuario responsable.
- Portal aislado por identidad autenticada.
- Sincronización entre dispositivos.

## Reglas transversales

- No borrar silenciosamente ventas, pagos, productos o movimientos.
- Separar estado logístico, financiero e inventario.
- No mostrar notas internas, costos o utilidad en Portal Cliente.
- Congelar precios, costos y tipos de cambio históricos.
- Toda nueva colección debe incluir IDs, relaciones y fechas.
- Mientras exista `localStorage`, no afirmar que hay seguridad multiusuario.
