const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xxxxxxxx.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy-key';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('[Supabase] ERROR: Las variables de entorno de Supabase NO están configuradas en Vercel.');
}

// Cliente público estándar (usando la clave anónima)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
