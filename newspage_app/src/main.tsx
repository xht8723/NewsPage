import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, fontFamily: "system-ui, sans-serif", color: "#a1a1aa", background: "#09090b", minHeight: "100vh" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f87171", marginBottom: 8 }}>Something went wrong</h2>
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#18181b", padding: 12, borderRadius: 8, marginBottom: 16, maxHeight: 300, overflow: "auto" }}>
            {this.state.error?.message ?? "Unknown error"}
          </pre>
          <button
            onClick={this.handleDismiss}
            style={{ background: "#27272a", color: "#e4e4e7", border: "1px solid #3f3f46", padding: "8px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
