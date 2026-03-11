import { useMemo } from "react";
import { use$ } from "@/hooks/use$";
import { pool } from "@/services/nostr";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Server } from "lucide-react";

interface RelayAvatarProps {
  relay: string;
  size?: "sm" | "md" | "lg";
}

interface RelayInformation {
  icon?: string;
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
}

export function RelayAvatar({ relay, size = "md" }: RelayAvatarProps) {
  const info = use$<RelayInformation | null>(
    () => pool.relay(relay).information$,
    [relay],
  );

  const sizeClass = useMemo(() => {
    switch (size) {
      case "sm":
        return "h-6 w-6";
      case "lg":
        return "h-12 w-12";
      default:
        return "h-8 w-8";
    }
  }, [size]);

  const iconSize = useMemo(() => {
    switch (size) {
      case "sm":
        return "h-3 w-3";
      case "lg":
        return "h-6 w-6";
      default:
        return "h-4 w-4";
    }
  }, [size]);

  const url = useMemo(() => {
    if (info?.icon) return info.icon;

    // Convert wss:// to https:// and ws:// to http://
    const httpUrl = relay
      .replace(/^wss:\/\//, "https://")
      .replace(/^ws:\/\//, "http://")
      .replace(/\/$/, "");

    return `${httpUrl}/favicon.ico`;
  }, [relay, info]);

  return (
    <Avatar className={sizeClass}>
      <AvatarImage src={url} alt={`${relay} icon`} />
      <AvatarFallback>
        <Server className={iconSize} />
      </AvatarFallback>
    </Avatar>
  );
}
