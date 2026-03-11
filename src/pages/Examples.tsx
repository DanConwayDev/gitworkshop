/**
 * Examples Page - Demonstrates Applesauce Features
 *
 * This page showcases the key features and patterns of Applesauce:
 * - Timeline feeds with Note casts
 * - Profile loading with ProfileModel
 * - Reactive updates with RxJS observables
 * - Authentication and account management
 */
import { useSeoMeta } from "@unhead/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TimelineFeed } from "@/components/examples/TimelineFeed";
import { ProfileCard } from "@/components/examples/ProfileCard";
import { LoginArea } from "@/components/auth/LoginArea";
import { useActiveAccount } from "applesauce-react/hooks";

const Examples = () => {
  useSeoMeta({
    title: "Applesauce Examples - Nostr Client",
    description:
      "Live examples demonstrating Applesauce features including timelines, profiles, and reactive data.",
  });

  const activeAccount = useActiveAccount();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto py-6 px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Applesauce Examples</h1>
              <p className="text-muted-foreground">
                Live demonstrations of Applesauce features and patterns
              </p>
            </div>
            <LoginArea className="max-w-60" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto py-8 px-4">
        <Tabs defaultValue="timeline" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="timeline">Timeline Feed</TabsTrigger>
            <TabsTrigger value="profile">Profile Card</TabsTrigger>
            <TabsTrigger value="info">About</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Timeline Feed</CardTitle>
                <CardDescription>
                  A reactive timeline using <code>useTimeline</code> hook with
                  Note casts. Automatically updates when new events arrive.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 p-4 bg-muted rounded-lg text-sm">
                  <p className="font-semibold mb-2">Features demonstrated:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>
                      Reactive timeline with <code>useTimeline</code>
                    </li>
                    <li>Note casts with reactive properties</li>
                    <li>
                      Author profiles with{" "}
                      <code>use$(note.author.profile$)</code>
                    </li>
                    <li>
                      Reply-to detection with{" "}
                      <code>use$(note.replyingTo$)</code>
                    </li>
                    <li>Skeleton loading states</li>
                    <li>Empty state handling</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <TimelineFeed />
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profile Card</CardTitle>
                <CardDescription>
                  User profile using <code>useProfile</code> hook with
                  ProfileModel. Reactively updates when profile metadata
                  changes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 p-4 bg-muted rounded-lg text-sm">
                  <p className="font-semibold mb-2">Features demonstrated:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>
                      Profile loading with <code>useProfile(pubkey)</code>
                    </li>
                    <li>ProfileModel reactive subscription</li>
                    <li>
                      All NIP-01 metadata fields (name, picture, banner, about,
                      etc.)
                    </li>
                    <li>NIP-05 verification display</li>
                    <li>Lightning address (lud16/lud06)</li>
                    <li>NIP-19 npub encoding</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {activeAccount ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Your Profile</h3>
                <ProfileCard pubkey={activeAccount.pubkey} />
              </div>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-12 px-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    Log in to see your profile
                  </p>
                  <LoginArea />
                </CardContent>
              </Card>
            )}

            {/* Example with another user */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Example Profile</h3>
              <p className="text-sm text-muted-foreground">
                Profile of fiatjaf (Nostr protocol creator)
              </p>
              <ProfileCard pubkey="3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" />
            </div>
          </TabsContent>

          <TabsContent value="info" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>About Applesauce</CardTitle>
                <CardDescription>
                  Understanding the architecture and patterns
                </CardDescription>
              </CardHeader>
              <CardContent className="prose prose-sm dark:prose-invert max-w-none">
                <h3>Architecture Overview</h3>
                <p>
                  Applesauce is a production-ready Nostr SDK built on RxJS
                  observables, used in production by noStrudel. It follows a
                  store-first architecture:
                </p>

                <ol>
                  <li>
                    <strong>EventStore</strong> - Central state container for
                    all events
                  </li>
                  <li>
                    <strong>RelayPool</strong> - Manages WebSocket connections
                    to relays
                  </li>
                  <li>
                    <strong>Loaders</strong> - Automatically batch and cache
                    event requests
                  </li>
                  <li>
                    <strong>Models</strong> - Reactive data models
                    (ProfileModel, ThreadModel, etc.)
                  </li>
                  <li>
                    <strong>Casts</strong> - Object-oriented event wrappers with
                    reactive properties
                  </li>
                  <li>
                    <strong>Actions</strong> - Pre-built operations for common
                    tasks
                  </li>
                  <li>
                    <strong>Accounts</strong> - Multi-account management with
                    various signers
                  </li>
                </ol>

                <h3>Key Benefits</h3>
                <ul>
                  <li>
                    <strong>Reactive</strong> - Automatic updates via RxJS
                    observables
                  </li>
                  <li>
                    <strong>Efficient</strong> - Request batching,
                    deduplication, caching
                  </li>
                  <li>
                    <strong>Type-safe</strong> - Full TypeScript support
                  </li>
                  <li>
                    <strong>Feature-rich</strong> - Comprehensive NIP support
                  </li>
                  <li>
                    <strong>Production-ready</strong> - Battle-tested in
                    noStrudel
                  </li>
                </ul>

                <h3>Learn More</h3>
                <p>
                  Check out the <code>/src/hooks</code> directory for hook
                  implementations, and <code>/src/services</code> for the core
                  architecture setup.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Examples;
