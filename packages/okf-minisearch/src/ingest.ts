import { fromMarkdown } from "mdast-util-from-markdown";
import { parse } from "yaml";

import { OkfError } from "./errors.js";

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

interface ParsedDocument {
  document: OkfDocument;
  bodyStartLine: number;
  status?: OkfStatus;
  trustTier?: OkfIndexRecord["trustTier"];
  staleAfterEpoch?: number;
  stalenessClassified: boolean;
}

export function prepareDocument(
  input: OkfDocumentInput,
): OkfIngestResult {
  const normalizedInput = {
    ...input,
    path: normalizePath(input.path),
  };
  const parsed = parseDocument(normalizedInput);
  const { document, bodyStartLine } = parsed;
  const lines = document.body.split(/\r\n|\n|\r/);
  const slugCounts = new Map<string, number>();

  const common = {
    documentId: document.id,
    path: normalizedInput.path,
    title: document.title,
    description: document.description ?? "",
    type: document.type,
    tags: document.tags,
    resource: document.resource ?? "",
    sourceText: flattenSources(document.sources),
    status: parsed.status,
    trustTier: parsed.trustTier,
    stalenessClassified: parsed.stalenessClassified,
    ...(document.staleAfter
      ? { staleAfter: document.staleAfter }
      : {}),
    ...(parsed.staleAfterEpoch !== undefined
      ? { staleAfterEpoch: parsed.staleAfterEpoch }
      : {}),
  };

  let conceptSections: Section[];

  try {
    conceptSections = sections(
      document.body,
      document.title,
      bodyStartLine,
    );
  } catch (cause) {
    throw new OkfError(
      "ERR_OKF_PARSE",
      normalizedInput.path,
      { cause },
    );
  }

  const records = conceptSections.flatMap(
    (section): OkfIndexRecord[] => {
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
    },
  );

  return {
    document,
    records,
    diagnostics: [],
  };
}

function parseDocument(
  input: OkfDocumentInput,
): ParsedDocument {
  const path = input.path;
  const id = documentId(path);
  const frontmatter = splitFrontmatter(
    input.markdown,
    path,
  );

  let parsed: unknown;

  try {
    parsed = parse(frontmatter.yaml);
  } catch (cause) {
    throw new OkfError(
      "ERR_OKF_PARSE",
      path,
      { cause },
    );
  }

  if (!isRecord(parsed)) {
    throw new OkfError(
      "ERR_OKF_PARSE",
      path,
    );
  }

  const data = parsed;
  const type = nonBlankString(data.type);

  if (!type) {
    throw new OkfError(
      "ERR_OKF_FIELD",
      path,
      { field: "type" },
    );
  }

  const description = string(data.description);
  const resource = string(data.resource);
  const usageWindow = timeWindow(data.usage_window);
  const generated = generation(data.generated);
  const verification = verificationValue(
    data,
  );
  const status = statusValue(data);
  const stale = staleAfterValue(data);
  const runtime = string(data.runtime);
  const parameters = parameterList(data.parameters);
  const computation = string(data.computation);
  const executor = executorValue(data.executor);
  const attester = attesterValue(data.attester);

  const document: OkfDocument = {
    id,
    type,
    title:
      nonBlankString(data.title) ??
      titleFromId(id),
    tags: stringList(data.tags),
    sources: sourceList(data.sources),
    verified: verification.events,
    body: frontmatter.body,

    extensions: Object.fromEntries(
      Object.entries(data).filter(
        ([key]) => !STANDARD_KEYS.has(key),
      ),
    ),

    ...(description ? { description } : {}),
    ...(resource ? { resource } : {}),
    ...(usageWindow ? { usageWindow } : {}),
    ...(generated ? { generated } : {}),
    ...(status ? { status } : {}),
    ...(stale.value
      ? { staleAfter: stale.value }
      : {}),
    ...(runtime ? { runtime } : {}),
    ...(parameters ? { parameters } : {}),
    ...(computation ? { computation } : {}),
    ...(executor ? { executor } : {}),
    ...(attester ? { attester } : {}),
  };

  return {
    document,
    bodyStartLine: frontmatter.bodyStartLine,
    status,
    trustTier: verification.tier,
    staleAfterEpoch: stale.epoch,
    stalenessClassified: stale.classified,
  };
}

