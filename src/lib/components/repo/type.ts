import type { User } from "../users/type";

export interface Repo {
    repo_id: string;
    name: string;
    description: string;
    git_server: string;
    tags: string[];
    maintainers: User[];
    relays: string[];
    loading: boolean;
}
export const defaults: Repo = {
    repo_id: "",
    name: "",
    description: "",
    git_server: "",
    tags: [],
    maintainers: [],
    relays: [],
    loading: true,
};