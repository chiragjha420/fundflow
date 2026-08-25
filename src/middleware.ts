import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let public assets, static files, next internals, and api routes pass without RLS/auth checks
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/logo.png' ||
    pathname === '/icon.png' ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  // Use safety placeholders during initialization to prevent server-side 500 crashes if environment keys are unconfigured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    // Fail-safe if connection is refused or placeholder keys are active
    user = null;
  }

  // If user is not logged in and not on login page, redirect to login
  if (!user) {
    if (pathname !== '/login') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return supabaseResponse;
  }

  // If user is logged in, determine their role
  let role = user.user_metadata?.role;

  // Fallback: If metadata role is missing, fetch from database profiles
  if (!role) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      role = profile?.role;

      // Sync database role to auth user metadata so subsequent requests don't hit the DB
      if (role) {
        await supabase.auth.updateUser({
          data: { role },
        });
      }
    } catch (e) {
      role = null;
    }
  }

  // If still no role found, log them out and redirect to login
  if (!role) {
    if (pathname !== '/login') {
      const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
      // Sign out to clear cookies
      try {
        await supabase.auth.signOut();
      } catch (e) {}
      return redirectResponse;
    }
    return supabaseResponse;
  }

  // If logged in and role is verified
  if (pathname === '/login') {
    if (role === 'admin') {
      return NextResponse.redirect(new URL('/admin', request.url));
    } else if (role === 'supervisor') {
      return NextResponse.redirect(new URL('/supervisor', request.url));
    }
  }

  // Path access control
  if (pathname.startsWith('/admin') && role !== 'admin') {
    if (role === 'supervisor') {
      return NextResponse.redirect(new URL('/supervisor', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname.startsWith('/supervisor') && role !== 'supervisor') {
    if (role === 'admin') {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
