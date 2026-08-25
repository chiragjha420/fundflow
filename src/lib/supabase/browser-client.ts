import { createBrowserClient as createClient } from '@supabase/ssr';

export function createBrowserClient() {
  // Use placeholders during build time if environment variables are missing
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  if (typeof window !== 'undefined') {
    console.log('Supabase Browser Client url:', url);
  }

  return createClient(url, key);
}
