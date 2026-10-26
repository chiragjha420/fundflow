import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₹0';
  
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
  return formatter.format(num);
}

/**
 * Parses transaction remarks/notes to extract any embedded handover photo proof URL.
 */
export function parseHandoverNote(rawNote: string | null | undefined): { note: string; photoUrl: string | null } {
  if (!rawNote) return { note: '', photoUrl: null };
  const match = rawNote.match(/\[handover_photo:(https?:\/\/[^\]]+)\]/);
  if (match) {
    const photoUrl = match[1];
    const cleanNote = rawNote.replace(/\[handover_photo:https?:\/\/[^\]]+\]/, '').trim();
    return { note: cleanNote, photoUrl };
  }
  return { note: rawNote, photoUrl: null };
}
