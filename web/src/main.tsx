import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import { applyUiScale, subscribeUiScale } from './ui-scale'
import './styles/base.css'

// The pre-paint script in index.html sets the size before anything renders, so this is only
// about keeping up afterwards. Two things move it: the account menu writing a new step, and the
// window crossing the line between the two remembered sizes — `subscribeUiScale` is both, which
// is why this does not subscribe to the settings directly.
//
// Registered here rather than in a component because what it writes sits above the tree React
// owns, and never unsubscribed because the document outlives the app.
subscribeUiScale(applyUiScale)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
