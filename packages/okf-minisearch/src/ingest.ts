import { fromMarkdown } from "mdast-util-from-markdown";
import { parse } from "yaml";

import { OkfError } from "./errors.js";

import type { RootContent } from "mdast";
import type { Node, Position } from "unist";

import type {
  OkfDiagnostic,
  OkfDocument,
  OkfDocumentInput,
  OkfIndexRecord,
  OkfIngestResult,
  OkfSource,
  OkfStatus,
  OkfTimeWindow,
  OkfValidationResult,
  OkfVerification,
} from "./types.js";

const MAX_SECTION_WORDS = 800;
const TARGET_CHUNK_WORDS = 500;

const STANDARD_KEYS = new Set([
  "type", "title", "description", "resource", "tags", "sources",
  "usage_window", "generated", "verified", "status", "stale_after",
  "runtime", "parameters", "computation", "executor", "attester",
]);

type PositionedBlock = RootContent & { position: Position };

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

interface DocumentAnalysis {
  diagnostics: OkfDiagnostic[];
  prepared?: Omit<OkfIngestResult, "diagnostics">;
}

export function validateOkfDocument(
  input: OkfDocumentInput,
): OkfValidationResult {
  const { diagnostics: errors } = analyzeDocument(input);

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function prepareDocument(
  input: OkfDocumentInput,
): OkfIngestResult {
  const analysis = analyzeDocument(input);
  const diagnostic = analysis.diagnostics[0];

  if (diagnostic) {
    throw new OkfError(diagnostic.code, diagnostic.path, {
      ...(diagnostic.field ? { field: diagnostic.field } : {}),
    });
  }

  if (!analysis.prepared) {
    throw new Error("OKF analysis completed without a result");
  }

  return {
    ...analysis.prepared,
    diagnostics: [],
  };
}

function analyzeDocument(input: OkfDocumentInput): DocumentAnalysis {
  let path: string;
  let id: string;

  try {
    const identity = normalizeDocumentIdentity(input.path);
    path = identity.path;
    id = identity.documentId;
  } catch (error) {
    return expectedFailure(error);
  }

  let frontmatter: ReturnType<typeof splitFrontmatter>;

  try {
    frontmatter = splitFrontmatter(input.markdown, path);
  } catch (error) {
    return expectedFailure(error);
  }

  let parsed: unknown;

  try {
    parsed = parse(frontmatter.yaml);
  } catch {
    return { diagnostics: [diagnostic("ERR_OKF_PARSE", path)] };
  }

  if (!isRecord(parsed)) {
    return { diagnostics: [diagnostic("ERR_OKF_PARSE", path)] };
  }

  const diagnostics = validateFields(parsed, path);
  const title = typeof parsed.title === "string"
    ? parsed.title
    : titleFromId(id);
  let conceptSections: Section[] | undefined;

  try {
    conceptSections = sections(frontmatter.body, title, frontmatter.bodyStartLine);
  } catch {
    diagnostics.push(diagnostic("ERR_OKF_PARSE", path));
  }

  if (diagnostics.length || !conceptSections) {
    return { diagnostics };
  }

  const parsedDocument = buildDocument(parsed, id, frontmatter);
  return {
    diagnostics,
    prepared: prepareParsedDocument(parsedDocument, path, conceptSections),
  };
}

function expectedFailure(error: unknown): DocumentAnalysis {
  if (!(error instanceof OkfError) || error.code === "ERR_OKF_READ") {
    throw error;
  }

  return {
    diagnostics: [{
      code: error.code,
      path: error.path,
      ...(error.field ? { field: error.field } : {}),
      message: error.message,
    }],
  };
}

function diagnostic(
  code: OkfDiagnostic["code"],
  path: string,
  field?: string,
): OkfDiagnostic {
  const error = new OkfError(code, path, field ? { field } : {});
  return {
    code,
    path,
    ...(field ? { field } : {}),
    message: error.message,
  };
}

function validateFields(
  data: Record<string, unknown>,
  path: string,
): OkfDiagnostic[] {
  const result: OkfDiagnostic[] = [];
  const invalid = (field: string) => {
    result.push(diagnostic("ERR_OKF_FIELD", path, field));
  };
  const present = (key: string) => Object.hasOwn(data, key);

  if (typeof data.type !== "string" || !data.type.trim()) invalid("type");
  for (const key of ["title", "description", "resource"] as const) {
    if (present(key) && typeof data[key] !== "string") invalid(key);
  }

  validateStringArray(data, "tags", invalid);
  validateSources(data, invalid);
  if (present("usage_window")) validateTimeWindow(data.usage_window, "usage_window", invalid);
  validateGenerated(data, invalid);
  validateVerified(data, invalid);

  if (present("status") && data.status !== "draft" && data.status !== "stable" && data.status !== "deprecated") {
    invalid("status");
  }
  if (present("stale_after") && !validTimestamp(data.stale_after)) invalid("stale_after");
  if (present("runtime") && typeof data.runtime !== "string") invalid("runtime");
  else if (data.type === "Attested Computation" && !present("runtime")) invalid("runtime");

  validateParameters(data, invalid);
  if (present("computation") && typeof data.computation !== "string") invalid("computation");
  validateExecutor(data, invalid);
  validateAttester(data, invalid);

  return result;
}

function validateStringArray(
  data: Record<string, unknown>,
  key: string,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, key)) return;
  const value = data[key];
  if (!Array.isArray(value)) {
    invalid(key);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") invalid(`${key}[${index}]`);
  });
}

