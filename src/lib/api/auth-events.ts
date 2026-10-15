// A tiny bridge between the query layer (which sees failed requests) and the
// session provider (which can start a fresh session).
type Listener = () => void;

const listeners = new Set<Listener>();

export function onAuthFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportAuthFailure(): void {
  for (const listener of listeners) listener();
}
