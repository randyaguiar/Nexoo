\set ON_ERROR_STOP on
-- Datos base (como postgres, saltándose RLS igual que el panel de Supabase).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@nexoo.app'),
  ('22222222-2222-2222-2222-222222222222','duenyo@negocio.cu');

insert into public.admins (user_id, email, role) values
  ('11111111-1111-1111-1111-111111111111','owner@nexoo.app','owner');

-- El flujo entero se apoya en La Habana, y la migración de países dejó Cuba
-- apagado. Encenderlo es parte del escenario de la prueba, no del producto.
update public.countries set active = true where code = 'CU';

insert into public.categories (id, name) values ('33333333-3333-3333-3333-333333333333','Dulcería');
insert into public.municipalities (id, province_code, name)
values ('44444444-4444-4444-4444-444444444444','LaHabana','Playa');

-- 1) El comprador manda la solicitud (rol authenticated, RLS activa).
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.business_applications
  (user_id, contact_email, name, description, municipality_id, contact_phone, category_ids)
values ('22222222-2222-2222-2222-222222222222','duenyo@negocio.cu','Dulcería Prueba',
        'Dulces', '44444444-4444-4444-4444-444444444444','+5350000000',
        array['33333333-3333-3333-3333-333333333333']::uuid[]);
\echo '1 OK: solicitud creada'

-- 2) Un comprador no puede aprobar.
do $$ begin
  begin
    perform public.approve_business_application(
      (select id from public.business_applications limit 1));
    raise exception 'FALLO: un comprador pudo aprobar';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo '2 OK: el comprador no puede aprobar'

-- 3) El owner aprueba.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.approve_business_application(
  (select id from public.business_applications limit 1)) as negocio \gset
\echo '3 OK: aprobada'

select case when exists (select 1 from public.admins
                         where user_id='22222222-2222-2222-2222-222222222222'
                           and role='business_admin' and business_id is not null)
       then '4 OK: el solicitante es business_admin de su negocio'
       else '4 FALLO' end;
-- El negocio recién creado, para el resto de la prueba.
select business_id as b from public.business_applications where status='approved' \gset

-- 5) El negocio crea un producto con su coste y sin precio público.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.products (business_id, name, cost_usd, stock, available)
values (:'b', 'Pastel', 4.00, 10, true);
\echo '5 OK: el negocio crea su producto con coste'

-- 6) Ese producto no se vende todavía.
select case when (select count(*) from public.product_catalog) = 0
  then '6 OK: sin precio no aparece en el catálogo' else '6 FALLO' end;

-- 7) El negocio no puede ponerle precio público.
do $$ begin
  begin
    update public.products set price_usd = 99 where name='Pastel';
    raise exception 'FALLO 7: el negocio pudo fijar el precio público';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo '7 OK: el negocio no puede fijar el precio público'

-- 8) El negocio no ve el coste de otros ni columnas cerradas.
do $$ begin
  begin
    perform cost_usd from public.products limit 1;
    raise exception 'FALLO 8: cost_usd legible desde products';
  exception when insufficient_privilege then null;
  end;
end $$;
\echo '8 OK: cost_usd cerrado por columna'

select '9 OK: el negocio ve su coste por product_pricing = '||cost_usd
from public.product_pricing where name='Pastel';

-- 10) El owner aplica margen del 30%.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select '10 OK: apply_markup cambió '||public.apply_markup(30, :'b', false)||' producto(s)';
select '11 OK: precio = '||price_usd||' (coste 4 + 30%)' from public.product_pricing where name='Pastel';
select case when (select count(*) from public.product_catalog) = 1
  then '12 OK: ya aparece en el catálogo' else '12 FALLO' end;
select id as pid, business_id as bid from public.products where name='Pastel' \gset

-- 13) Un comprador anónimo hace el pedido.
set role anon;
select public.create_order(jsonb_build_object(
  'buyerName','Ana','buyerEmail','ana@x.com','buyerPhone','+1305',
  'recipientName','Luis','recipientPhone','+5352','recipientProvince','LaHabana',
  'recipientMunicipality','Playa','recipientAddress','Calle 1',
  'items', jsonb_build_array(jsonb_build_object('productId', :'pid', 'quantity', 2))
)) as oid \gset
\echo '13 OK: pedido creado por un anónimo'

reset role;
select '14 OK: total='||total_usd||' (2 x 5.20)' from public.orders where id=:'oid';
select '15 OK: unit_cost congelado = '||unit_cost||' (coste del momento)'
from public.order_items where order_id=:'oid';

-- 16) Aunque suba el coste después, el pedido conserva el de la venta.
update public.products set cost_usd = 9.00 where id=:'pid';
select '16 OK: sigue congelado = '||unit_cost from public.order_items where order_id=:'oid';

