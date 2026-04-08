// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Upload,
  AlertTriangle,
  ChevronDown,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  X,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { QRCodeCanvas } from "@/components/ui/qrcode";
import { APP_NAME } from "@/lib/constants";
import {
  useLoginActions,
  createNostrConnectSession,
  type NostrConnectSession,
} from "@/hooks/useLoginActions";
import { DialogTitle } from "@radix-ui/react-dialog";
import { useIsMobile } from "@/hooks/useIsMobile";

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  onCreateAccount?: () => void;
}

const validateNsec = (nsec: string) => {
  return /^nsec1[a-zA-Z0-9]{58}$/.test(nsec);
};

/** Extract the relay list embedded in a nostrconnect:// URI */
const relaysFromUri = (uri: string): string[] => {
  try {
    const url = new URL(uri);
    return url.searchParams.getAll("relay");
  } catch {
    return [];
  }
};

const validateBunkerUri = (uri: string) => {
  return uri.startsWith("bunker://");
};

const LoginDialog: React.FC<LoginDialogProps> = ({
  isOpen,
  onClose,
  onLogin,
  onCreateAccount,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [nsec, setNsec] = useState("");
  const [bunkerUri, setBunkerUri] = useState("");
  const [nostrConnectSession, setNostrConnectSession] =
    useState<NostrConnectSession | null>(null);
  const [isWaitingForConnect, setIsWaitingForConnect] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [errors, setErrors] = useState<{
    nsec?: string;
    bunker?: string;
    file?: string;
    extension?: string;
  }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const login = useLoginActions();
  const isMobile = useIsMobile();
  const hasExtension = "nostr" in window;
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);

  // Relay editor state for the nostrconnect session
  const [showRelayEditor, setShowRelayEditor] = useState(false);
  const [newRelayInput, setNewRelayInput] = useState("");

  // Generate a nostrconnect session (sync — just creates the ephemeral signer + URI)
  const generateConnectSession = useCallback((relays?: string[]) => {
    const session = createNostrConnectSession(APP_NAME, relays);
    setNostrConnectSession(session);
    setConnectError(null);
  }, []);

  // Start listening for the remote signer to connect (async)
  useEffect(() => {
    if (!nostrConnectSession || isWaitingForConnect) return;

    const startListening = async () => {
      setIsWaitingForConnect(true);
      abortControllerRef.current = new AbortController();

      try {
        await login.nostrconnect(
          nostrConnectSession,
          abortControllerRef.current.signal,
        );
        onLogin();
        onClose();
      } catch (error) {
        // Don't show an error if the dialog was simply closed
        if (error instanceof Error && error.name !== "AbortError") {
          setConnectError(error.message);
        }
        setIsWaitingForConnect(false);
      }
    };

    startListening();
  }, [nostrConnectSession, login, onLogin, onClose, isWaitingForConnect]);

  // Clean up when the dialog closes
  useEffect(() => {
    if (!isOpen) {
      setNostrConnectSession(null);
      setIsWaitingForConnect(false);
      setConnectError(null);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }
  }, [isOpen]);

  // Reset all state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
      setIsFileLoading(false);
      setNsec("");
      setBunkerUri("");
      setErrors({});
      setShowBunkerInput(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [isOpen]);

  const handleRetry = useCallback(
    (relays?: string[]) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setNostrConnectSession(null);
      setIsWaitingForConnect(false);
      setConnectError(null);
      // Let state clear before generating a new session
      setTimeout(() => generateConnectSession(relays), 0);
    },
    [generateConnectSession],
  );

  /** Regenerate the session with a modified relay list */
  const handleRelayChange = useCallback(
    (relays: string[]) => {
      handleRetry(relays);
      setShowRelayEditor(false);
      setNewRelayInput("");
    },
    [handleRetry],
  );

  const handleCopyUri = async () => {
    if (!nostrConnectSession) return;
    await navigator.clipboard.writeText(nostrConnectSession.uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // On mobile, open the nostrconnect:// URI directly — this launches signer apps like Amber
  const handleOpenSignerApp = () => {
    if (!nostrConnectSession) return;
    window.location.href = nostrConnectSession.uri;
  };

  const handleExtensionLogin = async () => {
    setIsLoading(true);
    setErrors((prev) => ({ ...prev, extension: undefined }));

    try {
      if (!("nostr" in window)) {
        throw new Error(
          "Nostr extension not found. Please install a NIP-07 extension.",
        );
      }
      await login.extension();
      onLogin();
      onClose();
    } catch (e: unknown) {
      const error = e as Error;
      console.error("Extension login failed:", error);
      setErrors((prev) => ({
        ...prev,
        extension:
          error instanceof Error ? error.message : "Extension login failed",
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const executeLogin = (key: string) => {
    setIsLoading(true);
    setErrors({});

    // Timeout lets the UI update before the synchronous login call
    setTimeout(() => {
      try {
        login.nsec(key);
        onLogin();
        onClose();
      } catch {
        setErrors({
          nsec: "Failed to login with this key. Please check that it's correct.",
        });
        setIsLoading(false);
      }
    }, 50);
  };

  const handleKeyLogin = () => {
    if (!nsec.trim()) {
      setErrors((prev) => ({ ...prev, nsec: "Please enter your secret key" }));
      return;
    }

    if (!validateNsec(nsec)) {
      setErrors((prev) => ({
        ...prev,
        nsec: "Invalid secret key format. Must be a valid nsec starting with nsec1.",
      }));
      return;
    }
    executeLogin(nsec);
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim()) {
      setErrors((prev) => ({ ...prev, bunker: "Please enter a bunker URI" }));
      return;
    }

    if (!validateBunkerUri(bunkerUri)) {
      setErrors((prev) => ({
        ...prev,
        bunker: "Invalid bunker URI format. Must start with bunker://",
      }));
      return;
    }

    setIsLoading(true);
    setErrors((prev) => ({ ...prev, bunker: undefined }));

    try {
      await login.bunker(bunkerUri);
      onLogin();
      onClose();
      setBunkerUri("");
    } catch {
      setErrors((prev) => ({
        ...prev,
        bunker: "Failed to connect to bunker. Please check the URI.",
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsFileLoading(true);
    setErrors({});

    const reader = new FileReader();
    reader.onload = (event) => {
      setIsFileLoading(false);
      const content = event.target?.result as string;
      if (content) {
        const trimmedContent = content.trim();
        if (validateNsec(trimmedContent)) {
          executeLogin(trimmedContent);
        } else {
          setErrors({ file: "File does not contain a valid secret key." });
        }
      } else {
        setErrors({ file: "Could not read file content." });
      }
    };
    reader.onerror = () => {
      setIsFileLoading(false);
      setErrors({ file: "Failed to read file." });
    };
    reader.readAsText(file);
  };

  const renderTabs = () => (
    <Tabs
      defaultValue="key"
      className="w-full"
      onValueChange={(value) => {
        if (value === "remote" && !nostrConnectSession && !connectError) {
          generateConnectSession();
        }
      }}
    >
      <TabsList className="grid w-full grid-cols-2 bg-muted/80 rounded-lg mb-4">
        <TabsTrigger value="key" className="flex items-center gap-2">
          <span>Secret Key</span>
        </TabsTrigger>
        <TabsTrigger value="remote" className="flex items-center gap-2">
          <span>Remote Signer</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="key" className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleKeyLogin();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Input
              id="nsec"
              type="password"
              value={nsec}
              onChange={(e) => {
                setNsec(e.target.value);
                if (errors.nsec)
                  setErrors((prev) => ({ ...prev, nsec: undefined }));
              }}
              className={`rounded-lg ${
                errors.nsec ? "border-red-500 focus-visible:ring-red-500" : ""
              }`}
              placeholder="nsec1..."
              autoComplete="off"
            />
            {errors.nsec && (
              <p className="text-sm text-red-500">{errors.nsec}</p>
            )}
          </div>

          <div className="flex space-x-2">
            <Button
              type="submit"
              size="lg"
              disabled={isLoading || !nsec.trim()}
              className="flex-1"
            >
              {isLoading ? "Verifying..." : "Log in"}
            </Button>

            <input
              type="file"
              accept=".txt"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isFileLoading}
              className="px-3"
            >
              <Upload className="w-4 h-4" />
            </Button>
          </div>

          {errors.file && (
            <p className="text-sm text-red-500 text-center">{errors.file}</p>
          )}
        </form>
      </TabsContent>

      <TabsContent value="remote" className="space-y-4">
        {/* nostrconnect:// section */}
        <div className="flex flex-col items-center space-y-4">
          {connectError ? (
            <div className="flex flex-col items-center space-y-4 py-4">
              <p className="text-sm text-red-500 text-center">{connectError}</p>
              <Button variant="outline" onClick={() => handleRetry()}>
                Retry
              </Button>
            </div>
          ) : nostrConnectSession ? (
            <>
              {/* QR code — desktop only */}
              {!isMobile && (
                <div className="p-4 bg-white dark:bg-white rounded-xl">
                  <QRCodeCanvas
                    value={nostrConnectSession.uri}
                    size={180}
                    level="M"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {isMobile
                    ? "Tap to open your signer app"
                    : "Scan with your signer app"}
                </span>
              </div>

              {/* Deep-link button — mobile only */}
              {isMobile && (
                <Button
                  className="w-full gap-2 py-6 rounded-full"
                  onClick={handleOpenSignerApp}
                >
                  <ExternalLink className="w-5 h-5" />
                  Open Signer App
                </Button>
              )}

              <Button
                variant="outline"
                size={isMobile ? "default" : "sm"}
                className={isMobile ? "w-full gap-2 rounded-full" : "gap-2"}
                onClick={handleCopyUri}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy URI
                  </>
                )}
              </Button>

              {/* Relay editor — collapsible one-liner */}
              {(() => {
                const currentRelays = relaysFromUri(nostrConnectSession.uri);
                return (
                  <div className="w-full">
                    <button
                      type="button"
                      onClick={() => setShowRelayEditor(!showRelayEditor)}
                      className="flex items-center justify-center gap-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                    >
                      <span>
                        Relays:{" "}
                        {currentRelays
                          .map((r) => r.replace("wss://", ""))
                          .join(", ")}
                      </span>
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${showRelayEditor ? "rotate-180" : ""}`}
                      />
                    </button>

                    {showRelayEditor && (
                      <div className="mt-2 space-y-2 text-sm">
                        {currentRelays.map((relay) => (
                          <div
                            key={relay}
                            className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5"
                          >
                            <span className="flex-1 font-mono text-xs truncate">
                              {relay}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleRelayChange(
                                  currentRelays.filter((r) => r !== relay),
                                )
                              }
                              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                              aria-label={`Remove ${relay}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newRelayInput}
                            onChange={(e) => setNewRelayInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && newRelayInput.trim()) {
                                e.preventDefault();
                                const relay =
                                  newRelayInput.trim().startsWith("wss://") ||
                                  newRelayInput.trim().startsWith("ws://")
                                    ? newRelayInput.trim()
                                    : `wss://${newRelayInput.trim()}`;
                                handleRelayChange([...currentRelays, relay]);
                              }
                            }}
                            placeholder="wss://relay.example.com"
                            className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!newRelayInput.trim()) return;
                              const relay =
                                newRelayInput.trim().startsWith("wss://") ||
                                newRelayInput.trim().startsWith("ws://")
                                  ? newRelayInput.trim()
                                  : `wss://${newRelayInput.trim()}`;
                              handleRelayChange([...currentRelays, relay]);
                            }}
                            className="h-7 w-7 rounded-md border border-input bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            aria-label="Add relay"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="flex items-center justify-center h-[100px]">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Manual bunker:// input — collapsible */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowBunkerInput(!showBunkerInput)}
            className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            <span>Enter bunker URI manually</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showBunkerInput ? "rotate-180" : ""}`}
            />
          </button>

          {showBunkerInput && (
            <div className="space-y-3 mt-3">
              <div className="space-y-2">
                <Input
                  id="connectBunkerUri"
                  value={bunkerUri}
                  onChange={(e) => {
                    setBunkerUri(e.target.value);
                    if (errors.bunker)
                      setErrors((prev) => ({ ...prev, bunker: undefined }));
                  }}
                  className="rounded-lg border-gray-300 dark:border-gray-700 focus-visible:ring-primary text-sm"
                  placeholder="bunker://"
                  autoComplete="off"
                />
                {bunkerUri && !validateBunkerUri(bunkerUri) && (
                  <p className="text-red-500 text-xs">
                    Invalid bunker URI format
                  </p>
                )}
                {errors.bunker && (
                  <p className="text-sm text-red-500">{errors.bunker}</p>
                )}
              </div>

              <Button
                className="w-full rounded-full py-4"
                variant="outline"
                onClick={handleBunkerLogin}
                disabled={
                  isLoading ||
                  !bunkerUri.trim() ||
                  !validateBunkerUri(bunkerUri)
                }
              >
                {isLoading ? "Connecting..." : "Connect"}
              </Button>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-6 overflow-hidden rounded-2xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight text-center">
            Log in
          </DialogTitle>
        </DialogHeader>

        <div className="flex size-40 text-8xl bg-primary/10 rounded-full items-center justify-center justify-self-center">
          🔑
        </div>

        <div className="px-6 pb-6 space-y-4 overflow-y-auto">
          {/* Extension login — shown when a NIP-07 extension is detected */}
          {hasExtension && (
            <div className="space-y-3">
              {errors.extension && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{errors.extension}</AlertDescription>
                </Alert>
              )}
              <Button
                className="w-full h-12 px-9"
                onClick={handleExtensionLogin}
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Log in with Extension"}
              </Button>
            </div>
          )}

          {/* Tabs — collapsed behind "More Options" when an extension is present */}
          {hasExtension ? (
            <Collapsible
              className="space-y-4"
              open={isMoreOptionsOpen}
              onOpenChange={setIsMoreOptionsOpen}
            >
              <button
                type="button"
                onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
                className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                <span>More Options</span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${isMoreOptionsOpen ? "rotate-180" : ""}`}
                />
              </button>

              <CollapsibleContent>{renderTabs()}</CollapsibleContent>
            </Collapsible>
          ) : (
            renderTabs()
          )}

          {onCreateAccount && (
            <p className="text-sm text-center text-muted-foreground pt-2">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={onCreateAccount}
                className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
              >
                Create account
              </button>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
