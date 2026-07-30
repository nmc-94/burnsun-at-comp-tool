import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import { readSettings, subscribeSettings } from './settings'
import { applyUiScale } from './ui-scale'
import './styles/base.css'

// The pre-paint script in index.html sets the size before anything renders, so this is only
// about keeping up afterwards: when the account menu writes the preference, the attribute on
// <html> has to follow. Registered here rather than in a component because what it writes sits
// above the tree React owns, and never unsubscribed because the document outlives the app.
subscribeSettings(() => applyUiScale(readSettings().largerUi))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
