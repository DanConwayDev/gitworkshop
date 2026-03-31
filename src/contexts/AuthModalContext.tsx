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
 */

import React, { createContext, useContext, useState, useCallback } from "react";

export type AuthModalView = "landing" | "create-account" | "sign-in";

interface AuthModalContextValue {
  isOpen: boolean;
  initialView: AuthModalView;
  openAuthModal: (view?: AuthModalView) => void;
  closeAuthModal: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | undefined>(
  undefined,
);

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialView, setInitialView] = useState<AuthModalView>("landing");

  const openAuthModal = useCallback((view: AuthModalView = "landing") => {
    setInitialView(view);
    setIsOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <AuthModalContext.Provider
      value={{ isOpen, initialView, openAuthModal, closeAuthModal }}
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
