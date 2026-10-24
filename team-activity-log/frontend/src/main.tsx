import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { API_MODE } from "./api/client";
import { Providers } from "./app/Providers";

async function boot() {
  // Mock mode: start MSW before the first request so every call goes through the network seam.
  if (API_MODE === "mock") {
    const { startMockServer } = await import("./mock/browser");
    await startMockServer();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <Providers>
          <App />
        </Providers>
      </BrowserRouter>
    </StrictMode>,
  );
}

void boot();
