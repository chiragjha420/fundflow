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
    const payload: Record<string, any> = {
      recipients: [phone],
      message,
    };
    if (deviceId) {
      payload.deviceId = deviceId;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
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

// Default fallback configuration for TextBee Android SIM Gateway
const DEFAULT_GATEWAY_URL = 'https://api.textbee.dev/api/v1/gateway/send-sms';
const DEFAULT_API_KEY = 'txb_teLnOINlJfnF7vHldUfA8eYMQ7VeWNNl';
const DEFAULT_DEVICE_ID = '6ada27f7a4996b8ebf2e8de0';

export async function sendWorkerDisbursementSms(payload: WorkerSmsPayload): Promise<{
  success: boolean;
  messageText: string;
  sentViaGateway?: boolean;
  usedFallback?: boolean;
  smsUri?: string;
  error?: string;
}> {
  try {
    const cleanDigits = payload.workerPhone?.replace(/\D/g, '') || '';
    if (cleanDigits.length < 10) {
      return {
        success: false,
        messageText: '',
        error: 'Invalid or missing worker phone number.',
      };
    }

    // Standardize to E.164 (+91XXXXXXXXXX)
    let formattedPhone: string;
    if (cleanDigits.length === 10) {
      formattedPhone = `+91${cleanDigits}`;
    } else if (cleanDigits.length === 12 && cleanDigits.startsWith('91')) {
      formattedPhone = `+${cleanDigits}`;
    } else if (payload.workerPhone?.startsWith('+')) {
      formattedPhone = `+${cleanDigits}`;
    } else {
      formattedPhone = `+91${cleanDigits.slice(-10)}`;
    }

    // Strict worker message: confirms amount received only (no advance balance, no private details)
    const today = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const senderIdentifier = payload.factoryName || payload.supervisorName || 'JBB FundFlow';
    const messageText = `Received ₹${payload.amount.toLocaleString('en-IN')} on ${today} from ${senderIdentifier}.`;

    // 1. Check if Free Android SIM Gateway is configured (Primary & Fallback)
    const gatewayUrl = process.env.SMS_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;
    const primaryApiKey = process.env.SMS_GATEWAY_API_KEY?.trim() || DEFAULT_API_KEY;
    const primaryDeviceId = process.env.SMS_GATEWAY_DEVICE_ID?.trim() || DEFAULT_DEVICE_ID;

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