function validateSources(
  data: Record<string, unknown>,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, "sources")) return;
  if (!Array.isArray(data.sources)) {
    invalid("sources");
    return;
  }

  data.sources.forEach((value, index) => {
    const base = `sources[${index}]`;
    if (!isRecord(value)) {
      invalid(base);
      return;
    }
    if (typeof value.resource !== "string") invalid(`${base}.resource`);
    for (const key of ["id", "title"] as const) {
      if (Object.hasOwn(value, key) && typeof value[key] !== "string") invalid(`${base}.${key}`);
    }
    if (Object.hasOwn(value, "author") && (typeof value.author !== "string" || !validActor(value.author))) invalid(`${base}.author`);
    if (Object.hasOwn(value, "usage_count") && typeof value.usage_count !== "number") invalid(`${base}.usage_count`);
    if (Object.hasOwn(value, "last_modified") && !validTimestamp(value.last_modified)) invalid(`${base}.last_modified`);
    if (Object.hasOwn(value, "usage_window")) validateTimeWindow(value.usage_window, `${base}.usage_window`, invalid);
  });
}

function validateTimeWindow(
  value: unknown,
  base: string,
  invalid: (field: string) => void,
): void {
  if (!isRecord(value)) {
    invalid(base);
    return;
  }
  if (!validTimestamp(value.from)) invalid(`${base}.from`);
  if (!validTimestamp(value.to)) invalid(`${base}.to`);
}

function validateGenerated(
  data: Record<string, unknown>,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, "generated")) return;
  if (!isRecord(data.generated)) {
    invalid("generated");
    return;
  }
  if (typeof data.generated.by !== "string" || !validActor(data.generated.by)) invalid("generated.by");
  if (Object.hasOwn(data.generated, "at") && !validTimestamp(data.generated.at)) invalid("generated.at");
}

function validateVerified(
  data: Record<string, unknown>,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, "verified")) return;
  const values = Array.isArray(data.verified)
    ? data.verified
    : isRecord(data.verified)
      ? [data.verified]
      : undefined;
  if (!values) {
    invalid("verified");
    return;
  }
  values.forEach((value, index) => {
    const base = `verified[${index}]`;
    if (!isRecord(value)) {
      invalid(base);
      return;
    }
    if (typeof value.by !== "string" || !validActor(value.by)) invalid(`${base}.by`);
    if (!validTimestamp(value.at)) invalid(`${base}.at`);
  });
}

function validateParameters(
  data: Record<string, unknown>,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, "parameters")) return;
  if (!Array.isArray(data.parameters)) {
    invalid("parameters");
    return;
  }
  data.parameters.forEach((value, index) => {
    const base = `parameters[${index}]`;
    if (!isRecord(value)) {
      invalid(base);
      return;
    }
    if (typeof value.name !== "string") invalid(`${base}.name`);
    if (typeof value.type !== "string") invalid(`${base}.type`);
    if (typeof value.required !== "boolean") invalid(`${base}.required`);
  });
}

