# PLAN MAESTRO — LUXURY FINDS
**Versión:** 1.0  
**Estado:** Definición funcional inicial  
**Objetivo:** Convertir el prototipo actual de Luxury Finds en una aplicación web real, segura, multiusuario y preparada para operación diaria.

---

# 1. Visión del producto

Luxury Finds será una sola aplicación web para administrar y vender productos de belleza, moda y lujo mediante:

- Productos disponibles para entrega inmediata.
- Productos disponibles por pedido.
- Compras especiales realizadas directamente por Luxury Finds en tiendas.
- Planes de pago semanales.
- Apartados.
- Seguimiento logístico.
- Programación de entregas.
- Cobranza y validación de pagos.
- Portal privado de cada clienta.
- Administración completa del negocio.

La aplicación tendrá tres áreas dentro del mismo sitio:

### Área pública
Disponible para cualquier visitante.

### Mi cuenta
Área privada integrada al sitio para las clientas.

### Administración
Área privada exclusiva para la administradora de Luxury Finds.

No se manejarán como tres sistemas independientes.

---

# 2. Estructura general

## Página pública

- Inicio
- Catálogo
  - Por pedido
  - Entrega inmediata
- Cómo comprar
- Contacto
- Políticas
- Iniciar sesión / Mi cuenta

## Mi cuenta

- Resumen
- Mis compras
- Mis pagos
- Mis entregas
- Notificaciones
- Mi perfil

## Administración

- Dashboard
- Pedidos
- Productos
- Inventario
- Por ordenar
- Ordenados
- En camino
- Recibidos en La Paz
- Clientes
- Pagos por validar
- Cobranza
- Tickets
- Agenda
- Devoluciones
- Reportes
- Configuración

---

# 3. Tipos de usuario

## Administradora

Solo existirá inicialmente una cuenta administrativa.

Puede:

- Crear clientas.
- Asignar y restablecer contraseñas.
- Crear productos.
- Administrar inventario.
- Crear compras manualmente.
- Crear planes de pago.
- Registrar pagos.
- Validar comprobantes.
- Aplicar multas.
- Actualizar estados logísticos.
- Abrir horarios de entrega.
- Administrar cancelaciones.
- Procesar devoluciones.
- Consultar reportes.
- Modificar configuraciones del negocio.

## Clienta

Puede:

- Iniciar sesión.
- Consultar catálogo.
- Consultar sus compras.
- Consultar sus pagos.
- Subir comprobantes.
- Consultar multas.
- Consultar estado logístico.
- Recibir notificaciones.
- Programar entregas.
- Consultar su perfil.

Nunca puede consultar información perteneciente a otra clienta.

---

# 4. Inicio de sesión

Las cuentas son creadas únicamente por Luxury Finds.

La clienta inicia sesión utilizando:

**Usuario:** número de celular  
**Contraseña:** contraseña asignada por la administradora

La administradora comparte inicialmente la contraseña mediante WhatsApp.

No habrá registro público de clientas.

No habrá recuperación automática de contraseña.

Únicamente la administradora puede utilizar:

**Restablecer contraseña**

La contraseña anterior nunca deberá poder consultarse. El sistema solamente permitirá sustituirla.

---

# 5. Catálogo

Existirá un único catálogo público dividido en dos tipos.

## Por pedido

Productos que Luxury Finds puede conseguir, pero que no se encuentran físicamente en inventario.

Cada producto muestra:

- Fotografías.
- Nombre.
- Marca.
- Categoría.
- Variante, cuando corresponda.
- Precio.
- Disponibilidad.
- Información relevante.

## Entrega inmediata

Productos que Luxury Finds tiene físicamente disponibles.

Cada producto muestra:

- Fotografías.
- Nombre.
- Marca.
- Categoría.
- Variante.
- Precio.
- Stock disponible.

Todos los productos publicados tendrán precio fijo.

---

# 6. Productos públicos y privados

Al crear un producto desde Administración existirá:

