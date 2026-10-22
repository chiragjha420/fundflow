'use server';

/**
 * Free SMS Alert Dispatcher for FundFlow
 * 
 * Sends 100% free automated text messages to workers when money is disbursed.
 * Does NOT show outstanding advance balance or private details.
 * Strictly confirms amount received: "Received ₹[Amount] on [Date] from [Supervisor/Factory]."
 * 
 * Free Management Options:
 * 1. Free Android SIM Gateway (Automated):
 *    - Open-source Android app (e.g. TextBee / Android SMS Gateway) running on any spare phone at the factory.
 *    - Uses standard free 100 SMS/day included with any mobile SIM (Jio / Airtel / Vi).
 *    - Configured via SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY in .env.local
 * 
 * 2. Webhook Fallback / Native SMS URL Generator
 */

export interface WorkerSmsPayload {
  workerPhone: string;
  workerName: string;
  amount: number;
  supervisorName?: string;
  factoryName?: string;
  note?: string;
}

export async function sendWorkerDisbursementSms(payload: WorkerSmsPayload): Promise<{
  success: boolean;
  messageText: string;
  sentViaGateway?: boolean;
  smsUri?: string;
  error?: string;
}> {
  try {
    const rawPhone = payload.workerPhone?.replace(/[^\d+]/g, '');
    if (!rawPhone || rawPhone.length < 10) {
      return {
        success: false,
        messageText: '',
        error: 'Invalid or missing worker phone number.',
      };
    }

    // Format Indian mobile number (+91 if 10 digits)
    const formattedPhone = rawPhone.length === 10 ? `+91${rawPhone}` : rawPhone;

    // Strict worker message: confirms amount received only (no advance balance, no private details)
    const today = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const senderIdentifier = payload.factoryName || payload.supervisorName || 'JBB FundFlow';
    const messageText = `Received ₹${payload.amount.toLocaleString('en-IN')} on ${today} from ${senderIdentifier}.`;

    // 1. Check if Free Android SIM Gateway is configured
    const gatewayUrl = process.env.SMS_GATEWAY_URL?.trim();
    const gatewayApiKey = process.env.SMS_GATEWAY_API_KEY?.trim();

    if (gatewayUrl) {
      try {
        const response = await fetch(gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(gatewayApiKey ? { 'Authorization': `Bearer ${gatewayApiKey}`, 'x-api-key': gatewayApiKey } : {}),
          },
          body: JSON.stringify({
            to: formattedPhone,
            phone: formattedPhone,
            recipient: formattedPhone,
            message: messageText,
            text: messageText,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return {
            success: true,
            messageText,
            sentViaGateway: true,
          };
        }
      } catch (err: any) {
        console.warn('SMS Gateway network dispatch error:', err?.message);
      }
    }

    // 2. Fallback: Generate direct native SMS URI for immediate device dispatch
    const encodedBody = encodeURIComponent(messageText);
    const smsUri = `sms:${formattedPhone}?body=${encodedBody}`;

    return {
      success: true,
      messageText,
      sentViaGateway: false,
      smsUri,
    };
  } catch (error: any) {
    console.error('sendWorkerDisbursementSms exception:', error);
    return {
      success: false,
      messageText: '',
      error: error?.message || 'Failed to dispatch SMS alert.',
    };
  }
}
