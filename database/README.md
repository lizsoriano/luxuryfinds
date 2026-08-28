# Diseño relacional de Luxury Finds

El archivo `schema.sql` contiene el modelo PostgreSQL del Plan Maestro. Usa UUID para las entidades públicas, `timestamptz` para eventos y enteros en centavos MXN para todo importe.

## Núcleo del modelo

- `clients` es la propietaria de pedidos, tickets, pagos, entregas y notificaciones.
- `products` contiene la ficha comercial; `product_variants` contiene SKU, atributos, precio y unidad de inventario.
- `inventory_movements` es un libro inmutable. La existencia disponible se consulta mediante `variant_stock`.
- `orders` agrupa una operación y `order_items` sus artículos. Cada artículo genera exactamente un `ticket`.
- `tickets` guarda la fotografía histórica del artículo, variante, precio y modalidad. Los cambios futuros del catálogo no alteran la compra.
- `payment_plans` representa tanto plan semanal como apartado. Solo los planes semanales tienen `installments`.
- `payment_proofs` representa lo reportado y pendiente de validación. Solo al aprobarse se crea `payments`.
- `payment_allocations` distribuye un pago entre cuotas y multas, soportando pagos parciales, anticipados o liquidación temprana.
- Finanzas y logística son estados independientes en `tickets`.
- Disponibilidades de entrega se dividen en `delivery_slots` de diez minutos; los índices parciales impiden dos reservaciones activas.
- `terms_acceptances` conserva la versión aceptada por ticket y su primer pago.
- `activity_logs` conserva actor, entidad y valores anterior/nuevo para auditoría.

## Reglas transaccionales

Las restricciones locales están en SQL. Las reglas que dependen de varias filas están enumeradas al final de `schema.sql` y deben ejecutarse dentro de transacciones del servicio. Entre ellas están impedir inventario negativo, comprobar la suma de cuotas, distribuir pagos sin exceder su monto, calcular vencimientos en la zona horaria del negocio y detectar dos semanas consecutivas vencidas.

Para asignar inventario de forma segura, la aplicación debe bloquear la variante o sus movimientos durante la transacción, comprobar `variant_stock` y crear el movimiento `ALLOCATION`. Una liberación crea `RELEASE`; una entrega crea el evento `DELIVERY` con delta cero porque la unidad ya dejó de estar disponible al asignarse.

## Instalación

Ejecutar contra una base PostgreSQL vacía con un rol autorizado para crear extensiones y esquemas:

```powershell
psql -v ON_ERROR_STOP=1 -d luxury_finds -f database/schema.sql
```

El script instala `citext` y `pgcrypto`, crea el esquema `luxury_finds`, tipos, tablas, índices, vistas y configuración inicial.
