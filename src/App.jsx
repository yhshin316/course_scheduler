import { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import Navigation from './Navigation/Navigation.jsx'
import AppRouter from './AppRouter.jsx'
import './App.css'

function AppLayout() {
  const [isDarkMode, setIsDarkMode] = useState(false)

  return (
    <div className={`app-shell${isDarkMode ? ' is-dark' : ''}`}>
      <Navigation
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode((currentMode) => !currentMode)}
      />
      <main className="app-content">
        <AppRouter />
      </main>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}

export default App
