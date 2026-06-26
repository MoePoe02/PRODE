-- SQL Schema: Supaprode Mundial 2026
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

-- ─────────────────────────────────────────────────────────────
-- 1. TABLAS PRINCIPALES
-- ─────────────────────────────────────────────────────────────

-- Perfiles de usuario (enlazados a auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_emoji TEXT DEFAULT '⚽',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, NOW()) NOT NULL
);

-- Partidos del mundial
CREATE TABLE IF NOT EXISTS public.matches (
  id TEXT PRIMARY KEY,
  fase TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  date_iso TIMESTAMP WITH TIME ZONE NOT NULL,
  home_score INTEGER DEFAULT NULL,
  away_score INTEGER DEFAULT NULL,
  finalizado BOOLEAN DEFAULT FALSE NOT NULL,
  api_game_id INTEGER DEFAULT NULL,
  last_queried_api TEXT DEFAULT '',
  ganador_real TEXT DEFAULT ''
);

-- Predicciones de los usuarios para cada partido
CREATE TABLE IF NOT EXISTS public.predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  match_id TEXT REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  home_score INTEGER NOT NULL CHECK (home_score >= 0),
  away_score INTEGER NOT NULL CHECK (away_score >= 0),
  ganador_pred TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, NOW()) NOT NULL,
  CONSTRAINT unique_user_match UNIQUE (user_id, match_id)
);

-- Predicciones del Top 3 (Podio)
CREATE TABLE IF NOT EXISTS public.predictions_top3 (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  puesto_1 TEXT NOT NULL,
  puesto_2 TEXT NOT NULL,
  puesto_3 TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, NOW()) NOT NULL
);

-- Resultado real del Top 3 (Podio real)
CREATE TABLE IF NOT EXISTS public.resultado_top3 (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  puesto_1 TEXT DEFAULT '',
  puesto_2 TEXT DEFAULT '',
  puesto_3 TEXT DEFAULT ''
);

-- Mensajes en el chat/muro
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  texto TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, NOW()) NOT NULL,
  reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  reply_to_username TEXT DEFAULT NULL,
  reply_to_texto TEXT DEFAULT NULL
);

-- Configuración global del sistema
CREATE TABLE IF NOT EXISTS public.system_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  argentina_mode BOOLEAN DEFAULT FALSE NOT NULL
);

