import { createBrowserClient as createClient } from '@supabase/ssr';

let clientInstance: ReturnType<typeof createClient> | null = null;

export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  if (typeof window === 'undefined') {
    return createClient(url, key);
  }

  if (!clientInstance) {
    clientInstance = createClient(url, key);
  }

  return clientInstance;
}
