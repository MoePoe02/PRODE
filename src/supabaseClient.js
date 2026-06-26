const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('[Supabase] ERROR: La variable de entorno SUPABASE_URL no está configurada.');
}

// Cliente público estándar (usando la clave anónima)
const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// Cliente administrativo seguro (usando la clave de rol de servicio del backend)
const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl || '', supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : supabase; // Fallback al cliente estándar si no se define la clave de servicio

module.exports = {
  supabase,
  supabaseAdmin
};
