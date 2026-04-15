import { useSeoMeta } from "@unhead/react";
import { useActiveAccount } from "applesauce-react/hooks";
import { LandingPage } from "./LandingPage";
import { Dashboard } from "./Dashboard";

const Index = () => {
  const account = useActiveAccount();

  useSeoMeta({
    title: "ngit — Decentralized Git over Nostr",
    description:
      "Decentralized code collaboration over Nostr. Browse repositories, track issues, and contribute — without a central server.",
  });

  if (account) {
    return <Dashboard />;
  }

  return <LandingPage />;
};

export default Index;