function validateExecutor(
  data: Record<string, unknown>,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, "executor")) return;
  if (!isRecord(data.executor)) {
    invalid("executor");
    return;
  }
  if (typeof data.executor.resource !== "string") invalid("executor.resource");
  if (!Array.isArray(data.executor.receipt)) {
    invalid("executor.receipt");
  } else {
    data.executor.receipt.forEach((value, index) => {
      if (typeof value !== "string") invalid(`executor.receipt[${index}]`);
    });
  }
}

function validateAttester(
  data: Record<string, unknown>,
  invalid: (field: string) => void,
): void {
  if (!Object.hasOwn(data, "attester")) return;
  if (!isRecord(data.attester)) {
    invalid("attester");
    return;
  }
  if (typeof data.attester.resource !== "string") invalid("attester.resource");
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && parseTimestamp(value) !== undefined;
}

function buildDocument(
  data: Record<string, unknown>,
  id: string,
  frontmatter: ReturnType<typeof splitFrontmatter>,
): ParsedDocument {
  const verified = verificationValue(data.verified);
  const status = Object.hasOwn(data, "status") ? data.status as OkfStatus : "stable";
  const staleAfter = Object.hasOwn(data, "stale_after") ? data.stale_after as string : undefined;
  const document: OkfDocument = {
    id,
    type: data.type as string,
    title: Object.hasOwn(data, "title") ? data.title as string : titleFromId(id),
    tags: Object.hasOwn(data, "tags") ? [...data.tags as string[]] : [],
    sources: sourceList(data.sources),
    verified: verified.events,
    body: frontmatter.body,
    extensions: Object.fromEntries(Object.entries(data).filter(([key]) => !STANDARD_KEYS.has(key))),
    ...(Object.hasOwn(data, "description") ? { description: data.description as string } : {}),
    ...(Object.hasOwn(data, "resource") ? { resource: data.resource as string } : {}),
    ...(Object.hasOwn(data, "usage_window") ? { usageWindow: timeWindow(data.usage_window) } : {}),
    ...(Object.hasOwn(data, "generated") ? { generated: generation(data.generated) } : {}),
    ...(status ? { status } : {}),
    ...(staleAfter !== undefined ? { staleAfter } : {}),
    ...(Object.hasOwn(data, "runtime") ? { runtime: data.runtime as string } : {}),
    ...(Object.hasOwn(data, "parameters") ? { parameters: parameterList(data.parameters) } : {}),
    ...(Object.hasOwn(data, "computation") ? { computation: data.computation as string } : {}),
    ...(Object.hasOwn(data, "executor") ? { executor: executorValue(data.executor) } : {}),
    ...(Object.hasOwn(data, "attester") ? { attester: attesterValue(data.attester) } : {}),
  };

  return {
    document,
    bodyStartLine: frontmatter.bodyStartLine,
    status,
    trustTier: verified.tier,
    staleAfterEpoch: staleAfter === undefined ? undefined : parseTimestamp(staleAfter),
    stalenessClassified: true,
  };
}

function prepareParsedDocument(
  parsed: ParsedDocument,
  path: string,
  conceptSections: Section[],
): Omit<OkfIngestResult, "diagnostics"> {
  const { document, bodyStartLine } = parsed;
  const lines = document.body.split(/\r\n|\n|\r/);
  const slugCounts = new Map<string, number>();
  const common = {
    documentId: document.id,
    path,
    title: document.title,
    description: document.description ?? "",
    type: document.type,
    tags: [...document.tags],
    resource: document.resource ?? "",
    sourceText: flattenSources(document.sources),
    status: parsed.status,
    trustTier: parsed.trustTier,
    stalenessClassified: parsed.stalenessClassified,
    ...(document.staleAfter ? { staleAfter: document.staleAfter } : {}),
    ...(parsed.staleAfterEpoch !== undefined ? { staleAfterEpoch: parsed.staleAfterEpoch } : {}),
  };
  const records = conceptSections.flatMap((section): OkfIndexRecord[] => {
    const sectionId = uniqueSlug(section.slug, slugCounts);
    const chunks = chunkSection(lines, bodyStartLine, section);
    return chunks.map((chunk, index) => ({
      ...common,
      id: chunks.length === 1 ? `${document.id}#${sectionId}` : `${document.id}#${sectionId}--part-${index + 1}`,
      headingPath: section.headingPath,
      text: chunk.text,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    }));
  });
  return { document, records };
}

