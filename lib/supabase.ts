import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (new Proxy({} as SupabaseClient, {
      get: () => {
        throw new Error('Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.')
      }
    }))
