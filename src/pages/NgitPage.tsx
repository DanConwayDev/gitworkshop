import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Copy, Check, Download, Terminal, Package, Wrench } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NGIT_VERSION = "v2.4.1";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

interface Platform {
  name: string;
  compatibility: string;
  url: string;
  primary?: boolean;
}

function detectPlatforms(): {
  platforms: Platform[];
  detected: Platform | null;
} {
  const allPlatforms: (Platform & { osIdentifiers: RegExp[] })[] = [
    {
      name: "macOS (universal)",
      compatibility:
        "macOS 10.13 High Sierra (2017) or newer. Intel + Apple Silicon.",
      url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${NGIT_VERSION}/ngit-${NGIT_VERSION}-universal-apple-darwin.tar.gz`,
      osIdentifiers: [/Mac OS X/, /Macintosh/, /Darwin/],
    },
    {
      name: "Linux (x86-64, glibc)",
      compatibility:
        "Ubuntu 14.04+, Debian 8+, RHEL/CentOS 7+, Fedora 21+, openSUSE, Arch, etc. Any x86-64 distro with glibc ≥ 2.17. (For Alpine see more options)",
      url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${NGIT_VERSION}/ngit-${NGIT_VERSION}-x86_64-unknown-linux-gnu.2.17.tar.gz`,
      osIdentifiers: [/Linux(?!.*aarch64)/i, /X11(?!.*aarch64)/i],
    },
    {
      name: "Linux (aarch64, glibc)",
      compatibility:
        "Ubuntu 20.04+, Debian 11+, Amazon Linux 2, AWS Graviton, Raspberry Pi OS 64-bit, etc. Any aarch64/arm64 distro with glibc ≥ 2.17.",
      url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${NGIT_VERSION}/ngit-${NGIT_VERSION}-aarch64-unknown-linux-gnu.2.17.tar.gz`,
      osIdentifiers: [/Linux.*aarch64/i, /Linux.*arm64/i],
    },
    {
      name: "Linux (musl, static)",
      compatibility:
        "Alpine 3.12+, Distroless and scratch containers, and very old glibc systems. Fully static; no external libraries.",
      url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${NGIT_VERSION}/ngit-${NGIT_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
      osIdentifiers: [/Alpine/i],
    },
    {
      name: "Windows (x64)",
      compatibility:
        "Windows 7 SP1 / Server 2008 R2 and newer, including Windows 11. Requires the Universal C Runtime (present on Windows 10+ or via VC++ 2015-2022 redistributable on older systems).",
      url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${NGIT_VERSION}/ngit-${NGIT_VERSION}-x86_64-pc-windows-msvc.zip`,
      osIdentifiers: [/Windows NT/i, /Win64/i],
    },
  ];

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let detected: Platform | null = null;

  const platforms: Platform[] = allPlatforms.map((p) => {
    const isPrimary = !detected && p.osIdentifiers.some((re) => re.test(ua));
    if (isPrimary)
      detected = { name: p.name, compatibility: p.compatibility, url: p.url };
    return {
      name: p.name,
      compatibility: p.compatibility,
      url: p.url,
      primary: isPrimary,
    };
  });

  return { platforms, detected };
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 p-1 rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-between bg-muted rounded-md px-4 py-3 font-mono text-sm my-3">
      <span className="text-foreground">{children}</span>
      <CopyButton text={children} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstallNgit
// ---------------------------------------------------------------------------

function InstallNgit() {
  const [{ platforms, detected }, setPlatformData] = useState<{
    platforms: Platform[];
    detected: Platform | null;
  }>({ platforms: [], detected: null });

  useEffect(() => {
    setPlatformData(detectPlatforms());
  }, []);

  const isWindows = detected?.name === "Windows (x64)";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Installation command:
        </p>
        <CodeBlock>curl -Ls https://ngit.dev/install.sh | bash</CodeBlock>
      </div>

      {isWindows && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            Or one-liner for Windows (PowerShell):
          </p>
          <CodeBlock>iwr -useb https://ngit.dev/install.ps1 | iex</CodeBlock>
        </div>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="more">
          <AccordionTrigger className="text-sm text-muted-foreground hover:text-foreground">
            More install options
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Build from source */}
              <Accordion
                type="single"
                collapsible
                className="border rounded-md"
              >
                <AccordionItem value="source" className="border-none">
                  <AccordionTrigger className="px-4 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Wrench className="h-4 w-4" />
                      1. Build from source
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <ol className="space-y-2 text-sm list-decimal list-inside text-muted-foreground">
                      <li>
                        <a
                          href="https://www.rust-lang.org/tools/install"
                          target="_blank"
                          rel="noreferrer"
                          className="text-pink-500 hover:underline"
                        >
                          Install Rust and Cargo
                        </a>
                      </li>
                      <li>
                        Clone{" "}
                        <a
                          href="https://github.com/DanConwayDev/ngit-cli"
                          target="_blank"
                          rel="noreferrer"
                          className="text-pink-500 hover:underline"
                        >
                          the ngit-cli repository
                        </a>
                      </li>
                      <li>Checkout the latest release tag ({NGIT_VERSION})</li>
                      <li>
                        Run:
                        <CodeBlock>cargo build --release</CodeBlock>
                      </li>
                      <li>
                        Move both binaries to your PATH:
                        <div className="bg-muted rounded-md px-4 py-3 font-mono text-sm mt-2 space-y-1">
                          <div>./target/release/ngit</div>
                          <div>./target/release/git-remote-nostr</div>
                        </div>
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Install with Cargo */}
              <Accordion
                type="single"
                collapsible
                className="border rounded-md"
              >
                <AccordionItem value="cargo" className="border-none">
                  <AccordionTrigger className="px-4 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      2. Install with Cargo
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <ol className="space-y-2 text-sm list-decimal list-inside text-muted-foreground">
                      <li>
                        <a
                          href="https://www.rust-lang.org/tools/install"
                          target="_blank"
                          rel="noreferrer"
                          className="text-pink-500 hover:underline"
                        >
                          Install Rust and Cargo
                        </a>
                      </li>
                      <li>
                        <CodeBlock>cargo install ngit</CodeBlock>
                      </li>
                      <li>
                        Add{" "}
                        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                          ~/.cargo/bin
                        </code>{" "}
                        to your PATH
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Install with Nix */}
              <Accordion
                type="single"
                collapsible
                className="border rounded-md"
              >
                <AccordionItem value="nix" className="border-none">
                  <AccordionTrigger className="px-4 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      3. Install with Nix
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <ol className="space-y-2 text-sm list-decimal list-inside text-muted-foreground">
                      <li>
                        Add ngit as a flake input:
                        <div className="bg-muted rounded-md px-4 py-3 font-mono text-sm mt-2 whitespace-pre">
                          {`{ inputs = { ngit.url = "github:DanConwayDev/ngit-cli"; } }`}
                        </div>
                      </li>
                      <li>
                        Include default packages (e.g. with home-manager):
                        <div className="bg-muted rounded-md px-4 py-3 font-mono text-sm mt-2 whitespace-pre">
                          {`{ inputs, ... }: {
  home-manager.users.myuser = { pkgs, ... }: {
    home.packages = [
      inputs.ngit.packages."\${pkgs.system}".default
    ];
  };
}`}
                        </div>
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Download binaries */}
              <Accordion
                type="single"
                collapsible
                className="border rounded-md"
              >
                <AccordionItem value="binaries" className="border-none">
                  <AccordionTrigger className="px-4 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      4. Download binaries for Linux, macOS and Windows
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      Download, extract binaries and add them to PATH.
                    </p>
                    <div className="space-y-4">
                      {platforms.map((platform) => (
                        <div
                          key={platform.url}
                          className="flex items-start gap-4"
                        >
                          <Button
                            asChild
                            variant={platform.primary ? "default" : "outline"}
                            size="sm"
                            className={
                              platform.primary
                                ? "bg-pink-500 hover:bg-pink-600 text-white flex-shrink-0"
                                : "flex-shrink-0"
                            }
                          >
                            <a href={platform.url} rel="external">
                              <Download className="h-3.5 w-3.5 mr-1.5" />
                              {platform.name}
                            </a>
                          </Button>
                          <p className="text-xs text-muted-foreground pt-1">
                            {platform.compatibility}
                          </p>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Verify install */}
              <div className="pt-2">
                <p className="text-sm text-muted-foreground mb-2">
                  Verify install — check both binaries are in your PATH and
                  executable:
                </p>
                <div className="bg-muted rounded-md px-4 py-3 font-mono text-sm space-y-1">
                  <div>ngit --version</div>
                  <div>git-remote-nostr --version</div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NgitPage
// ---------------------------------------------------------------------------

export default function NgitPage() {
  const location = useLocation();
  const expandQuickStart = !!(
    location.state as { expandQuickStart?: boolean } | null
  )?.expandQuickStart;
  const defaultOpen = expandQuickStart ? ["contributor", "maintainer"] : [];

  useSeoMeta({
    title: "Install ngit — Decentralized Git CLI",
    description:
      "Install the ngit CLI to collaborate on git repositories over Nostr. Works with any Nostr-compatible relay.",
    ogImage: "/og-image.svg",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    twitterCard: "summary_large_image",
  });

  return (
    <div className="container max-w-screen-md px-4 md:px-8 py-10 space-y-12">
      {/* Install section */}
      <section className="space-y-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold">ngit</h1>
            <Badge variant="secondary" className="font-mono">
              {NGIT_VERSION}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            The CLI tool for collaborating on git repositories over Nostr.
          </p>
        </div>
        <InstallNgit />
      </section>

      {/* Quick start */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Quick start</h2>

        <Accordion type="multiple" defaultValue={defaultOpen}>
          {/* Contributor */}
          <AccordionItem value="contributor">
            <AccordionTrigger
              className="text-lg font-medium hover:no-underline"
              id="contributor"
            >
              Contributor
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-1">
                <p className="text-sm text-muted-foreground">
                  Pre-requisite: install ngit and git-remote-nostr (above).
                </p>

                <div className="space-y-4 text-sm">
                  <div>
                    <h4 className="font-medium mb-1">1. Find a repository</h4>
                    <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                      <li>
                        <Link to="/" className="text-pink-500 hover:underline">
                          Search gitworkshop.dev
                        </Link>{" "}
                        for the repository
                      </li>
                      <li>Explore PRs and issues</li>
                      <li>Copy the git clone URL</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">
                      2. Clone the repository
                    </h4>
                    <CodeBlock>
                      git clone nostr://npub123/repo-identifier
                    </CodeBlock>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">3. Submit a PR</h4>
                    <p className="text-muted-foreground mb-2">
                      Push a branch with the{" "}
                      <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                        pr/
                      </code>{" "}
                      prefix:
                    </p>
                    <div className="space-y-1">
                      <CodeBlock>git checkout -b pr/great-feature</CodeBlock>
                      <CodeBlock>git commit -am "improve the world"</CodeBlock>
                      <CodeBlock>git push -u</CodeBlock>
                    </div>
                    <p className="text-muted-foreground mt-2">
                      Or use ngit for more options (cover letter, etc.):
                    </p>
                    <CodeBlock>ngit send</CodeBlock>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">4. View open PRs</h4>
                    <CodeBlock>git branch -r --list origin/pr/*</CodeBlock>
                    <p className="text-muted-foreground mt-1">Or with ngit:</p>
                    <CodeBlock>ngit list</CodeBlock>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Maintainer */}
          <AccordionItem value="maintainer">
            <AccordionTrigger
              className="text-lg font-medium hover:no-underline"
              id="maintainer"
            >
              Maintainer
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-1">
                <p className="text-sm text-muted-foreground">
                  Pre-requisite: install ngit and git-remote-nostr (above).
                </p>

                <div className="space-y-4 text-sm">
                  <div>
                    <h4 className="font-medium mb-1">
                      1. Create a local git repo
                    </h4>
                    <div className="space-y-1">
                      <CodeBlock>git init</CodeBlock>
                      <CodeBlock>git commit -am "initial commit"</CodeBlock>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">2. Initialise on Nostr</h4>
                    <CodeBlock>ngit init</CodeBlock>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">3. View PRs</h4>
                    <CodeBlock>git branch -r --list origin/pr/*</CodeBlock>
                    <p className="text-muted-foreground mt-1">
                      Or with ngit (includes apply options):
                    </p>
                    <CodeBlock>ngit list</CodeBlock>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">
                      4. Merge / incorporate PRs
                    </h4>
                    <p className="text-muted-foreground mb-2">
                      PR status is automatically updated when you merge the
                      branch:
                    </p>
                    <div className="space-y-1">
                      <CodeBlock>git checkout master</CodeBlock>
                      <CodeBlock>git merge pr/great-feature</CodeBlock>
                      <CodeBlock>git push</CodeBlock>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">
                      5. Consider disabling PRs and issues elsewhere
                    </h4>
                    <p className="text-muted-foreground">
                      If you push to GitHub, Codeberg, Bitbucket, etc., consider
                      disabling their PRs and issues so everything is managed on
                      Nostr. For GitHub, use{" "}
                      <em>Repo Settings &gt; Features</em> for issues (disabling
                      PRs is not yet possible on GitHub).
                    </p>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  );
}
