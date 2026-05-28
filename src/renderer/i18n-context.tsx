import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { getMessages, type AppLocale, type Messages } from '../i18n'

const I18nContext = createContext<Messages>(getMessages('zh-CN'))

export function I18nProvider(props: { locale: AppLocale; children: ReactNode }) {
  const messages = useMemo(() => getMessages(props.locale), [props.locale])

  return <I18nContext.Provider value={messages}>{props.children}</I18nContext.Provider>
}

export function useT(): Messages {
  return useContext(I18nContext)
}
