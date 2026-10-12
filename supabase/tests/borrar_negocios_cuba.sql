-- Borra los negocios de Cuba. Esto no se deshace: mira antes
-- `inventario_cuba.sql`, que enseña qué le pasaría a cada uno.
--
-- Lo que NO se borra, a propósito:
--
--   * Los negocios con pedidos o liquidaciones. `orders.business_id` y
--     `settlements.business_id` son `on delete restrict`, y eso no es un
--     estorbo: un pedido es el registro de un dinero que se movió y de alguien
--     a quien se le debe o se le pagó. Esos negocios se desactivan, que deja el
--     mismo resultado de cara al público.
--   * Los pedidos, que por lo anterior se quedan enteros.
--   * Las solicitudes de alta: quedan como historial, apuntando a nada.
--   * Las cuentas de quienes gestionaban esos negocios. Pierden el acceso al
--     panel (su fila de `admins` se borra en cascada) pero el usuario sigue
--     existiendo.
--   * Las fotos de los productos y los logos, que viven en Storage y no en la
--     base de datos. Si quieres vaciarlos, es a mano en Storage.
--
-- Todo va en una transacción: o se hace entero, o no se hace nada.

begin;

create temp table negocios_cuba on commit drop as
select b.id, b.name
from public.businesses b
join public.provinces p on p.code = b.province
where p.country_code = 'CU';

create temp table con_historial on commit drop as
select n.id
from negocios_cuba n
where exists (select 1 from public.orders o where o.business_id = n.id)
   or exists (select 1 from public.settlements s where s.business_id = n.id);

-- Las reservas de carrito cuelgan de productos vivos; sin esto el borrado de
-- productos se lleva por delante un carrito ajeno a medias.
delete from public.stock_reservations
 where product_id in (
     select p.id from public.products p
      where p.business_id in (select id from negocios_cuba)
        and p.business_id not in (select id from con_historial)
 );

delete from public.products
 where business_id in (select id from negocios_cuba)
   and business_id not in (select id from con_historial);

delete from public.businesses
 where id in (select id from negocios_cuba)
   and id not in (select id from con_historial);

update public.businesses
   set active = false
 where id in (select id from con_historial);

select (select count(*) from negocios_cuba)    as negocios_de_cuba,
       (select count(*) from con_historial)    as desactivados_por_tener_pedidos,
       (select count(*) from negocios_cuba)
     - (select count(*) from con_historial)    as borrados;

commit;
