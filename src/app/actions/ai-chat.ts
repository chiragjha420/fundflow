'use server';

import { createServerClient } from '@/lib/supabase/server-client';
import { createAdminClient } from '@/lib/supabase/admin-client';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp?: string;
}

export interface ChatResponse {
  success: boolean;
  answer?: string;
  error?: string;
  modelUsed?: string;
  dataPointsCount?: {
    factories: number;
    supervisors: number;
    workers: number;
    transactions: number;
    expenses: number;
  };
}

export async function checkServerAIKeysConfigured(): Promise<{ hasGemini: boolean; hasOpenRouter: boolean; configured: boolean }> {
  const hasGemini = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0;
  return { hasGemini, hasOpenRouter, configured: hasGemini || hasOpenRouter };
}

export async function checkServerGeminiKeyConfigured(): Promise<{ configured: boolean }> {
  const hasEnvKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0;
  return { configured: hasEnvKey || hasOpenRouter };
}

export async function askDatabaseAI(
  userQuery: string,
  history: ChatMessage[] = [],
  apiKeyOverride?: string,
  modelRequested: string = 'gemini-3.8-flash',
  openRouterKeyOverride?: string
): Promise<ChatResponse> {
  try {
    // 1. Security Check: Verify Admin Authentication
    const supabaseUserClient = createServerClient();
    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Unauthorized: You must be logged in as an Administrator.' };
    }

    const { data: profile } = await supabaseUserClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return { success: false, error: 'Access Denied: Only administrators have access to database intelligence.' };
    }

    // 2. Resolve API Keys
    const geminiApiKey = apiKeyOverride?.trim() || process.env.GEMINI_API_KEY?.trim();
    const openRouterApiKey = openRouterKeyOverride?.trim() || process.env.OPENROUTER_API_KEY?.trim();

    if (!geminiApiKey && !openRouterApiKey) {
      return {
        success: false,
        error: 'MISSING_API_KEY',
      };
    }

    // 3. Fetch Live Comprehensive Database Snapshot using Service Role
    const adminClient = createAdminClient();

    const [
      { data: factories },
      { data: supervisors },
      { data: workers },
      { data: transactions },
      { data: expenses }
    ] = await Promise.all([
      adminClient.from('factories').select('*').order('name'),
      adminClient.from('supervisors').select('*, factories(name)').order('name'),
      adminClient.from('worker_balances').select('*').order('running_advance', { ascending: false }),
      adminClient
        .from('cash_transactions')
        .select('*, from:from_supervisor_id(name), to_sup:to_supervisor_id(name, factory_id), to_work:to_worker_id(name, factory_id)')
        .order('created_at', { ascending: false }),
      adminClient
        .from('expenses')
        .select('*, supervisors(name), factories(name)')
        .order('created_at', { ascending: false })
    ]);

    const factoryList = factories || [];
    const supervisorList = supervisors || [];
    const workerList = workers || [];
    const transactionList = transactions || [];
    const expenseList = expenses || [];

    // 4. Precompute Deep Business Logic & Discrepancy Diagnostics
    const now = new Date();

    // Supervisor Financial & Activity Diagnostics
    const supervisorDiagnostics = supervisorList.map(sup => {
      // 1. Cash on hand calculation
      const officeConfirmed = transactionList
        .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id === sup.id && t.status === 'confirmed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const inboundTransfers = transactionList
        .filter(t => t.type === 'supervisor_to_supervisor' && t.to_supervisor_id === sup.id && t.status === 'confirmed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const outboundTransfers = transactionList
        .filter(t => t.type === 'supervisor_to_supervisor' && t.from_supervisor_id === sup.id && t.status !== 'disputed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const workerDisbursed = transactionList
        .filter(t => t.type === 'supervisor_to_worker' && t.from_supervisor_id === sup.id && t.status === 'confirmed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const supExpenses = expenseList
        .filter(e => e.supervisor_id === sup.id)
        .reduce((sum, e) => sum + Number(e.amount), 0);

      const cashOnHand = officeConfirmed + inboundTransfers - outboundTransfers - workerDisbursed - supExpenses;

      // 2. Spending Recency (Expenses)
      const supExpenseRecords = expenseList.filter(e => e.supervisor_id === sup.id);
      const lastExpense = supExpenseRecords.length > 0 ? supExpenseRecords[0] : null;
      const daysSinceLastExpense = lastExpense
        ? Math.floor((now.getTime() - new Date(lastExpense.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // 3. Disbursement Recency (Workers)
      const supDisbursementRecords = transactionList.filter(t => t.type === 'supervisor_to_worker' && t.from_supervisor_id === sup.id);
      const lastDisbursement = supDisbursementRecords.length > 0 ? supDisbursementRecords[0] : null;
      const daysSinceLastDisbursement = lastDisbursement
        ? Math.floor((now.getTime() - new Date(lastDisbursement.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // 4. Pending / Flagged transactions (older than 24h)
      const pendingOver24h = transactionList.filter(t => {
        if (t.status !== 'pending') return false;
        const isFromOrTo = t.from_supervisor_id === sup.id || t.to_supervisor_id === sup.id;
        const ageHours = (now.getTime() - new Date(t.created_at).getTime()) / (1000 * 60 * 60);
        return isFromOrTo && ageHours >= 24;
      });

      return {
        id: sup.id,
        name: sup.name,
        phone: sup.phone,
        factoryName: sup.factories?.name || 'Unassigned',
        active: sup.active,
        cashOnHand,
        totalExpensesLogged: supExpenses,
        expensesCount: supExpenseRecords.length,
        daysSinceLastExpense,
        lastExpenseDate: lastExpense?.created_at || null,
        totalDisbursedToWorkers: workerDisbursed,
        disbursementsCount: supDisbursementRecords.length,
        daysSinceLastDisbursement,
        hasPendingOver24h: pendingOver24h.length > 0,
        pendingOver24hCount: pendingOver24h.length,
        isNegativeCash: cashOnHand < 0,
      };
    });

    // Discrepancy & Anomaly Detection Summary
    const flaggedPendingTransactions = transactionList.filter(t => {
      if (t.status !== 'pending') return false;
      const ageHours = (now.getTime() - new Date(t.created_at).getTime()) / (1000 * 60 * 60);
      return ageHours >= 24;
    }).map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      createdAt: t.created_at,
      ageHours: Math.round((now.getTime() - new Date(t.created_at).getTime()) / (1000 * 60 * 60)),
      from: t.from?.name || 'Office',
      to: t.to_sup?.name || t.to_work?.name || 'N/A',
      note: t.note,
    }));

    const disputedTransactions = transactionList.filter(t => t.status === 'disputed').map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      from: t.from?.name || 'Office',
      to: t.to_sup?.name || 'Supervisor',
      note: t.note,
      createdAt: t.created_at,
    }));

    const negativeBalanceSupervisors = supervisorDiagnostics.filter(s => s.cashOnHand < 0);
    const inactiveSpendingSupervisors = supervisorDiagnostics.filter(s => s.active && (s.daysSinceLastExpense === null || s.daysSinceLastExpense > 7));

    // Factory Cash Totals
    const factoryPositions = factoryList.map(f => {
      const sups = supervisorDiagnostics.filter(s => s.factoryName === f.name);
      const totalCashOnHand = sups.reduce((sum, s) => sum + s.cashOnHand, 0);
      const totalDisbursed = sups.reduce((sum, s) => sum + s.totalDisbursedToWorkers, 0);
      const totalExpenses = sups.reduce((sum, s) => sum + s.totalExpensesLogged, 0);

      return {
        id: f.id,
        name: f.name,
        location: f.location,
        activeSupervisorsCount: sups.filter(s => s.active).length,
        totalCashOnHand,
        totalDisbursed,
        totalExpenses,
      };
    });

    // Top Worker Advances
    const topWorkerAdvances = workerList.slice(0, 15).map(w => ({
      id: w.worker_id,
      name: w.worker_name,
      phone: w.worker_phone,
      factory: factoryList.find(f => f.id === w.factory_id)?.name || 'Unknown Factory',
      supervisor: supervisorList.find(s => s.id === w.supervisor_id)?.name || 'Unknown Supervisor',
      openingAdvance: Number(w.opening_advance),
      totalDisbursed: Number(w.total_cash_disbursed),
      runningAdvance: Number(w.running_advance),
    }));

    // Build Comprehensive System Instruction with Live Database Context
    const systemPrompt = `You are FundFlow AI, an elite, highly accurate executive database forensic and financial intelligence assistant for JBB FundFlow (a factory manufacturing cash disbursement & ledger system).

Current Date and Time: ${now.toISOString()} (${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST).

Your mission is to answer ANY questions about the factory database in clear, precise natural language.

---
### FundFlow Business Logic & Principles:
1. Cash Flow Chain:
   - Head Office sends cash to Supervisors ('office_to_supervisor'). Supervisor must confirm it.
   - Supervisors disburse advances/wages to Workers ('supervisor_to_worker').
   - Supervisors can transfer cash to peer supervisors ('supervisor_to_supervisor').
   - Supervisors pay for factory operational expenses ('expenses' table: materials, transport, maintenance, other).
2. Balance Formulas:
   - Supervisor Cash On Hand = (Confirmed Office Cash + Confirmed Inbound Transfers) - Outbound Transfers - Worker Disbursements - Expenses.
   - Worker Running Advance = Opening Advance + Confirmed Disbursements.
3. Auditing & Red Flag Criteria:
   - Stale/Pending Transactions: Transactions pending for more than 24 hours without confirmation.
   - Disputed Transactions: Transactions marked as 'disputed'.
   - Negative Cash On Hand: A supervisor spending more cash than they were officially sent/confirmed (indicates unrecorded cash or error).
   - Inactive Spenders / Dormant Supervisors: Supervisors holding company cash who have not logged any expenses in 7+ days or have NEVER logged an expense.
   - High Worker Advances: Workers with exceptionally high accumulated running advances.

---
### LIVE DATABASE STATE SNAPSHOT:

1. FACTORIES (${factoryList.length}):
${JSON.stringify(factoryPositions, null, 2)}

2. SUPERVISORS & CASH POSITIONS (${supervisorDiagnostics.length}):
${JSON.stringify(supervisorDiagnostics, null, 2)}

3. DISCREPANCIES & AUDIT ALERTS:
- Flagged Pending Transactions (>24h without confirmation): ${JSON.stringify(flaggedPendingTransactions, null, 2)}
- Disputed Transactions: ${JSON.stringify(disputedTransactions, null, 2)}
- Supervisors with Negative Cash Balance: ${JSON.stringify(negativeBalanceSupervisors.map(s => ({ name: s.name, factory: s.factoryName, cashOnHand: s.cashOnHand })), null, 2)}
- Supervisors Inactive in Spending (>7 days without expense): ${JSON.stringify(inactiveSpendingSupervisors.map(s => ({ name: s.name, factory: s.factoryName, daysSinceLastExpense: s.daysSinceLastExpense, cashOnHand: s.cashOnHand })), null, 2)}

4. TOP WORKER ADVANCES (Top ${topWorkerAdvances.length} of ${workerList.length} total workers):
${JSON.stringify(topWorkerAdvances, null, 2)}

5. RECENT TRANSACTION SAMPLE (Total: ${transactionList.length}):
${JSON.stringify(transactionList.slice(0, 30).map(t => ({
  id: t.id,
  type: t.type,
  amount: t.amount,
  status: t.status,
  from: t.from?.name || 'Office',
  to: t.to_sup?.name || t.to_work?.name || 'N/A',
  note: t.note,
  createdAt: t.created_at
})), null, 2)}

6. RECENT EXPENSES SAMPLE (Total: ${expenseList.length}):
${JSON.stringify(expenseList.slice(0, 25).map(e => ({
  id: e.id,
  supervisor: e.supervisors?.name || 'Unknown',
  factory: e.factories?.name || 'Unknown',
  amount: e.amount,
  category: e.category,
  note: e.note,
  createdAt: e.created_at
})), null, 2)}

---
### Guidelines for Your Output:
- Respond directly, concisely, and insightfully with exact figures, supervisor/worker names, and dates.
- Format all currency in Indian Rupees using '₹' and commas (e.g. ₹25,000).
- When asked "who hasn't been logging their spending", specifically name the supervisors, their factory, how many days have elapsed since their last logged expense, and how much cash they are currently sitting on.
- When asked "who has discrepancies", highlight pending transactions >24h, disputed transactions, negative cash balances, or missing logs with full details.
- When asked "who has the most advance", list the top workers with their advance amount, their factory, and assigned supervisor.
- Use GitHub markdown: bold key metrics, bulleted lists, and clean tables where comparison is helpful.
- If no discrepancies or records exist for a specific filter, clearly state that everything is clean and balanced.`;

    // 5. Call the Google Gemini API with the Requested Model (Latest Gemini 3.8 / 3.5 Generation)
    const candidateModels = [
      modelRequested,
      'gemini-3.8-flash',
      'gemini-3.8-pro',
      'gemini-3.5-flash',
      'gemini-3.5-pro'
    ];

    // Remove duplicates while preserving order
    const modelsToTry = Array.from(new Set(candidateModels));

    let finalAnswer: string | null = null;
    let actualModelUsed: string = modelRequested;
    let lastError: string | null = null;

    // Convert previous chat history
    const contents: any[] = [];

    // Add previous history
    for (const msg of history.slice(-6)) {
      contents.push({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }

    // Add current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: userQuery }]
    });

    // Attempt Gemini first if key is available
    if (geminiApiKey) {
      for (const model of modelsToTry) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{ text: systemPrompt }]
                },
                contents,
                generationConfig: {
                  temperature: 0.2,
                  maxOutputTokens: 4096,
                }
              }),
            }
          );

          const data = await response.json();

          if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            finalAnswer = data.candidates[0].content.parts[0].text;
            actualModelUsed = model;
            break;
          } else {
            const apiErrorMessage = data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
            lastError = `[Gemini ${model}]: ${apiErrorMessage}`;
            console.warn(`Gemini API call failed for model ${model}:`, apiErrorMessage);
            if (response.status === 404 || apiErrorMessage.toLowerCase().includes('not found')) {
              continue;
            } else {
              break;
            }
          }
        } catch (err: any) {
          lastError = err?.message || 'Network error calling Gemini API';
          console.error(`Fetch exception for ${model}:`, err);
        }
      }
    } else {
      lastError = 'No Gemini API key provided.';
    }

    // Fallback: If Gemini is unavailable or failed, call OpenRouter Nemotron Super VL Free
    if (!finalAnswer) {
      console.warn('Gemini unavailable or error:', lastError, 'Attempting OpenRouter Nemotron Super VL Free fallback...');

      const openRouterResult = await callOpenRouterFallback(
        systemPrompt,
        history,
        userQuery,
        openRouterApiKey
      );

      if (openRouterResult.success && openRouterResult.answer) {
        finalAnswer = openRouterResult.answer;
        actualModelUsed = openRouterResult.modelUsed || 'nvidia/nemotron-3.5-super-vl:free';
      } else {
        lastError = geminiApiKey 
          ? `Gemini failed: ${lastError}. OpenRouter fallback: ${openRouterResult.error || 'Unknown error'}`
          : (openRouterResult.error || 'OpenRouter fallback failed');
      }
    }

    if (!finalAnswer) {
      return {
        success: false,
        error: lastError || 'Failed to generate response. Please check your Gemini or OpenRouter API key.',
        modelUsed: actualModelUsed,
      };
    }

    return {
      success: true,
      answer: finalAnswer,
      modelUsed: actualModelUsed,
      dataPointsCount: {
        factories: factoryList.length,
        supervisors: supervisorList.length,
        workers: workerList.length,
        transactions: transactionList.length,
        expenses: expenseList.length,
      }
    };

  } catch (error: any) {
    console.error('Database AI Query Error:', error);
    return {
      success: false,
      error: error?.message || 'An unexpected error occurred while querying database AI.',
    };
  }
}

