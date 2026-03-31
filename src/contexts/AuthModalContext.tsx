/**
 * AuthModalContext — provides a global way to open the unified auth modal
 * (create account / sign in) from anywhere in the component tree without
 * prop-drilling.
 *
 * Usage:
 *   const { openAuthModal } = useAuthModal();
 *   openAuthModal();                    // opens on the landing view
 *   openAuthModal("create-account");    // opens directly on create-account
 *   openAuthModal("sign-in");           // opens directly on sign-in
 *   openAuthModal("landing", fn);       // calls fn() after successful auth
 */

import React, { createContext, useContext, useState, useCallback } from "react";

export type AuthModalView = "landing" | "create-account" | "sign-in";

interface AuthModalContextValue {
  isOpen: boolean;
  initialView: AuthModalView;
  /** Callback to invoke after the user successfully authenticates. */
  onAuthSuccess: (() => void) | null;
  openAuthModal: (view?: AuthModalView, onSuccess?: () => void) => void;
  closeAuthModal: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | undefined>(
  undefined,
);

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialView, setInitialView] = useState<AuthModalView>("landing");
  const [onAuthSuccess, setOnAuthSuccess] = useState<(() => void) | null>(null);

  const openAuthModal = useCallback(
    (view: AuthModalView = "landing", onSuccess?: () => void) => {
      setInitialView(view);
      // useState setter with a function arg is treated as an updater, so wrap
      // the callback in another function to store it as a value.
      setOnAuthSuccess(onSuccess ? () => onSuccess : null);
      setIsOpen(true);
    },
    [],
  );

  const closeAuthModal = useCallback(() => {
    setIsOpen(false);
    setOnAuthSuccess(null);
  }, []);

  return (
    <AuthModalContext.Provider
      value={{
        isOpen,
        initialView,
        onAuthSuccess,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthModalContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return ctx;
}
