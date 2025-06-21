import { createContext, useContext, useState, useEffect } from 'react';
import en from '../locales/en';
import zh from '../locales/zh';

const translations = { en, zh };

const TranslationContext = createContext({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
});

export const TranslationProvider = ({ children }) => {
  const [language, setLanguage] = useState('en');
  const t = (key) => translations[language][key] || key;

  useEffect(() => {
    async function detectLang() {
      try {
        const res = await fetch('/api/detect-lang');
        const data = await res.json();
        let lang = 'en';
        if ((data.country || '').toUpperCase() === 'CN') {
          lang = 'zh';
        } else if (/zh/i.test(data.acceptLang || '')) {
          lang = 'zh';
        }
        setLanguage(lang);
      } catch (e) {
        // default to English on error
      }
    }
    detectLang();
  }, []);

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => useContext(TranslationContext);
