import { useEffect, useState } from "react";

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8000");

  useEffect(() => {
    window.desktopPet
      ?.runtimeInfo()
      .then((info) => setApiBaseUrl(info.apiBaseUrl))
      .catch(() => {});
  }, []);

  return (
    <main className="pet-shell">
      <div className="pet-placeholder">
        <span className="pet-status-dot" />
        <span>Codex Pet</span>
      </div>
      <p>{apiBaseUrl}</p>
    </main>
  );
}