**Mostrar en catálogo: Sí / No**

### Producto público

Puede aparecer en:

- Por pedido.
- Entrega inmediata.

### Producto privado

No aparece en el catálogo.

Puede utilizarse para registrar productos especiales solicitados por una clienta.

Posteriormente la administradora puede convertirlo en producto público.

---

# 7. Variantes e inventario

Los productos pueden tener variantes.

Ejemplos:

- Talla.
- Color.
- Tono.
- Modelo.
- Presentación.

El inventario se controla por variante.

Ejemplo:

New Balance 530

- Talla 23 → 2 unidades.
- Talla 24 → 1 unidad.
- Talla 25 → 0 unidades.

Cuando una unidad de inventario se asigna a un ticket, deja de estar disponible para otras clientas.

El sistema debe conservar movimientos de inventario para conocer:

- Entrada.
- Asignación.
- Cancelación.
- Liberación.
- Entrega.
- Ajuste manual.

---

# 8. Origen de las compras

Existirán dos formas principales de generar una compra.

## A. Compra originada desde el sitio

La clienta selecciona un producto publicado en Luxury Finds.

El producto queda asociado con su cuenta y posteriormente se maneja mediante su ticket y modalidad de pago.

## B. Compra agregada manualmente

Una clienta puede solicitar un artículo que Luxury Finds encuentre directamente en una tienda o por otro medio.

La administradora puede crear desde Admin:

- Clienta.
- Producto.
- Imagen.
- Nombre.
- Marca.
- Variante.
- Precio.
- Cantidad.
- Tienda.
- Notas.

Después decide:

**Publicar también en catálogo: Sí / No**

La compra aparece automáticamente dentro de Mi cuenta de la clienta.

---

# 9. Tickets

Cada compra debe quedar asociada a un ticket.

Formato sugerido:

**LF-2026-0001**

El ticket conserva permanentemente una fotografía histórica de:

- Producto.
- Variante.
- Cantidad.
- Precio pactado.
- Modalidad de pago.
- Plan.
- Descuentos.
- Multas.
- Pagos.
- Saldo.
- Estado financiero.

Cambiar posteriormente el precio del catálogo nunca modifica tickets anteriores.

Todos los cálculos monetarios deberán realizarse internamente en centavos.

---

# 10. Modalidades de pago

Se manejarán tres modalidades principales.

## Pago completo

La clienta liquida el total correspondiente.

## Plan semanal

Disponible con plazos de:

**4 a 16 semanas.**

## Apartado

Disponible exclusivamente para productos de entrega inmediata.

---

# 11. Métodos de pago

Luxury Finds acepta:

- Transferencia.
- Efectivo.
- Link de pago.

No se integrará inicialmente una pasarela automática de pagos.

---

# 12. Planes de pago semanales

Los planes pueden durar entre:

**4 y 16 semanas.**

El precio final puede ser superior al precio de contado debido a las facilidades otorgadas.

La administradora puede determinar:

- Precio final del plan.
- Número de semanas.
- Monto inicial.
- Monto de cada cuota.
- Fecha de inicio.

La suma de todas las cuotas debe coincidir con el total pactado.

Los montos pueden ser personalizados.

---

# 13. Día de pago

Los pagos deberán realizarse el mismo día de la semana en el que se generó el plan.

Ejemplo:

Si el plan comenzó un lunes:

- Pago 1 → lunes.
- Pago 2 → lunes.
- Pago 3 → lunes.
- Etc.

La clienta tiene hasta las **11:59 p. m.** del día correspondiente.

A partir de las **12:00 a. m. del día siguiente**, el pago se considera retrasado.

La aplicación utilizará la zona horaria configurada para Luxury Finds.

---

# 14. Multas

Cada cuota que no se cubra dentro de su fecha correspondiente genera:

**Multa: $100 MXN**

El sistema debe almacenar por separado:

- Monto de la cuota.
- Multa.
- Saldo pendiente.