function splitFrontmatter(
  markdown: string,
  path: string,
): {
  yaml: string;
  body: string;
  bodyStartLine: number;
} {
  const opening = markdown.startsWith("---\r\n")
    ? 5
    : markdown.startsWith("---\n")
      ? 4
      : 0;

  if (!opening) {
    throw new OkfError(
      "ERR_OKF_PARSE",
      path,
    );
  }

  const remainder = markdown.slice(opening);
  const closing = remainder.match(
    /(?:^|\r?\n)---(?:\r?\n|$)/,
  );

  if (!closing || closing.index === undefined) {
    throw new OkfError(
      "ERR_OKF_PARSE",
      path,
    );
  }

  const yaml = remainder.slice(
    0,
    closing.index,
  );
  const prefixLength =
    opening + closing.index + closing[0].length;
  const prefix = markdown.slice(0, prefixLength);

  return {
    yaml,
    body: markdown.slice(prefixLength),
    bodyStartLine:
      (prefix.match(/\r\n|\n/g)?.length ?? 0) + 1,
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

function verificationValue(
  data: Record<string, unknown>,
): {
  events: OkfVerification[];
  tier?: OkfIndexRecord["trustTier"];
} {
  if (!Object.hasOwn(data, "verified")) {
    return {
      events: [],
      tier: "unverified",
    };
  }

  const value = data.verified;
  const values = Array.isArray(value)
    ? value
    : isRecord(value)
      ? [value]
      : undefined;

  if (!values) {
    return { events: [] };
  }

  const events: OkfVerification[] = [];

  for (const item of values) {
    if (!isRecord(item)) {
      return { events: [] };
    }

    const by = nonBlankString(item.by);
    const at = nonBlankString(item.at);

    if (
      !by ||
      !at ||
      !validActor(by) ||
      parseTimestamp(at) === undefined
    ) {
      return { events: [] };
    }

    events.push({ by, at });
  }

  return {
    events,
    tier: events.some((event) =>
      event.by.startsWith("human:"),
    )
      ? "human-reviewed"
      : events.length
        ? "machine-confirmed"
        : "unverified",
  };
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
  data: Record<string, unknown>,
): OkfStatus | undefined {
  if (!Object.hasOwn(data, "status")) {
    return "stable";
  }

  const value = data.status;

  return value === "draft" ||
    value === "stable" ||
    value === "deprecated"
    ? value
    : undefined;
}

function staleAfterValue(
  data: Record<string, unknown>,
): {
  classified: boolean;
  value?: string;
  epoch?: number;
} {
  if (!Object.hasOwn(data, "stale_after")) {
    return { classified: true };
  }

  const value = nonBlankString(
    data.stale_after,
  );
  const epoch = value
    ? parseTimestamp(value)
    : undefined;

  return value && epoch !== undefined
    ? { classified: true, value, epoch }
    : { classified: false };
}

function validActor(value: string): boolean {
  return /^human:\S+$/.test(value) ||
    /^process:\S+$/.test(value) ||
    /^[^\s/]+\/[^\s/]+$/.test(value);
}

function parseTimestamp(
  value: string,
): number | undefined {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/,
  );

  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const millisecond = Number(
    fraction.slice(0, 3).padEnd(3, "0"),
  );
  const roundsUp = /[1-9]/.test(
    fraction.slice(3),
  );
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    return undefined;
  }

  const local = new Date(0);
  local.setUTCHours(
    hour,
    minute,
    second,
    millisecond,
  );
  local.setUTCFullYear(year, month - 1, day);

  const offset = match[8] === "Z"
    ? 0
    : (match[9] === "+" ? 1 : -1) *
      (offsetHour * 60 + offsetMinute) *
      60_000;
  const epoch = local.getTime() - offset;

  return Number.isFinite(epoch)
    ? epoch + (roundsUp ? 1 : 0)
    : undefined;
}

function daysInMonth(
  year: number,
  month: number,
): number {
  if (month === 2) {
    return year % 4 === 0 &&
      (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28;
  }

  return [4, 6, 9, 11].includes(month)
    ? 30
    : 31;
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

function normalizePath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.startsWith("\\\\") ||
    path.endsWith("/") ||
    path.endsWith("/.")
  ) {
    throw invalidUnsafePath();
  }

  const segments = path.split("/");

  if (segments.includes("..")) {
    throw invalidUnsafePath();
  }

  const normalized = segments
    .filter((segment) => segment && segment !== ".")
    .join("/");

  if (!normalized) {
    throw invalidUnsafePath();
  }

  return normalized;
}

function invalidUnsafePath(): OkfError {
  return new OkfError(
    "ERR_OKF_FIELD",
    "<input>",
    { field: "path" },
  );
}

function documentId(path: string): string {
  const filename = path.split("/").at(-1);

  if (
    !filename?.endsWith(".md") ||
    filename === "index.md" ||
    filename === "log.md"
  ) {
    throw new OkfError(
      "ERR_OKF_FIELD",
      path,
      { field: "path" },
    );
  }

  return path.slice(0, -3);
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

function nonBlankString(
  value: unknown,
): string | undefined {
  return typeof value === "string" &&
    value.trim().length
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
  return isRecord(value)
    ? value
    : {};
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}
