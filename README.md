# Nexoo

Plataforma para comprar en negocios locales de América Latina desde fuera y entregar el pedido a un
familiar allá mismo. El comprador paga con tarjeta; la plataforma liquida después a cada negocio.

La geografía son datos, no código: países, provincias y municipios se gestionan desde el panel, y el
sitio arrancó con Cuba porque es donde había negocios. Añadir otra isla es dar de alta el país y sus
provincias, sin tocar nada.

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
| Correos del pedido       | el webhook de la pasarela → Edge Function `notify-order-paid` → Resend |

## Modelo de datos

| Tabla         | Campos clave                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `businesses`  | name, description, logo_url, province, municipality_id/municipality, contact_phone, active                   |
| `business_categories` | business_id + category_id (un negocio puede ofrecer varios servicios)                               |
| `countries`   | code (PK, ISO-2: `CU`, `DO`…), name, phone_prefix, active                                                   |
| `provinces`   | code (PK, único en todo el marketplace: `CUHabana`), country_code, name, active                             |
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

### Cobro

El pedido se crea antes de pagar, porque `create_order()` es quien reserva el stock; nace como
`PendingPayment` y solo pasa a `Paid` cuando la pasarela confirma el cobro por webhook. Volver del
checkout a la web no prueba nada —esa URL se puede escribir a mano—, así que la página de
confirmación enseña lo que diga la base de datos, no lo que diga el parámetro de vuelta.

Hay dos pasarelas y una activa a la vez, en `payment_settings`: **Stripe** cobra en dólares y
**TropiPay** en euros. El pedido se guarda siempre en dólares y lo que se anota es cómo se cobró
(`payment_provider`, `charged_currency`, `charged_amount`, `fx_rate`), igual que en las
liquidaciones en CUP. Lo que se le paga al negocio no depende de la pasarela.

`create-checkout-session` lee el importe y las líneas de la base de datos, nunca del navegador: si
vinieran del cliente se podría pagar un pedido de 300 USD por uno. Con Stripe manda una
`Idempotency-Key` con el id del pedido; con TropiPay el enlace es `singleUse`. En los dos casos,
pulsar dos veces no abre dos cobros.

Los dos webhooks acaban en `mark_order_paid()`, que filtra por estado: el reintento de un evento ya
procesado no cambia nada. Esa función es la única vía para dar por pagado un pedido y está
concedida solo a la `service_role`.

Lo que cambia entre los dos es cómo se comprueba que el aviso es auténtico. `stripe-webhook`
verifica la firma `t=…,v1=…` con HMAC-SHA256 y compara en tiempo constante. Para TropiPay no hay
documentación suficiente del esquema de firma, así que `tropipay-webhook` no se fía del cuerpo del
aviso: lo usa solo para saber qué cobro mirar y vuelve a leerlo contra la API de TropiPay con
nuestras credenciales, comprobando además que el importe coincida con el que abrimos. Un aviso
falsificado no puede dar nada por pagado.

Zelle sigue en el proyecto, pero como forma de **pagarle al negocio**
(`business_payout_accounts.method = 'zelle_us'`). Eso es dinero saliendo.

### Fotos de producto

Hasta tres por producto, en `products.photo_urls`, subidas al bucket `product-photos`. La primera es
la que sale en la tarjeta del catálogo; el resto aparecen como miniaturas que la sustituyen.

La ruta del archivo empieza por el uuid del negocio y la policy del bucket compara ese tramo con el
negocio de la sesión, así que ninguno puede escribir en la carpeta de otro. (El bucket de logos, más
antiguo, solo comprueba `is_admin()`: cualquier usuario del panel puede tocar los de todos.)

Quitar una foto de un producto no borra el archivo del bucket: la misma URL podría estar en uso y
dejarla rota sería peor que ocupar unos kilobytes de más.

### Precios y liquidaciones

