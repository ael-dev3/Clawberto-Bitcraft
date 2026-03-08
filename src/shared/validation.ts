import type { ZodType } from 'zod';

export function validateWithSchema<T>(value: unknown, schema: ZodType<T>, label: string): T | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.warn(`${label} validation failed`, result.error.flatten());
    return null;
  }
  return result.data;
}
