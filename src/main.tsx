import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { startFrameProbe } from './lib/cheapMode'
import './styles/base.css'

// Safari ignores user-scalable=no. These three events are what actually stop
// the child pinch-zooming the page instead of the map.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

// Start watching the frame clock now, so that by the time the child has
// pressed play — a few seconds of gate at the very least — the app knows
// whether this iPad can afford the good animations. Nothing waits on it: it
// answers "not cheap" until it has actually caught frames being missed.
startFrameProbe()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
