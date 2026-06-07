import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { ToastProvider } from '@/components/ui/Toast.jsx';
import { ThemeProvider } from '@/context/ThemeContext.jsx';
import { AuthProvider } from '@/context/AuthContext.jsx';
import { ProfileProvider } from '@/context/ProfileContext.jsx';
import { NavProvider } from '@/context/NavContext.jsx';
import { ErrorBoundary } from '@/components/ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <ProfileProvider>
                <NavProvider>
                  <App />
                </NavProvider>
              </ProfileProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
