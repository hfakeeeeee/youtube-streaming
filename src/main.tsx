import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const scrollTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
document.addEventListener('scroll', (event) => {
  const element = event.target instanceof Element ? event.target : document.documentElement;
  clearTimeout(scrollTimers.get(element));
  element.classList.add('is-scrolling');
  scrollTimers.set(element, setTimeout(() => element.classList.remove('is-scrolling'), 700));
}, { capture: true, passive: true });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}notification-sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
