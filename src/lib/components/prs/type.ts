import type { User } from "../users/type";
import { defaults as user_defaults } from "../users/type";
import type { Event } from "../events/type";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

export interface PRSummary {
    title: string;
    descritpion: string;
    repo_id: string;
    id: string;
    comments: number;
    author: User;
    created_at: number | undefined;
    loading: boolean;
}

export const summary_defaults: PRSummary = {
    title: "",
    descritpion: "",
    repo_id: "",
    id: "",
    comments: 0,
    author: { ...user_defaults },
    created_at: 0,
    loading: true,
};

export interface PRSummaries {
    id: string;
    summaries: PRSummary[];
    loading: boolean;
}

export const summaries_defaults: PRSummaries = {
    id: "",
    summaries: [],
    loading: true,
};

export interface PRFull {
    summary: PRSummary;
    pr_event: NDKEvent | undefined;
    events: Event[];
    loading: boolean;
}

export const full_defaults: PRFull = {
    summary: { ...summary_defaults },
    pr_event: undefined,
    events: [],
    loading: true,
};

