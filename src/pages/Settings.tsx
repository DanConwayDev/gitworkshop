import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RelayItem } from "@/components/RelayItem";
import { NewRelayForm } from "@/components/NewRelayForm";
import { extraRelays, gitIndexRelays, lookupRelays } from "@/services/settings";
import { use$ } from "@/hooks/use$";
import { useAccount } from "@/hooks/useAccount";
import { useUser } from "@/hooks/useUser";
import {
  AddInboxRelay,
  AddOutboxRelay,
  RemoveInboxRelay,
  RemoveOutboxRelay,
} from "applesauce-actions/actions/mailboxes";
import { runner } from "@/services/actions";

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

function OutboxRelaysSection() {
  const account = useAccount();
  const user = useUser(account?.pubkey);
  const outboxes = use$(user?.outboxes$);

  if (!account) return null;

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
              onRemove={() => runner.run(RemoveOutboxRelay, outbox)}
            />
          ))}
        </div>
        <NewRelayForm onAdd={(relay) => runner.run(AddOutboxRelay, relay)} />
      </CardContent>
    </Card>
  );
}

function InboxRelaysSection() {
  const account = useAccount();
  const user = useUser(account?.pubkey);
  const inboxes = use$(user?.inboxes$);

  if (!account) return null;

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
              onRemove={() => runner.run(RemoveInboxRelay, inbox)}
            />
          ))}
        </div>
        <NewRelayForm onAdd={(relay) => runner.run(AddInboxRelay, relay)} />
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
  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your relay configurations for the application.
        </p>
      </div>

      <DiscoveryRelaysSection />
      <OutboxRelaysSection />
      <InboxRelaysSection />
      <ExtraRelaysSection />
    </div>
  );
}
