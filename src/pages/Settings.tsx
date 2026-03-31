import type React from "react";
import { useState, useCallback, useEffect, useRef } from "react";
import { useSeoMeta } from "@unhead/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RelayItem } from "@/components/RelayItem";
import { NewRelayForm } from "@/components/NewRelayForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  extraRelays,
  gitIndexRelays,
  lookupRelays,
  relayCurationMode,
  DEFAULT_GRASP_SERVERS,
  type RelayCurationMode,
} from "@/services/settings";
import { validateGraspServer } from "@/lib/grasp";
import { use$ } from "@/hooks/use$";
import { useAccount } from "@/hooks/useAccount";
import { useUser } from "@/hooks/useUser";
import { useGraspServers } from "@/hooks/useGraspServers";
import { usePublish } from "@/hooks/usePublish";
import { useRobustReplaceableAction } from "@/hooks/useRobustReplaceableAction";
import { useToast } from "@/hooks/useToast";
import {
  AddInboxRelay,
  AddOutboxRelay,
  RemoveInboxRelay,
  RemoveOutboxRelay,
} from "applesauce-actions/actions/mailboxes";
import { runner } from "@/services/actions";
import { cn } from "@/lib/utils";
import { Shield, Globe, Server, Loader2, Info, Plus } from "lucide-react";

const CURATION_OPTIONS: {
  value: RelayCurationMode;
  icon: React.ReactNode;
  title: string;
  description: string;
}[] = [
  {
    value: "repo",
    icon: <Shield className="h-5 w-5" />,
    title: "Curated",
    description:
      "Only events from relays declared in the repository announcement are shown. Maintainers control what appears — spam-resistant and predictable.",
  },
  {
    value: "outbox",
    icon: <Globe className="h-5 w-5" />,
    title: "Uncensored",
    description:
      "Events are fetched from every maintainer's NIP-65 outbox and inbox relays in addition to the repo's declared relays. Nothing is filtered out by relay selection.",
  },
];

