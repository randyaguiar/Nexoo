-- Datos de prueba del catálogo Nexoo (un negocio por provincia de lanzamiento).

insert into public.businesses (id, name, description, province, municipality, contact_phone, active)
values
  ('11111111-1111-1111-1111-111111111111',
   'Dulcería La Vueltabajera',
   'Dulces finos, cakes y merenguitos hechos por encargo en el centro de Pinar del Río.',
   'PinarDelRio', 'Pinar del Río', '+53 5 555 1234', true),
  ('22222222-2222-2222-2222-222222222222',
   'Cafetería El Malecón',
   'Cafetería habanera: café, batidos y combos para llevar a domicilio.',
   'LaHabana', 'Centro Habana', '+53 5 555 9876', true)
on conflict (id) do nothing;

insert into public.products (id, business_id, name, description, price_usd, photo_url, available)
values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Cake de chocolate (8 porciones)', 'Cake húmedo de chocolate con cobertura de ganache.', 22.00,
   'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800', true),
  ('aaaaaaa1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Caja de merenguitos (24 u.)', 'Merenguitos tradicionales cubanos.', 9.50,
   'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=800', true),
  ('aaaaaaa1-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Pastelitos de guayaba (12 u.)', 'Hojaldre relleno de guayaba.', 12.00,
   'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800', true),
  ('bbbbbbb2-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Combo desayuno para 2', 'Café con leche, tostadas y jugo natural.', 15.00,
   'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=800', true),
  ('bbbbbbb2-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Paquete de café molido (500 g)', 'Café cubano molido, tueste medio.', 11.00,
   'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800', true)
on conflict (id) do nothing;