Las multas no deberán confundirse con el precio del producto.

---

# 15. Incumplimiento del plan

Si la clienta acumula **dos semanas consecutivas de retraso**:

- El plan se considera incumplido.
- El producto no se entrega.
- No existe devolución por incumplimiento.
- El historial de pagos permanece registrado.
- El pedido no se elimina.

El estado deberá mostrar claramente:

**Plan incumplido**

---

# 16. Pagos adelantados

La clienta puede:

- Adelantar cuotas.
- Abonar cantidades superiores.
- Liquidar antes del plazo.

Sin embargo, liquidar anticipadamente no reduce el total pactado.

Ejemplo:

Plan de 8 semanas:

**Total pactado: $4,200**

Aunque se liquide en la semana 3:

**Total: $4,200**

---

# 17. Momento para ordenar productos bajo pedido

Los productos bajo pedido con plan semanal se ordenan en el **penúltimo pago**.

Ejemplos:

- 4 semanas → listo para ordenar después del pago 3.
- 8 semanas → después del pago 7.
- 12 semanas → después del pago 11.
- 16 semanas → después del pago 15.

Al alcanzar ese punto, el sistema cambia a:

**Listo para ordenar**

No cambia automáticamente a **Ordenado**.

La administradora debe realizar la compra y posteriormente seleccionar:

**Marcar como ordenado**

---

# 18. Apartados

Los apartados se permiten únicamente para productos de **Entrega inmediata**.

Para iniciar un apartado se requiere como mínimo:

**30% del precio total**

El saldo restante deberá liquidarse dentro de:

**30 días naturales**

La clienta puede realizar abonos anticipados.

No existen pagos semanales obligatorios dentro de un apartado.

---

# 19. Incumplimiento del apartado

Si después de 30 días naturales el producto no está liquidado:

- El apartado queda cancelado.
- El anticipo no se devuelve.
- El producto no se entrega.
- No se permiten cambios de artículo.
- El inventario correspondiente puede liberarse nuevamente.

---

# 20. Comprobantes de pago

La clienta puede subir comprobantes desde:

**Mi cuenta → Mis pagos**

Formatos previstos:

- JPG.
- PNG.
- PDF.

El comprobante queda con estado:

**Pendiente de validación**

Todavía no cuenta como pago confirmado.

---

# 21. Validación de pagos

La administradora consulta:

**Admin → Pagos por validar**

Puede:

- Ver comprobante.
- Ver monto.
- Ver fecha reportada.
- Ver método.
- Aprobar.
- Rechazar.

Cuando se aprueba:

- Se registra el pago.
- Se actualiza saldo.
- Se aplican las cuotas correspondientes.
- Se recalcula el estado financiero.
- Se actualiza el progreso del plan.

Cuando se rechaza, deberá conservarse el motivo.

---

# 22. Pagos recibidos por WhatsApp

Si la clienta manda el comprobante directamente a Luxury Finds por WhatsApp, la administradora puede registrarlo manualmente.

Puede adjuntar el comprobante desde Admin y registrarlo directamente como validado.

El efectivo también se registra manualmente y no requiere comprobante obligatorio.

---

# 23. Fechas de los pagos

Cada pago debe almacenar por separado:

- Fecha efectiva del pago.
- Fecha en que se subió el comprobante.
- Fecha de validación.

La fecha efectiva determina si corresponde una multa.

Ejemplo:

Pago realizado lunes 11:40 p. m.

Comprobante subido martes.

Validado miércoles.

Resultado:

**Pago puntual.**

---

# 24. Estados financieros

Posibles estados:

- Pendiente de primer pago.
- Comprobante pendiente.
- Pago parcial.
- Al corriente.
- Vencido.
- Pagado.
- Incumplido.
- Cancelado por incidencia.
- Devolución pendiente.
- Reembolsado.

---

# 25. Estados logísticos

La logística se manejará independientemente del estado financiero.

Para productos bajo pedido:

