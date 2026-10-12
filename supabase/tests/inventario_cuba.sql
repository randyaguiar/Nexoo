-- Qué hay colgando de Cuba, antes de borrar nada. Solo lee.
-- Se pega tal cual en el SQL editor de Supabase.

select b.name                                as negocio,
       b.province                            as provincia,
       b.active                              as visible,
       (select count(*) from public.products p
         where p.business_id = b.id)          as productos,
       (select count(*) from public.orders o
         where o.business_id = b.id)          as pedidos,
       (select count(*) from public.settlements s
         where s.business_id = b.id)          as liquidaciones,
       (select count(*) from public.admins a
         where a.business_id = b.id)          as usuarios_del_panel,
       case
           when exists (select 1 from public.orders o where o.business_id = b.id)
             or exists (select 1 from public.settlements s where s.business_id = b.id)
           then 'SE DESACTIVA (tiene historial de dinero)'
           else 'SE BORRA'
       end                                   as que_le_pasaria
from public.businesses b
join public.provinces p on p.code = b.province
where p.country_code = 'CU'
order by b.name;