// Fallback Helper for OpenRouter Nemotron Models
async function callOpenRouterFallback(
  systemPrompt: string,
  history: ChatMessage[],
  userQuery: string,
  openRouterApiKey?: string
): Promise<{ success: boolean; answer?: string; error?: string; modelUsed?: string }> {
  const key = openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    return {
      success: false,
      error: 'No OpenRouter API key found. Add OPENROUTER_API_KEY in .env.local or UI to enable Nemotron fallback.'
    };
  }

  const nemotronModels = [
    'nvidia/nemotron-3.5-super-vl:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-nano-9b-v2:free'
  ];

  const messages: any[] = [
    { role: 'system', content: systemPrompt }
  ];

  for (const msg of history.slice(-6)) {
    messages.push({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content
    });
  }

  messages.push({ role: 'user', content: userQuery });

  let lastErr = '';

  for (const model of nemotronModels) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'https://fundflow.local',
          'X-Title': 'FundFlow Database Assistant',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
        }),
      });

      const data = await res.json();
      if (res.ok && data?.choices?.[0]?.message?.content) {
        return {
          success: true,
          answer: data.choices[0].message.content,
          modelUsed: model,
        };
      } else {
        lastErr = data?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
        console.warn(`OpenRouter model ${model} failed:`, lastErr);
      }
    } catch (e: any) {
      lastErr = e?.message || 'Network error connecting to OpenRouter';
    }
  }

  return {
    success: false,
    error: lastErr || 'Failed to call OpenRouter Nemotron models.',
  };
}
