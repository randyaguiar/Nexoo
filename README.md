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
| Login y panel admin      | Supabase Auth + policies contra la tabla `admins`            |
| Aviso de pedido al admin | Database Webhook → Edge Function `notify-new-order` → Resend |

## Modelo de datos

| Tabla         | Campos clave                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `businesses`  | name, description, province, municipality, contact_phone, active                                            |
| `products`    | business_id, name, price_usd, photo_url, available                                                          |
| `orders`      | buyer_*, recipient_* (nombre, teléfono, provincia, municipio, dirección), business_id, status, total_usd     |
| `order_items` | order_id, product_id, product_name, quantity, unit_price                                                    |
| `admins`      | user_id (→ `auth.users`), email                                                                             |

`province` (`PinarDelRio`, `LaHabana`) y `status` (`PendingPayment`, `Paid`, `PaidToBusiness`,
`Delivered`, `Cancelled`) son texto con `CHECK`: añadir valores no requiere migrar datos.

## Reglas de negocio y por qué viven en la base de datos

El comprador es anónimo, así que **no puede escribir en `orders`**: no hay policy de insert para el
rol `anon`. El checkout llama a `create_order(payload jsonb)`, que:

- resuelve nombre y precio de cada producto **desde la tabla**, nunca desde el cliente (si no, se
  podría enviar `total_usd = 0`);
- rechaza pedidos que mezclen negocios, porque cada negocio se paga por separado;
- suma las líneas repetidas del mismo producto y valida cantidades entre 1 y 100;
- rechaza productos no disponibles o de negocios desactivados.

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

Catálogo → filtro por provincia → negocio → carrito (un solo negocio) → checkout con datos del
comprador y del destinatario → pedido `Pendiente de pago` + instrucciones de Zelle + email al admin
→ el panel lista el pedido y cambia su estado.

## Fuera del alcance del MVP

Pagos automáticos, split de comisiones, multi-idioma, SMS y provincias adicionales.
