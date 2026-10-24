import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, ScrollRestoration } from "react-router-dom";
import { App } from "./App";
import { API_MODE } from "./api/client";
import { ErrorScreen } from "./app/ErrorScreen";
import { Providers } from "./app/Providers";

async function boot() {
  // Mock mode: start MSW before the first request so every call goes through the network seam.
  if (API_MODE === "mock") {
    const { startMockServer } = await import("./mock/browser");
    await startMockServer();
  }
  // A data router (needed for useBlocker) hosting the declarative <Routes> in App.
  const router = createBrowserRouter([
    {
      path: "*",
      element: (
        <Providers>
          <App />
          <ScrollRestoration />
        </Providers>
      ),
      errorElement: (
        <Providers>
          <ErrorScreen />
        </Providers>
      ),
    },
  ]);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void boot();
