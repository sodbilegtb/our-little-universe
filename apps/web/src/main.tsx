import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MotionConfig } from 'motion/react';
import { App } from './App';
import './styles/index.css';

if (import.meta.env.DEV) {
  // Console access for local design work and end-to-end tests, e.g. await __olu.simulate()
  void Promise.all([import('@/services/api'), import('@/features/admin/adminSession')]).then(([{ api }, { adminSessionStore }]) => {
    const admin = () => {
      const session = adminSessionStore.read();
      if (!session) throw new Error('Sign in to the host desk first.');
      return session;
    };
    Object.assign(window, {
      __olu: {
        api,
        reset: () => api.dev?.reset(admin()),
        simulate: () => api.dev?.simulateActivity(admin()),
        simulateOutage: (ms = 10_000) => api.dev?.simulateOutage?.(ms),
      },
    });
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {/* "user" honours prefers-reduced-motion across every Motion component. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
);
