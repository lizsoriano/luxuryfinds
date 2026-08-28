# Base de datos de Luxury Finds en Supabase

`schema.sql` instala el modelo relacional completo sobre Supabase PostgreSQL. Conserva UUID para entidades públicas, `timestamptz` para eventos y enteros en centavos MXN para importes.

## Autenticación

Supabase Auth es la única fuente de credenciales. `luxury_finds.clients.id` y `luxury_finds.admin_users.id` son a la vez PK y FK hacia `auth.users(id) ON DELETE CASCADE`. El esquema no guarda hashes ni fechas de cambio de contraseña.

Primero se crea el usuario con Supabase Auth y después, desde un backend autorizado, se inserta su perfil usando exactamente el mismo UUID:

```sql
insert into luxury_finds.clients (
  id, phone, first_name, last_name, email
)
values (
  '<auth.users.id>', '<telefono>', '<nombre>', '<apellido>', '<email>'
);
```

Los perfiles administrativos siguen el mismo patrón en `luxury_finds.admin_users`. No se deben crear administradores desde el navegador.

## Seguridad

Todas las tablas tienen Row Level Security habilitado. El catálogo anónimo solo expone productos públicos y activos, sus variantes e imágenes necesarias, categorías activas, marcas asociadas y términos publicados.

Los clientes autenticados solo pueden consultar registros asociados a `auth.uid()`: perfil, pedidos, tickets, planes, cuotas, comprobantes, pagos, multas, reembolsos, entregas, notificaciones y aceptaciones. Los privilegios de columna excluyen `clients.internal_notes`, `orders.internal_notes` y otros metadatos administrativos.

No existen políticas administrativas para clientes web. Las operaciones administrativas deben ejecutarse desde un backend seguro con la clave `service_role` o una conexión PostgreSQL protegida. Nunca se debe exponer la clave `service_role` en el frontend.

Si se usará la Data API sobre el esquema personalizado, agrega `luxury_finds` en **Project Settings → API → Exposed schemas**. Los permisos y RLS del archivo siguen aplicándose.

## Supabase Storage

El script registra dos buckets:

- `product-images`: público, para JPEG, PNG, WebP y AVIF.
- `payment-proofs`: privado, para JPEG, PNG y PDF.

Las claves `storage_key` e `image_storage_key_snapshot` guardan únicamente la ruta del objeto; ningún archivo binario se almacena en PostgreSQL.

Los comprobantes deben subirse con esta estructura:

```text
<auth.users.id>/<nombre-unico-del-archivo>
```

Las políticas de Storage permiten a un cliente autenticado subir y consultar solamente objetos dentro de su propia carpeta. El backend administrativo puede acceder mediante `service_role` y debe entregar comprobantes mediante descargas autenticadas o URL firmadas.

## Instalación mediante Supabase SQL Editor

1. Crea un proyecto nuevo en Supabase.
2. Abre **SQL Editor → New query**.
3. Copia todo el contenido de `database/schema.sql`.
4. Ejecuta la consulta completa una sola vez.
5. Confirma que existan el esquema `luxury_finds` y los buckets en **Storage**.
6. Ejecuta **Security Advisor** y comprueba que RLS permanezca habilitado.

El script usa `citext` y `pgcrypto`, ambas extensiones compatibles con Supabase. No crea ni modifica tablas internas de `auth`; únicamente referencia la PK estable `auth.users(id)`. Sí registra buckets y políticas sobre `storage.objects`, que es la interfaz SQL documentada de Supabase Storage.

## Núcleo del modelo

- `clients` posee pedidos, tickets, pagos, entregas y notificaciones.
- `products` contiene la ficha comercial; `product_variants` contiene SKU, atributos, precio y unidad de inventario.
- `inventory_movements` es un libro inmutable. La existencia disponible se consulta mediante `variant_stock`.
- `orders` agrupa una operación y `order_items` sus artículos. Cada artículo genera exactamente un `ticket`.
- `tickets` guarda la fotografía histórica del artículo, variante, precio y modalidad.
- `payment_plans`, `installments`, `payment_proofs`, `payments` y `payment_allocations` conservan el flujo financiero existente.
- Finanzas y logística permanecen como estados independientes en `tickets`.
- `delivery_slots` mantiene intervalos de diez minutos y evita reservaciones activas duplicadas.
- `terms_acceptances` y `activity_logs` mantienen aceptación legal y auditoría.

Las validaciones entre varias filas enumeradas al final de `schema.sql` deben seguir ejecutándose dentro de transacciones del backend.
