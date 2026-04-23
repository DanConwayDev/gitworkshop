import { useSeoMeta } from "@unhead/react";
import { useActiveAccount } from "applesauce-react/hooks";
import { LandingPage } from "./LandingPage";
import { Dashboard } from "./Dashboard";

const Index = () => {
  const account = useActiveAccount();

  useSeoMeta({
    title: "ngit — Decentralized Git over Nostr",
    description:
      "Distributed code collaboration with Nostr. Browse repositories, track issues, and contribute — without a central server.",
    ogImage: "/og-image.svg",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageAlt: "ngit — Decentralized Git over Nostr",
    twitterCard: "summary_large_image",
  });

  if (account) {
    return <Dashboard />;
  }

  return <LandingPage />;
};

export default Index;