-- Insertar configuración inicial por defecto
INSERT INTO public.system_config (id, argentina_mode) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.resultado_top3 (id, puesto_1, puesto_2, puesto_3) VALUES (1, '', '', '') ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. VISTA DE CÁLCULO DE PUNTOS
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.predictions_with_points AS
SELECT
  p.id AS prediction_id,
  p.user_id,
  pr.username,
  pr.avatar_emoji,
  p.match_id,
  p.home_score AS home_score_pred,
  p.away_score AS away_score_pred,
  p.ganador_pred,
  m.fase,
  m.home_score AS home_score_real,
  m.away_score AS away_score_real,
  m.finalizado,
  m.ganador_real,
  m.date_iso AS match_date,
  -- 1. Puntos Tendencia
  CASE
    WHEN NOT m.finalizado THEN 0
    ELSE (
      CASE
        WHEN m.fase = 'Fase de Grupos' THEN
          CASE WHEN sign(p.home_score - p.away_score) = sign(m.home_score - m.away_score) THEN 2 ELSE 0 END
        ELSE -- Knockout
          CASE
            WHEN m.home_score = m.away_score THEN -- Penales real
              CASE
                WHEN p.home_score = p.away_score THEN -- Penales pred
                  2 + CASE WHEN p.ganador_pred = m.ganador_real THEN 1 ELSE 0 END
                ELSE -- Directa pred
                  CASE WHEN (CASE WHEN p.home_score > p.away_score THEN 'local' ELSE 'visitante' END) = m.ganador_real THEN 1 ELSE 0 END
              END
            ELSE -- Regular real
              CASE
                WHEN p.home_score != p.away_score THEN -- Directa pred
                  CASE WHEN (CASE WHEN p.home_score > p.away_score THEN 'local' ELSE 'visitante' END) = (CASE WHEN m.home_score > m.away_score THEN 'local' ELSE 'visitante' END) THEN 2 ELSE 0 END
                ELSE 0 -- Penales pred pero terminado en regular
              END
          END
      END
    )
  END AS puntos_tendencia,

  -- 2. Puntos Goles
  CASE
    WHEN NOT m.finalizado THEN 0
    ELSE (
      -- Local
      CASE WHEN m.home_score = 0 AND p.home_score = 0 THEN 1 ELSE greatest(0, m.home_score - abs(p.home_score - m.home_score)) END
      +
      -- Visitante
      CASE WHEN m.away_score = 0 AND p.away_score = 0 THEN 1 ELSE greatest(0, m.away_score - abs(p.away_score - m.away_score)) END
    )
  END AS puntos_goles,

  -- 3. Puntos Pleno (Resultado Exacto)
  CASE
    WHEN NOT m.finalizado THEN 0
    ELSE (
      CASE WHEN p.home_score = m.home_score AND p.away_score = m.away_score THEN 2 ELSE 0 END
    )
  END AS puntos_pleno,

  -- 4. Puntos Totales (Suma)
  CASE
    WHEN NOT m.finalizado THEN 0
    ELSE (
      -- Tendencia
      (CASE
        WHEN m.fase = 'Fase de Grupos' THEN
          CASE WHEN sign(p.home_score - p.away_score) = sign(m.home_score - m.away_score) THEN 2 ELSE 0 END
        ELSE
          CASE
            WHEN m.home_score = m.away_score THEN
              CASE
                WHEN p.home_score = p.away_score THEN
                  2 + CASE WHEN p.ganador_pred = m.ganador_real THEN 1 ELSE 0 END
                ELSE
                  CASE WHEN (CASE WHEN p.home_score > p.away_score THEN 'local' ELSE 'visitante' END) = m.ganador_real THEN 1 ELSE 0 END
              END
            ELSE
              CASE
                WHEN p.home_score != p.away_score THEN
                  CASE WHEN (CASE WHEN p.home_score > p.away_score THEN 'local' ELSE 'visitante' END) = (CASE WHEN m.home_score > m.away_score THEN 'local' ELSE 'visitante' END) THEN 2 ELSE 0 END
                ELSE 0
              END
          END
      END)
      +
      -- Goles Local
      (CASE WHEN m.home_score = 0 AND p.home_score = 0 THEN 1 ELSE greatest(0, m.home_score - abs(p.home_score - m.home_score)) END)
      +
      -- Goles Visitante
      (CASE WHEN m.away_score = 0 AND p.away_score = 0 THEN 1 ELSE greatest(0, m.away_score - abs(p.away_score - m.away_score)) END)
      +
      -- Pleno
      (CASE WHEN p.home_score = m.home_score AND p.away_score = m.away_score THEN 2 ELSE 0 END)
    )
  END AS puntos_partido
FROM public.predictions p
JOIN public.profiles pr ON p.user_id = pr.id
JOIN public.matches m ON p.match_id = m.id;

-- ─────────────────────────────────────────────────────────────
-- 3. PROCEDIMIENTO Y TRIGGER AUTOMÁTICO PARA NUEVOS USUARIOS
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_emoji)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', substring(NEW.email from '^[^@]+')),
    COALESCE(NEW.raw_user_meta_data->>'avatar_emoji', '⚽')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger si ya existe para evitar errores
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 4. SEGURIDAD (ROW LEVEL SECURITY - RLS)
-- ─────────────────────────────────────────────────────────────

-- Activar RLS en todas las tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions_top3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resultado_top3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Políticas para Profiles
CREATE POLICY "Public read profiles" ON public.profiles FOR SELECT USING (TRUE);
CREATE POLICY "User update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Políticas para Matches
CREATE POLICY "Public read matches" ON public.matches FOR SELECT USING (TRUE);
-- Nota: La inserción y modificación de matches se hará por la clave service_role en el backend (bypasseando RLS).

-- Políticas para Predictions
CREATE POLICY "Users can select predictions" ON public.predictions FOR SELECT USING (TRUE);
CREATE POLICY "Users can insert own predictions" ON public.predictions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own predictions" ON public.predictions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own predictions" ON public.predictions FOR DELETE USING (auth.uid() = user_id);

-- Políticas para Predictions_top3
CREATE POLICY "Users can select predictions_top3" ON public.predictions_top3 FOR SELECT USING (TRUE);
CREATE POLICY "Users can modify own predictions_top3" ON public.predictions_top3 FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Políticas para Resultado_top3
CREATE POLICY "Public read resultado_top3" ON public.resultado_top3 FOR SELECT USING (TRUE);

-- Políticas para Chat_messages
CREATE POLICY "Users can select chat_messages" ON public.chat_messages FOR SELECT USING (TRUE);
CREATE POLICY "Users can insert own chat_messages" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Políticas para System_config
CREATE POLICY "Public read system_config" ON public.system_config FOR SELECT USING (TRUE);