function RelayCurationSection() {
  const mode = use$(relayCurationMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event Fetching Strategy</CardTitle>
        <CardDescription>
          Controls which relays are queried when loading issues, patches, and
          comments for a repository.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CURATION_OPTIONS.map((opt) => {
            const selected = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => relayCurationMode.next(opt.value)}
                className={cn(
                  "relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-all duration-150",
                  "hover:border-violet-500/50 hover:bg-violet-500/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
                  selected
                    ? "border-violet-500 bg-violet-500/5 shadow-sm shadow-violet-500/10"
                    : "border-border bg-background",
                )}
              >
                {selected && (
                  <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-violet-500" />
                )}
                <span
                  className={cn(
                    "transition-colors",
                    selected ? "text-violet-500" : "text-muted-foreground",
                  )}
                >
                  {opt.icon}
                </span>
                <span className="font-semibold text-sm">{opt.title}</span>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  {opt.description}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DiscoveryRelaysSection() {
  const lookupRelaysList = use$(lookupRelays);
  const gitIndexRelaysList = use$(gitIndexRelays);

  const handleAddLookupRelay = (relay: string) => {
    const newRelays = [...new Set([...(lookupRelaysList || []), relay])];
    lookupRelays.next(newRelays);
  };

  const handleRemoveLookupRelay = (relay: string) => {
    const newRelays = (lookupRelaysList || []).filter((r) => r !== relay);
    lookupRelays.next(newRelays);
  };

  const handleAddGitRelay = (relay: string) => {
    const newRelays = [...new Set([...(gitIndexRelaysList || []), relay])];
    gitIndexRelays.next(newRelays);
  };

  const handleRemoveGitRelay = (relay: string) => {
    const newRelays = (gitIndexRelaysList || []).filter((r) => r !== relay);
    gitIndexRelays.next(newRelays);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lookup Relays</CardTitle>
        <CardDescription>
          Relays used to discover users and repositories across the network
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Users</h3>
            <p className="text-xs text-muted-foreground">
              Used for discovering user profiles and relay lists
            </p>
          </div>
          <div className="space-y-2">
            {lookupRelaysList?.map((relay, index) => (
              <RelayItem
                key={index}
                relay={relay}
                onRemove={() => handleRemoveLookupRelay(relay)}
              />
            ))}
          </div>
          <NewRelayForm onAdd={handleAddLookupRelay} />
        </div>

        <div className="border-t pt-6 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Repositories</h3>
            <p className="text-xs text-muted-foreground">
              Used for discovering repository announcements published via ngit
            </p>
          </div>
          <div className="space-y-2">
            {gitIndexRelaysList?.map((relay, index) => (
              <RelayItem
                key={index}
                relay={relay}
                onRemove={() => handleRemoveGitRelay(relay)}
              />
            ))}
          </div>
          <NewRelayForm onAdd={handleAddGitRelay} />
        </div>
      </CardContent>
    </Card>
  );
}

/** kind:10002 — NIP-65 relay list */
const MAILBOXES_KIND = 10002;

function OutboxRelaysSection() {
  const account = useAccount();
  const user = useUser(account?.pubkey);
  const outboxes = use$(user?.outboxes$);
  const { execute } = useRobustReplaceableAction();
  const { toast } = useToast();

  if (!account) return null;

  const safeRun = async (action: () => Promise<void>) => {
    try {
      await execute(MAILBOXES_KIND, action);
    } catch (err) {
      toast({
        title: "Failed to update relay list",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outbox Relays</CardTitle>
        <CardDescription>
          Relays where your events are published for others to find
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {outboxes?.map((outbox, index) => (
            <RelayItem
              key={index}
              relay={outbox}
              onRemove={() =>
                safeRun(() => runner.run(RemoveOutboxRelay, outbox))
              }
            />
          ))}
        </div>
        <NewRelayForm
          onAdd={(relay) => safeRun(() => runner.run(AddOutboxRelay, relay))}
        />
      </CardContent>
    </Card>
  );
}

function InboxRelaysSection() {
  const account = useAccount();
  const user = useUser(account?.pubkey);
  const inboxes = use$(user?.inboxes$);
  const { execute } = useRobustReplaceableAction();
  const { toast } = useToast();

  if (!account) return null;

  const safeRun = async (action: () => Promise<void>) => {
    try {
      await execute(MAILBOXES_KIND, action);
    } catch (err) {
      toast({
        title: "Failed to update relay list",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbox Relays</CardTitle>
        <CardDescription>
          Relays used by other users to send you events
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {inboxes?.map((inbox, index) => (
            <RelayItem
              key={index}
              relay={inbox}
              onRemove={() =>
                safeRun(() => runner.run(RemoveInboxRelay, inbox))
              }
            />
          ))}
        </div>
        <NewRelayForm
          onAdd={(relay) => safeRun(() => runner.run(AddInboxRelay, relay))}
        />
      </CardContent>
    </Card>
  );
}

const GRASP_LIST_KIND = 10317;

function GraspRelaysSection() {
  const account = useAccount();
  const pubkey = account?.pubkey;
  const { servers, isFromUserList, isLoading } = useGraspServers(pubkey);
  const { publishEvent } = usePublish();
  const { execute } = useRobustReplaceableAction();
  const { toast } = useToast();

  // ---------------------------------------------------------------------------
  // Draft state — local edits before the user hits Save
  // ---------------------------------------------------------------------------

  // null = no draft open (showing published state)
  const [draftDomains, setDraftDomains] = useState<string[] | null>(null);

  // Sync draft when the published list changes from underneath us (e.g. first
  // load), but only if the user hasn't started editing yet.
  const prevServersRef = useRef(servers);
  useEffect(() => {
    if (prevServersRef.current !== servers) {
      prevServersRef.current = servers;
      // If no draft is open, nothing to do. If a draft is open we leave it
      // alone — the user is mid-edit.
    }
  }, [servers]);

  const activeDomains = draftDomains ?? servers.map((s) => s.domain);

  const isDirty =
    draftDomains !== null &&
    (draftDomains.length !== servers.length ||
      draftDomains.some((d, i) => d !== servers[i]?.domain));

  const openDraft = useCallback(
    (initial: string[]) => setDraftDomains([...initial]),
    [],
  );

  const discardDraft = useCallback(() => setDraftDomains(null), []);

  // ---------------------------------------------------------------------------
  // Add-server input with 1.5 s debounce auto-validation
  // ---------------------------------------------------------------------------

  const [customDomain, setCustomDomain] = useState("");
  const [customDomainError, setCustomDomainError] = useState<
    string | undefined
  >();
  // "idle" | "validating" | "valid" | "invalid"
  const [validationState, setValidationState] = useState<
    "idle" | "validating" | "valid" | "invalid"
  >("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runValidation = useCallback(async (domain: string) => {
    setValidationState("validating");
    setCustomDomainError(undefined);
    const err = await validateGraspServer(domain);
    if (err) {
      setValidationState("invalid");
      setCustomDomainError(err);
    } else {
      setValidationState("valid");
    }
  }, []);

  const handleDomainChange = useCallback(
    (raw: string) => {
      setCustomDomain(raw);
      setCustomDomainError(undefined);
      setValidationState("idle");

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const domain = raw
        .trim()
        .toLowerCase()
        .replace(/^wss?:\/\//, "")
        .replace(/\/+$/, "");

      if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return;

      debounceRef.current = setTimeout(() => {
        void runValidation(domain);
      }, 1500);
    },
    [runValidation],
  );

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleAddDomain = useCallback(async () => {
    const raw = customDomain.trim().toLowerCase();
    if (!raw) return;

    const domain = raw.replace(/^wss?:\/\//, "").replace(/\/+$/, "");

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      setCustomDomainError("Enter a valid domain (e.g. relay.example.com)");
      setValidationState("invalid");
      return;
    }

    if (activeDomains.includes(domain)) {
      setCustomDomainError("Already in the list");
      setValidationState("invalid");
      return;
    }

    // If debounce validation is still in flight, cancel it and run immediately
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (validationState !== "valid") {
      await runValidation(domain);
      // Re-read state via closure won't work — check error after await
      const err = await validateGraspServer(domain);
      if (err) return; // runValidation already set the error
    }

    // Open draft if not already open, then append
    setDraftDomains((prev) => {
      const base = prev ?? servers.map((s) => s.domain);
      return [...base, domain];
    });
    setCustomDomain("");
    setCustomDomainError(undefined);
    setValidationState("idle");
  }, [customDomain, activeDomains, validationState, runValidation, servers]);

  const handleRemoveDomain = useCallback(
    (domain: string) => {
      setDraftDomains((prev) => {
        const base = prev ?? servers.map((s) => s.domain);
        return base.filter((d) => d !== domain);
      });
    },
    [servers],
  );

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  const [publishing, setPublishing] = useState(false);

  const publishGraspList = useCallback(
    async (domains: string[]) => {
      if (!account) return;
      setPublishing(true);
      try {
        await execute(GRASP_LIST_KIND, async () => {
          const tags = domains.map((d) => ["g", `wss://${d}`]);
          await publishEvent({
            kind: GRASP_LIST_KIND,
            content: "",
            tags,
            created_at: Math.floor(Date.now() / 1000),
          });
        });
        setDraftDomains(null); // close draft on success
      } catch (err) {
        toast({
          title: "Failed to update grasp server list",
          description:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          variant: "destructive",
        });
      } finally {
        setPublishing(false);
      }
    },
    [account, publishEvent, execute, toast],
  );

  const handleSave = useCallback(async () => {
    await publishGraspList(draftDomains ?? activeDomains);
  }, [publishGraspList, draftDomains, activeDomains]);

  const handleSaveDefaults = useCallback(async () => {
    await publishGraspList([...DEFAULT_GRASP_SERVERS]);
  }, [publishGraspList]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isInputBusy = validationState === "validating" || publishing;

  // The list to render — draft if open, otherwise published
  const displayDomains = draftDomains ?? servers.map((s) => s.domain);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grasp Servers</CardTitle>
        <CardDescription>
          Servers used to host your git repositories via the Grasp protocol
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading your server list...
          </div>
        ) : (
          <>
            {/* No user list notice */}
            {!isFromUserList && draftDomains === null && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    You don&apos;t have a Grasp server list yet. These defaults
                    are used:
                  </p>
                  {account && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={publishing}
                      onClick={() => void handleSaveDefaults()}
                    >
                      {publishing ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                      ) : null}
                      Save defaults as my list
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Server list (draft or published) */}
            <div className="space-y-2">
              {displayDomains.map((domain) => {
                const isDefault = DEFAULT_GRASP_SERVERS.includes(domain);
                const isUserPublished =
                  isFromUserList && servers.some((s) => s.domain === domain);
                const isDraftOnly =
                  draftDomains !== null &&
                  !servers.some((s) => s.domain === domain);
                return (
                  <div
                    key={domain}
                    className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                  >
                    <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-mono flex-1">{domain}</span>
                    {isDraftOnly && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-4"
                      >
                        new
                      </Badge>
                    )}
                    {isDefault && !isUserPublished && !isDraftOnly && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
                      >
                        default
                      </Badge>
                    )}
                    {account && (
                      <button
                        type="button"
                        onClick={() => {
                          if (draftDomains === null) {
                            openDraft(servers.map((s) => s.domain));
                          }
                          handleRemoveDomain(domain);
                        }}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors px-1"
                        aria-label={`Remove ${domain}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
              {displayDomains.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No servers selected — add at least one before saving.
                </p>
              )}
            </div>

            {/* Add server input — only when logged in */}
            {account && (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <Input
                    placeholder="relay.example.com"
                    value={customDomain}
                    disabled={isInputBusy}
                    onChange={(e) => handleDomainChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddDomain();
                      }
                    }}
                    className={cn(
                      "h-8 text-sm font-mono",
                      validationState === "valid" &&
                        "border-green-500 focus-visible:ring-green-500",
                      validationState === "invalid" && "border-red-500",
                    )}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddDomain()}
                    disabled={isInputBusy || !customDomain.trim()}
                    className="h-8 px-2.5 shrink-0"
                  >
                    {validationState === "validating" ? (
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
                {validationState === "valid" && !customDomainError && (
                  <p className="text-xs text-green-600 dark:text-green-400 px-0.5">
                    Server supports GRASP-01
                  </p>
                )}
              </div>
            )}

            {/* Save / Discard — shown when there are unsaved changes */}
            {isDirty && (
              <div className="flex items-center justify-end gap-2 pt-1 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={discardDraft}
                  disabled={publishing}
                  className="h-8 text-xs"
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={publishing || displayDomains.length === 0}
                  className="h-8 text-xs"
                >
                  {publishing ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  ) : null}
                  Save
                </Button>
              </div>
            )}

            {!account && (
              <p className="text-xs text-muted-foreground">
                Log in to manage your Grasp server list.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ExtraRelaysSection() {
  const extraRelaysList = use$(extraRelays);

  const handleAddExtraRelay = (relay: string) => {
    const newRelays = [...new Set([...(extraRelaysList || []), relay])];
    extraRelays.next(newRelays);
  };

  const handleRemoveExtraRelay = (relay: string) => {
    const newRelays = (extraRelaysList || []).filter((r) => r !== relay);
    extraRelays.next(newRelays);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extra Relays</CardTitle>
        <CardDescription>
          Always used when fetching or publishing events across the app
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {extraRelaysList?.map((relay, index) => (
            <RelayItem
              key={index}
              relay={relay}
              onRemove={() => handleRemoveExtraRelay(relay)}
            />
          ))}
        </div>
        <NewRelayForm onAdd={handleAddExtraRelay} />
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  useSeoMeta({
    title: "Settings - ngit",
    description: "Manage relay configurations and application settings.",
  });

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your relay configurations for the application.
        </p>
      </div>

      <RelayCurationSection />
      <GraspRelaysSection />
      <DiscoveryRelaysSection />
      <OutboxRelaysSection />
      <InboxRelaysSection />
      <ExtraRelaysSection />
    </div>
  );
}
