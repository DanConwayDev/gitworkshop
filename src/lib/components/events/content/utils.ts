import type { NDKTag } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import { identity, last, pluck } from "ramda";

export const TOPIC = "topic";
export const LINK = "link";
export const LINKCOLLECTION = "link[]";
export const HTML = "html";
export const INVOICE = "invoice";
export const NOSTR_NOTE = "nostr:note";
export const NOSTR_NEVENT = "nostr:nevent";
export const NOSTR_NPUB = "nostr:npub";
export const NOSTR_NPROFILE = "nostr:nprofile";
export const NOSTR_NADDR = "nostr:naddr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const first = (list: any) => (list ? list[0] : undefined);

export const fromNostrURI = (s: string) => s.replace(/^[\w+]+:\/?\/?/, "");

export const urlIsMedia = (url: string) =>
    !url.match(/\.(apk|docx|xlsx|csv|dmg)/) && last(url.split("://"))?.includes("/");

export type ContentArgs = {
    content: string;
    tags?: Array<NDKTag>;
};

export type ParsedPart = ParsedNewLine | ParsedText;

export const NEWLINE = "newline";

export type ParsedNewLine = {
    type: "newline",
    value: string,
};

export const isParsedNewLine = (part: ParsedPart): part is ParsedNewLine => {
    return part.type == "newline"
};

export const TEXT = "text";

export type ParsedText = {
    type: "text",
    value: string,
};

export const isParsedText = (part: ParsedPart): part is ParsedText => {
    return part.type == "text"
};

export const parseContent = ({ content, tags = [] }: ContentArgs): ParsedPart[] => {
    const result: ParsedPart[] = [];
    let text = content.trim();
    let buffer = "";

    const parseNewline = () => {
        const newline = first(text.match(/^\n+/));

        if (newline) {
            return [NEWLINE, newline, newline];
        }
    };

    while (text) {
        // The order that this runs matters
        const part =
            parseNewline();

        if (part) {
            if (buffer) {
                result.push({ type: "text", value: buffer });
                buffer = "";
            }

            const [type, raw, value] = part;

            result.push({ type, value });
            text = text.slice(raw.length);
        } else {
            // Instead of going character by character and re-running all the above regular expressions
            // a million times, try to match the next word and add it to the buffer
            const match = first(text.match(/^[\w\d]+ ?/i)) || text[0];

            buffer += match;
            text = text.slice(match.length);
        }
    }

    if (buffer) {
        result.push({ type: TEXT, value: buffer });
    }

    return result;
};