-- 17) Hasta que el comprador no paga, no hay nada que liquidar.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select case when (select count(*) from public.pending_settlements)=0
  then '17 OK: pedido sin pagar no se liquida' else '17 FALLO' end;

reset role;
update public.orders set status='Paid' where id=:'oid';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select '18 OK: pendiente cobrado='||gross_usd||' se le debe='||cost_usd from public.pending_settlements;

select public.create_settlement(:'bid') as sid \gset
select '19 OK: liquidación bruto='||gross_usd||' coste='||cost_usd||' margen='||fee_usd
from public.settlements where id=:'sid';

select case when (select count(*) from public.pending_settlements)=0
  then '20 OK: ya no aparece como pendiente' else '20 FALLO: se liquidaría dos veces' end;

-- 21) Pagar en otra moneda sin tipo de cambio debe fallar.
do $$ begin
  begin
    perform public.mark_settlement_paid((select id from public.settlements limit 1),
                                        'cash_cuba', 'ref', 'CUP', null, null, null);
    raise exception 'FALLO 21: aceptó CUP sin tipo de cambio';
  exception when sqlstate '22023' then null;
  end;
end $$;
\echo '21 OK: exige tipo de cambio al pagar en CUP'

select public.mark_settlement_paid((select id from public.settlements limit 1),
                                   'cash_cuba','ref-1','CUP', 420.0, 4368.0, null);
select '22 OK: liquidación '||status||', pedido pasa a '||
  (select status from public.orders where id=:'oid')
from public.settlements limit 1;
-- Los intentos que deben fallar: alguien con cuenta pero sin acceso al panel.
reset role;
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555','intruso@x.com') on conflict do nothing;
insert into public.business_applications
  (user_id, contact_email, name, municipality_id, contact_phone)
values ('55555555-5555-5555-5555-555555555555','intruso@x.com','Negocio Pirata',
        '44444444-4444-4444-4444-444444444444','+53');

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

do $$ begin
  begin
    perform public.approve_business_application(
      (select id from public.business_applications where status='pending' limit 1));
    raise exception 'SIGUE ROTO: un comprador se autoaprobó';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo 'A OK: ya no puede autoaprobarse'

do $$ begin
  begin
    perform public.apply_markup(500, null, true);
    raise exception 'SIGUE ROTO: un comprador cambió los precios del marketplace';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo 'B OK: no puede tocar precios'

do $$ begin
  begin
    perform public.create_settlement('44444444-4444-4444-4444-444444444444');
    raise exception 'SIGUE ROTO: un comprador creó una liquidación';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo 'C OK: no puede liquidar'

-- El owner sigue pudiendo.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'D OK: el owner sigue aprobando -> '||public.approve_business_application(
  (select id from public.business_applications where status='pending' limit 1));

-- Comprador y negocio son cuentas separadas -----------------------------------

-- E) El negocio no puede hacer pedidos con su cuenta del panel.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin
    perform public.create_order(jsonb_build_object(
      'buyerName','Dueño','buyerEmail','duenyo@negocio.cu','buyerPhone','+5350000000',
      'recipientName','Luis','recipientPhone','+5352','recipientProvince','LaHabana',
      'recipientMunicipality','Playa','recipientAddress','Calle 1',
      'items', jsonb_build_array(jsonb_build_object(
        'productId', (select id from public.products where name='Pastel'), 'quantity', 1))
    ));
    raise exception 'FALLO E: una cuenta de negocio hizo un pedido';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo 'E OK: la cuenta de negocio no puede comprar'

-- F) Quien ya compró no puede solicitar el alta de un negocio.
reset role;
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666','comprador@x.com') on conflict do nothing;

set role authenticated;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select public.create_order(jsonb_build_object(
  'buyerName','Ana','buyerEmail','comprador@x.com','buyerPhone','+1305',
  'recipientName','Luis','recipientPhone','+5352','recipientProvince','LaHabana',
  'recipientMunicipality','Playa','recipientAddress','Calle 1',
  'items', jsonb_build_array(jsonb_build_object(
    'productId', (select id from public.products where name='Pastel'), 'quantity', 1))
)) as compra \gset

do $$ begin
  begin
    insert into public.business_applications
      (user_id, contact_email, name, municipality_id, contact_phone)
    values ('66666666-6666-6666-6666-666666666666','comprador@x.com','Negocio del comprador',
            '44444444-4444-4444-4444-444444444444','+53');
    raise exception 'FALLO F: un comprador con pedidos pidió el alta';
  exception when sqlstate '42501' then null;
  end;
end $$;
\echo 'F OK: con pedidos no se puede solicitar el alta'

