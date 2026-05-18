/**
 * Vendored from @fiatjaf/git-natural-api v0.2.4
 * https://jsr.io/@fiatjaf/git-natural-api
 *
 * Local modifications (already applied):
 *  - parsePerson: fixed multi-word name parsing (split on first "<" instead of " ")
 *    to correctly handle names with spaces (mirrors git's split_ident_line)
 */

/** Represents a parsed Git commit with structured data */
export type Commit = {
  hash: string; // SHA-1 hash of the commit
  tree: string; // SHA-1 hash of the tree object
  parents: string[]; // SHA-1 hashes of parent commits
  author: {
    name: string; // Author name
    email: string; // Author email
    timestamp: number; // Author timestamp (Unix epoch)
    timezone: string; // Author timezone (e.g., "+0000", "-0500")
  };
  committer: {
    name: string; // Committer name
    email: string; // Committer email
    timestamp: number; // Committer timestamp (Unix epoch)
    timezone: string; // Committer timezone (e.g., "+0000", "-0500")
  };
  message: string; // Full commit message
};

/**
 * Parses a Git commit object into structured data.
 * @param data Raw commit data as Uint8Array
 * @param hash SHA-1 hash of the commit
 * @returns Parsed Commit object with structured information
 */
export function parseCommit(data: Uint8Array, hash: string): Commit {
  const decoder = new TextDecoder("utf-8");
  const content = decoder.decode(data);

  // split header and message
  const headerEndIndex = content.indexOf("\n\n");
  if (headerEndIndex === -1) {
    throw new Error(
      `Invalid commit format for ${hash}: no message separator found`,
    );
  }

  const header = content.slice(0, headerEndIndex);
  const message = content.slice(headerEndIndex + 2);

  // parse header lines
  const lines = header.split("\n");
  const result: Partial<Commit> = {
    hash,
    parents: [],
    message,
  };

  for (const line of lines) {
    if (line.startsWith("tree ")) {
      result.tree = line.slice(5);
    } else if (line.startsWith("parent ")) {
      result.parents = result.parents || [];
      result.parents.push(line.slice(7));
    } else if (line.startsWith("author ")) {
      result.author = parsePerson(line.slice(7));
    } else if (line.startsWith("committer ")) {
      result.committer = parsePerson(line.slice(10));
    }
  }

  // validate required fields
  if (!result.tree) {
    throw new Error(`invalid commit format for ${hash}: missing tree`);
  }
  if (!result.author) {
    throw new Error(`invalid commit format for ${hash}: missing author`);
  }
  if (!result.committer) {
    throw new Error(`invalid commit format for ${hash}: missing committer`);
  }

  return result as Commit;
}

/**
 * Parses author/committer line from Git commit header.
 * Format: "Name With Spaces <email> timestamp timezone"
 *
 * Mirrors git's split_ident_line (ident.c):
 *  - name  = everything before the first "<", trailing whitespace trimmed
 *  - email = between first "<" and the *last* ">" (handles broken idents
 *            where the email itself contains a stray ">")
 *  - timestamp and timezone are parsed from the tail after the last ">",
 *    and are optional — git treats their absence as valid ("person_only")
 *
 * @param line The author/committer line without the "author "/"committer " prefix
 * @returns Parsed person information
 */
function parsePerson(line: string): {
  name: string;
  email: string;
  timestamp: number;
  timezone: string;
} {
  const mailOpen = line.indexOf("<");
  if (mailOpen === -1)
    return { name: line.trim(), email: "", timestamp: NaN, timezone: "" };

  const name = line.slice(0, mailOpen).trimEnd();

  // Use the *last* ">" as the mail boundary (git's broken-ident handling)
  const mailClose = line.lastIndexOf(">");
  const email = line.slice(mailOpen + 1, mailClose);

  // Parse optional "timestamp timezone" tail after the last ">"
  const tail = line.slice(mailClose + 1).trimStart();
  const tailMatch = tail.match(/^(\d+)\s+([+-]\d+)$/);
  const timestamp = tailMatch ? parseInt(tailMatch[1], 10) : NaN;
  const timezone = tailMatch ? tailMatch[2] : "";

  return { name, email, timestamp, timezone };
}
