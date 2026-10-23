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

/**
 * Dispatches an SMS via TextBee / Android SIM Gateway REST endpoint.
 */
async function postToGateway(
  url: string,
  apiKey: string,
  deviceId: string | undefined,
  phone: string,
  message: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        // TextBee standard payload
        recipients: [phone],
        message,
        ...(deviceId ? { deviceId } : {}),
        // Generic gateway compatibility fields
        to: phone,
        phone,
        recipient: phone,
        text: message,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: errText };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

export async function sendWorkerDisbursementSms(payload: WorkerSmsPayload): Promise<{
  success: boolean;
  messageText: string;
  sentViaGateway?: boolean;
  usedFallback?: boolean;
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

    // 1. Check if Free Android SIM Gateway is configured (Primary & Fallback)
    const gatewayUrl = process.env.SMS_GATEWAY_URL?.trim();
    const primaryApiKey = process.env.SMS_GATEWAY_API_KEY?.trim();
    const primaryDeviceId = process.env.SMS_GATEWAY_DEVICE_ID?.trim();

    const fallbackApiKey = process.env.SMS_GATEWAY_FALLBACK_API_KEY?.trim();
    const fallbackDeviceId = process.env.SMS_GATEWAY_FALLBACK_DEVICE_ID?.trim();

    if (gatewayUrl && primaryApiKey) {
      // Attempt 1: Primary Gateway Key
      const primaryRes = await postToGateway(
        gatewayUrl,
        primaryApiKey,
        primaryDeviceId,
        formattedPhone,
        messageText
      );

      if (primaryRes.ok) {
        return {
          success: true,
          messageText,
          sentViaGateway: true,
        };
      }

      console.warn(
        `Primary SMS Gateway failed (Status: ${primaryRes.status || 'Unknown'}, Details: ${primaryRes.error}).`
      );

      // Attempt 2: Fallback Gateway Key (Used if Primary reaches 300 SMS/mo limit, 429 quota, or error)
      if (fallbackApiKey) {
        console.info('Attempting dispatch with Fallback SMS Gateway API key...');
        const fallbackRes = await postToGateway(
          gatewayUrl,
          fallbackApiKey,
          fallbackDeviceId,
          formattedPhone,
          messageText
        );

        if (fallbackRes.ok) {
          console.info('Successfully dispatched SMS via Fallback Gateway key.');
          return {
            success: true,
            messageText,
            sentViaGateway: true,
            usedFallback: true,
          };
        }

        console.warn(
          `Fallback SMS Gateway also failed (Status: ${fallbackRes.status || 'Unknown'}, Details: ${fallbackRes.error}).`
        );
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
