import { useMemo, useState } from "react";
import { use$ } from "@/hooks/use$";
import { pool } from "@/services/nostr";
import { Button } from "@/components/ui/button";
import { ensureHttpURL } from "applesauce-core/helpers";
import { WifiIcon, WifiOffIcon, Loader2Icon } from "lucide-react";

export function RelayItem({
  relay,
  onRemove,
}: {
  relay: string;
  onRemove: () => void | Promise<void>;
}) {
  const inst = useMemo(() => pool.relay(relay), [relay]);
  const icon = use$(inst.icon$);
  const connected = use$(inst.connected$);
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove();
    setRemoving(false);
  };

  return (
    <div className="flex items-center gap-2">
      <a href={ensureHttpURL(relay)} target="_blank" title="Open in new tab">
        <img src={icon} className="w-6 h-6" />
      </a>
      <code className="flex-1 text-xs bg-muted p-2 rounded font-mono select-all">
        {relay}
      </code>
      <span className="text-xs text-muted-foreground">
        {connected ? (
          <WifiIcon className="w-4 h-4 text-green-500" />
        ) : (
          <WifiOffIcon className="w-4 h-4 text-gray-500" />
        )}
      </span>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleRemove}
        disabled={removing}
      >
        {removing ? <Loader2Icon className="w-4 h-4 animate-spin" /> : "Remove"}
      </Button>
    </div>
  );
}
