/**
 * AuthModal — unified authentication modal.
 *
 * Views:
 *   landing        — two CTAs: "Create account" and "Sign in with Nostr"
 *   create-account — multi-step signup flow:
 *                      1. display-name  — enter a name
 *                      2. secure        — generate key, show warning, force download
 *                      3. publishing    — publish kind:0 + kind:10002 via CreateAccount action
 *   sign-in        — delegates to the existing LoginDialog
 *
 * The modal is opened globally via useAuthModal() so any component that
 * requires authentication can trigger it without prop-drilling.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Download,
  Eye,
  EyeOff,
  ArrowLeft,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import { useLoginActions } from "@/hooks/useLoginActions";
import { runner } from "@/services/actions";
import { CreateAccount } from "@/actions/account";
import { useAuthModal, type AuthModalView } from "@/contexts/AuthModalContext";
import LoginDialog from "./LoginDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreateAccountStep = "display-name" | "secure" | "publishing";

// ---------------------------------------------------------------------------
// AuthModal
// ---------------------------------------------------------------------------

export function AuthModal() {
  const { isOpen, initialView, closeAuthModal } = useAuthModal();

  const [view, setView] = useState<AuthModalView>(initialView);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  // Create-account state
  const [createStep, setCreateStep] =
    useState<CreateAccountStep>("display-name");
  const [displayName, setDisplayName] = useState("");
  const [nsec, setNsec] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [nameError, setNameError] = useState("");

  const login = useLoginActions();

  // Sync view when the modal opens
  useEffect(() => {
    if (isOpen) {
      setView(initialView);
      // Reset create-account flow
      setCreateStep("display-name");
      setDisplayName("");
      setNsec("");
      setShowKey(false);
      setHasDownloaded(false);
      setIsPublishing(false);
      setNameError("");
    }
  }, [isOpen, initialView]);

  // When the user clicks "Sign in with Nostr" open LoginDialog on top
  const handleSignIn = useCallback(() => {
    setLoginDialogOpen(true);
  }, []);

  const handleLoginDialogClose = useCallback(() => {
    setLoginDialogOpen(false);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setLoginDialogOpen(false);
    closeAuthModal();
  }, [closeAuthModal]);

  // ---------------------------------------------------------------------------
  // Create-account flow
  // ---------------------------------------------------------------------------

  const handleNameSubmit = useCallback(() => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError("Please enter a display name");
      return;
    }
    // Generate key and move to secure step
    const sk = generateSecretKey();
    setNsec(nip19.nsecEncode(sk));
    setCreateStep("secure");
    setNameError("");
  }, [displayName]);

  const handleDownloadKey = useCallback(() => {
    try {
      const blob = new Blob([nsec], { type: "text/plain; charset=utf-8" });
      const url = globalThis.URL.createObjectURL(blob);

      const decoded = nip19.decode(nsec);
      if (decoded.type !== "nsec") throw new Error("Invalid nsec");

      const pubkey = getPublicKey(decoded.data);
      const npub = nip19.npubEncode(pubkey);
      const filename = `nostr-${location.hostname.replaceAll(/\./g, "-")}-${npub.slice(5, 9)}.nsec.txt`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      globalThis.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setHasDownloaded(true);
    } catch {
      toast({
        title: "Download failed",
        description:
          "Could not download the key file. Please copy it manually.",
        variant: "destructive",
      });
    }
  }, [nsec]);

  const handleCreateAccount = useCallback(async () => {
    if (!hasDownloaded) return;

    setCreateStep("publishing");
    setIsPublishing(true);

    try {
      // Log in with the generated key first so the factory has a signer
      login.nsec(nsec);

      // Publish kind:0 + kind:10002 via the CreateAccount action
      await runner.run(CreateAccount, displayName.trim());

      toast({
        title: "Account created",
        description: "Your profile and relay list have been published.",
      });

      closeAuthModal();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create account";
      toast({
        title: "Account creation failed",
        description: message,
        variant: "destructive",
      });
      // Step back so the user can retry
      setCreateStep("secure");
    } finally {
      setIsPublishing(false);
    }
  }, [hasDownloaded, nsec, displayName, login, closeAuthModal]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const getTitle = (): string => {
    if (view === "sign-in") return "Sign in";
    if (view === "create-account") {
      if (isPublishing) return "Creating account...";
      if (createStep === "display-name") return "Create account";
      if (createStep === "secure") return "Secure your account";
    }
    return "Get started";
  };

  const canGoBack = view === "create-account" && createStep === "display-name";

  const handleBack = () => {
    if (canGoBack) setView("landing");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog
        open={isOpen && !loginDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeAuthModal();
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-0 overflow-hidden rounded-2xl overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pb-2">
            <div className="flex items-center gap-2">
              {canGoBack && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="p-1 -ml-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="text-lg font-semibold leading-none tracking-tight flex-1 text-center pr-5">
                {getTitle()}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="px-6 pb-6 pt-4 space-y-5">
            {/* ── Landing view ── */}
            {view === "landing" && (
              <div className="space-y-3">
                <div className="flex size-20 text-5xl bg-primary/10 rounded-full items-center justify-center mx-auto mb-6">
                  🔑
                </div>
                <Button
                  className="w-full h-12"
                  onClick={() => setView("create-account")}
                >
                  Create account
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-12"
                  onClick={handleSignIn}
                >
                  Sign in with Nostr
                </Button>
              </div>
            )}

            {/* ── Create account: display-name step ── */}
            {view === "create-account" && createStep === "display-name" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleNameSubmit();
                }}
                className="space-y-4"
              >
                <div className="flex size-20 text-5xl bg-primary/10 rounded-full items-center justify-center mx-auto">
                  👤
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="auth-display-name"
                    className="text-sm font-medium"
                  >
                    Display name
                  </label>
                  <Input
                    id="auth-display-name"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      if (nameError) setNameError("");
                    }}
                    placeholder="Your name"
                    autoComplete="off"
                    autoFocus
                    className={
                      nameError
                        ? "border-red-500 focus-visible:ring-red-500"
                        : ""
                    }
                  />
                  {nameError && (
                    <p className="text-sm text-red-500">{nameError}</p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full h-12"
                  disabled={!displayName.trim()}
                >
                  Continue
                </Button>
              </form>
            )}

            {/* ── Create account: secure step ── */}
            {view === "create-account" && createStep === "secure" && (
              <div className="space-y-4">
                {/* Key display */}
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={nsec}
                    readOnly
                    className="pr-10 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                {/* Warning */}
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      Your account IS a Nostr secret key
                    </span>
                  </div>
                  <p className="text-xs text-amber-900 dark:text-amber-300 leading-relaxed">
                    Download it and keep it safe — if you lose it, you lose your
                    account permanently. There is no password reset.
                  </p>
                  <p className="text-xs text-amber-900 dark:text-amber-300 leading-relaxed">
                    If anyone else accesses it, they also have permanent access
                    to your account. With great power comes great
                    responsibility.
                  </p>
                </div>

                {/* Download button */}
                <Button
                  className="w-full h-12 gap-2"
                  variant={hasDownloaded ? "outline" : "default"}
                  onClick={handleDownloadKey}
                >
                  <Download className="h-4 w-4" />
                  {hasDownloaded ? "Download again" : "Download key"}
                </Button>

                {/* Continue — only enabled after download */}
                <Button
                  className="w-full h-12"
                  disabled={!hasDownloaded}
                  onClick={handleCreateAccount}
                >
                  Create account
                </Button>

                {!hasDownloaded && (
                  <p className="text-xs text-center text-muted-foreground">
                    You must download your key before continuing.
                  </p>
                )}
              </div>
            )}

            {/* ── Create account: publishing step ── */}
            {view === "create-account" && isPublishing && (
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground text-center">
                  Publishing your profile and relay list...
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Existing LoginDialog — opened when user clicks "Sign in with Nostr" */}
      <LoginDialog
        isOpen={loginDialogOpen}
        onClose={handleLoginDialogClose}
        onLogin={handleLoginSuccess}
      />
    </>
  );
}
