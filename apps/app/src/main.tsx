import { Effect } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const bootMessage = Effect.runSync(Effect.succeed("Vite+ / Bun / Effect"));

function App() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Vite+ / Bun / Effect</p>
        <h1>{bootMessage}</h1>
        <p>The app workspace is wired for package-local checks through patched effect-tsgo.</p>
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
