import { Component, type ErrorInfo, type ReactNode } from 'react';
import { diagLog } from '../../state/diagnostics';

interface State {
  error: Error | null;
}

/** Catches render errors so a broken panel shows a recoverable message, not a blank app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    diagLog('error', `React error in ${this.props.label ?? 'app'}: ${error.message}`);
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 20,
            color: 'var(--danger)',
            fontSize: 13,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <strong>Something went wrong in {this.props.label ?? 'the app'}.</strong>
          <code style={{ fontSize: 11, color: 'var(--text-dim)' }}>{this.state.error.message}</code>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
