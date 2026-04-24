import { mainLineLocale } from './main-line.js';
import { sanDiegoLocale } from './san-diego.js';
import type { LocaleConfig } from './types.js';

export type { LocaleConfig } from './types.js';

export const LOCALES: Record<string, LocaleConfig> = {
  'main-line':  mainLineLocale,
  'san-diego':  sanDiegoLocale,
};

export function getLocale(id: string): LocaleConfig {
  return LOCALES[id] ?? mainLineLocale;
}
