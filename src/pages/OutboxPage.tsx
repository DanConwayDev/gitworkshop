import { useSeoMeta } from "@unhead/react";
import { OutboxPanel } from "@/components/OutboxPanel";

export default function OutboxPage() {
  useSeoMeta({
    title: "Outbox - ngit",
    description: "View the status of published events and relay delivery.",
    ogImage: "/og-image.svg",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    twitterCard: "summary_large_image",
  });

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold">Outbox</h1>
        <p className="text-muted-foreground">
          Track published events and their delivery status across relays.
        </p>
      </div>

      <OutboxPanel variant="page" />
    </div>
  );
}