-- G) Y si compra con la solicitud ya pendiente, tampoco se aprueba.
reset role;
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777','listillo@x.com') on conflict do nothing;

set role authenticated;
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
insert into public.business_applications
  (user_id, contact_email, name, municipality_id, contact_phone)
values ('77777777-7777-7777-7777-777777777777','listillo@x.com','Negocio Tardío',
        '44444444-4444-4444-4444-444444444444','+53');

select public.create_order(jsonb_build_object(
  'buyerName','Listillo','buyerEmail','listillo@x.com','buyerPhone','+1305',
  'recipientName','Luis','recipientPhone','+5352','recipientProvince','LaHabana',
  'recipientMunicipality','Playa','recipientAddress','Calle 1',
  'items', jsonb_build_array(jsonb_build_object(
    'productId', (select id from public.products where name='Pastel'), 'quantity', 1))
)) as tardio \gset

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    perform public.approve_business_application(
      (select id from public.business_applications
        where user_id='77777777-7777-7777-7777-777777777777'));
    raise exception 'FALLO G: se aprobó una cuenta que ya había comprado';
  exception when sqlstate '22023' then null;
  end;
end $$;
\echo 'G OK: no se aprueba una cuenta con pedidos'

-- Pasarela de cobro ------------------------------------------------------------

-- H) Solo el owner cambia la pasarela.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  update public.payment_settings set provider='tropipay' where id;
  if found then
    raise exception 'FALLO H: un negocio cambió la pasarela de cobro';
  end if;
end $$;
\echo 'H OK: solo el owner cambia la pasarela'

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.payment_settings set provider='tropipay', eur_per_usd=0.9 where id;
select 'I OK: el owner la cambió a '||provider||' a '||eur_per_usd||' €/$'
from public.payment_settings;

-- J) mark_order_paid deja constancia de con qué se cobró, y es idempotente.
reset role;
insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888','pagador@x.com') on conflict do nothing;

set role anon;
select public.create_order(jsonb_build_object(
  'buyerName','Ana','buyerEmail','ana@x.com','buyerPhone','+1305',
  'recipientName','Luis','recipientPhone','+5352','recipientProvince','LaHabana',
  'recipientMunicipality','Playa','recipientAddress','Calle 1',
  'items', jsonb_build_array(jsonb_build_object(
    'productId', (select id from public.products where name='Pastel'), 'quantity', 1))
)) as poid \gset

reset role;
select case when public.mark_order_paid(:'poid','tropipay','BOC-1','EUR',4.68,0.9)
  then 'J OK: marcado pagado con TropiPay' else 'J FALLO' end;

select case when public.mark_order_paid(:'poid','tropipay','BOC-1','EUR',4.68,0.9) = false
  then 'K OK: el reintento no vuelve a marcarlo' else 'K FALLO' end;

select 'L OK: cobrado '||charged_amount||' '||charged_currency||' al cambio '||fx_rate
from public.orders where id=:'poid';

-- M) Una pasarela inventada no entra.
do $$ begin
  begin
    perform public.mark_order_paid(gen_random_uuid(),'paypal','x','USD',1,1);
    raise exception 'FALLO M: aceptó una pasarela desconocida';
  exception when sqlstate '22023' then null;
  end;
end $$;
\echo 'M OK: rechaza una pasarela desconocida'

-- Países -----------------------------------------------------------------------

-- N) El país sale en el catálogo deducido de la provincia, sin columna propia.
reset role;
select 'N OK: el catálogo dice '||country_code||' / '||country_name
from public.business_catalog limit 1;

-- O) El pedido también lo deduce, para los correos y la confirmación.
select 'O OK: get_order devuelve '||(public.get_order(:'oid') ->> 'recipientCountryName');

-- P) Apagar un país esconde sus provincias del público.
update public.countries set active = false where code = 'CU';
set role anon;
select case when (select count(*) from public.provinces where country_code = 'CU') = 0
  then 'P OK: con el país apagado no se ven sus provincias' else 'P FALLO' end;

reset role;
update public.countries set active = true where code = 'CU';
set role anon;
select case when (select count(*) from public.provinces where country_code = 'CU') > 0
  then 'Q OK: al encenderlo vuelven' else 'Q FALLO' end;

-- R) Un país con provincias no se borra: la FK lo impide.
reset role;
do $$ begin
  begin
    delete from public.countries where code = 'CU';
    raise exception 'FALLO R: borró un país con provincias';
  exception when foreign_key_violation then null;
  end;
end $$;
\echo 'R OK: no se borra un país con provincias'