**Esperando para ordenar**
→ **Listo para ordenar**
→ **Ordenado**
→ **En camino**
→ **Recibido en La Paz**
→ **Entrega programada**
→ **Entregado**

Los productos de entrega inmediata omiten los estados de compra y traslado que no correspondan.

---

# 26. Cancelaciones especiales

Si Luxury Finds no puede cumplir con el producto por situaciones como:

- Producto agotado.
- Cancelación del proveedor.
- Producto incorrecto.
- Producto dañado.
- Producto perdido.
- Imposibilidad de conseguirlo.

El producto se marca como:

**Cancelado por incidencia**

La clienta podrá elegir:

1. Encargar otro producto.
2. Cambiarlo por un producto disponible.
3. Solicitar devolución.

Esto es diferente de una cancelación causada por incumplimiento de la clienta.

---

# 27. Solicitudes de devolución

La clienta deberá proporcionar información para recibir la devolución.

Campos previstos:

- Nombre.
- Apellido.
- Banco.
- Información necesaria para realizar la devolución.

Por seguridad, el sistema deberá evitar almacenar números completos de tarjetas cuando no sea indispensable. Se priorizará cuenta/CLABE u otra información bancaria apropiada.

Estados:

**Devolución solicitada**
→ **En proceso**
→ **Devolución realizada**

La administradora registra:

- Monto.
- Fecha.
- Método.
- Referencia.
- Motivo.

El pago original nunca se elimina.

---

# 28. Entregas

Las entregas solamente podrán programarse cuando el producto esté listo para entregarse.

La administradora abre manualmente los periodos disponibles.

Ejemplo:

**Viernes 4:00 p. m. – 6:00 p. m.**

El sistema divide automáticamente ese periodo en bloques de:

**10 minutos**

Ejemplo:

- 4:00–4:10
- 4:10–4:20
- 4:20–4:30
- 4:30–4:40
- 4:40–4:50
- 4:50–5:00

Cada bloque solamente puede tener una reservación.

---

# 29. Anticipación mínima

Las entregas deben programarse como mínimo con:

**1 día de anticipación**

No se permiten reservaciones para el mismo día.

Aunque exista un horario abierto, al comenzar ese día deja de estar disponible para nuevas reservaciones.

---

# 30. Tipos de entrega

La clienta podrá elegir entre las modalidades habilitadas:

## Recoger personalmente

Selecciona punto, fecha y horario.

## DiDi Entregas

DiDi también ocupa un bloque de 10 minutos.

Durante ese periodo la clienta solicita su conductor.

El costo de DiDi siempre lo paga directamente la clienta.

Luxury Finds no cobra ni administra el costo del servicio de DiDi.

---

# 31. Clienta que no se presenta

Si una clienta no se presenta en su horario:

- La administradora marca la cita como no presentada.
- La entrega se cancela.
- Se genera un mensaje de cancelación para WhatsApp.
- El producto vuelve a quedar disponible para programar otra entrega.
- La cita anterior permanece registrada en el historial.

---

# 32. Notificaciones

Luxury Finds tendrá un sistema interno de notificaciones.

Ejemplos:

- Pago aprobado.
- Comprobante rechazado.
- Pago próximo.
- Pago vencido.
- Multa aplicada.
- Producto listo para ordenar.
- Producto ordenado.
- Producto en camino.
- Producto recibido en La Paz.
- Ya puede programar entrega.
- Entrega programada.
- Entrega cancelada.
- Devolución procesada.

No se implementarán inicialmente notificaciones automáticas por WhatsApp.

---

# 33. WhatsApp

El sistema puede generar mensajes precargados.

Ejemplos:

- Contraseña nueva.
- Recordatorio.
- Cancelación de entrega.
- Producto recibido.
- Incidencia.
- Cambio de estado.

La administradora decide cuándo abrir WhatsApp y enviar el mensaje.

No habrá WhatsApp Business API en la primera versión.

---

