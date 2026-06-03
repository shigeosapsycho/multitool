import React from 'react'
import ReactDOM from 'react-dom/client'
import './lib/api' // side-effect: installs window.api backed by Tauri invokes
import App from './App'
import './styles/globals.css'

// Block Ctrl/Cmd + scroll-wheel zoom.
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  },
  { passive: false }
)

// Block the webview's native Ctrl/Cmd+F find bar.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
