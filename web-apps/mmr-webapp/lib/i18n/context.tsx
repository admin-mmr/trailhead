'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Lang, TranslationKey, t } from './translations'

interface LangContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  T: (key: TranslationKey) => string
}

const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => {},
  T: (key) => key,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    const stored = localStorage.getItem('mmr-lang') as Lang | null
    if (stored === 'en' || stored === 'zh') setLangState(stored)
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('mmr-lang', l)
    document.documentElement.lang = l
  }

  const T = (key: TranslationKey) => t(key, lang)

  return (
    <LangContext.Provider value={{ lang, setLang, T }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