El negocio declara su precio mayorista (`products.cost_usd`) y la plataforma fija el público
(`products.price_usd`). Un producto sin precio público no existe para el comprador: queda fuera del
catálogo y `create_order()` lo rechaza, así que cada alta pasa por *Admin → Precios*.

`cost_usd` no se protege con un grant por rol porque no lo habría: todos los usuarios de la app son
el mismo rol de Postgres (`authenticated`) y los roles de Nexoo viven en `admins`. Se cierra por
columna para todos y el panel lo lee por la vista `product_pricing`, que filtra con
`can_access_business()`. Un trigger impide además que un rol de negocio toque el precio público.

`apply_markup()` recalcula precios desde el coste —un negocio o el marketplace entero— y respeta
los que se ajustaron a mano salvo que se pida lo contrario; ese "a mano" lo marca el mismo trigger.

Una liquidación agrupa los pedidos de un negocio ya cobrados al comprador y todavía sin pagar, y
congela lo que entró, lo que se debe y el margen. El vínculo es `orders.settlement_id`, así que un
pedido no puede entrar en dos. Los pedidos en `PaidToBusiness` quedan fuera a propósito: ese estado
significa que ya se pagó a mano. Lo que se le debe al negocio sale de `order_items.unit_cost`, el
coste del momento de la venta, no el de hoy.

Los datos de cobro del negocio viven en `business_payout_accounts` y no en `businesses`, porque esa
tabla la lee `anon` entera y ahí hay nombres y teléfonos de personas.

### Alta de negocios

Un negocio entra solo: quien lo gestiona crea su cuenta de comprador, rellena `/registro-negocio` y
la solicitud queda en `business_applications` como `pending`. Un rol global la resuelve desde
*Admin → Solicitudes*.

Aprobar es una sola llamada, `approve_business_application()`, que en la misma transacción crea el
negocio con sus categorías y le da a quien solicitó el rol `business_admin` de ese negocio. Se hace
en una función `security definer` porque escribir en `admins` no está abierto a nadie por policy, y
porque un negocio sin dueño (o un dueño sin negocio) dejaría el panel en un estado imposible.

Como la solicitud exige sesión, al aprobar ya existe el `auth.users.id` y no hace falta invitar por
email. Una persona pertenece a un solo negocio (`admins.user_id` es la clave primaria), así que la
función rechaza aprobar a quien ya tiene acceso al panel. Un índice parcial deja una sola solicitud
`pending` por persona; rechazada, puede volver a enviarla con el motivo a la vista.

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

### 3. URLs de confirmación de cuenta

Authentication → **URL Configuration**:

- **Site URL**: la URL pública del sitio (`https://tu-dominio.vercel.app`). El valor por defecto es
  `http://localhost:3000`, y con él el enlace del correo de confirmación no lleva a ninguna parte.
- **Redirect URLs**: añade `http://localhost:5173/auth/confirmado` y
  `https://tu-dominio.vercel.app/auth/confirmado`.

El registro pide la vuelta a `/auth/confirmado` (`EMAIL_CONFIRM_PATH` en `frontend/src/api/client.ts`);
si esa URL no está en la lista, Supabase la ignora y usa el Site URL.

### 4. Remitente de los correos de Auth (SMTP propio)

Sin SMTP propio los correos salen como *Supabase Auth &lt;noreply@mail.app.supabase.io&gt;*, **solo
llegan a las direcciones del equipo del proyecto** y hay un tope de 2 por hora: sirve para probar,
no para compradores reales. Con Resend (el mismo proveedor que usa `notify-order-paid`):

1. Resend → *Domains* → añade el dominio y publica los registros DNS hasta que quede *Verified*.
2. Supabase → Authentication → **Emails** → *SMTP Settings* (`/dashboard/project/_/auth/smtp`) →
   activa *Enable Custom SMTP*:

   | Campo         | Valor                          |
   | ------------- | ------------------------------ |
   | Sender email  | `no-reply@tudominio.com`       |
   | Sender name   | `Nexoo`                        |
   | Host          | `smtp.resend.com`              |
   | Port          | `587`                          |
   | Username      | `resend`                       |
   | Password      | la API key de Resend           |

