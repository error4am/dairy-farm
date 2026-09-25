import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/AuthContext';
import { DataProvider } from './lib/DataContext';
import { MetaProvider } from './lib/MetaContext';
import { ToastProvider } from './lib/ToastContext';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DataProvider>
          <MetaProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </MetaProvider>
        </DataProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
