/**
 * CreateRepoDialog — dialog for creating a new git repository using Grasp.
 *
 * Shows a form (name, description, optional advanced Grasp settings) then
 * transitions to a step-by-step progress view during creation.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import {
  Check,
  Circle,
  Loader2,
  X,
  AlertTriangle,
  Server,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toRepoIdentifier, validateRepoIdentifier } from "@/lib/create-repo";
import {
  useCreateRepo,
  type CreateRepoStep,
  type CreateRepoFormInput,
} from "@/hooks/useCreateRepo";
import { useGraspServers, type GraspServer } from "@/hooks/useGraspServers";
import { useRepoPath } from "@/hooks/useRepoPath";
import { usePublish } from "@/hooks/usePublish";
import { DEFAULT_GRASP_SERVERS } from "@/services/settings";
import { validateGraspServer } from "@/lib/grasp";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRASP_LIST_KIND = 10317;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS: { key: CreateRepoStep; label: string }[] = [
  { key: "building-commit", label: "Building initial commit" },
  { key: "signing-events", label: "Signing events" },
  {
    key: "publishing-announcement",
    label: "Publishing repository announcement",
  },
  { key: "publishing-state", label: "Publishing repository state" },
  { key: "pushing", label: "Pushing git data" },
];

const STEP_ORDER: CreateRepoStep[] = STEPS.map((s) => s.key);

function StepIcon({
  step,
  currentStep,
}: {
  step: CreateRepoStep;
  currentStep: CreateRepoStep;
}) {
  const stepIdx = STEP_ORDER.indexOf(step);
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  if (currentStep === "error") {
    if (stepIdx < currentIdx) {
      return <Check className="h-4 w-4 text-green-500" />;
    }
    if (stepIdx === currentIdx) {
      return <X className="h-4 w-4 text-red-500" />;
    }
    return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  }

  if (currentStep === "done") {
    return <Check className="h-4 w-4 text-green-500" />;
  }

  if (stepIdx < currentIdx) {
    return <Check className="h-4 w-4 text-green-500" />;
  }
  if (stepIdx === currentIdx) {
    return <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

// ---------------------------------------------------------------------------
// Purgatory countdown
// ---------------------------------------------------------------------------

function PurgatoryCountdown({ publishedAt }: { publishedAt: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const expiresAt = publishedAt + 30 * 60 * 1000; // 30 minutes
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  if (remaining <= 0) {
    return (
      <p className="text-sm text-red-500">
        Purgatory window has expired. Events may have been discarded.
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Events are in purgatory. You have{" "}
      <span className="font-mono font-medium text-foreground">
        {minutes}:{seconds.toString().padStart(2, "0")}
      </span>{" "}
      to retry before they expire.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Success redirect helper
// ---------------------------------------------------------------------------

function SuccessActions({
  pubkey,
  identifier,
  onClose,
}: {
  pubkey: string;
  identifier: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const repoPath = useRepoPath(pubkey, identifier, []);

  const handleViewRepo = useCallback(() => {
    onClose();
    navigate(repoPath);
  }, [navigate, repoPath, onClose]);

  return (
    <div className="space-y-4">
      <Button onClick={handleViewRepo} className="w-full">
        View Repository
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function CreateRepoDialog({ isOpen, onClose }: CreateRepoDialogProps) {
  const account = useActiveAccount();
  const pubkey = account?.pubkey;
  const {
    servers: resolvedServers,
    isFromUserList,
    isLoading: serversLoading,
  } = useGraspServers(pubkey);

  const { state, execute, retryPush, reset } = useCreateRepo();
  const { publishEvent } = usePublish();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Advanced section state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // selectedDomains: the set of domains the user has chosen for this repo.
  // Initialised from resolvedServers once they load.
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  // Custom domain input for adding a server not in the list
  const [customDomain, setCustomDomain] = useState("");
  const [customDomainError, setCustomDomainError] = useState<
    string | undefined
  >();
  const [validatingDomain, setValidatingDomain] = useState(false);
  // Whether to save these servers as the user's default grasp list
  const [saveAsDefaults, setSaveAsDefaults] = useState(false);

  // Derived identifier
  const identifier = useMemo(() => toRepoIdentifier(name), [name]);
  const identifierError = useMemo(
    () => (name.trim() ? validateRepoIdentifier(identifier) : undefined),
    [name, identifier],
  );

  // Build the effective GraspServer list from selectedDomains
  const selectedServers = useMemo<GraspServer[]>(() => {
    return selectedDomains.map((domain) => {
      // Prefer the wsUrl from resolvedServers if available
      const existing = resolvedServers.find((s) => s.domain === domain);
      return existing ?? { domain, wsUrl: `wss://${domain}` };
    });
  }, [selectedDomains, resolvedServers]);

  // Initialise selectedDomains when servers load or dialog opens
  useEffect(() => {
    if (resolvedServers.length > 0 && selectedDomains.length === 0) {
      setSelectedDomains(resolvedServers.map((s) => s.domain));
    }
  }, [resolvedServers, selectedDomains.length]);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setDescription("");
      setSelectedDomains(resolvedServers.map((s) => s.domain));
      setCustomDomain("");
      setCustomDomainError(undefined);
      setValidatingDomain(false);
      setSaveAsDefaults(false);
      setAdvancedOpen(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, reset]);

  // When resolvedServers change (e.g. after load) and we haven't customised yet,
  // sync selectedDomains to the new resolved list.
  useEffect(() => {
    if (!advancedOpen) {
      setSelectedDomains(resolvedServers.map((s) => s.domain));
    }
  }, [resolvedServers, advancedOpen]);

  const handleClose = useCallback(() => {
    if (
      state.step !== "idle" &&
      state.step !== "done" &&
      state.step !== "error"
    ) {
      return;
    }
    onClose();
  }, [state.step, onClose]);

  const canSubmit =
    name.trim().length > 0 &&
    !identifierError &&
    selectedServers.length > 0 &&
    state.step === "idle";

  // Add a custom domain to the selection
  const handleAddCustomDomain = useCallback(async () => {
    const raw = customDomain.trim().toLowerCase();
    if (!raw) return;

    // Strip protocol if pasted
    const domain = raw.replace(/^wss?:\/\//, "").replace(/\/+$/, "");

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      setCustomDomainError("Enter a valid domain (e.g. relay.example.com)");
      return;
    }

    if (selectedDomains.includes(domain)) {
      setCustomDomainError("Already in the list");
      return;
    }

    // Validate NIP-11 Grasp support before adding
    setValidatingDomain(true);
    setCustomDomainError(undefined);
    const validationError = await validateGraspServer(domain);
    setValidatingDomain(false);

    if (validationError) {
      setCustomDomainError(validationError);
      return;
    }

    setSelectedDomains((prev) => [...prev, domain]);
    setCustomDomain("");
    setCustomDomainError(undefined);
  }, [customDomain, selectedDomains]);

  // Toggle a resolved server in/out of the selection
  const handleToggleServer = useCallback((domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((d) => d !== domain)
        : [...prev, domain],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    // Optionally save as defaults before creating
    if (saveAsDefaults && account) {
      try {
        const tags = selectedServers.map((s) => ["g", s.wsUrl]);
        await publishEvent({
          kind: GRASP_LIST_KIND,
          content: "",
          tags,
          created_at: Math.floor(Date.now() / 1000),
        });
      } catch {
        // Non-fatal — continue with repo creation even if saving defaults fails
      }
    }

    const input: CreateRepoFormInput = {
      name: name.trim(),
      description: description.trim(),
      identifier,
      graspServers: selectedServers,
    };

    await execute(input);
  }, [
    canSubmit,
    saveAsDefaults,
    account,
    selectedServers,
    publishEvent,
    name,
    description,
    identifier,
    execute,
  ]);

  const handleRetry = useCallback(async () => {
    if (!state.commitHash) return;

    const input: CreateRepoFormInput = {
      name: name.trim(),
      description: description.trim(),
      identifier,
      graspServers: selectedServers,
    };

    await retryPush(input, state.commitHash);
  }, [
    state.commitHash,
    name,
    description,
    identifier,
    selectedServers,
    retryPush,
  ]);

  const isInProgress =
    state.step !== "idle" && state.step !== "done" && state.step !== "error";

  // Servers available to toggle (resolved list + any custom ones already added)
  const allKnownDomains = useMemo(() => {
    const fromResolved = resolvedServers.map((s) => s.domain);
    const extra = selectedDomains.filter((d) => !fromResolved.includes(d));
    return [...fromResolved, ...extra];
  }, [resolvedServers, selectedDomains]);

  // Whether the current selection differs from the resolved defaults
  const hasCustomSelection = useMemo(() => {
    const resolvedDomains = resolvedServers.map((s) => s.domain).sort();
    const current = [...selectedDomains].sort();
    return (
      current.length !== resolvedDomains.length ||
      current.some((d, i) => d !== resolvedDomains[i])
    );
  }, [resolvedServers, selectedDomains]);

  // Label for the advanced trigger
  const advancedLabel = useMemo(() => {
    if (selectedDomains.length === 0) return "No servers selected";
    if (selectedDomains.length === 1) return selectedDomains[0];
    return `${selectedDomains.length} servers`;
  }, [selectedDomains]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state.step === "done"
              ? "Repository created"
              : state.step === "idle"
                ? "Create a new repository"
                : "Creating repository..."}
          </DialogTitle>
          {state.step === "idle" && (
            <DialogDescription>
              Create a git repository hosted using Grasp.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* ── Form view ──────────────────────────────────────────── */}
        {state.step === "idle" && (
          <div className="space-y-4">
            {/* Repository name */}
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository name</Label>
              <Input
                id="repo-name"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              {name.trim() && (
                <div className="flex items-center gap-1.5">
                  {identifierError ? (
                    <p className="text-xs text-red-500">{identifierError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Identifier:{" "}
                      <code className="font-mono text-foreground">
                        {identifier}
                      </code>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="repo-description">
                Description{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="repo-description"
                placeholder="A brief description of the project"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Info strip */}
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5"
                >
                  main
                </Badge>
                <span>Default branch</span>
                <span className="text-muted-foreground/40 mx-1">|</span>
                <span>README.md will be created</span>
              </div>
            </div>

            {/* ── Advanced / Grasp servers ──────────────────────────── */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {advancedOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    Grasp servers
                  </span>
                  {!advancedOpen && (
                    <span className="text-xs font-mono text-muted-foreground/70 flex items-center gap-1">
                      {serversLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          {advancedLabel}
                          {hasCustomSelection && (
                            <span className="ml-1 text-violet-500">
                              (custom)
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2">
                {serversLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading your server list...
                  </div>
                ) : (
                  <>
                    {/* Server checklist */}
                    <div className="space-y-1.5">
                      {allKnownDomains.map((domain) => {
                        const checked = selectedDomains.includes(domain);
                        const isDefault =
                          DEFAULT_GRASP_SERVERS.includes(domain);
                        const isUserList =
                          isFromUserList &&
                          resolvedServers.some((s) => s.domain === domain);
                        return (
                          <label
                            key={domain}
                            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => handleToggleServer(domain)}
                              id={`server-${domain}`}
                            />
                            <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-mono flex-1">
                              {domain}
                            </span>
                            {isUserList && !isDefault && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4"
                              >
                                your list
                              </Badge>
                            )}
                            {isDefault && !isUserList && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
                              >
                                default
                              </Badge>
                            )}
                          </label>
                        );
                      })}
                    </div>

                    {/* Add custom server */}
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <Input
                          placeholder="relay.example.com"
                          value={customDomain}
                          disabled={validatingDomain}
                          onChange={(e) => {
                            setCustomDomain(e.target.value);
                            setCustomDomainError(undefined);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleAddCustomDomain();
                            }
                          }}
                          className="h-8 text-sm font-mono"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleAddCustomDomain()}
                          disabled={validatingDomain}
                          className="h-8 px-2.5 shrink-0"
                        >
                          {validatingDomain ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                      {customDomainError && (
                        <p className="text-xs text-red-500 px-0.5">
                          {customDomainError}
                        </p>
                      )}
                    </div>

                    {/* Save as defaults */}
                    <label className="flex items-start gap-2.5 cursor-pointer rounded-md px-2.5 py-2 hover:bg-muted/40 transition-colors border border-border/40">
                      <Checkbox
                        checked={saveAsDefaults}
                        onCheckedChange={(v) => setSaveAsDefaults(!!v)}
                        id="save-defaults"
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium">
                          Save as my Grasp defaults
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {isFromUserList
                            ? "Overwrite your saved server list with this selection."
                            : "Save this selection so future repositories use these servers by default."}
                        </p>
                      </div>
                    </label>

                    {selectedDomains.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 px-0.5">
                        Select at least one server to continue.
                      </p>
                    )}
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                Create Repository
              </Button>
            </div>
          </div>
        )}

        {/* ── Progress view ──────────────────────────────────────── */}
        {(isInProgress || state.step === "error" || state.step === "done") && (
          <div className="space-y-4">
            {/* Step list */}
            <div className="space-y-2.5">
              {STEPS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2.5">
                  <StepIcon step={key} currentStep={state.step} />
                  <span
                    className={
                      STEP_ORDER.indexOf(key) <= STEP_ORDER.indexOf(state.step)
                        ? "text-sm text-foreground"
                        : "text-sm text-muted-foreground/60"
                    }
                  >
                    {label}
                    {key === "pushing" && selectedServers.length > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        to {selectedServers.map((s) => s.domain).join(", ")}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Error state */}
            {state.step === "error" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {state.error}
                    </p>
                  </div>
                </div>

                {state.publishedAt && (
                  <PurgatoryCountdown publishedAt={state.publishedAt} />
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  {state.publishedAt && state.commitHash && (
                    <Button onClick={handleRetry}>Retry Push</Button>
                  )}
                </div>
              </div>
            )}

            {/* Success state */}
            {state.step === "done" &&
              pubkey &&
              state.identifier &&
              state.cloneUrl && (
                <SuccessActions
                  pubkey={pubkey}
                  identifier={state.identifier}
                  onClose={onClose}
                />
              )}

            {/* In-progress — show a subtle message */}
            {isInProgress && (
              <p className="text-xs text-muted-foreground text-center">
                This may take a few seconds.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