3. Authentication → **Rate Limits** → con SMTP propio el tope pasa a 30 usuarios nuevos por hora;
   súbelo si hace falta.

El asunto y el cuerpo se editan en Authentication → **Emails** → *Templates* → *Confirm signup*. Si se
cambia la plantilla, hay que conservar `{{ .ConfirmationURL }}`; la variante con
`{{ .TokenHash }}` también funciona porque `/auth/confirmado` canjea los dos formatos.

### 5. Cobro

Hay dos pasarelas y solo una activa a la vez. La elige el owner en el panel, en **Pagos**
(`payment_settings`), y `create-checkout-session` la lee al abrir cada cobro. Los pedidos que ya
estén abiertos siguen con la pasarela con la que nacieron.

El pedido se guarda **siempre en dólares** —precios, costes y liquidaciones no cambian—; lo que se
anota es en qué moneda y con qué cambio se cobró (`charged_currency`, `charged_amount`, `fx_rate`),
igual que ya se hacía al pagarle a un negocio en CUP.

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy tropipay-webhook
```

`SITE_URL` (la URL pública del sitio, sin barra final) hace falta para las dos.

**Stripe** — cobra en dólares.

1. Stripe → *Developers → API keys* → copia la clave secreta y guárdala como `STRIPE_SECRET_KEY`.
2. Stripe → *Developers → Webhooks* → *Add endpoint*:
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, evento
   `checkout.session.completed`. Copia el *signing secret* y guárdalo como `STRIPE_WEBHOOK_SECRET`.

**TropiPay** — cobra en euros.

1. Secrets: `TROPIPAY_CLIENT_ID`, `TROPIPAY_CLIENT_SECRET` y `TROPIPAY_API_URL`
   (`https://sandbox.tropipay.me` para probar). Opcionales: `TROPIPAY_ACCOUNT_ID` si tienes más de
   una cuenta y `TROPIPAY_REASON_ID` si el motivo por defecto no te sirve.

   En `TROPIPAY_CLIENT_SECRET` va lo que te den. El token se pide con un OAuth normal
   (`client_credentials`, los scopes separados por espacios) en `/api/v3/access/token`, y si esa ruta
   falla se reintenta en `/api/v2/access/token`; la versión que conteste manda también en el resto de
   rutas. Si el secret empieza por `sk_` o `pk_` se usa tal cual.

   La API key se crea en el panel de TropiPay con dos permisos: *Transferencias Entrada* y *Recarga
   externa*. **El campo de IP se deja vacío**: las Edge Functions no salen por una IP fija y una
   credencial atada a una IP devuelve `Forbidden` siempre.
2. El aviso de pago no se configura en su panel: la URL se manda en cada cobro
   (`urlNotification`), apuntando a `tropipay-webhook`.
3. `TROPIPAY_PAID_STATES` casi nunca hace falta: por defecto cuenta como pagado el estado `5`,
   que es el que manda TropiPay cuando la tarjeta ya se ha cobrado. Que su panel lo siga enseñando
   como *Pendiente* es la liquidación al saldo, no el cobro —igual que con Stripe, donde el pedido
   se da por pagado aunque el dinero tarde días—. Si algún día usan otro número, se cambia con ese
   secret (admite varios separados por comas) sin tocar código.

Las tres funciones van con `verify_jwt = false` (`supabase/config.toml`): a la primera la llama un
comprador que puede no tener cuenta, y a las otras dos las llaman las pasarelas, que no mandan un
JWT.

