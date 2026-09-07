import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!rawUrl || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Copia frontend/.env.example a .env.',
  );
}

// La URL del proyecto se pega a menudo con barra final o con /rest/v1 incluido;
// ambas rompen las peticiones con "Invalid path specified in request URL".
const url = rawUrl.trim().replace(/\/+(rest\/v1)?\/*$/, '');

export const supabase = createClient(url, anonKey.trim());
