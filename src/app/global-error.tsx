"use client"; // Error boundaries must be Client Components

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole
 * document, so it cannot rely on the app's stylesheet: inline styles only.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <title>FleetOps · Something went wrong</title>
        <div role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>FleetOps could not load</h1>
          <p style={{ fontSize: 14, color: "#475569", margin: "0 0 16px" }}>
            Something went wrong while starting the app. Please try again.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 6,
              border: "none",
              background: "#0369a1",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