> Stripe firma sus avisos con un HMAC y se comprueba. TropiPay también: manda tres firmas
> —`signature`, `signaturev2` y `signaturev3`— que son `sha256(bankOrderCode + clientId + secret +
> importe)`, con el secret tal cual en las primeras y pasado por `sha1` en la v3. `tropipay-webhook` no toca el pedido si ninguna cuadra, y deja el aviso
> entero en el log. Esto no es un detalle: el comprador conoce el id de su propio pedido, porque
> está en su URL, así que sin firma el aviso no prueba nada.

### 6. Correos del pedido

Cuando Stripe confirma el cobro, `stripe-webhook` llama a `notify-order-paid`, que manda tres
correos: el aviso interno, la confirmación al comprador y la orden de preparación a la tienda. Cada
uno ve lo suyo —el comprador no ve lo que cobra la tienda, la tienda no ve lo que pagó el
comprador— y el margen solo aparece en el interno.

```bash
supabase functions deploy notify-order-paid
supabase secrets set RESEND_API_KEY=... ADMIN_EMAIL=admin@nexoo.app FROM_EMAIL='Nexoo <pedidos@tudominio.com>'
```

`SITE_URL` (la del cobro) se reaprovecha para el enlace al pedido. La dirección de la tienda sale de
`admins`, no de `businesses`: esa tabla la lee cualquiera sin sesión.

Sin `RESEND_API_KEY` el pedido se cobra igual y el contenido de los correos queda en el log de la
función.

> Antes esto era `notify-new-order`, colgado de un Database Webhook sobre el `INSERT` en `orders`.
> Con Stripe ese momento dejó de servir: un pedido nace como `PendingPayment` y puede no pagarse
> nunca. Si vienes de esa versión, borra el webhook (Integrations → Webhooks) y la función.

### 7. Frontend

```bash
cd frontend
cp .env.example .env    # rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

> El `.env` hace falta también para `npm run build`. Sin él, `src/api/supabase.ts` lanza en el
> propio import, el bundler lo da por código muerto y **compila sin fallar un bundle sin la
> aplicación dentro**. Un build que pasa no prueba gran cosa si no hay `.env`.

`http://localhost:5173`; el panel está en `/admin/login`.

> La `anon key` es pública por diseño y va en el bundle: quien protege los datos es RLS, no la
> clave. La `service_role` key **nunca** debe aparecer en el frontend.

### 8. Vercel

*New Project* → el repositorio → **Root Directory: `frontend`**. Vercel detecta Vite y `vercel.json`
ya trae el rewrite a `index.html` que necesitan las rutas del router. Añade `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` como variables de entorno. A partir de ahí cada push
publica solo.

## Flujo end-to-end

Catálogo → filtro por provincia y categoría → negocio → carrito (un solo negocio) → checkout con datos del
comprador y del destinatario → pago con tarjeta en Stripe → el webhook marca el pedido pagado + email al admin
→ el panel lista el pedido y cambia su estado.

## Fuera del alcance del MVP

Pagos automáticos, split de comisiones, multi-idioma y SMS.

### Geografía y países

`countries` → `provinces` → `municipalities`, los tres gestionables desde **Provincias y
municipios** en el panel. Apagar un nivel esconde los de abajo: un país inactivo saca del catálogo
sus provincias y, con ellas, sus negocios.

El país **no se guarda** en `businesses` ni en `orders`: se deduce de la provincia, que ya está en
los dos. Así no hay dos columnas que puedan quedar desalineadas, y `create_order()` no cambia.

El código de la provincia es la clave primaria, así que es único en todo el marketplace y no dentro
de su país: 'Santiago' existe en Cuba y en República Dominicana, y por eso se usan con prefijo
(`CUSantiago`, `DOSantiago`). El formulario del panel lo recuerda al crearlas.

En el checkout el país **no se elige**: lo marca el negocio que esté en el carrito, y solo se
ofrecen sus provincias. No se puede comprar en una isla y entregar en otra, que es justo lo que
`create_order()` no sabría preparar.
