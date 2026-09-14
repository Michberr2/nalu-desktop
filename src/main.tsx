import React from 'react'
import ReactDOM from 'react-dom/client'
const Companion = React.lazy(() => import('./companion/Companion'))
const App = React.lazy(() => import('./App'))
import './globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>{location.hash === '#companion' ? <Companion /> : <App />}</React.Suspense>
  </React.StrictMode>,
)
