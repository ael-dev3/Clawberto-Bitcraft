import type { ZodType } from 'zod';

import { resolvePublicUrl } from '../bitcraft';
import { fetchJsonWithSchema, type FetchJsonOptions } from './fetch-json';

export async function fetchRuntimeJson<T>(
  relativePath: string,
  schema: ZodType<T>,
  label: string,
  options: FetchJsonOptions = {},
): Promise<T | null> {
  return fetchJsonWithSchema(resolvePublicUrl(relativePath), schema, label, {
    noStore: true,
    ...options,
  });
}
