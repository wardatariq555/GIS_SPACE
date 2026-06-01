function LoadingOverlay({ loading }) {
  if (!loading) return null;

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">Calculating walkable reach...</div>
    </div>
  );
}

export default LoadingOverlay;
