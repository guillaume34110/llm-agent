import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import axios from 'axios';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';
import store from './store/store';

axios.defaults.withCredentials = true;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
