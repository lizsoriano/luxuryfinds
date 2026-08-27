# glamstudio - Sistema de Gestión de Pedidos

Sistema completo de gestión de pedidos para productos de belleza y lujo. Incluye kanban de pedidos, catálogo de productos, agenda de entregas y vista para clientes.

## Características

### 📦 Gestión de Pedidos (Kanban)
- **4 estados de pedido**: Sin ordenar, Ordenados, Pendiente entrega, Entregados
- Drag and drop visual entre estados
- Información completa del cliente (nombre, teléfono, canal)
- Lista de productos con estados individuales
- Cálculo automático de precios totales
- Edición de pedidos existentes
- Cancelación selectiva de productos

### 💄 Catálogo de Productos
- Grid visual de productos con emoji, nombre y precio
- Búsqueda en tiempo real
- Importación masiva desde CSV
- Agregar/editar productos manualmente
- Control de stock (disponible/agotado)
- Categorización de productos

### ✨ Productos Disponibles (NUEVO)
- Vista dedicada de productos en stock
- Filtrado por categoría con pills interactivas
- Búsqueda instantánea
- Ordenamiento múltiple (nombre, precio, categoría)
- Cards grandes con información destacada
- Contador en tiempo real de productos disponibles
- Diseño optimizado para compartir con clientes

### 📅 Agenda de Entregas
- Vista organizada por fecha
- 2 puntos de entrega configurados:
  - **Indeco de 8**: 8:30 am - 12:30 pm (Lun-Sáb)
  - **Villas del Encanto**: 4:00 pm - 8:00 pm (Lun-Sáb)
- Slots de 30 minutos
- Validación de fechas (mínimo 1 día anticipación)
- Reagendación de entregas
- Cancelación con notificación automática

### 💬 Integración WhatsApp
- Confirmación de pedidos
- Notificación de cancelación de productos
- Recordatorios de entrega
- Cancelación de entregas
- Enlaces directos a WhatsApp con mensaje pre-cargado

### 👥 Vista Cliente
- Rastreador de estado de pedido (4 pasos visuales)
- Auto-agendado de recolección
- Selección de punto y horario
- Validaciones de disponibilidad

## Tecnologías

- **HTML5**: Estructura semántica
- **CSS3**: Diseño responsive con CSS Grid y Flexbox
- **JavaScript Vanilla**: Sin dependencias externas
- **LocalStorage**: Persistencia de datos en el navegador

## Instalación

1. Clona o descarga este repositorio
2. Abre `index.html` en tu navegador
3. O inicia un servidor local:

```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (con http-server)
npx http-server -p 8000
```

4. Navega a `http://localhost:8000`

## Estructura de Archivos

```
luxuryFinds/
├── index.html          # Página de inicio
├── pedidos.html        # Vista de pedidos (kanban)
├── catalogo.html       # Vista de catálogo completo
├── disponibles.html    # Vista de productos disponibles (NUEVO)
├── agenda.html         # Vista de agenda de entregas
├── cliente.html        # Vista para clientes
├── app.js             # Lógica de la aplicación
├── styles.css         # Estilos globales mejorados
└── README.md          # Este archivo
```

## Uso

### Crear un Nuevo Pedido

1. Ve a la vista "Pedidos"
2. Haz clic en "+ Nuevo pedido"
3. Completa:
   - Nombre de la clienta
   - Número de WhatsApp
   - Canal de origen (WhatsApp/Instagram)
   - Selecciona productos del catálogo
   - Agrega notas (opcional)
4. Haz clic en "Guardar"

### Gestionar Estados de Pedido

**Sin ordenar → Ordenados**
- Envía confirmación por WhatsApp
- Mueve el pedido a "Ordenados"

**Ordenados → Pendiente entrega**
- Cancela productos individuales si es necesario
- Mueve a "Pendiente entrega" cuando todo esté listo

**Pendiente entrega → Entregados**
- Agenda la entrega (punto, fecha y hora)
- Envía recordatorio por WhatsApp
- Marca como entregado al completar

### Agregar Productos al Catálogo

**Manualmente:**
1. Ve a "Catálogo"
2. Haz clic en "+ Agregar"
3. Completa: nombre, precio, emoji, categoría, stock
4. Haz clic en "Agregar"

**Por CSV:**
1. Exporta tu catálogo desde Tienda Nube (o prepara un CSV)
2. Formato: `nombre,precio,categoria`
3. Haz clic en "Subir CSV" y selecciona el archivo
4. Los productos se importarán automáticamente

### Agendar Entregas

1. Desde el pedido, haz clic en "Agendar entrega"
2. Selecciona punto de entrega
3. Elige fecha (mínimo mañana, lunes-sábado)
4. Selecciona horario disponible
5. Agrega notas (opcional)
6. Confirma y la entrega aparecerá en "Mi agenda"

## Formato CSV para Importar

El archivo CSV debe tener este formato:

