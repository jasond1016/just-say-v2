import { enUS } from './en-US'
import type { AppLocale, Messages } from './types'
import { zhCN } from './zh-CN'

const localeMap: Record<AppLocale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

export function getMessages(locale: AppLocale): Messages {
  return localeMap[locale] ?? zhCN
}

export type { AppLocale, Messages } from './types'
