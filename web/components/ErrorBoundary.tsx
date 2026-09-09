"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  hasError: boolean;
}

/**
 * Component-level boundary so one misbehaving Stage/Theatre can't blank the whole page
 * (the failure mode that earlier masked a hydration issue). Wrap any sim view in this.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Stage error:", error);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <span className="text-sm text-danger">
            {this.props.label ?? "This view"} hit an error.
          </span>
          <button className="btn" onClick={this.reset}>
            ↺ Reload view
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
