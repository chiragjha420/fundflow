'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { createServerClient } from '@/lib/supabase/server-client';
import { revalidatePath } from 'next/cache';

export async function createFactory(state: any, formData: FormData) {
  const name = formData.get('name') as string;
  const location = formData.get('location') as string;

  if (!name || !location) {
    return { error: 'Please fill in all factory fields.' };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('factories').insert({
    name,
    location,
    active: true,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/admin/supervisors');
  revalidatePath('/admin');
  return { success: true };
}

export async function provisionSupervisor(state: any, formData: FormData) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const phone = formData.get('phone') as string;
  const factoryId = formData.get('factoryId') as string;

  if (!name || !email || !password || !phone || !factoryId) {
    return { error: 'All fields are required.' };
  }

  const adminClient = createAdminClient();

  // 1. Create auth user with metadata
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'supervisor' },
  });

  if (authError) {
    return { error: authError.message };
  }

  const userId = authData.user?.id;
  if (!userId) {
    return { error: 'Failed to create auth user.' };
  }

  // 2. Insert into profiles & supervisors
  const userClient = createServerClient();

  const { error: profileError } = await userClient.from('profiles').insert({
    id: userId,
    role: 'supervisor',
  });

  if (profileError) {
    // Clean up auth user to prevent orphans
    await adminClient.auth.admin.deleteUser(userId);
    return { error: profileError.message };
  }

  const { error: supervisorError } = await userClient.from('supervisors').insert({
    user_id: userId,
    factory_id: factoryId,
    name,
    phone,
    active: true,
  });

  if (supervisorError) {
    // Clean up
    await userClient.from('profiles').delete().eq('id', userId);
    await adminClient.auth.admin.deleteUser(userId);
    return { error: supervisorError.message };
  }

  revalidatePath('/admin/supervisors');
  revalidatePath('/admin');
  return { success: true };
}

export async function toggleSupervisorActive(supervisorId: string, currentStatus: boolean) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from('supervisors')
    .update({ active: !currentStatus })
    .eq('id', supervisorId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/admin/supervisors');
  return { success: true };
}

export async function createOfficeDisbursement(state: any, formData: FormData) {
  const supervisorId = formData.get('supervisorId') as string;
  const amountStr = formData.get('amount') as string;
  const note = formData.get('note') as string;

  if (!supervisorId || !amountStr) {
    return { error: 'Please select a supervisor and specify amount.' };
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return { error: 'Amount must be a positive number.' };
  }

  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated.' };
  }

  const { error } = await supabase.from('cash_transactions').insert({
    type: 'office_to_supervisor',
    to_supervisor_id: supervisorId,
    amount,
    status: 'pending',
    note: note || null,
    created_by: user.id,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/admin');
  return { success: true };
}

export async function deleteSupervisor(supervisorId: string) {
  const supabase = createServerClient();
  
  // 1. Get supervisor details to retrieve their user_id
  const { data: supervisor, error: fetchError } = await supabase
    .from('supervisors')
    .select('user_id, name')
    .eq('id', supervisorId)
    .single();

  if (fetchError || !supervisor) {
    return { error: 'Supervisor not found.' };
  }

  // 2. Check if they have any ledger transactions or expenses
  const { count: txCount, error: txError } = await supabase
    .from('cash_transactions')
    .select('*', { count: 'exact', head: true })
    .or(`from_supervisor_id.eq.${supervisorId},to_supervisor_id.eq.${supervisorId}`);

  const { count: expCount, error: expError } = await supabase
    .from('expenses')
    .select('*', { count: 'exact', head: true })
    .eq('supervisor_id', supervisorId);

  if (txError || expError) {
    return { error: 'Error checking supervisor history.' };
  }

  // If there are transactions or expenses, they CANNOT be deleted.
  // We deactivate them instead and notify the admin.
  if ((txCount && txCount > 0) || (expCount && expCount > 0)) {
    const { error: updateError } = await supabase
      .from('supervisors')
      .update({ active: false })
      .eq('id', supervisorId);

    if (updateError) {
      return { error: updateError.message };
    }

    revalidatePath('/admin/supervisors');
    revalidatePath('/admin');
    return { 
      success: false, 
      warning: `This supervisor has transaction history. To protect the ledger's audit trail, they cannot be deleted, but they have been deactivated instead.`
    };
  }

  // 3. If NO transaction history, we can perform a hard delete
  // Delete supervisor record
  const { error: deleteSupError } = await supabase
    .from('supervisors')
    .delete()
    .eq('id', supervisorId);

  if (deleteSupError) {
    return { error: deleteSupError.message };
  }

  // Delete profile record
  await supabase.from('profiles').delete().eq('id', supervisor.user_id);

  // Delete Auth user using admin client
  const adminClient = createAdminClient();
  await adminClient.auth.admin.deleteUser(supervisor.user_id);

  revalidatePath('/admin/supervisors');
  revalidatePath('/admin');
  return { success: true };
}
