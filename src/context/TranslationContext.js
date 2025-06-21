import { createContext, useContext, useState } from 'react';
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

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => useContext(TranslationContext);