function splitFrontmatter(
  markdown: string,
  path: string,
): { yaml: string; body: string; bodyStartLine: number } {
  const opening = markdown.startsWith("---\r\n") ? 5 : markdown.startsWith("---\n") ? 4 : 0;
  if (!opening) throw new OkfError("ERR_OKF_PARSE", path);
  const remainder = markdown.slice(opening);
  const closing = remainder.match(/(?:^|\r?\n)---(?:\r?\n|$)/);
  if (!closing || closing.index === undefined) throw new OkfError("ERR_OKF_PARSE", path);
  const yaml = remainder.slice(0, closing.index);
  const prefixLength = opening + closing.index + closing[0].length;
  const prefix = markdown.slice(0, prefixLength);
  return {
    yaml,
    body: markdown.slice(prefixLength),
    bodyStartLine: (prefix.match(/\r\n|\n/g)?.length ?? 0) + 1,
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

function sourceList(value: unknown): OkfSource[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item as Record<string, unknown>;
    return {
      resource: source.resource as string,
      ...(Object.hasOwn(source, "id") ? { id: source.id as string } : {}),
      ...(Object.hasOwn(source, "title") ? { title: source.title as string } : {}),
      ...(Object.hasOwn(source, "author") ? { author: source.author as string } : {}),
      ...(Object.hasOwn(source, "usage_count") ? { usageCount: source.usage_count as number } : {}),
      ...(Object.hasOwn(source, "last_modified") ? { lastModified: source.last_modified as string } : {}),
      ...(Object.hasOwn(source, "usage_window") ? { usageWindow: timeWindow(source.usage_window) } : {}),
    };
  });
}

function verificationValue(value: unknown): {
  events: OkfVerification[];
  tier: OkfIndexRecord["trustTier"];
} {
  if (value === undefined) return { events: [], tier: "unverified" };
  const values = Array.isArray(value) ? value : [value];
  const events = values.map((item) => {
    const event = item as Record<string, string>;
    return { by: event.by!, at: event.at! };
  });
  return {
    events,
    tier: events.some((event) => event.by.startsWith("human:"))
      ? "human-reviewed"
      : events.length ? "machine-confirmed" : "unverified",
  };
}

function timeWindow(value: unknown): OkfTimeWindow {
  const window = value as Record<string, string>;
  return { from: window.from!, to: window.to! };
}

function generation(value: unknown): OkfDocument["generated"] {
  const generated = value as Record<string, string>;
  return {
    by: generated.by!,
    ...(Object.hasOwn(generated, "at") ? { at: generated.at } : {}),
  };
}

function parameterList(value: unknown): NonNullable<OkfDocument["parameters"]> {
  return (value as Array<Record<string, unknown>>).map((parameter) => ({
    name: parameter.name as string,
    type: parameter.type as string,
    required: parameter.required as boolean,
  }));
}

function executorValue(value: unknown): NonNullable<OkfDocument["executor"]> {
  const executor = value as Record<string, unknown>;
  return {
    resource: executor.resource as string,
    receipt: [...executor.receipt as string[]],
  };
}

function attesterValue(value: unknown): NonNullable<OkfDocument["attester"]> {
  return { resource: (value as Record<string, string>).resource! };
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

export function normalizeDocumentIdentity(
  path: string,
): { path: string; documentId: string } {
  const normalizedPath = normalizePath(path);
  return {
    path: normalizedPath,
    documentId: documentId(normalizedPath),
  };
}

function normalizePath(path: string): string {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.startsWith("\\\\") || path.endsWith("/") || path.endsWith("/.")) {
    throw invalidUnsafePath();
  }
  const segments = path.split("/");
  if (segments.includes("..")) throw invalidUnsafePath();
  const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
  if (!normalized) throw invalidUnsafePath();
  return normalized;
}

function invalidUnsafePath(): OkfError {
  return new OkfError("ERR_OKF_FIELD", "<input>", { field: "path" });
}

function documentId(path: string): string {
  const filename = path.split("/").at(-1);
  if (!filename?.endsWith(".md") || filename === "index.md" || filename === "log.md") {
    throw new OkfError("ERR_OKF_FIELD", path, { field: "path" });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
