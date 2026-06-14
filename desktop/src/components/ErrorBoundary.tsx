import React, { Component, ReactNode } from 'react';
import { t } from '../i18n/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught error:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center h-[100vh] bg-[var(--bg)] text-[var(--text-muted)] font-[system-ui,-apple-system,sans-serif] p-[20px]"
        >
          <div
            className="text-[60px] mb-[16px]"
          >
            😿
          </div>
          <h1
            className="text-[20px] font-semibold mb-[8px] text-[var(--text-dim)]"
          >
            {t('error.crashed')}
          </h1>
          <p
            className="text-[14px] mb-[24px] text-[var(--text-muted)] text-center max-w-[400px]"
          >
            {t('error.retry')}
          </p>
          <button
            onClick={this.handleReload}
            className="bg-[var(--accent)] text-white border-none rounded-[8px] px-[20px] py-[8px] text-[14px] font-semibold cursor-pointer transition-opacity duration-200 hover:opacity-90"
          >
            {t('error.reload')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
