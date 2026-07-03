export default function ConfirmLoading() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "4rem 1rem" }}>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
        <div style={{
          width: 32, height: 32,
          border: "3px solid rgba(2,132,199,0.2)",
          borderTopColor: "#0284c7",
          borderRadius: "50%",
          animation: "spin 0.75s linear infinite",
        }} />
        <p style={{ fontSize: "0.875rem", color: "#5b8db0", margin: 0 }}>Loading…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
