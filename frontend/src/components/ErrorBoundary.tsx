import React from 'react';

interface State { hasError: boolean; message: string }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message || 'Erreur inconnue' };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', gap: 16,
      }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>Une erreur est survenue</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 320, textAlign: 'center' }}>{this.state.message}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px', border: 'none', borderRadius: 'var(--radius)',
            background: 'var(--green)', color: 'white', fontFamily: 'Nunito',
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}
        >
          Recharger la page
        </button>
      </div>
    );
  }
}
