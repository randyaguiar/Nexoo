-- Qué formas de pago se le ofrecen al comprador en la pasarela.
--
-- TropiPay admite cuatro: tarjeta, saldo de una cuenta TropiPay, cripto y
-- tarjeta regalo. Hasta ahora mandábamos solo tarjeta, decidido en el código.
-- Es una decisión de negocio —el saldo TropiPay, por ejemplo, sale más barato
-- en comisiones— así que la elige el owner desde el panel.
--
-- Stripe ignora esto: allí siempre es tarjeta.

alter table public.payment_settings
    add column if not exists payment_methods text[] not null default array['EXT'];

do $$ begin
    alter table public.payment_settings
        add constraint payment_settings_methods_check check (
            cardinality(payment_methods) between 1 and 4
            and payment_methods <@ array['EXT', 'TPP', 'CRYPTO', 'TPP_GIFTCARD']
        );
exception when duplicate_object then null;
end $$;

comment on column public.payment_settings.payment_methods is
    'Formas de pago que ofrece la pasarela: EXT tarjeta, TPP saldo TropiPay, CRYPTO, TPP_GIFTCARD.';

