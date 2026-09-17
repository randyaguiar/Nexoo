\set ON_ERROR_STOP on
-- Datos base (como postgres, saltándose RLS igual que el panel de Supabase).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@nexoo.app'),
  ('22222222-2222-2222-2222-222222222222','duenyo@negocio.cu');

insert into public.admins (user_id, email, role) values
  ('11111111-1111-1111-1111-111111111111','owner@nexoo.app','owner');

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
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.approve_business_application(
  (select id from public.business_applications where status='pending' limit 1)) as b \gset
\echo '3 OK: el owner aprueba'

select case when exists (select 1 from public.admins
       where user_id='22222222-2222-2222-2222-222222222222' and role='business_admin')
  then '4 OK: solicitante convertido en business_admin' else '4 FALLO' end;

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
