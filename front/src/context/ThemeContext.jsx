import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'massa-storage-theme'

const ThemeContext = createContext({
  theme: 'dark',
  setTheme: () => {},
  isLight: false,
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      return (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {}
  }, [theme])

  const setTheme = (value) => {
    setThemeState(value === 'light' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLight: theme === 'light' }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

