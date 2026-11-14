import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="auth-page">
        <h1>Не удалось открыть страницу</h1>
        <p>Обновите страницу. Сохранённые записи останутся доступны.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Обновить
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
