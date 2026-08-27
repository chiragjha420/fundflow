import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server-client';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role === 'admin') {
      redirect('/admin');
    } else if (profile?.role === 'supervisor') {
      redirect('/supervisor');
    }
  }

  redirect('/login');
}
