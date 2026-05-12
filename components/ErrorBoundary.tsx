import React from 'react'

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4">
        <div className="max-w-md w-full glass-card rounded-2xl p-6 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-lg font-semibold text-white mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-400 mb-5">
            The page hit an unexpected error. Try refreshing — if it keeps happening, let Michael know.
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition"
          >
            Reload
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mt-4 text-left text-[11px] text-red-400 bg-red-500/5 border border-red-500/10 rounded-lg p-3 overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
