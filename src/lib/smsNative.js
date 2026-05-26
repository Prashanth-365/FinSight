// JS bridge to the native SmsReader Capacitor plugin.
// On the web (no Capacitor), every method is a no-op that returns a benign default,
// so existing code paths keep working.

import { Capacitor, registerPlugin } from '@capacitor/core';

const SmsReader = registerPlugin('SmsReader', {
  web: () => ({
    checkPermissions: async () => ({ sms: 'denied' }),
    requestPermissions: async () => ({ sms: 'denied' }),
    readInbox: async () => ({ messages: [], count: 0 }),
    startListener: async () => {},
    stopListener: async () => {},
    addListener: async () => ({ remove: () => {} })
  })
});

export function isNativeAndroid() {
  return Capacitor.getPlatform() === 'android';
}

export async function checkSmsPermission() {
  const r = await SmsReader.checkPermissions();
  return r?.sms ?? 'denied';
}

export async function ensureSmsPermission() {
  const cur = await SmsReader.checkPermissions();
  if (cur.sms === 'granted') return true;
  const after = await SmsReader.requestPermissions();
  return after.sms === 'granted';
}

// Default sender substrings used to find bank/UPI SMS in the user's inbox.
// They are case-insensitive substring matches on the SMS "from" field.
export const DEFAULT_BANK_SENDERS = [
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YESBNK', 'IDBI', 'PNB', 'BOI',
  'IDFC', 'INDUS', 'CITI', 'HSBC', 'STANC', 'AU', 'RBL', 'CANBNK', 'UBI',
  'PAYTM', 'PHONEPE', 'GPAY', 'BHIM', 'AMEX',
  'BK', 'BNK'
];

// Body keywords that very strongly indicate a transaction SMS
export const TXN_BODY_KEYWORDS = [
  'debited', 'credited', 'spent', 'paid', 'received', 'transferred',
  'withdrawn', 'deposit', 'purchase', 'refund', 'a/c', 'acct', 'upi'
];

export async function fetchSmsHistory({ sinceTs = 0, limit = 2000 } = {}) {
  if (!isNativeAndroid()) return { messages: [], count: 0 };
  return SmsReader.readInbox({
    senderFilter: DEFAULT_BANK_SENDERS,
    bodyFilter: TXN_BODY_KEYWORDS,
    sinceTs,
    limit
  });
}

export async function startSmsListener(onMessage) {
  if (!isNativeAndroid()) return () => {};
  const handle = await SmsReader.addListener('smsReceived', (m) => onMessage(m));
  await SmsReader.startListener();
  return async () => {
    try { handle.remove(); } catch {}
    try { await SmsReader.stopListener(); } catch {}
  };
}

export default SmsReader;
