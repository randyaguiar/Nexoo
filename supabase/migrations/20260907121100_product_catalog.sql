-- El catálogo enseña el stock libre, no el de la tabla.
--
-- `products.stock` es el inventario del negocio: incluye unidades que otro
-- comprador ya tiene reservadas en su carrito y que, por tanto, no se pueden
-- vender ahora. La tienda mira esta vista; el panel sigue mirando la tabla,
-- porque para el negocio el inventario real es el de verdad.

create or replace view public.product_catalog
with (security_invoker = on) as
    select p.id,
           p.business_id,
           p.name,
           p.description,
           p.price_usd,
           p.photo_url,
           p.available,
           -- available_stock() es security definer: descuenta las reservas sin
           -- abrir stock_reservations a nadie (los tokens de carrito son secretos).
           public.available_stock(p.id) as stock
    from public.products p;

grant select on public.product_catalog to anon, authenticated;
