import MiniSearch from "minisearch";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parse } from "yaml";

import type { RootContent } from "mdast";
import type { Node, Position } from "unist";

import type {
  OkfDocument,
  OkfDocumentInput,
  OkfIndexRecord,
  OkfIngestResult,
  OkfSource,
  OkfStatus,
  OkfTimeWindow,
  OkfVerification,
} from "./types.js";

const MAX_SECTION_WORDS = 800;
const TARGET_CHUNK_WORDS = 500;

const STANDARD_KEYS = new Set([
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "sources",
  "usage_window",
  "generated",
  "verified",
  "status",
  "stale_after",
  "runtime",
  "parameters",
  "computation",
  "executor",
  "attester",
]);

type PositionedBlock = RootContent & {
  position: Position;
};

interface Section {
  headingPath: string;
  slug: string;
  headingLine?: number;
  blocks: PositionedBlock[];
}

interface Chunk {
  text: string;
  startLine: number;
  endLine: number;
}

export function ingestDocument(
  index: MiniSearch<OkfIndexRecord>,
  input: OkfDocumentInput,
): OkfIngestResult {
  const { document, bodyStartLine } = parseDocument(input);
  const lines = document.body.split(/\r\n|\n|\r/);
  const slugCounts = new Map<string, number>();

  const common = {
    documentId: document.id,
    title: document.title,
    description: document.description ?? "",
    type: document.type,
    tags: document.tags,
    resource: document.resource ?? "",
    sourceText: flattenSources(document.sources),
    status: document.status,
    trustTier: trustTier(document.verified),
    ...(document.staleAfter
      ? { staleAfter: document.staleAfter }
      : {}),
  };

  const records = sections(
    document.body,
    document.title,
    bodyStartLine,
  ).flatMap((section): OkfIndexRecord[] => {
    const sectionId = uniqueSlug(
      section.slug,
      slugCounts,
    );

    const chunks = chunkSection(
      lines,
      bodyStartLine,
      section,
    );

    return chunks.map((chunk, index) => ({
      ...common,

      id:
        chunks.length === 1
          ? `${document.id}#${sectionId}`
          : `${document.id}#${sectionId}--part-${index + 1}`,

      headingPath: section.headingPath,
      text: chunk.text,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    }));
  });

  const previousIds = index
    .search(MiniSearch.wildcard, {
      filter: (result) =>
        result.documentId === document.id,
    })
    .map((result) => result.id);

  if (previousIds.length > 0) {
    index.discardAll(previousIds);
  }

  index.addAll(records);

  return {
    document,
    records,
    diagnostics: [],
  };
}

function parseDocument(
  input: OkfDocumentInput,
): {
  document: OkfDocument;
  bodyStartLine: number;
} {
  const id = documentId(input.path);

  const match = input.markdown.match(
    /^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/,
  );

  if (!match) {
    throw new Error(
      `Missing YAML frontmatter: ${input.path}`,
    );
  }

  const prefix = match[0];
  const body = input.markdown.slice(prefix.length);
  const data = record(parse(match[1] ?? ""));
  const type = string(data.type);

  if (!type) {
    throw new Error(`Missing OKF type: ${input.path}`);
  }

  const description = string(data.description);
  const resource = string(data.resource);
  const usageWindow = timeWindow(data.usage_window);
  const generated = generation(data.generated);
  const staleAfter = string(data.stale_after);
  const runtime = string(data.runtime);
  const parameters = parameterList(data.parameters);
  const computation = string(data.computation);
  const executor = executorValue(data.executor);
  const attester = attesterValue(data.attester);

  const document: OkfDocument = {
    id,
    type,
    title: string(data.title) ?? titleFromId(id),
    tags: stringList(data.tags),
    sources: sourceList(data.sources),
    verified: verificationList(data.verified),
    status: statusValue(data.status),
    body,

    extensions: Object.fromEntries(
      Object.entries(data).filter(
        ([key]) => !STANDARD_KEYS.has(key),
      ),
    ),

    ...(description ? { description } : {}),
    ...(resource ? { resource } : {}),
    ...(usageWindow ? { usageWindow } : {}),
    ...(generated ? { generated } : {}),
    ...(staleAfter ? { staleAfter } : {}),
    ...(runtime ? { runtime } : {}),
    ...(parameters ? { parameters } : {}),
    ...(computation ? { computation } : {}),
    ...(executor ? { executor } : {}),
    ...(attester ? { attester } : {}),
  };

  return {
    document,
    bodyStartLine:
      (prefix.match(/\r\n|\n|\r/g)?.length ?? 0) + 1,
  };
}

