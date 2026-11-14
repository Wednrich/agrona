import { ErrorBoundary } from "./components/ErrorBoundary";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import App from "./App";
import "./styles.css";
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60000 } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
