import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Order matters: tokens.css declares the neutral `--ac-*` defaults; the
// active instance's theme (imported inside ./config/active, pulled in
// transitively via App below) re-declares them with real skin values, and
// must load AFTER tokens.css to win the cascade. index.css (Tailwind) only
// ever *consumes* `--ac-*` vars, so its position relative to the theme load
// doesn't matter.
import './styles/tokens.css';
import './index.css';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