-- S) Las formas de pago al negocio dejaron de nombrar una isla.
do $$ begin
  begin
    insert into public.business_payout_accounts (business_id, method, holder_name, contact)
    values ((select id from public.businesses limit 1), 'cash_cuba', 'X', 'Y');
    raise exception 'FALLO S: aceptó un método con nombre de país';
  exception when check_violation then null;
  end;
end $$;
\echo 'S OK: los métodos de pago son genéricos'

-- T) Un negocio sin pedidos se puede borrar: el trigger del historial se
-- disparaba después del borrado y escribía un id que ya no existía, así que la
-- clave foránea tumbaba el delete entero.
reset role;
insert into public.businesses (name, municipality_id, contact_phone, active)
values ('Negocio Desechable', '44444444-4444-4444-4444-444444444444', '+53', true);

delete from public.businesses where name = 'Negocio Desechable';
select case when (select count(*) from public.businesses where name='Negocio Desechable') = 0
  then 'T OK: un negocio sin pedidos se borra' else 'T FALLO' end;

select case when exists (
         select 1 from public.activity_log
          where entity = 'businesses' and action = 'delete' and business_id is null)
  then 'U OK: y el borrado queda en el historial, sin referencia rota'
  else 'U FALLO' end;

-- V) Uno con pedidos no: los pedidos son el registro de un dinero que se movió.
do $$ begin
  begin
    delete from public.businesses
     where id = (select business_id from public.orders limit 1);
    raise exception 'FALLO V: borró un negocio con pedidos';
  exception when foreign_key_violation then null;
  end;
end $$;
\echo 'V OK: no se borra un negocio con pedidos'

-- W) El código de operación se guarda: es lo que pide la pasarela para
-- reembolsar, y el de seis argumentos sigue funcionando sin él.
reset role;
set role anon;
select public.create_order(jsonb_build_object(
  'buyerName','Rosa','buyerEmail','rosa@x.com','buyerPhone','+1305',
  'recipientName','Iris','recipientPhone','+5352','recipientProvince','LaHabana',
  'recipientMunicipality','Playa','recipientAddress','Calle 9',
  'items', jsonb_build_array(jsonb_build_object(
    'productId', (select id from public.products where name='Pastel'), 'quantity', 1))
)) as woid \gset

reset role;
select case when public.mark_order_paid(:'woid','tropipay','BOC-2','EUR',4.68,0.9,'ORDER-CODE-2')
  then 'W OK: marcado pagado con código de operación' else 'W FALLO' end;

select case when payment_order_code = 'ORDER-CODE-2' and payment_charge_id = 'BOC-2'
  then 'X OK: orderCode y bankOrderCode se guardan por separado' else 'X FALLO' end
from public.orders where id=:'woid';

-- Y) Los pedidos que esperan cobro: solo los que abrieron uno y con margen para
-- que llegue el aviso.
set role anon;
select public.create_order(jsonb_build_object(
  'buyerName','Tere','buyerEmail','tere@x.com','buyerPhone','+1305',
  'recipientName','Olga','recipientPhone','+5352','recipientProvince','LaHabana',
  'recipientMunicipality','Playa','recipientAddress','Calle 11',
  'items', jsonb_build_array(jsonb_build_object(
    'productId', (select id from public.products where name='Pastel'), 'quantity', 1))
)) as yoid \gset

reset role;
select case when (select count(*) from public.orders_awaiting_payment('tropipay')) = 0
  then 'Y OK: un pedido recién creado no se repasa todavía' else 'Y FALLO' end;

update public.orders
   set payment_provider = 'tropipay',
       payment_reference = 'CARD-1',
       charged_amount = 4.68,
       created_at = now() - interval '1 hour'
 where id = :'yoid';

select case when (select count(*) from public.orders_awaiting_payment('tropipay')) = 1
  then 'Z OK: con el cobro abierto y pasado el margen, sí' else 'Z FALLO' end;

-- AA) Las formas de pago: al menos una, y solo las que admite la pasarela.
reset role;
update public.payment_settings set payment_methods = array['EXT','TPP'] where id;
select case when payment_methods = array['EXT','TPP']
  then 'AA OK: se guardan las formas de pago elegidas' else 'AA FALLO' end
from public.payment_settings;

do $$ begin
  begin
    update public.payment_settings set payment_methods = array[]::text[] where id;
    raise exception 'FALLO AB: aceptó quedarse sin formas de pago';
  exception when check_violation then null;
  end;
end $$;
\echo 'AB OK: no se puede dejar al comprador sin forma de pagar'

do $$ begin
  begin
    update public.payment_settings set payment_methods = array['PAYPAL'] where id;
    raise exception 'FALLO AC: aceptó una forma de pago inventada';
  exception when check_violation then null;
  end;
end $$;
\echo 'AC OK: una forma de pago inventada no entra'
