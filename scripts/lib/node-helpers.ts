import fs from 'node:fs/promises';
import path from 'node:path';

import type { ZodType } from 'zod';

import { validateWithSchema } from '../../src/shared/validation';

export async function readJsonFileIfExists<T>(filePath: string, schema: ZodType<T>, label: string): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    return validateWithSchema(parsed, schema, label);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }

    console.warn(`${label} read failed`, error);
    return null;
  }
}

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function fetchJsonWithSchema<T>(
  url: string,
  schema: ZodType<T>,
  label: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const response = await fetch(url, init);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error != null && 'code' in error;
}
