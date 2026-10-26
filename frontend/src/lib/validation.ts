// Validazioni lato client (solo comodita': le regole vere le applica il backend).
import type { PropertyInput } from './types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB (contratto: image/*)
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MiB (contratto: video/*)

export type Errors<K extends string = string> = Partial<Record<K, string>>;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Controlla tipo e dimensione di un file da caricare; ritorna il messaggio d'errore o null. */
export function validateUploadFile(file: { name: string; type: string; size: number }): string | null {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) return `"${file.name}": sono ammesse solo immagini e video.`;
  if (file.size <= 0) return `"${file.name}": il file e' vuoto.`;
  const max = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > max) {
    return `"${file.name}" pesa ${formatBytes(file.size)}: il limite e' ${formatBytes(max)} per ${isImage ? 'le immagini' : 'i video'}.`;
  }
  return null;
}

export type PropertyForm = Record<keyof PropertyInput, string>;

export const emptyPropertyForm: PropertyForm = {
  title: '', description: '', price: '', city: '', address: '',
  listingType: 'sale', rooms: '', bathrooms: '', areaSqm: '',
};

const isInt = (s: string) => /^\d+$/.test(s.trim());

export function validateProperty(f: PropertyForm): Errors<keyof PropertyInput> {
  const e: Errors<keyof PropertyInput> = {};
  if (!f.title.trim()) e.title = 'Inserisci un titolo.';
  else if (f.title.length > 200) e.title = 'Massimo 200 caratteri.';
  if (!f.city.trim()) e.city = 'Inserisci la citta\'.';
  const price = Number(f.price.replace(',', '.'));
  if (!f.price.trim() || !Number.isFinite(price) || price <= 0) e.price = 'Inserisci un prezzo maggiore di zero.';
  if (f.listingType !== 'sale' && f.listingType !== 'rent') e.listingType = 'Scegli vendita o affitto.';
  for (const k of ['rooms', 'bathrooms', 'areaSqm'] as const) {
    if (!isInt(f[k])) e[k] = 'Inserisci un numero intero (anche 0).';
  }
  return e;
}

export function propertyFromForm(f: PropertyForm): PropertyInput {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    price: Number(f.price.replace(',', '.')),
    city: f.city.trim(),
    address: f.address.trim(),
    listingType: f.listingType === 'rent' ? 'rent' : 'sale',
    rooms: Number(f.rooms),
    bathrooms: Number(f.bathrooms),
    areaSqm: Number(f.areaSqm),
  };
}

export function validateOffer(amount: string, message: string): Errors<'amount' | 'message'> {
  const e: Errors<'amount' | 'message'> = {};
  const n = Number(amount.replace(',', '.'));
  if (!amount.trim() || !Number.isFinite(n) || n <= 0) e.amount = 'Inserisci un importo maggiore di zero.';
  if (message.length > 1000) e.message = 'Massimo 1000 caratteri.';
  return e;
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Inserisci un indirizzo email valido.';
}

/** Controllo minimo; i requisiti esatti (maiuscole, numeri, simboli) li impone il pool e Cognito risponde con l'errore. */
export function validateNewPassword(oldPw: string, newPw: string, confirm: string): Errors<'old' | 'new' | 'confirm'> {
  const e: Errors<'old' | 'new' | 'confirm'> = {};
  if (!oldPw) e.old = 'Inserisci la password attuale.';
  if (newPw.length < 8) e.new = 'Almeno 8 caratteri.';
  else if (newPw === oldPw) e.new = 'La nuova password deve essere diversa da quella attuale.';
  if (confirm !== newPw) e.confirm = 'Le due password non coincidono.';
  return e;
}

export function validateProfile(f: { displayName: string; phone: string; bio: string }): Errors<'displayName' | 'phone' | 'bio'> {
  const e: Errors<'displayName' | 'phone' | 'bio'> = {};
  if (f.displayName.length > 100) e.displayName = 'Massimo 100 caratteri.';
  if (f.phone && !/^\+?[0-9 ()./-]{6,20}$/.test(f.phone)) e.phone = 'Numero di telefono non valido.';
  if (f.bio.length > 1000) e.bio = 'Massimo 1000 caratteri.';
  return e;
}