function sections(
  body: string,
  title: string,
  bodyStartLine: number,
): Section[] {
  const result: Section[] = [];

  const stack: Array<{
    depth: number;
    text: string;
  }> = [];

  let current: Section = {
    headingPath: title,
    slug: "root",
    blocks: [],
  };

  for (const node of fromMarkdown(body).children) {
    if (node.type !== "heading") {
      if (node.position) {
        current.blocks.push(
          node as PositionedBlock,
        );
      }

      continue;
    }

    if (
      current.headingLine !== undefined ||
      current.blocks.length > 0
    ) {
      result.push(current);
    }

    const depth =
      "depth" in node &&
      typeof node.depth === "number"
        ? node.depth
        : 1;

    while (
      stack.at(-1)?.depth &&
      stack.at(-1)!.depth >= depth
    ) {
      stack.pop();
    }

    const text =
      nodeText(node).trim() || "Untitled section";

    stack.push({ depth, text });

    const headingPath = stack
      .map((item) => item.text)
      .join(" > ");

    current = {
      headingPath,
      slug: slug(headingPath),

      headingLine:
        bodyStartLine +
        (node.position?.start.line ?? 1) -
        1,

      blocks: [],
    };
  }

  if (
    current.headingLine !== undefined ||
    current.blocks.length > 0 ||
    !result.length
  ) {
    result.push(current);
  }

  return result;
}

function chunkSection(
  lines: string[],
  bodyStartLine: number,
  section: Section,
): Chunk[] {
  const blocks = section.blocks.map((block) => ({
    block,
    words: wordCount(
      slice(lines, block.position),
    ),
  }));

  const totalWords = blocks.reduce(
    (sum, item) => sum + item.words,
    0,
  );

  if (totalWords <= MAX_SECTION_WORDS) {
    return [
      chunk(
        lines,
        bodyStartLine,
        section,
        section.blocks,
        true,
      ),
    ];
  }

  const groups: PositionedBlock[][] = [[]];
  const groupWords: number[] = [0];

  for (const item of blocks) {
    let last = groups.length - 1;

    if (
      groups[last]!.length > 0 &&
      groupWords[last]! + item.words >
        TARGET_CHUNK_WORDS
    ) {
      groups.push([]);
      groupWords.push(0);
      last += 1;
    }

    groups[last]!.push(item.block);
    groupWords[last] =
      groupWords[last]! + item.words;
  }

  if (
    groups.length > 1 &&
    groupWords.at(-1)! <
      TARGET_CHUNK_WORDS / 2
  ) {
    groups.at(-2)!.push(...groups.at(-1)!);
    groups.pop();
  }

  return groups.map((blocks, index) =>
    chunk(
      lines,
      bodyStartLine,
      section,
      blocks,
      index === 0,
    ),
  );
}

function chunk(
  lines: string[],
  bodyStartLine: number,
  section: Section,
  blocks: PositionedBlock[],
  includeHeading: boolean,
): Chunk {
  if (!blocks.length) {
    const line =
      section.headingLine ?? bodyStartLine;

    return {
      text: "",
      startLine: line,
      endLine: line,
    };
  }

  const first =
    blocks[0]!.position.start.line;

  const last =
    blocks.at(-1)!.position.end.line;

  return {
    text: lines
      .slice(first - 1, last)
      .join("\n")
      .trim(),

    startLine:
      includeHeading &&
      section.headingLine !== undefined
        ? section.headingLine
        : bodyStartLine + first - 1,

    endLine:
      bodyStartLine + last - 1,
  };
}

function sourceList(
  value: unknown,
): OkfSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const source = record(item);
    const resource = string(source.resource);

    if (!resource) {
      return [];
    }

    const id = string(source.id);
    const title = string(source.title);
    const author = string(source.author);
    const lastModified = string(
      source.last_modified,
    );

    const usageWindow = timeWindow(
      source.usage_window,
    );

    return [
      {
        resource,

        ...(id ? { id } : {}),
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),

        ...(typeof source.usage_count === "number"
          ? { usageCount: source.usage_count }
          : {}),

        ...(lastModified
          ? { lastModified }
          : {}),

        ...(usageWindow
          ? { usageWindow }
          : {}),
      },
    ];
  });
}

