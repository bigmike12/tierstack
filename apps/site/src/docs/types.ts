/**
 * The docs are data, not markup.
 *
 * Every page below is a list of blocks that a single renderer knows how to
 * draw. That is the whole point: when the API changes, the edit is one entry
 * in `content.ts` — not a hunt through JSX for the paragraph that went stale.
 * Nothing here is generated from the running server, so the rule is simple:
 * change a route, change its block in the same commit.
 */

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ParamRow {
  name: string;
  type: string;
  required?: boolean;
  note: string;
}

export type Block =
  /** A paragraph. Text inside `backticks` renders as inline code. */
  | { kind: "prose"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "code"; code: string; caption?: string }
  | { kind: "endpoint"; method: Method; path: string; summary?: string }
  | { kind: "params"; title?: string; rows: ParamRow[] }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone?: "info" | "warn"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export interface DocPage {
  slug: string;
  title: string;
  /** One line, shown in the sidebar hover and on the docs index. */
  summary: string;
  blocks: Block[];
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}
