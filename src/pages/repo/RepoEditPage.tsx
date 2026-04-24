/**
 * RepoEditPage — edit the selected maintainer's repository announcement.
 *
 * Allows editing:
 *   - Basic info: name, description, web URLs, topics
 *   - Grasp servers (with NIP-11 validation, same as CreateRepoDialog)
 *   - Other relays (non-Grasp relay URLs)
 *   - Other git servers (non-Grasp clone URLs)
 *
 * Read-only / auto-populated:
 *   - Clone URLs generated from selected Grasp servers
 *   - Relay URLs generated from selected Grasp servers
 *   - Items contributed only by co-maintainers (displayed as info)
 *
 * Only accessible when the logged-in user is the selected maintainer.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import {
  ArrowLeft,
  Plus,
  X,
  Loader2,
  Server,
  Radio,
  GitBranch,
  AlertTriangle,
  Users,
  Tag,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import type { EventTemplate } from "nostr-tools";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { UserName } from "@/components/UserAvatar";

import { useRepoContext } from "./RepoContext";
import {
  REPO_KIND,
  getRepoName,
  getRepoDescription,
  getRepoCloneUrls,
  getRepoRelays,
  getRepoWebUrls,
  isGraspCloneUrl,
  graspCloneUrlDomain,
  type ResolvedRepo,
} from "@/lib/nip34";
import { repoToPath } from "@/lib/routeUtils";
import { validateGraspServer } from "@/lib/grasp";
import { publish } from "@/services/nostr";
import { useGraspServers } from "@/hooks/useGraspServers";
import { DEFAULT_GRASP_SERVERS } from "@/services/settings";
import { GraspLogo } from "@/components/GraspLogo";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Known tag names — tags that the edit form explicitly manages.
// Any tag with a name NOT in this set is treated as "unknown" and preserved
// verbatim so that data from other clients is never silently dropped.
// ---------------------------------------------------------------------------

const KNOWN_TAG_NAMES = new Set([
  "d",
  "name",
  "description",
  "clone",
  "relays",
  "alt",
  "r",
  "maintainers",
  "web",
  "t",
]);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RepoEditPage() {
  const { resolved, nip05 } = useRepoContext();
  const account = useActiveAccount();
  const repo = resolved?.repo;

  const isMaintainer =
    account?.pubkey && repo && account.pubkey === repo.selectedMaintainer;

  const basePath = repo
    ? repoToPath(repo.selectedMaintainer, repo.dTag, repo.relays, nip05)
    : undefined;

  if (!repo || !basePath) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }

  if (!isMaintainer) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="max-w-md">
          <div className="flex items-center gap-2 text-destructive mb-4">
            <AlertTriangle className="h-5 w-5" />
            <p className="font-medium">Not authorised</p>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Only the selected maintainer can edit this repository announcement.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to={`${basePath}/about`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to About
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return <RepoEditForm repo={repo} basePath={basePath} />;
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

interface RepoEditFormProps {
  repo: ResolvedRepo;
  basePath: string;
}

function RepoEditForm({ repo, basePath }: RepoEditFormProps) {
  const account = useActiveAccount();
  const navigate = useNavigate();

  // Find the selected maintainer's own announcement
  const selectedAnnouncement = useMemo(
    () => repo.announcements.find((a) => a.pubkey === repo.selectedMaintainer),
    [repo],
  );

  // Grasp server resolution (for the known server list)
  const { servers: resolvedServers, isFromUserList } = useGraspServers(
    account?.pubkey,
  );

  // ---------------------------------------------------------------------------
  // Parse current values from the selected announcement
  // ---------------------------------------------------------------------------

  const currentCloneUrls = useMemo(
    () => (selectedAnnouncement ? getRepoCloneUrls(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentRelayUrls = useMemo(
    () => (selectedAnnouncement ? getRepoRelays(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentGraspCloneUrls = useMemo(
    () => currentCloneUrls.filter(isGraspCloneUrl),
    [currentCloneUrls],
  );
  const currentGraspDomains = useMemo(
    () => [
      ...new Set(
        currentGraspCloneUrls
          .map(graspCloneUrlDomain)
          .filter((d): d is string => !!d),
      ),
    ],
    [currentGraspCloneUrls],
  );
  const currentOtherGitServers = useMemo(
    () => currentCloneUrls.filter((u) => !isGraspCloneUrl(u)),
    [currentCloneUrls],
  );
  const currentOtherRelays = useMemo(() => {
    const graspDomainSet = new Set(currentGraspDomains);
    return currentRelayUrls.filter((r) => {
      try {
        return !graspDomainSet.has(new URL(r).hostname);
      } catch {
        return true;
      }
    });
  }, [currentRelayUrls, currentGraspDomains]);

  const currentWebUrls = useMemo(
    () => (selectedAnnouncement ? getRepoWebUrls(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentTopics = useMemo(
    () =>
      selectedAnnouncement?.tags
        .filter(([t]) => t === "t")
        .map(([, v]) => v)
        .filter(Boolean) ?? [],
    [selectedAnnouncement],
  );
  const currentEucHash = useMemo(
    () =>
      selectedAnnouncement?.tags.find(
        ([t, , marker]) => t === "r" && marker === "euc",
      )?.[1] ?? "",
    [selectedAnnouncement],
  );

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  const [name, setName] = useState(
    selectedAnnouncement ? getRepoName(selectedAnnouncement) : "",
  );
  const [description, setDescription] = useState(
    selectedAnnouncement ? getRepoDescription(selectedAnnouncement) : "",
  );
  const [webUrls, setWebUrls] = useState<string[]>(currentWebUrls);
  const [webInput, setWebInput] = useState("");
  const [topics, setTopics] = useState<string[]>(currentTopics);
  const [topicInput, setTopicInput] = useState("");

  // Grasp server selection
  const [selectedDomains, setSelectedDomains] =
    useState<string[]>(currentGraspDomains);
  const [customDomain, setCustomDomain] = useState("");
  const [customDomainError, setCustomDomainError] = useState<
    string | undefined
  >();
  const [validatingDomain, setValidatingDomain] = useState(false);

  // Other relays
  const [otherRelays, setOtherRelays] = useState<string[]>(currentOtherRelays);
  const [relayInput, setRelayInput] = useState("");
  const [relayInputError, setRelayInputError] = useState<string | undefined>();

  // Other git servers
  const [otherGitServers, setOtherGitServers] = useState<string[]>(
    currentOtherGitServers,
  );
  const [gitServerInput, setGitServerInput] = useState("");
  const [gitServerInputError, setGitServerInputError] = useState<
    string | undefined
  >();

  // Earliest unique commit hash
  const [eucHash, setEucHash] = useState(currentEucHash);

  // Unknown / custom tags — tags not managed by the form fields above.
  // Stored as string[][] so multi-value tags and repeated tag names are
  // preserved exactly. Initialised once from the selected announcement.
  const [unknownTags, setUnknownTags] = useState<string[][]>(() => {
    if (!selectedAnnouncement) return [];
    return selectedAnnouncement.tags.filter(
      ([name]) => name !== undefined && !KNOWN_TAG_NAMES.has(name),
    );
  });

  // Other-section open state (auto-open if the repo already has entries there)
  const [otherRelaysOpen, setOtherRelaysOpen] = useState(
    () => currentOtherRelays.length > 0,
  );
  const [otherGitServersOpen, setOtherGitServersOpen] = useState(
    () => currentOtherGitServers.length > 0,
  );
  const [unknownTagsOpen, setUnknownTagsOpen] = useState(
    () =>
      !!selectedAnnouncement?.tags.some(
        ([name]) => name !== undefined && !KNOWN_TAG_NAMES.has(name),
      ),
  );

  // Submit state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // Sync selectedDomains with the current Grasp domains on first render
  useEffect(() => {
    setSelectedDomains(currentGraspDomains);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Computed: all known Grasp domains (resolved + custom added)
  // ---------------------------------------------------------------------------

  const allKnownDomains = useMemo(() => {
    const fromResolved = resolvedServers.map((s) => s.domain);
    // Also include any domains that are already selected but not in the user's
    // resolved list (they came from the existing announcement)
    const extra = selectedDomains.filter((d) => !fromResolved.includes(d));
    // Make sure current announcement domains are always visible
    const fromAnnouncement = currentGraspDomains.filter(
      (d) => !fromResolved.includes(d) && !extra.includes(d),
    );
    return [...fromResolved, ...extra, ...fromAnnouncement];
  }, [resolvedServers, selectedDomains, currentGraspDomains]);

  // ---------------------------------------------------------------------------
  // Union items from other maintainers
  // ---------------------------------------------------------------------------

  const isMultiMaintainer = repo.maintainerSet.length > 1;

  const unionOnlyRelays = useMemo((): Array<{
    url: string;
    contributorPubkey: string;
  }> => {
    if (!isMultiMaintainer || !selectedAnnouncement) return [];
    const myRelays = new Set(getRepoRelays(selectedAnnouncement));
    return repo.relays
      .filter((r) => !myRelays.has(r))
      .map((url) => ({
        url,
        contributorPubkey:
          repo.relayProvenance.find((p) => p.value === url)?.pubkey ?? "",
      }));
  }, [
    isMultiMaintainer,
    selectedAnnouncement,
    repo.relays,
    repo.relayProvenance,
  ]);

  const unionOnlyGitServers = useMemo((): Array<{
    url: string;
    contributorPubkey: string;
  }> => {
    if (!isMultiMaintainer || !selectedAnnouncement) return [];
    const myCloneUrls = new Set(getRepoCloneUrls(selectedAnnouncement));
    return repo.cloneUrls
      .filter((u) => !myCloneUrls.has(u) && !isGraspCloneUrl(u))
      .map((url) => ({
        url,
        contributorPubkey:
          repo.cloneUrlProvenance.find((p) => p.value === url)?.pubkey ?? "",
      }));
  }, [
    isMultiMaintainer,
    selectedAnnouncement,
    repo.cloneUrls,
    repo.cloneUrlProvenance,
  ]);

  const unionOnlyGraspDomains = useMemo((): Array<{
    domain: string;
    contributorPubkey: string;
  }> => {
    if (!isMultiMaintainer || !selectedAnnouncement) return [];
    const myCloneUrls = new Set(getRepoCloneUrls(selectedAnnouncement));
    const myGraspDomains = new Set(
      Array.from(myCloneUrls)
        .filter(isGraspCloneUrl)
        .map(graspCloneUrlDomain)
        .filter(Boolean),
    );
    return repo.graspCloneUrls
      .filter((u) => {
        const domain = graspCloneUrlDomain(u);
        return domain && !myGraspDomains.has(domain);
      })
      .map((url) => ({
        domain: graspCloneUrlDomain(url) ?? url,
        contributorPubkey:
          repo.cloneUrlProvenance.find((p) => p.value === url)?.pubkey ?? "",
      }))
      .filter(
        (item, idx, arr) =>
          arr.findIndex((x) => x.domain === item.domain) === idx,
      );
  }, [
    isMultiMaintainer,
    selectedAnnouncement,
    repo.graspCloneUrls,
    repo.cloneUrlProvenance,
  ]);

  // ---------------------------------------------------------------------------
  // Grasp server actions
  // ---------------------------------------------------------------------------

  const handleToggleServer = useCallback((domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((d) => d !== domain)
        : [...prev, domain],
    );
  }, []);

  const handleAddCustomDomain = useCallback(async () => {
    const raw = customDomain.trim().toLowerCase();
    if (!raw) return;

    const domain = raw.replace(/^wss?:\/\//, "").replace(/\/+$/, "");

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      setCustomDomainError("Enter a valid domain (e.g. relay.example.com)");
      return;
    }
    if (selectedDomains.includes(domain)) {
      setCustomDomainError("Already in the list");
      return;
    }

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

  // ---------------------------------------------------------------------------
  // Other relay actions
  // ---------------------------------------------------------------------------

  const handleAddRelay = useCallback(() => {
    const raw = relayInput.trim();
    if (!raw) return;
    let url = raw;
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
      url = `wss://${url}`;
    }
    try {
      new URL(url);
    } catch {
      setRelayInputError(
        "Enter a valid WebSocket URL (e.g. wss://relay.example.com)",
      );
      return;
    }
    if (otherRelays.includes(url)) {
      setRelayInputError("Already in the list");
      return;
    }
    setOtherRelays((prev) => [...prev, url]);
    setRelayInput("");
    setRelayInputError(undefined);
  }, [relayInput, otherRelays]);

  const handleRemoveRelay = useCallback((url: string) => {
    setOtherRelays((prev) => prev.filter((r) => r !== url));
  }, []);

  // ---------------------------------------------------------------------------
  // Other git server actions
  // ---------------------------------------------------------------------------

  const handleAddGitServer = useCallback(() => {
    const raw = gitServerInput.trim();
    if (!raw) return;
    try {
      new URL(raw);
    } catch {
      setGitServerInputError(
        "Enter a valid URL (e.g. https://github.com/user/repo.git)",
      );
      return;
    }
    if (isGraspCloneUrl(raw)) {
      setGitServerInputError(
        "This looks like a Grasp server URL — use the Grasp Servers section instead",
      );
      return;
    }
    if (otherGitServers.includes(raw)) {
      setGitServerInputError("Already in the list");
      return;
    }
    setOtherGitServers((prev) => [...prev, raw]);
    setGitServerInput("");
    setGitServerInputError(undefined);
  }, [gitServerInput, otherGitServers]);

  const handleRemoveGitServer = useCallback((url: string) => {
    setOtherGitServers((prev) => prev.filter((u) => u !== url));
  }, []);

  // ---------------------------------------------------------------------------
  // Web URL actions
  // ---------------------------------------------------------------------------

  const handleAddWebUrl = useCallback(() => {
    const raw = webInput.trim();
    if (!raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    try {
      new URL(url);
    } catch {
      return;
    }
    if (webUrls.includes(url)) return;
    setWebUrls((prev) => [...prev, url]);
    setWebInput("");
  }, [webInput, webUrls]);

  // ---------------------------------------------------------------------------
  // Topic actions
  // ---------------------------------------------------------------------------

  const handleAddTopic = useCallback(() => {
    const raw = topicInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!raw || topics.includes(raw)) return;
    setTopics((prev) => [...prev, raw]);
    setTopicInput("");
  }, [topicInput, topics]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const hasInfrastructure =
    selectedDomains.length > 0 ||
    (otherRelays.length > 0 && otherGitServers.length > 0);
  const canSave = name.trim().length > 0 && hasInfrastructure && !isSaving;

  const handleSave = useCallback(async () => {
    if (!canSave || !account) return;
    if (!selectedAnnouncement) return;

    setIsSaving(true);
    setSaveError(undefined);

    try {
      const npub = nip19.npubEncode(account.pubkey);
      const encodedId = encodeURIComponent(repo.dTag);

      // Build clone URLs: Grasp URLs + other git servers
      const graspCloneUrls = selectedDomains.map(
        (domain) => `https://${domain}/${npub}/${encodedId}.git`,
      );
      const allCloneUrls = [...graspCloneUrls, ...otherGitServers];

      // Build relay URLs: Grasp relay WSS + other relays
      const graspRelayUrls = selectedDomains.map((domain) => `wss://${domain}`);
      const allRelayUrls = [...graspRelayUrls, ...otherRelays];

      // Preserve maintainers tag
      const maintainersTag = selectedAnnouncement.tags.find(
        ([t]) => t === "maintainers",
      );

      const template: EventTemplate = {
        kind: REPO_KIND,
        content: "",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", repo.dTag],
          ["name", name.trim()],
          ["description", description.trim()],
          ...(allCloneUrls.length > 0
            ? [["clone", ...allCloneUrls] as string[]]
            : []),
          ...(allRelayUrls.length > 0
            ? [["relays", ...allRelayUrls] as string[]]
            : []),
          ["alt", `git repository: ${name.trim()}`],
          ...(eucHash.trim() ? [["r", eucHash.trim(), "euc"] as string[]] : []),
          ...(maintainersTag ? [maintainersTag] : []),
          ...webUrls.map((u) => ["web", u] as string[]),
          ...topics.map((t) => ["t", t] as string[]),
          // Preserve unknown/custom tags verbatim
          ...unknownTags.filter((tag) => tag.length > 0 && tag[0]),
        ],
      };

      const signedEvent = await account.signer.signEvent(template);

      // Publish to user outbox + repo's declared relays + git index
      const repoCoord = `${REPO_KIND}:${repo.selectedMaintainer}:${repo.dTag}`;
      await publish(signedEvent, [repoCoord, "git-index"]);

      // Navigate back to the about page
      navigate(`${basePath}/about`);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save changes",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    account,
    selectedAnnouncement,
    repo,
    selectedDomains,
    otherGitServers,
    otherRelays,
    name,
    description,
    webUrls,
    topics,
    eucHash,
    unknownTags,
    basePath,
    navigate,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="max-w-2xl">
        {/* Back link */}
        <Link
          to={`${basePath}/about`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to About
        </Link>

        <h1 className="text-xl font-semibold mb-6">Edit repository</h1>

        <div className="space-y-8">
          {/* ── Basic info ─────────────────────────────────────────────── */}
          <section className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Repository name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of the project"
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Website */}
            <div className="space-y-2">
              <Label>Website</Label>
              {webUrls.length > 0 && (
                <div className="space-y-1.5">
                  {webUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                    >
                      <span className="text-sm text-foreground/80 flex-1 truncate">
                        {url}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setWebUrls((prev) => prev.filter((u) => u !== url))
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Remove ${url}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="https://example.com"
                  value={webInput}
                  onChange={(e) => setWebInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddWebUrl();
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddWebUrl}
                  className="h-8 px-2.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Topics */}
            <div className="space-y-2">
              <Label>Topics</Label>
              {topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {topics.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="text-xs gap-1 pr-1"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() =>
                          setTopics((prev) => prev.filter((x) => x !== t))
                        }
                        className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                        aria-label={`Remove ${t}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Add topic…"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTopic();
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddTopic}
                  className="h-8 px-2.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Earliest unique commit */}
            <div className="space-y-2">
              <Label htmlFor="edit-euc">Earliest unique commit</Label>
              <Input
                id="edit-euc"
                value={eucHash}
                onChange={(e) => setEucHash(e.target.value)}
                placeholder="40-character git commit hash"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                The earliest commit hash that uniquely identifies this
                repository — used to track it across forks and renames. Set
                automatically by <code className="font-mono">ngit push</code>.
              </p>
            </div>
          </section>

          <Separator />

          {/* ── Infrastructure ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Infrastructure</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Grasp servers provide git hosting and Nostr relay in one.
                Alternatively, specify both a relay and a git server manually.
              </p>
            </div>

            {/* Grasp servers — always visible, primary path */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 px-1">
                <GraspLogo className="h-3.5 w-3.5 text-pink-500" />
                <span className="text-sm font-medium">Grasp servers</span>
              </div>

              <div className="space-y-3 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Grasp servers host your git data and act as relays. Clone and
                  relay URLs are auto-generated from your server selection.
                  Adding a new server requires pushing via{" "}
                  <code className="font-mono">ngit</code> afterwards.
                </p>

                {/* Server checklist */}
                <div className="space-y-1.5">
                  {allKnownDomains.map((domain) => {
                    const checked = selectedDomains.includes(domain);
                    const isDefault = DEFAULT_GRASP_SERVERS.includes(domain);
                    const isUserList =
                      isFromUserList &&
                      resolvedServers.some((s) => s.domain === domain);
                    const isFromAnnouncement =
                      currentGraspDomains.includes(domain);
                    return (
                      <label
                        key={domain}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => handleToggleServer(domain)}
                          id={`edit-server-${domain}`}
                        />
                        <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-mono flex-1">
                          {domain}
                        </span>
                        {isFromAnnouncement && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 text-pink-500 border-pink-500/30"
                          >
                            current
                          </Badge>
                        )}
                        {isUserList && !isDefault && !isFromAnnouncement && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4"
                          >
                            your list
                          </Badge>
                        )}
                        {isDefault && !isFromAnnouncement && (
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

                {!hasInfrastructure && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 px-0.5">
                    Select at least one Grasp server, or add both a relay and a
                    git server below.
                  </p>
                )}

                {/* Union Grasp servers from other maintainers */}
                {unionOnlyGraspDomains.length > 0 && (
                  <UnionSection label="Covered by co-maintainers (read-only)">
                    {unionOnlyGraspDomains.map(
                      ({ domain, contributorPubkey }) => (
                        <UnionItem
                          key={domain}
                          value={domain}
                          contributorPubkey={contributorPubkey}
                          monospace
                        />
                      ),
                    )}
                  </UnionSection>
                )}
              </div>
            </div>

            {/* Other relays — optional, collapsed by default */}
            <Collapsible
              open={otherRelaysOpen}
              onOpenChange={setOtherRelaysOpen}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {otherRelaysOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Radio className="h-3 w-3" />
                    <span className="font-medium">Other relays</span>
                    <span className="font-normal opacity-60 ml-0.5">
                      (optional)
                    </span>
                  </span>
                  {!otherRelaysOpen && otherRelays.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5"
                    >
                      {otherRelays.length}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Additional Nostr relay URLs beyond Grasp servers.
                </p>

                {otherRelays.length > 0 && (
                  <div className="space-y-1.5">
                    {otherRelays.map((url) => (
                      <div
                        key={url}
                        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                      >
                        <code className="text-xs font-mono text-foreground/80 flex-1 truncate">
                          {url}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleRemoveRelay(url)}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label={`Remove ${url}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      placeholder="wss://relay.example.com"
                      value={relayInput}
                      onChange={(e) => {
                        setRelayInput(e.target.value);
                        setRelayInputError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddRelay();
                        }
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddRelay}
                      className="h-8 px-2.5 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {relayInputError && (
                    <p className="text-xs text-red-500 px-0.5">
                      {relayInputError}
                    </p>
                  )}
                </div>

                {/* Union relays from other maintainers */}
                {unionOnlyRelays.length > 0 && (
                  <UnionSection label="Covered by co-maintainers (read-only)">
                    {unionOnlyRelays.map(({ url, contributorPubkey }) => (
                      <UnionItem
                        key={url}
                        value={url}
                        contributorPubkey={contributorPubkey}
                        monospace
                      />
                    ))}
                  </UnionSection>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Other git servers — optional, collapsed by default */}
            <Collapsible
              open={otherGitServersOpen}
              onOpenChange={setOtherGitServersOpen}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {otherGitServersOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <GitBranch className="h-3 w-3" />
                    <span className="font-medium">Other git servers</span>
                    <span className="font-normal opacity-60 ml-0.5">
                      (optional)
                    </span>
                  </span>
                  {!otherGitServersOpen && otherGitServers.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5"
                    >
                      {otherGitServers.length}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Additional raw git clone URLs beyond Grasp servers (e.g.
                  GitHub mirrors).
                </p>

                {otherGitServers.length > 0 && (
                  <div className="space-y-1.5">
                    {otherGitServers.map((url) => (
                      <div
                        key={url}
                        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                      >
                        <code className="text-xs font-mono text-foreground/80 flex-1 truncate break-all">
                          {url}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleRemoveGitServer(url)}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label={`Remove ${url}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://github.com/user/repo.git"
                      value={gitServerInput}
                      onChange={(e) => {
                        setGitServerInput(e.target.value);
                        setGitServerInputError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddGitServer();
                        }
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddGitServer}
                      className="h-8 px-2.5 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {gitServerInputError && (
                    <p className="text-xs text-red-500 px-0.5">
                      {gitServerInputError}
                    </p>
                  )}
                </div>

                {/* Union git servers from other maintainers */}
                {unionOnlyGitServers.length > 0 && (
                  <UnionSection label="Covered by co-maintainers (read-only)">
                    {unionOnlyGitServers.map(({ url, contributorPubkey }) => (
                      <UnionItem
                        key={url}
                        value={url}
                        contributorPubkey={contributorPubkey}
                        monospace
                      />
                    ))}
                  </UnionSection>
                )}
              </CollapsibleContent>
            </Collapsible>
          </section>

          <Separator />

          {/* ── Unknown / custom tags ──────────────────────────────────── */}
          <section className="space-y-3">
            <Collapsible
              open={unknownTagsOpen}
              onOpenChange={setUnknownTagsOpen}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {unknownTagsOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Tag className="h-3 w-3" />
                    <span className="font-medium">Custom tags</span>
                    <span className="font-normal opacity-60 ml-0.5">
                      (advanced)
                    </span>
                  </span>
                  {!unknownTagsOpen && unknownTags.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5"
                    >
                      {unknownTags.length}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Tags not recognised by this client are preserved here. Both
                  the tag name and values are editable. Use "add value" to
                  attach additional values to the same tag.
                </p>

                {unknownTags.length > 0 && (
                  <div className="space-y-2">
                    {unknownTags.map((tag, idx) => (
                      <UnknownTagRow
                        key={idx}
                        tag={tag}
                        onChange={(updated) =>
                          setUnknownTags((prev) =>
                            prev.map((t, i) => (i === idx ? updated : t)),
                          )
                        }
                        onRemove={() =>
                          setUnknownTags((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                      />
                    ))}
                  </div>
                )}

                <AddCustomTagRow
                  onAdd={(tag) => setUnknownTags((prev) => [...prev, tag])}
                />
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/* ── Error / actions ────────────────────────────────────────── */}
          {saveError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="bg-pink-600 hover:bg-pink-700 text-white"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            <Button asChild variant="ghost">
              <Link to={`${basePath}/about`}>Cancel</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnknownTagRow — editable row for a single unknown/custom tag
// ---------------------------------------------------------------------------

/**
 * Two-column layout:
 *   left  — editable tag name input (fixed width)
 *   right — stacked value inputs, one per line, with per-value × and an
 *           "add value" + button below the last one
 *
 * The outer × (top-right) removes the entire tag.
 */
function UnknownTagRow({
  tag,
  onChange,
  onRemove,
}: {
  tag: string[];
  onChange: (updated: string[]) => void;
  onRemove: () => void;
}) {
  const [name, ...rawValues] = tag;
  // Always show at least one value input
  const values = rawValues.length > 0 ? rawValues : [""];

  const handleNameChange = (newName: string) => {
    onChange([newName, ...values]);
  };

  const handleValueChange = (valueIdx: number, newVal: string) => {
    const newValues = values.map((v, i) => (i === valueIdx ? newVal : v));
    onChange([name, ...newValues]);
  };

  const handleRemoveValue = (valueIdx: number) => {
    const newValues = values.filter((_, i) => i !== valueIdx);
    // Keep at least one empty value so the input is always visible
    onChange([name, ...(newValues.length > 0 ? newValues : [""])]);
  };

  const handleAddValue = () => {
    onChange([name, ...values, ""]);
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="flex items-start gap-2">
        {/* Left column — tag name */}
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="h-7 w-24 shrink-0 text-xs font-mono"
          placeholder="name"
          aria-label="Tag name"
        />

        {/* Right column — value inputs stacked */}
        <div className="flex-1 space-y-1">
          {values.map((val, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={val}
                onChange={(e) => handleValueChange(i, e.target.value)}
                className="h-7 text-xs font-mono flex-1"
                placeholder="value"
              />
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveValue(i)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label="Remove value"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {/* Add another value */}
          <button
            type="button"
            onClick={handleAddValue}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5"
            aria-label="Add value"
          >
            <Plus className="h-3 w-3" />
            <span>add value</span>
          </button>
        </div>

        {/* Remove whole tag */}
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-1"
          aria-label={`Remove tag ${name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddCustomTagRow — form for adding a brand-new custom tag
// ---------------------------------------------------------------------------

/**
 * Same two-column layout as UnknownTagRow. Manages its own pending name +
 * values list before committing, so the "add value" button is visible from
 * the start and makes the multi-value capability obvious.
 */
function AddCustomTagRow({ onAdd }: { onAdd: (tag: string[]) => void }) {
  const [tagName, setTagName] = useState("");
  const [values, setValues] = useState<string[]>([""]);
  const [error, setError] = useState<string | undefined>();

  const handleCommit = () => {
    const name = tagName.trim();
    if (!name) {
      setError("Tag name is required");
      return;
    }
    if (KNOWN_TAG_NAMES.has(name)) {
      setError(`"${name}" is managed by the form above`);
      return;
    }
    onAdd([name, ...values]);
    setTagName("");
    setValues([""]);
    setError(undefined);
  };

  const handleValueChange = (i: number, val: string) => {
    setValues((prev) => prev.map((v, idx) => (idx === i ? val : v)));
  };

  const handleRemoveValue = (i: number) => {
    setValues((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length > 0 ? next : [""];
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        {/* Left — tag name */}
        <Input
          placeholder="tag name"
          value={tagName}
          onChange={(e) => {
            setTagName(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCommit();
            }
          }}
          className="h-7 w-24 shrink-0 text-xs font-mono"
        />

        {/* Right — values */}
        <div className="flex-1 space-y-1">
          {values.map((val, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                placeholder="value"
                value={val}
                onChange={(e) => handleValueChange(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                className="h-7 text-xs font-mono flex-1"
              />
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveValue(i)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label="Remove value"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setValues((prev) => [...prev, ""])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5"
          >
            <Plus className="h-3 w-3" />
            <span>add value</span>
          </button>
        </div>

        {/* Commit */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCommit}
          className="h-7 px-2.5 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-red-500 px-0.5">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnionSection — collapsible section for union-only items from co-maintainers
// ---------------------------------------------------------------------------

function UnionSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Users className="h-3 w-3" />
          {label}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 pt-2">
        <p className="text-xs text-muted-foreground/70 leading-relaxed px-1 pb-1">
          These are contributed by co-maintainers' announcements and are
          included via union. They are not in your announcement.
        </p>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// UnionItem — a single read-only item with contributor attribution
// ---------------------------------------------------------------------------

function UnionItem({
  value,
  contributorPubkey,
  monospace = false,
}: {
  value: string;
  contributorPubkey: string;
  monospace?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-1.5 opacity-75">
      <span
        className={cn(
          "text-xs text-foreground/60 flex-1 truncate",
          monospace && "font-mono",
        )}
      >
        {value}
      </span>
      {contributorPubkey && (
        <span className="text-[10px] text-muted-foreground/60 shrink-0 flex items-center gap-1">
          via{" "}
          <UserName
            pubkey={contributorPubkey}
            className="text-[10px] text-muted-foreground/60"
          />
        </span>
      )}
    </div>
  );
}
