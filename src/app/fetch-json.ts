import type { ZodType } from 'zod';

import { validateWithSchema } from '../shared/validation';

interface FetchJsonOptions {
  cacheBust?: boolean;
}

export async function fetchJsonValidated<T>(
  url: string,
  schema: ZodType<T>,
  label: string,
  options: FetchJsonOptions = {},
): Promise<T | null> {
  const targetUrl = new URL(url);
  if (options.cacheBust) {
    targetUrl.searchParams.set('v', String(Date.now()));
  }

  const response = await fetch(targetUrl, { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    console.warn(`${label} returned an empty response`);
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text) as unknown;
  } catch (error) {
    console.warn(`${label} returned invalid JSON`, error);
    return null;
  }

  return validateWithSchema(parsedJson, schema, label);
}
