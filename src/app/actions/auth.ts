'use server';

import { createServerClient } from '@/lib/supabase/server-client';
import { redirect } from 'next/navigation';

export async function login(state: any, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Please enter both email and password.' };
  }

  const supabase = createServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  const role = data.user?.user_metadata?.role;

  if (role === 'admin') {
    redirect('/admin');
  } else {
    redirect('/supervisor');
  }
}

export async function logout() {
  const supabase = createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