```csv
nombre,precio,categoria
Foundation MAC NC25,850,Base
Lipstick Ruby Woo,520,Labial
Perfume Chanel,2800,Fragancia
Mascara Lash Princess,320,Ojos
```

**Notas:**
- Primera línea es el encabezado (se ignora)
- Precio sin símbolos, solo número
- Emoji se asigna automáticamente (📦)
- Stock por defecto es "Disponible"

## Características Técnicas

### Persistencia de Datos
- Todos los datos se guardan en LocalStorage
- Los cambios persisten entre sesiones
- Datos de ejemplo incluidos en primera carga
- Los importes financieros se calculan en centavos enteros
- Los tickets conservan un snapshot histórico; cambiar el catálogo no modifica ventas anteriores
- La migración a esquema 6 crea un ticket por cada pedido anterior y usa `orderId` para no duplicarlo
- El respaldo JSON incluye tickets, planes, calendario, pagos, comprobantes, créditos y reembolsos

`FileRepository` acepta JPG, PNG y PDF de hasta 750 KB y guarda un Data URL solo para la demostración local. LocalStorage tiene una cuota pequeña, no es seguro ni es adecuado para acumular comprobantes. En producción, el repositorio deberá subir los archivos a almacenamiento privado y guardar únicamente su URL o identificador desde el backend.

### Responsive Design
- **Desktop**: Grid de 4 columnas (kanban y estadísticas)
- **Tablet (< 1024px)**: Grid de 2 columnas
- **Mobile (< 768px)**: 1 columna, navegación scrollable
- **Pequeño (< 480px)**: Botones full-width, stats apiladas

### Modo Oscuro
- Detección automática de preferencia del sistema
- `prefers-color-scheme: dark`
- Variables CSS adaptativas

### Accesibilidad
- Indicadores visuales de foco (`:focus-visible`)
- Contraste WCAG AA
- Navegación por teclado
- Etiquetas semánticas

## Datos de Ejemplo

La aplicación viene precargada con:

**Pedidos:**
- 1 pedido en "Entrega" con entrega agendada
- 1 pedido en "Ordenado"
- 1 pedido en "Nuevo"

**Catálogo:**
- 8 productos de ejemplo en varias categorías
- Precios de referencia
- Emojis representativos

## Personalización

### Puntos de Entrega

Edita en `catalogo.html` (líneas 61-73) y `pedidos.html` (líneas 117-129):

```html
<div class="loc-card" id="loc-indeco" onclick="selectLoc('indeco')">
  <div class="loc-icon">📍</div>
  <div class="loc-name">TU UBICACIÓN</div>
  <div class="loc-hours">TU HORARIO</div>
  <div class="loc-days">TUS DÍAS</div>
</div>
```

### Horarios de Slots

Edita en `app.js` la función `updateSlots()`:

```javascript
const slots = selectedLocation === 'indeco' 
  ? ['8:30 am', '9:00 am', ...] // Tus horarios
  : ['4:00 pm', '4:30 pm', ...];
```

### Colores

Edita variables CSS en `styles.css`:

```css
:root {
  --pk: #D4537E;  /* Color principal (rosa) */
  --tl: #1D9E75;  /* Teal (confirmado) */
  --am: #BA7517;  /* Ámbar (ordenado) */
  --pu: #7F77DD;  /* Púrpura (entrega) */
  --gr: #639922;  /* Verde (entregado) */
  --co: #D85A30;  /* Coral (cancelado) */
}
```

## Solución de Problemas

### Los datos se perdieron
- Verifica que LocalStorage esté habilitado en tu navegador
- No uses modo incógnito (los datos se borran al cerrar)
- Exporta regularmente tus datos como respaldo

### El CSV no se importa
- Verifica que el formato sea correcto: `nombre,precio,categoria`
- Asegúrate de que el archivo sea .csv UTF-8
- Revisa que haya al menos 2 líneas (encabezado + datos)

### WhatsApp no abre
- Verifica que el número tenga formato internacional: `52 81 xxxx xxxx`
- El número debe estar en formato clickeable (sin guiones extra)
- Prueba el enlace manualmente

### Los estilos no se cargan
- Verifica que `styles.css` esté en el mismo directorio
- Limpia la caché del navegador (Ctrl+F5)
- Abre la consola del navegador para ver errores

## Roadmap

### Próximas características:
- [ ] Exportación de datos a CSV/Excel
- [ ] Gráficas de ventas y estadísticas
- [ ] Búsqueda avanzada con filtros
- [ ] Notificaciones push
- [ ] Integración con API de pago
- [ ] Backend con base de datos
- [ ] Autenticación de usuarios
- [ ] Permisos y roles

## Licencia

Este proyecto es de código abierto. Úsalo libremente para tu negocio.

## Soporte

Para problemas o preguntas, revisa la documentación o abre un issue en el repositorio.

---

**glamstudio** - Tu solución completa para gestionar pedidos de belleza 💄✨
