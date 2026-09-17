select paso, objeto,
       case when presente then 'SI' else 'NO  <-- falta' end as estado
from (
  values
    ('120000 solicitudes', 'tabla business_applications', to_regclass('public.business_applications') is not null),
    ('120000 solicitudes', 'funcion approve_business_application', to_regproc('public.approve_business_application') is not null),
    ('130000 precios',     'columna products.cost_usd', exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='cost_usd')),
    ('130000 precios',     'columna products.price_is_manual', exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='price_is_manual')),
    ('130000 precios',     'columna businesses.default_markup_pct', exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='default_markup_pct')),
    ('130000 precios',     'vista product_pricing', to_regclass('public.product_pricing') is not null),
    ('130000 precios',     'funcion apply_markup', to_regproc('public.apply_markup') is not null),
    ('130000 precios',     'columna order_items.unit_cost', exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='unit_cost')),
    ('140000 liquidacion', 'tabla settlements', to_regclass('public.settlements') is not null),
    ('140000 liquidacion', 'tabla business_payout_accounts', to_regclass('public.business_payout_accounts') is not null),
    ('150000 fotos',       'columna products.photo_urls', exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='photo_urls')),
    ('150000 fotos',       'columna products.photo_url ya retirada', not exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='photo_url')),
    ('160000 permisos',    'funcion is_global_admin', to_regproc('public.is_global_admin') is not null)
) as t(paso, objeto, presente)
order by paso, objeto;
