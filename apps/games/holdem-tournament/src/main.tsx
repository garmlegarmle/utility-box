import React from 'react';
import ReactDOM from 'react-dom/client';
import App from 'holdem/app/App';
import 'holdem/styles/variables.css';
import 'holdem/styles/globals.css';
import 'holdem/styles/fullscreen.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App layoutMode="fullscreen" />
  </React.StrictMode>,
);
