import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export const THEMES = ['midnight', 'ocean', 'emerald', 'violet', 'crimson', 'light']
const Ctx = createContext<any>(null)
export const useTheme = () => useContext(Ctx)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(localStorage.getItem('ft_theme') || 'midnight')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ft_theme', theme)
  }, [theme])
  return <Ctx.Provider value={{ theme, setTheme, THEMES }}>{children}</Ctx.Provider>
}
