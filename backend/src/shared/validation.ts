import { ValidationError } from "./errors";

type Opts = { required?: boolean; nullable?: boolean };
type StrOpts = Opts & { min?: number; max?: number };
type NumOpts = Opts & { min?: number; max?: number };

/**
 * Lettura e controllo dei campi di un body già parsato. Accumula gli errori e li lancia tutti insieme con
 * `done()` (422). Un campo assente restituisce `undefined`; `null` è ammesso solo con `nullable`.
 */
export class Fields {
  private readonly errors: string[] = [];
  constructor(private readonly src: Record<string, unknown>) {}

  has(key: string): boolean {
    return Object.hasOwn(this.src, key) && this.src[key] !== undefined;
  }

  private absent(key: string, o: Opts): "missing" | "null" | "present" {
    if (!this.has(key)) {
      if (o.required) this.errors.push(`${key}: obbligatorio`);
      return "missing";
    }
    if (this.src[key] === null) {
      if (!o.nullable) this.errors.push(`${key}: non può essere null`);
      return "null";
    }
    return "present";
  }

  string(key: string, o: StrOpts = {}): string | null | undefined {
    const s = this.absent(key, o);
    if (s === "missing") return undefined;
    if (s === "null") return o.nullable ? null : undefined;
    const v = this.src[key];
    if (typeof v !== "string") return void this.errors.push(`${key}: deve essere una stringa`);
    const t = v.trim();
    if (t.length < (o.min ?? 0)) return void this.errors.push(`${key}: troppo corto`);
    if (t.length > (o.max ?? 1000)) return void this.errors.push(`${key}: troppo lungo (max ${o.max ?? 1000})`);
    return t;
  }

  number(key: string, o: NumOpts = {}): number | null | undefined {
    const s = this.absent(key, o);
    if (s === "missing") return undefined;
    if (s === "null") return o.nullable ? null : undefined;
    const v = this.src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return void this.errors.push(`${key}: deve essere un numero`);
    if (v < (o.min ?? -Infinity) || v > (o.max ?? Infinity)) return void this.errors.push(`${key}: fuori intervallo`);
    return v;
  }

  integer(key: string, o: NumOpts = {}): number | null | undefined {
    const v = this.number(key, o);
    if (typeof v === "number" && !Number.isInteger(v)) return void this.errors.push(`${key}: deve essere intero`);
    return v;
  }

  /** Importo in euro con al massimo 2 decimali (colonna numeric(12,2)). */
  money(key: string, o: NumOpts = {}): number | undefined {
    const v = this.number(key, { ...o, max: o.max ?? 9_999_999_999.99 });
    if (typeof v === "number" && Math.abs(Math.round(v * 100) - v * 100) > 1e-6) {
      this.errors.push(`${key}: al massimo 2 decimali`);
      return undefined;
    }
    return v ?? undefined;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], o: Opts = {}): T | undefined {
    const s = this.absent(key, o);
    if (s !== "present") return undefined;
    const v = this.src[key];
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      this.errors.push(`${key}: deve essere uno tra ${allowed.join(", ")}`);
      return undefined;
    }
    return v as T;
  }

  done(): void {
    if (this.errors.length > 0) throw new ValidationError(this.errors.join("; "));
  }
}

/** Stessi controlli per i parametri di query (sono sempre stringhe). */
export function queryNumber(query: Record<string, string>, key: string, o: { min?: number; max?: number; integer?: boolean } = {}): number | undefined {
  const raw = query[key];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || (o.integer && !Number.isInteger(n)) || n < (o.min ?? -Infinity) || n > (o.max ?? Infinity)) {
    throw new ValidationError(`${key}: valore non valido`);
  }
  return n;
}
