import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Block Ctrl/Cmd + scroll-wheel zoom — keyboard shortcuts are blocked in main.
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  },
  { passive: false }
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
