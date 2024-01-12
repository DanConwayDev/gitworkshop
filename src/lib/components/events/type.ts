import { defaults as user_defaults } from "../users/type";
import type { User } from "../users/type";

export interface Event {
    author: User;
    content: any;
}

let defaults: Event = {
    author: { ...user_defaults },
    content: [],
}