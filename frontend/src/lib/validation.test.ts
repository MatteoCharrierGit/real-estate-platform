import { describe, expect, it } from 'vitest';
import { buildUploadForm } from './upload';
import {
  MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, emptyPropertyForm, propertyFromForm, validateEmail, validateNewPassword,
  validateOffer, validateProperty, validateUploadFile,
} from './validation';

describe('validazione upload', () => {
  const f = (type: string, size: number) => ({ name: 'x', type, size });
  it('accetta immagini fino a 10 MiB e video fino a 100 MiB', () => {
    expect(validateUploadFile(f('image/jpeg', MAX_IMAGE_BYTES))).toBeNull();
    expect(validateUploadFile(f('video/mp4', MAX_VIDEO_BYTES))).toBeNull();
  });
  it('rifiuta oltre i limiti, file vuoti e tipi diversi', () => {
    expect(validateUploadFile(f('image/png', MAX_IMAGE_BYTES + 1))).toMatch(/10\.0 MiB/);
    expect(validateUploadFile(f('video/mp4', MAX_VIDEO_BYTES + 1))).toMatch(/100\.0 MiB/);
    expect(validateUploadFile(f('video/mp4', MAX_IMAGE_BYTES + 1))).toBeNull();
    expect(validateUploadFile(f('image/png', 0))).toMatch(/vuoto/);
    expect(validateUploadFile(f('application/pdf', 10))).toMatch(/solo immagini e video/);
  });
});

describe('FormData del presigned POST', () => {
  it('invia i campi in ordine e il file per ULTIMO', () => {
    const form = buildUploadForm({ fields: { key: 'uploads/1/a.jpg', policy: 'p', 'X-Amz-Signature': 's' } }, new Blob(['x']), 'image/jpeg');
    const keys = [...form.keys()];
    expect(keys).toEqual(['key', 'policy', 'X-Amz-Signature', 'Content-Type', 'file']);
    expect(keys.at(-1)).toBe('file');
  });
  it('non duplica Content-Type se l\'API l\'ha gia\' incluso', () => {
    const form = buildUploadForm({ fields: { 'Content-Type': 'image/png', key: 'k' } }, new Blob(['x']), 'image/png');
    expect([...form.keys()].filter((k) => k.toLowerCase() === 'content-type')).toHaveLength(1);
  });
});

describe('form annuncio', () => {
  const ok = { ...emptyPropertyForm, title: 'Bilocale', city: 'Milano', price: '250000', rooms: '2', bathrooms: '1', areaSqm: '60' };
  it('valido', () => {
    expect(validateProperty(ok)).toEqual({});
    expect(propertyFromForm({ ...ok, price: '1200,50' }).price).toBe(1200.5);
  });
  it('segnala i campi errati', () => {
    const e = validateProperty({ ...ok, title: ' ', price: '0', rooms: '-1', areaSqm: 'abc' });
    expect(Object.keys(e).sort()).toEqual(['areaSqm', 'price', 'rooms', 'title']);
  });
});

describe('altre validazioni', () => {
  it('offerta', () => {
    expect(validateOffer('1000', '')).toEqual({});
    expect(validateOffer('', '').amount).toBeTruthy();
    expect(validateOffer('-5', '').amount).toBeTruthy();
  });
  it('email', () => {
    expect(validateEmail('a@b.it')).toBeNull();
    expect(validateEmail('a@b')).toBeTruthy();
  });
  it('cambio password', () => {
    expect(validateNewPassword('vecchia123', 'nuovaPass1', 'nuovaPass1')).toEqual({});
    expect(validateNewPassword('', 'corta', 'x')).toMatchObject({ old: expect.any(String), new: expect.any(String), confirm: expect.any(String) });
    expect(validateNewPassword('stessaPass1', 'stessaPass1', 'stessaPass1').new).toBeTruthy();
  });
});
