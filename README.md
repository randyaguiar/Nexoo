# Nexoo

Plataforma para comprar en negocios locales de Cuba (Pinar del Río y La Habana) desde EE.UU. y
entregar el pedido a un familiar en la isla. El pago se coordina manualmente por Zelle fuera de la
plataforma.

## Arquitectura

Supabase es el backend completo: no hay servidor propio que mantener.

```
frontend             React + Vite + TypeScript (se despliega en Vercel)
supabase/migrations  esquema, RLS y funciones SQL
supabase/functions   Edge Function del aviso por email
supabase/seed.sql    catálogo de prueba
```

| Pieza                    | Cómo se resuelve                                            |
| ------------------------ | ----------------------------------------------------------- |
| Catálogo público         | `supabase-js` → PostgREST, con policies de solo lectura      |
| Creación de pedidos      | RPC `create_order()` (`SECURITY DEFINER`)                    |
| Confirmación del pedido  | RPC `get_order()`, el id del pedido actúa como token         |
| Cuentas de compradores   | Supabase Auth (email + contraseña); `orders.user_id`         |
| Login y panel admin      | Supabase Auth + policies contra la tabla `admins`            |
| Gestión de usuarios      | Edge Function `manage-admins` (service role) + rol `owner`   |
| Aviso de pedido al admin | Database Webhook → Edge Function `notify-new-order` → Resend |

## Modelo de datos

| Tabla         | Campos clave                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `businesses`  | name, description, logo_url, province, municipality_id/municipality, contact_phone, active                   |
| `business_categories` | business_id + category_id (un negocio puede ofrecer varios servicios)                               |
| `provinces`   | code (PK, p. ej. `LaHabana`), name, active                                                                  |
| `municipalities` | province_code, name, active (único por provincia)                                                        |
| `categories`  | name (único), description, active — tipo de servicio del negocio                                            |
| `products`    | business_id, name, price_usd, photo_url, available                                                          |
| `orders`      | buyer_*, recipient_* (nombre, teléfono, provincia, municipio, dirección), business_id, status, total_usd, user_id |
| `order_items` | order_id, product_id, product_name, quantity, unit_price                                                    |
| `admins`      | user_id (→ `auth.users`), email, role (`owner` \| `staff`)                                                   |

Provincias, municipios y categorías se gestionan desde el panel (`/admin/lugares`,
`/admin/categorias`). Guardar un negocio y sus categorías es una sola transacción, `save_business()`
(sin `security definer`: las policies de admin siguen decidiendo). `businesses.province` y `orders.recipient_province` guardan el código de la
provincia con FK a `provinces`; el trigger `businesses_sync_municipality` deriva `province` y
`municipality` del `municipality_id` elegido, así que no pueden quedar desalineados y renombrar un
municipio se propaga a sus negocios. `status` (`PendingPayment`, `Paid`, `PaidToBusiness`,
`Delivered`, `Cancelled`) sigue siendo texto con `CHECK`.

## Reglas de negocio y por qué viven en la base de datos

Comprar **no exige cuenta**. Quien crea una (registro en `/registro`, login en `/entrar`) ve sus
pedidos en `/mis-pedidos`: `create_order()` guarda `auth.uid()` en `orders.user_id` y una policy
deja al comprador leer solo esas filas. Los pedidos hechos sin sesión quedan con `user_id` nulo y
se siguen consultando únicamente con su id; **no se reclaman después por email**, porque el email
del pedido no está verificado. Una cuenta de comprador no da ningún acceso al panel: eso lo decide
la tabla `admins`.

El comprador nunca escribe en `orders`: no hay policy de insert, ni para `anon` ni para
`authenticated`. El checkout llama a `create_order(payload jsonb)`, que:

- resuelve nombre y precio de cada producto **desde la tabla**, nunca desde el cliente (si no, se
  podría enviar `total_usd = 0`);
- rechaza pedidos que mezclen negocios, porque cada negocio se paga por separado;
- suma las líneas repetidas del mismo producto y valida cantidades entre 1 y 100;
- rechaza productos no disponibles o de negocios desactivados.

Los usuarios del panel se gestionan desde *Admin → Usuarios*, visible solo para el rol `owner`.
Crear o borrar cuentas exige la service role, que no puede viajar al navegador, así que la UI llama
a la Edge Function `manage-admins`, que comprueba en cada petición que quien llama es `owner`.
Quitar el acceso borra la fila de `admins` y conserva el usuario de `auth.users`; siempre debe
quedar al menos un `owner` y nadie puede degradarse ni eliminarse a sí mismo.

Negocios y productos con pedidos asociados no se pueden borrar (lo impide la clave foránea): el
panel los desactiva en su lugar.

## Puesta en marcha

### 1. Supabase

Crea el proyecto y aplica las migraciones con la CLI:

```bash
supabase link --project-ref <tu-project-ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql   # catálogo de prueba (opcional)
```

Alternativa sin CLI: pega el contenido de `supabase/migrations/*.sql` (en orden) y de
`supabase/seed.sql` en el SQL editor del panel.

### 2. Usuario admin

Authentication → Users → *Add user* (email + contraseña, confirmado). Después, en el SQL editor:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'admin@nexoo.app';
```

Sin esa fila el usuario puede iniciar sesión pero no ve ningún pedido: `is_admin()` devuelve falso.
Ese primer usuario queda como `owner`; los siguientes se crean desde *Admin → Usuarios* (requiere
desplegar `manage-admins`):

```bash
supabase functions deploy manage-admins
```

### 3. Aviso por email (opcional)

```bash
supabase functions deploy notify-new-order
supabase secrets set RESEND_API_KEY=... ADMIN_EMAIL=admin@nexoo.app FROM_EMAIL='Nexoo <pedidos@tudominio.com>'
```

Luego Database → Webhooks → nuevo webhook: tabla `public.orders`, evento `INSERT`, tipo *Supabase
Edge Functions*, función `notify-new-order`. Sin `RESEND_API_KEY` el pedido se crea igual y el aviso
solo queda en el log de la función.

### 4. Frontend

```bash
cd frontend
cp .env.example .env    # rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

`http://localhost:5173`; el panel está en `/admin/login`.

> La `anon key` es pública por diseño y va en el bundle: quien protege los datos es RLS, no la
> clave. La `service_role` key **nunca** debe aparecer en el frontend.

### 5. Vercel

*New Project* → el repositorio → **Root Directory: `frontend`**. Vercel detecta Vite y `vercel.json`
ya trae el rewrite a `index.html` que necesitan las rutas del router. Añade `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` y `VITE_ZELLE_EMAIL` como variables de entorno. A partir de ahí cada push
publica solo.

## Flujo end-to-end

Catálogo → filtro por provincia y categoría → negocio → carrito (un solo negocio) → checkout con datos del
comprador y del destinatario → pedido `Pendiente de pago` + instrucciones de Zelle + email al admin
→ el panel lista el pedido y cambia su estado.

## Fuera del alcance del MVP

Pagos automáticos, split de comisiones, multi-idioma y SMS.
