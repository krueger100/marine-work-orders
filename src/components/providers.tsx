"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { reportAuthFailure } from "@/lib/api/auth-events";
import { toAppError } from "@/lib/api/errors";
import { SessionProvider } from "./session/session-provider";

// A request rejected because the session is invalid starts session recovery.
const onError = (error: unknown) => {
  if (toAppError(error).isAuthFailure) reportAuthFailure();
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Retry once, but never with a session the server already rejected.
            retry: (failureCount, error) => failureCount < 1 && !toAppError(error).isAuthFailure,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
