import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[ErrorBoundary]', err, info); }
  reset = () => this.setState({ err: null });
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="fs-card p-6 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-fg mb-4">{String(this.state.err?.message ?? this.state.err)}</p>
          <button onClick={() => { this.reset(); location.reload(); }} className="fs-btn-primary w-full">
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