function verificationList(
  value: unknown,
): OkfVerification[] {
  const values = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  return values.flatMap((item) => {
    const verification = record(item);
    const by = string(verification.by);
    const at = string(verification.at);

    return by && at
      ? [{ by, at }]
      : [];
  });
}

function timeWindow(
  value: unknown,
): OkfTimeWindow | undefined {
  const window = record(value);
  const from = string(window.from);
  const to = string(window.to);

  return from && to
    ? { from, to }
    : undefined;
}

function generation(
  value: unknown,
): OkfDocument["generated"] {
  const generated = record(value);
  const by = string(generated.by);
  const at = string(generated.at);

  return by
    ? {
        by,
        ...(at ? { at } : {}),
      }
    : undefined;
}

function parameterList(
  value: unknown,
): OkfDocument["parameters"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((item) => {
    const parameter = record(item);
    const name = string(parameter.name);
    const type = string(parameter.type);

    return (
      name &&
      type &&
      typeof parameter.required === "boolean"
    )
      ? [
          {
            name,
            type,
            required: parameter.required,
          },
        ]
      : [];
  });
}

function executorValue(
  value: unknown,
): OkfDocument["executor"] {
  const executor = record(value);
  const resource = string(executor.resource);

  return resource
    ? {
        resource,
        receipt: stringList(executor.receipt),
      }
    : undefined;
}

function attesterValue(
  value: unknown,
): OkfDocument["attester"] {
  const resource = string(
    record(value).resource,
  );

  return resource
    ? { resource }
    : undefined;
}

function statusValue(
  value: unknown,
): OkfStatus {
  return value === "draft" ||
    value === "deprecated"
    ? value
    : "stable";
}

function trustTier(
  verified: readonly OkfVerification[],
): OkfIndexRecord["trustTier"] {
  if (
    verified.some((item) =>
      item.by.startsWith("human:"),
    )
  ) {
    return "human-reviewed";
  }

  return verified.length
    ? "machine-confirmed"
    : "unverified";
}

function flattenSources(
  sources: readonly OkfSource[],
): string {
  return sources
    .flatMap((source) => [
      source.id,
      source.title,
      source.author,
      source.resource,
    ])
    .filter(
      (value): value is string =>
        Boolean(value),
    )
    .join(" ");
}

function documentId(path: string): string {
  const normalized = path
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");

  const filename = normalized
    .split("/")
    .at(-1)
    ?.toLowerCase();

  if (!filename?.endsWith(".md")) {
    throw new Error(
      `Not Markdown: ${path}`,
    );
  }

  if (
    filename === "index.md" ||
    filename === "log.md"
  ) {
    throw new Error(
      `Reserved OKF file: ${path}`,
    );
  }

  return normalized.slice(0, -3);
}

function nodeText(node: Node): string {
  const value = node as Node & {
    value?: unknown;
    children?: Node[];
  };

  return [
    typeof value.value === "string"
      ? value.value
      : "",

    ...(value.children?.map(nodeText) ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function slice(
  lines: string[],
  position: Position,
): string {
  return lines
    .slice(
      position.start.line - 1,
      position.end.line,
    )
    .join("\n");
}

function uniqueSlug(
  value: string,
  counts: Map<string, number>,
): string {
  const count =
    (counts.get(value) ?? 0) + 1;

  counts.set(value, count);

  return count === 1
    ? value
    : `${value}--${count}`;
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(
        /[^\p{L}\p{N}]+/gu,
        "-",
      )
      .replace(/^-+|-+$/g, "") ||
    "section"
  );
}

function titleFromId(id: string): string {
  const title = (
    id.split("/").at(-1) ?? id
  ).replace(/[-_]+/g, " ");

  return (
    title.charAt(0).toUpperCase() +
    title.slice(1)
  );
}

function wordCount(value: string): number {
  return (
    value.match(
      /[\p{L}\p{N}_]+/gu,
    )?.length ?? 0
  );
}

function string(
  value: unknown,
): string | undefined {
  return typeof value === "string" &&
    value.length
    ? value
    : undefined;
}

function stringList(
  value: unknown,
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string",
      )
    : [];
}

function record(
  value: unknown,
): Record<string, unknown> {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : {};
}