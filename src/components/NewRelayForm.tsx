import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureWebSocketURL } from "applesauce-core/helpers";

export function NewRelayForm({
  onAdd,
}: {
  onAdd: (relay: string) => void | Promise<void>;
}) {
  const [newRelay, setNewRelay] = useState("");
  const [adding, setAdding] = useState(false);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleAdd = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    setAdding(true);
    await onAdd(ensureWebSocketURL(newRelay.trim()));
    setNewRelay("");
    setAdding(false);
  };

  return (
    <form className="flex gap-2 w-full" onSubmit={handleAdd}>
      <Input
        type="text"
        placeholder="wss://relay.example.com"
        value={newRelay}
        onChange={(e) => setNewRelay(e.target.value)}
        onKeyDown={handleKeyPress}
        className="flex-1"
        disabled={adding}
      />
      <Button type="submit" disabled={!newRelay.trim() || adding}>
        Add
      </Button>
    </form>
  );
}
