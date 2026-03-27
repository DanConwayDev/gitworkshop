/**
 * CreateRepoDialog — dialog for creating a new git repository on a Grasp server.
 *
 * Shows a form (name, description, server selection) then transitions to a
 * step-by-step progress view during creation.
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
  Info,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toRepoIdentifier, validateRepoIdentifier } from "@/lib/create-repo";
import {
  useCreateRepo,
  type CreateRepoStep,
  type CreateRepoFormInput,
} from "@/hooks/useCreateRepo";
import { useGraspServers } from "@/hooks/useGraspServers";
import { useRepoPath } from "@/hooks/useRepoPath";

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
    // Show check for completed steps, X for the step that was in progress
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
    servers,
    isFromUserList,
    isLoading: serversLoading,
  } = useGraspServers(pubkey);

  const { state, execute, retryPush, reset } = useCreateRepo();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedServer, setSelectedServer] = useState<string>("");

  // Derived identifier
  const identifier = useMemo(() => toRepoIdentifier(name), [name]);
  const identifierError = useMemo(
    () => (name.trim() ? validateRepoIdentifier(identifier) : undefined),
    [name, identifier],
  );

  // Auto-select first server when servers load
  useEffect(() => {
    if (servers.length > 0 && !selectedServer) {
      setSelectedServer(servers[0].domain);
    }
  }, [servers, selectedServer]);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setDescription("");
      setSelectedServer(servers.length > 0 ? servers[0].domain : "");
      reset();
    }
  }, [isOpen, reset, servers]);

  const handleClose = useCallback(() => {
    if (
      state.step !== "idle" &&
      state.step !== "done" &&
      state.step !== "error"
    ) {
      // Don't close during active creation
      return;
    }
    onClose();
  }, [state.step, onClose]);

  const selectedGraspServer = useMemo(
    () => servers.find((s) => s.domain === selectedServer),
    [servers, selectedServer],
  );

  const canSubmit =
    name.trim().length > 0 &&
    !identifierError &&
    selectedGraspServer &&
    state.step === "idle";

  // Reorder servers so the selected one is first (primary for display),
  // but all servers are included in the announcement and pushed to.
  const orderedServers = useMemo(() => {
    if (!selectedGraspServer) return servers;
    const rest = servers.filter((s) => s.domain !== selectedGraspServer.domain);
    return [selectedGraspServer, ...rest];
  }, [servers, selectedGraspServer]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !selectedGraspServer) return;

    const input: CreateRepoFormInput = {
      name: name.trim(),
      description: description.trim(),
      identifier,
      graspServers: orderedServers,
    };

    await execute(input);
  }, [
    canSubmit,
    name,
    description,
    identifier,
    orderedServers,
    selectedGraspServer,
    execute,
  ]);

  const handleRetry = useCallback(async () => {
    if (!state.commitHash) return;

    const input: CreateRepoFormInput = {
      name: name.trim(),
      description: description.trim(),
      identifier,
      graspServers: orderedServers,
    };

    await retryPush(input, state.commitHash);
  }, [
    state.commitHash,
    name,
    description,
    identifier,
    orderedServers,
    retryPush,
  ]);

  const isInProgress =
    state.step !== "idle" && state.step !== "done" && state.step !== "error";

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
              Create a new git repository hosted on a Grasp server.
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

            {/* Grasp server selection */}
            <div className="space-y-2">
              <Label>Grasp server</Label>
              {serversLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading servers...
                </div>
              ) : (
                <>
                  <Select
                    value={selectedServer}
                    onValueChange={setSelectedServer}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a server" />
                    </SelectTrigger>
                    <SelectContent>
                      {servers.map((server) => (
                        <SelectItem key={server.domain} value={server.domain}>
                          <div className="flex items-center gap-2">
                            <Server className="h-3.5 w-3.5 text-muted-foreground" />
                            {server.domain}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!isFromUserList && (
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Using default servers. Publish a{" "}
                        <span className="font-mono">kind:10317</span> grasp list
                        to customise.
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Info */}
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
                    {key === "pushing" && selectedGraspServer && (
                      <span className="text-muted-foreground">
                        {" "}
                        to {selectedGraspServer.domain}
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
