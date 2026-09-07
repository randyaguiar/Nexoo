# Nexoo

Plataforma para comprar en negocios locales de Cuba (Pinar del Río y La Habana) desde EE.UU. y
entregar el pedido a un familiar en la isla. El pago se coordina manualmente por Zelle fuera de la
plataforma.

## Estructura

```
backend/Nexoo.Api   API REST en .NET 8 (minimal APIs + EF Core / Npgsql)
frontend            React + Vite + TypeScript
db                  schema.sql y seed.sql para PostgreSQL / Supabase
```

## Modelo de datos

| Tabla         | Campos clave                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `businesses`  | name, description, province, municipality, contact_phone, active                                   |
| `products`    | business_id, name, price_usd, photo_url, available                                                 |
| `orders`      | buyer_*, recipient_* (nombre, teléfono, provincia, municipio, dirección), business_id, status, total_usd |
| `order_items` | order_id, product_id, product_name, quantity, unit_price                                           |

`province` y `status` se guardan como texto (`PinarDelRio`, `LaHabana`; `PendingPayment`, `Paid`,
`PaidToBusiness`, `Delivered`, `Cancelled`) para que añadir valores no requiera migrar datos.

## API

Público:

- `GET /api/catalog/businesses?province=PinarDelRio` — negocios activos, filtrables por provincia
- `GET /api/catalog/businesses/{id}` — negocio + productos disponibles
- `POST /api/orders` — crea el pedido en estado `PendingPayment`
- `GET /api/orders/{id}` — confirmación del pedido (el id actúa como token de acceso)

Admin (requiere `Authorization: Bearer <token>`):

- `POST /api/admin/login` — devuelve un JWT
- `GET|POST|PUT|DELETE /api/admin/businesses[/{id}]`
- `GET|POST|PUT|DELETE /api/admin/products[/{id}]` (`?businessId=` para filtrar)
- `GET /api/admin/orders[?status=Paid]`, `PUT /api/admin/orders/{id}/status`

Reglas de negocio aplicadas en el servidor:

- Un pedido solo puede contener productos de **un** negocio (cada negocio se paga por separado).
- Los precios y el total se calculan desde la base de datos, nunca desde el cliente.
- Negocios y productos con historial de pedidos no se borran: se desactivan.

## Puesta en marcha

### Base de datos

Con Supabase o cualquier PostgreSQL:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql   # datos de prueba (opcional)
```

En desarrollo la API también crea el esquema al arrancar (`EnsureCreated`) y siembra dos negocios
de prueba.

### Backend

```bash
cd backend/Nexoo.Api
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:Postgres" "Host=...;Database=...;Username=...;Password=..."
dotnet user-secrets set "Admin:Email" "admin@nexoo.app"
dotnet user-secrets set "Admin:Password" "..."
dotnet user-secrets set "Admin:JwtSigningKey" "<mínimo 32 caracteres>"
dotnet run
```

La API escucha en `http://localhost:5080` y expone Swagger en `/swagger` en desarrollo.

Para las notificaciones por email al admin, configura la sección `Smtp`. Sin SMTP configurado el
correo se escribe en el log y el pedido se crea igual.

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Abre `http://localhost:5173`. El panel admin está en `/admin/login`.

## Despliegue (Vercel + Render + Supabase)

Vercel no ejecuta .NET, así que el sitio se reparte en tres piezas. Una vez conectadas, cada push a
la rama desplegada actualiza el frontend y el backend automáticamente.

### 1. Base de datos — Supabase

Crea el proyecto y copia la *connection string* (Project settings → Database → Connection string →
URI). La API crea las tablas al arrancar; si prefieres hacerlo a mano, ejecuta `db/schema.sql` y
`db/seed.sql` desde el SQL editor.

### 2. API — Render (Docker)

El repositorio incluye `backend/Dockerfile` y `render.yaml`. En Render: *New → Blueprint*, apunta al
repositorio y rellena las variables:

| Variable               | Valor                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`         | la URI `postgresql://…` de Supabase                               |
| `CORS_ALLOWED_ORIGINS` | dominios de Vercel separados por coma                             |
| `Admin__Email`         | email del admin                                                   |
| `Admin__Password`      | contraseña del admin                                              |
| `Admin__JwtSigningKey` | la genera Render automáticamente                                  |
| `Smtp__*`              | opcional; sin SMTP el aviso de pedido solo se escribe en el log   |

`SeedSampleData=true` siembra los negocios de prueba también en producción (útil para la primera
revisión; quítalo después). La API queda en `https://nexoo-api.onrender.com`.

> El plan gratuito de Render duerme el servicio tras unos minutos de inactividad: la primera carga
> del catálogo puede tardar ~30 s.

### 3. Frontend — Vercel

*New Project* → el repositorio → **Root Directory: `frontend`**. Vercel detecta Vite; `vercel.json`
ya incluye el rewrite a `index.html` que necesitan las rutas del router. Variables de entorno:

| Variable           | Valor                                     |
| ------------------ | ----------------------------------------- |
| `VITE_API_URL`     | `https://nexoo-api.onrender.com`          |
| `VITE_ZELLE_EMAIL` | el email/usuario de Zelle de Nexoo        |

Después añade el dominio de Vercel a `CORS_ALLOWED_ORIGINS` en Render y vuelve a desplegar la API.

## Flujo end-to-end

Catálogo → filtro por provincia → negocio → carrito (un solo negocio) → checkout con datos del
comprador y del destinatario → pedido `Pendiente de pago` + instrucciones de Zelle + email al
admin → panel admin lista el pedido y cambia su estado.

## Fuera del alcance del MVP

Pagos automáticos, split de comisiones, multi-idioma, SMS y provincias adicionales.
