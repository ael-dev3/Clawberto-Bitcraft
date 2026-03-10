import type { ZodType } from 'zod';

import { validateWithSchema } from '../validation';

export interface FetchJsonOptions {
  cacheBust?: boolean;
  init?: RequestInit;
  noStore?: boolean;
}

export async function fetchJsonWithSchema<T>(
  url: string,
  schema: ZodType<T>,
  label: string,
  options: FetchJsonOptions = {},
): Promise<T | null> {
  const targetUrl = new URL(url);
  if (options.cacheBust) {
    targetUrl.searchParams.set('v', String(Date.now()));
  }

  try {
    const response = await fetch(targetUrl, {
      ...(options.noStore ? { cache: 'no-store' } : {}),
      ...options.init,
    });
    const text = await response.text();

    if (!response.ok) {
      console.warn(`${label} request failed with ${response.status}`);
      return null;
    }

    if (!text.trim()) {
      console.warn(`${label} returned an empty response`);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      console.warn(`${label} returned invalid JSON`, error);
      return null;
    }

    return validateWithSchema(parsed, schema, label);
  } catch (error) {
    console.warn(`${label} request failed`, error);
    return null;
  }
}
