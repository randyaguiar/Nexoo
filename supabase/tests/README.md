# Pruebas de la base de datos

Las migraciones se aplican a un Postgres local y se ejecuta el flujo completo:
alta de negocio, precios, pedido y liquidación, más los intentos que deben
fallar (un comprador aprobando su propia solicitud, tocando precios o
liquidando; una cuenta de negocio comprando; un comprador con pedidos pidiendo
el alta de un negocio).

Requiere `postgresql-16` instalado; no hace falta Docker ni el CLI de Supabase.

```bash
pg=/tmp/pgtest
rm -rf $pg && mkdir -p $pg && chown postgres:postgres $pg && chmod 700 $pg
su postgres -c "initdb -D $pg/data -A trust -U postgres"
su postgres -c "pg_ctl -D $pg/data -l $pg/pg.log -o '-p 5433 -k /tmp' start"

psql -h /tmp -p 5433 -U postgres -c 'create database nexoo;'
psql -h /tmp -p 5433 -U postgres -d nexoo -q -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -h /tmp -p 5433 -U postgres -d nexoo -q -v ON_ERROR_STOP=1 -f "$f" || break
done
psql -h /tmp -p 5433 -U postgres -d nexoo -q -t -f supabase/tests/01_flow.sql
```

`00_supabase_stub.sql` imita lo que Supabase da hecho: los roles `anon`,
`authenticated` y `service_role`, `auth.users`, `auth.uid()` (que aquí lee un
ajuste de sesión en vez de un JWT) y lo mínimo de `storage`. No pretende ser
Supabase: sirve para que las migraciones se apliquen y las policies se puedan
ejercitar cambiando de rol con `set role` y `set request.jwt.claim.sub`.

## Qué hay aplicado en un proyecto

`diagnostico.sql` lista los objetos que añade cada migración reciente y si están
o no. Sirve para saber en qué punto se quedó una base de datos sin ir probando
migraciones a ciegas; se pega tal cual en el SQL editor de Supabase.

## Ponerse al día

`aplicar_pendientes.sql` es la concatenación de las migraciones de precios,
liquidaciones, fotos y permisos dentro de un `begin/commit`, para un proyecto
que solo tenía aplicadas las anteriores. Se pega entero en el SQL editor: o
entra todo, o no entra nada. Después hace falta `notify pgrst, 'reload schema';`
para que PostgREST vea las tablas y vistas nuevas.
