import React, { useState, useEffect } from 'react'
import Generator from './Generator'
import './App.css'

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('nfTheme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('nfTheme', theme)
  }, [theme])

  return (
    <div className="nf-shell">
      <header className="nf-header">
        <h1>name<span>Finder</span></h1>
        <button
          className="btn-theme"
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </header>

      <main className="nf-panel">
        <Generator />
      </main>
    </div>
  )
}