# 34. Perfil de clienta

Cada perfil puede almacenar:

- Nombre.
- Apellidos.
- Celular.
- Instagram.
- Correo.
- Dirección.
- Fecha de cumpleaños.
- Notas internas.
- Permiso para planes de pago.
- Saldo a favor.
- Fecha de creación.
- Estado.
- Historial de compras.
- Historial de pagos.
- Multas.
- Apartados.
- Devoluciones.
- Entregas.

Las notas internas nunca son visibles para la clienta.

---

# 35. Dashboard administrativo

El Dashboard deberá priorizar información operativa.

## Pagos

- Comprobantes por validar.
- Pagos vencidos.
- Total por cobrar.
- Pagos esperados hoy.

## Logística

- Listos para ordenar.
- Ordenados.
- En camino.
- Recibidos en La Paz.

## Entregas

- Entregas de hoy.
- Próximas entregas.
- DiDi programados.

## Negocio

- Ventas.
- Cobrado.
- Pendiente.
- Devoluciones.

---

# 36. Reportes

La arquitectura debe permitir consultar posteriormente:

- Ventas por periodo.
- Total cobrado.
- Total pendiente.
- Multas.
- Devoluciones.
- Ventas por clienta.
- Productos más vendidos.
- Ventas por categoría.
- Planes de pago.
- Apartados.
- Inventario.
- Entregas.
- Utilidad.

Los reportes avanzados pueden desarrollarse gradualmente.

---

# 37. Bitácora

Toda acción importante deberá generar un registro.

Ejemplos:

- Pago aprobado.
- Pago rechazado.
- Contraseña restablecida.
- Producto creado.
- Inventario modificado.
- Estado logístico cambiado.
- Multa aplicada.
- Entrega programada.
- Entrega cancelada.
- Devolución realizada.

Debe almacenarse:

- Usuario responsable.
- Acción.
- Fecha.
- Registro afectado.
- Información anterior.
- Información nueva.

---

# 38. Arquitectura técnica propuesta

Luxury Finds deberá convertirse en una aplicación con backend y base de datos central.

Arquitectura propuesta:

**Frontend + aplicación**
Next.js + TypeScript

**Diseño**
Tailwind CSS

**Backend**
Servidor/API integrado con Next.js

**Base de datos**
PostgreSQL

**ORM**
Prisma

**Archivos**
Almacenamiento privado para comprobantes e imágenes.

**Autenticación**
Sesiones seguras utilizando celular + contraseña.

No se utilizará `localStorage` como fuente principal de datos.

---

# 39. Rutas principales

Ejemplo:

luxuryfinds.mx/

luxuryfinds.mx/catalogo  
luxuryfinds.mx/por-pedido  
luxuryfinds.mx/entrega-inmediata  
luxuryfinds.mx/como-comprar  
luxuryfinds.mx/politicas  

luxuryfinds.mx/cuenta  
luxuryfinds.mx/cuenta/compras  
luxuryfinds.mx/cuenta/pagos  
luxuryfinds.mx/cuenta/entregas  
luxuryfinds.mx/cuenta/perfil  

luxuryfinds.mx/admin  
luxuryfinds.mx/admin/pedidos  
luxuryfinds.mx/admin/clientes  
luxuryfinds.mx/admin/cobranza  
luxuryfinds.mx/admin/agenda  

Todo forma parte de la misma aplicación.

---

# 40. Entidades principales de base de datos

La base de datos deberá contemplar como mínimo:

- AdminUser
- Client
- Product
- ProductVariant
- InventoryMovement
- Order
- OrderItem
- Ticket
- PaymentPlan
- Installment
- Payment
- PaymentProof
- LateFee
- RefundRequest
- Refund
- DeliveryAvailability
- DeliverySlot
- DeliveryBooking
- Notification
- ActivityLog
- TermsVersion
- TermsAcceptance

La estructura exacta y relaciones serán definidas en el diseño de base de datos.

---

# 41. Términos y condiciones

Los términos definitivos se redactarán cuando las reglas funcionales estén completamente cerradas.

El sistema deberá permitir guardar diferentes versiones.

Cada aceptación almacena:

- Versión de los términos.
- Clienta.
- Ticket/pedido.
- Fecha.
- Hora.

La aceptación quedará asociada al primer pago correspondiente.

Modificar las políticas posteriormente no modificará las condiciones históricas de compras anteriores.

---

# 42. Fuera del MVP

No se desarrollará inicialmente:

- Pago automático dentro de la página.
- WhatsApp Business API.
- Aplicación móvil nativa.
- Notificaciones push del dispositivo.
- Múltiples administradores.
- Roles complejos de empleados.
- Facturación automática.
- Integración automática con DiDi.
- Contabilidad completa.
- Integración automática con proveedores.

La arquitectura deberá permitir agregarlos posteriormente.

---

# 43. Fases de desarrollo

## Fase 0 — Cierre funcional

- Terminar términos y condiciones.
- Confirmar campos definitivos.
- Definir diseños principales.
- Congelar reglas del MVP.

## Fase 1 — Base técnica

- Crear proyecto nuevo.
- Base de datos PostgreSQL.
- Modelo inicial.
- Autenticación.
- Admin.
- Clientas.
- Seguridad de rutas.
- Almacenamiento de archivos.

## Fase 2 — Catálogo e inventario

- Productos.
- Variantes.
- Imágenes.
- Categorías.
- Stock.
- Público/privado.
- Por pedido.
- Entrega inmediata.
- Movimientos de inventario.

## Fase 3 — Mi cuenta

- Login.
- Resumen.
- Compras.
- Pagos.
- Entregas.
- Perfil.
- Notificaciones.

## Fase 4 — Pedidos y tickets

- Creación desde catálogo.
- Creación manual.
- Tickets.
- Productos históricos.
- Estados.
- Compras especiales.

## Fase 5 — Sistema financiero

- Planes de 4–16 semanas.
- Cuotas manuales.
- Apartados.
- Comprobantes.
- Validación.
- Pagos adelantados.
- Multas.
- Incumplimientos.
- Cobranza.

## Fase 6 — Logística

- Listo para ordenar.
- Ordenado.
- En camino.
- Recibido en La Paz.
- Cancelaciones especiales.
- Devoluciones.

## Fase 7 — Agenda

- Disponibilidad administrativa.
- Bloques de 10 minutos.
- Restricción de un día.
- Recoger personalmente.
- DiDi.
- Cancelaciones.
- No-show.

## Fase 8 — Administración avanzada

- Dashboard.
- Reportes.
- Actividad.
- Notificaciones.
- Configuración.

## Fase 9 — Migración

Migrar desde el prototipo actual:

- Clientas.
- Catálogo.
- Pedidos.
- Tickets.
- Pagos.
- Planes.
- Reembolsos.
- Historial.

## Fase 10 — Pruebas y producción

- Pruebas funcionales.
- Pruebas de permisos.
- Pruebas de pagos.
- Pruebas de inventario.
- Pruebas de agenda.
- Pruebas móviles.
- Copias de seguridad.
- Deploy de producción.

---

# 44. Principio principal del proyecto

Luxury Finds debe construirse alrededor de cuatro sistemas centrales:

**Clientas + Inventario + Finanzas + Logística**

Toda compra debe poder responder claramente:

1. ¿De quién es?
2. ¿Qué producto es?
3. ¿Cuánto debe pagar?
4. ¿Cuánto ha pagado?
5. ¿Cuándo debe pagar?
6. ¿Existe alguna multa?
7. ¿En qué estado logístico se encuentra?
8. ¿Cuándo puede entregarse?
9. ¿Qué movimientos se realizaron?
10. ¿Qué condiciones aceptó la clienta?

Si cualquiera de estas preguntas no puede responderse desde el historial del sistema, la implementación está incompleta.